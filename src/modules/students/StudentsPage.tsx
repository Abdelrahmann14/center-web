import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  Ban,
  Barcode,
  FileChartColumn,
  Loader2,
  Pencil,
  Trash2,
  Users,
  Users2,
  Copy,
  SlidersHorizontal,
  Plus,
} from "@/components/icons";
import { THEAD } from "@/components/tableStyles";
import { RowActionsMenu, type RowAction } from "@/components/RowActionsMenu";
import { Pagination } from "@/components/Pagination";
import { api, ApiError, isOfflineError, qs } from "@/lib/api";
import { useOnline } from "@/lib/useOnline";
import { useWhatsappAction } from "@/lib/useWhatsappAvailability";
import { useSync } from "@/sync/SyncProvider";
import { toast } from "@/components/ui/toast";
import { cachedGet, cachedGetAll, invalidate } from "@/lib/dataCache";
import { useDebounced } from "@/lib/useDebounced";
import { fmtDate } from "@/lib/datetime";
import { localPhone } from "@/lib/phone";
import { AuditCell } from "@/components/AuditCell";
import { usePageState } from "@/lib/pageState";
import { useAuth } from "@/auth/AuthContext";
import { useBarcodeScanner } from "@/lib/useBarcodeScanner";
import {
  STUDENT_SEARCH_PLACEHOLDER,
  matchesStudentSearch,
  searchModeLabel,
} from "@/lib/studentSearch";
import { isIncomplete } from "./incompleteFields";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { Select, ConfirmDialog, Money } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import {
  StudentForm,
  groupLabel,
  type Student,
  type StudentOptions,
  type Grade,
  type Group,
  AUTO_BARCODE_PATH,
} from "./StudentForm";
import { StudentDetails } from "./StudentDetails";

const ROWS_OPTIONS = ["10", "25", "50"];

/**
 * Cards per request. Matches the server's own cap, which is chosen so one
 * request stays comfortably inside every timeout between here and the sender.
 */
const BARCODE_BATCH = 20;

/** GET /students/barcode/pending - how many students never got their card. */
interface Backlog {
  pending: number;
  /** Why no card can go out at all right now, or null when one can. */
  blocked_reason: string | null;
}

/** POST /students/barcode/send-pending - one batch, and what is left after it. */
interface BarcodeBatch {
  sent: number;
  failed: number;
  remaining: number;
  blocked_reason: string | null;
}

/** Running totals of a bulk send, so the button can show real progress. */
interface BulkProgress {
  sent: number;
  failed: number;
  remaining: number;
}

const Dash = () => <span className="block text-center text-slate-300">-</span>;


const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * One phone number, with what WhatsApp last did with it.
 *
 * <p>Three states, and only two of them draw anything. A green dot means a
 * message to this number was reported delivered; red means the last attempt came
 * back undeliverable. A number nobody has messaged yet gets NO dot - inventing a
 * grey "unknown" mark for it would put a symbol beside every number on a fresh
 * workspace and teach the eye to ignore all three.
 *
 * <p>The red dot says "did not arrive", not "has no WhatsApp". Meta returns one
 * bucket error for several causes and does not say which applied, so the
 * stronger claim would be one the data cannot support.
 */
function PhoneCell({ phone, reach }: { phone: string; reach: Record<string, boolean> }) {
  const state = reach[localPhone(phone)];
  return (
    // justify-end, and not by preference: the cell is dir="ltr" so the digits
    // read correctly, and a flex box ignores the table's text-align entirely.
    // Without it the numbers packed to the left edge while their headers stayed
    // right, and every phone column looked a centimetre out of line.
    <span className="flex items-center justify-end gap-1.5">
      {state !== undefined && (
        <span
          title={
            state
              ? "وصلت رسالة واتساب لهذا الرقم من قبل"
              : "آخر رسالة واتساب لهذا الرقم لم تصل - غالبًا لا يوجد واتساب عليه"
          }
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${state ? "bg-green-500" : "bg-rose-500"}`}
        />
      )}
      <span className="truncate" title={phone}>
        {phone}
      </span>
    </span>
  );
}

export default function StudentsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const sync = useSync();
  const online = useOnline();
  const canCreate = can("STUDENT_CREATE");
  const canUpdate = can("STUDENT_UPDATE");
  const canDelete = can("STUDENT_DELETE");
  const canAnalytics = can("STUDENT_ANALYTICS");
  // Same permission the server puts on POST /students/{id}/barcode/send.
  const canSendBarcode = can("STUDENT_REPORT_SEND");
  // Permission is only half of it: the card goes out over WhatsApp, and the
  // server is the one that knows whether a number - and, on the official
  // account, an approved template with a file header - is actually in place.
  const waBarcode = useWhatsappAction("barcode");
  const [allRows, setAllRows] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  // Two lists on purpose. The full one renders and validates students who may
  // carry a grade this workspace no longer teaches; the short one is what the
  // forms offer, so a new student cannot be put into a grade with no price.
  const [formGrades, setFormGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [options, setOptions] = useState<StudentOptions | null>(null);
  const [loading, setLoading] = useState(true);

  // Search persists across navigation (return as you left it). The full-text
  // search hits the server; the chip filters below run over the whole dataset
  // in the browser, and pagination is applied to the FILTERED rows.
  const [search, setSearch] = usePageState("students.search", "");
  const [rows, setRows] = usePageState("students.rows", "10");
  const [page, setPage] = usePageState("students.page", 1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [viewStudent, setViewStudent] = useState<Student | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Student | null>(null);
  /** Id of the student whose barcode is being sent, so only that row spins. */
  const [sendingBarcode, setSendingBarcode] = useState<string | null>(null);

  // ── The backlog of students who have never been sent their card ──
  //
  // The count is the server's, not a tally of the loaded rows: it applies the
  // same three rules the send itself applies (never sent, still active, has a
  // number of their own), so the button can never offer work the send would
  // then skip. `blocked` is why nothing can go out at all - no number, or no
  // template bound to the barcode type - and it is what the button says instead
  // of letting the teacher press it and collect a screen of identical failures.
  const [backlog, setBacklog] = useState<Backlog | null>(null);
  /** Non-null while the bulk send is running: what it has done so far. */
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  /**
   * True once the button has been pressed a first time.
   *
   * <p>The press does not send. It narrows the table to exactly the students the
   * send would cover, and turns the button into "إرسال (n)" - so the second
   * press confirms a list the teacher is looking at rather than a promise in a
   * dialog. This is the same two-step the lesson page's attendance and grade
   * buttons use, and it is here for a stronger reason: this send is the one that
   * can reach a hundred and forty families in a row.
   */
  const [armedBarcode, setArmedBarcode] = useState(false);
  /**
   * Why the backlog could not be read, when it could not.
   *
   * <p>A disabled button whose own state failed to load is the worst thing this
   * page can show: it looks like a considered "no" when it is really "I never
   * found out". Carrying the server's words into the tooltip turns a dead
   * control into something that can be diagnosed without a browser console.
   */
  const [backlogError, setBacklogError] = useState<string | null>(null);

  // ── Which numbers WhatsApp actually reached ──
  //
  // Phone (local form) -> did the last thing we learned about it say the message
  // landed. A number that is ABSENT has never been messaged: unknown, not fine.
  // Nothing here asks WhatsApp anything - the official API has no endpoint that
  // answers "is this number registered" - so this is what the delivery reports
  // for this teacher's own number have said so far.
  const [reach, setReach] = useState<Record<string, boolean>>({});

  /**
   * A scanned code IS a student code, so it goes straight into the search box -
   * the shared rule reads a digit string that does not start with 0 as a code,
   * which narrows the table to that one student. One behaviour, two ways in.
   */
  function onScanned(code: string) {
    const digits = code.replace(/\D/g, "");
    setSearch(digits || code);
    setPage(1);
  }

  // A desk scanner typing into the page while focus is elsewhere.
  useBarcodeScanner(onScanned);

  // Searching and filtering happen on the server, so don't fire a request per
  // keystroke.
  const debouncedSearch = useDebounced(search);

  // Small shared lookup lists, loaded once through the SWR cache.
  useEffect(() => {
    Promise.all([
      cachedGet<Grade[]>("/grades"),
      cachedGet<Grade[]>("/grades/in-use"),
      cachedGet<Group[]>("/groups"),
      cachedGet<StudentOptions>("/students/options"),
    ])
      .then(([gr, inUse, gp, opt]) => {
        setGrades(gr);
        setFormGrades(inUse);
        setGroups(gp);
        setOptions(opt);
      })
      .catch(() => {});
  }, []);

  // Filter keys are the backend record's component names and `sort` is the
  // entity property - both camelCase, unlike the snake_case response bodies.
  // No page/size here: `cachedGetAll` pulls every page of this search, so the
  // chip filters below can run over the whole dataset.
  //
  // Client-side toggles over the loaded dataset: show only the duplicates, or
  // only the records that share a guardian number (grouped together).
  const [dupOnly, setDupOnly] = useState(false);
  const [sharedParentOnly, setSharedParentOnly] = useState(false);

  const query = qs({
    search: debouncedSearch.trim(),
    sort: "createdAt,desc",
  });

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedGetAll<Student>(`/students${query}`)
      .then((data) => {
        // A slower earlier query must not overwrite a newer one's results.
        if (!cancelled) setAllRows(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  const reload = () => setReloadKey((n) => n + 1);

  // Reloaded with the table: every send this page makes adds to what is known,
  // and the answer for a number can flip either way over time.
  useEffect(() => {
    let cancelled = false;
    api
      .get<Record<string, boolean>>("/messaging/whatsapp/reachability")
      .then((m) => {
        if (!cancelled) setReach(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Refreshed with the table, so sending a card - from a row or in bulk - and
  // adding a student both move the number on the button.
  useEffect(() => {
    if (!canSendBarcode) return;
    let cancelled = false;
    // Through the cache: the button then paints its real count on the first
    // frame of a revisit instead of showing "—" and unlocking a moment later.
    // Every mutation here already calls invalidate("/students"), which this path
    // sits under, so the count can never go stale behind a press.
    //
    // The auto-send switch is warmed alongside it, unread here. It belongs to
    // the add-student form, which cannot fetch it early enough to draw itself
    // complete - by the time anyone presses "add", this has already landed.
    cachedGet(AUTO_BARCODE_PATH).catch(() => {});
    cachedGet<Backlog>("/students/barcode/pending")
      .then((b) => {
        if (!cancelled) {
          setBacklog(b);
          setBacklogError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBacklogError(err instanceof ApiError ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canSendBarcode, reloadKey]);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // ── Client-side chip filters (over the whole dataset). Never id / name /
  // created / updated. ──
  /**
   * A record is incomplete when any field the student form requires is missing -
   * whatever the reason (imported data, a record saved before a field existed,
   * a group that was later deleted). The track only counts when the student's
   * grade actually has tracks.
   *
   * <p>A name shorter than four parts counts too. Two parts now SAVE fine - the
   * form no longer refuses them - but the quadruple is still the complete
   * Egyptian name, so a short one leaves the row amber and chase-able instead of
   * blocking whoever was trying to enter the student.
   */
  const incomplete = useMemo(() => (s: Student) => isIncomplete(s, grades), [grades]);

  // ── Duplicate detection, computed once over the whole loaded dataset. Two
  // independent kinds, each with its own row colour:
  //   • name/phone duplicate — the same name, or a student phone shared with
  //     another student (a real collision to clean up after importing).
  //   • parent-phone duplicate — siblings, or two records that ended up on the
  //     same guardian number.
  // A student's own repeated number does not count (deduped per student). ──
  const dup = useMemo(() => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const digits = (p: string) => p.replace(/\D/g, "");
    const nameCount = new Map<string, number>();
    const studentPhoneCount = new Map<string, number>();
    const parentPhoneCount = new Map<string, number>();
    for (const s of allRows) {
      const n = norm(s.name);
      if (n) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      for (const d of new Set(s.student_phones.map(digits).filter(Boolean))) {
        studentPhoneCount.set(d, (studentPhoneCount.get(d) ?? 0) + 1);
      }
      for (const d of new Set(s.parent_phones.map(digits).filter(Boolean))) {
        parentPhoneCount.set(d, (parentPhoneCount.get(d) ?? 0) + 1);
      }
    }
    const nameDup = (s: Student) => {
      const n = norm(s.name);
      return !!n && (nameCount.get(n) ?? 0) > 1;
    };
    const studentPhoneDup = (s: Student) =>
      s.student_phones.map(digits).filter(Boolean).some((d) => (studentPhoneCount.get(d) ?? 0) > 1);
    const nameOrPhoneDup = (s: Student) => nameDup(s) || studentPhoneDup(s);
    const parentPhoneDup = (s: Student) =>
      s.parent_phones.map(digits).filter(Boolean).some((d) => (parentPhoneCount.get(d) ?? 0) > 1);
    // Sort key that puts records sharing a parent number next to each other.
    const parentGroupKey = (s: Student) => {
      for (const d of s.parent_phones.map(digits).filter(Boolean)) {
        if ((parentPhoneCount.get(d) ?? 0) > 1) return d;
      }
      return "~"; // students with no shared parent number sort last
    };
    return { nameOrPhoneDup, parentPhoneDup, parentGroupKey };
  }, [allRows]);

  const colVal = useMemo(() => {
    const priceLabel = (s: Student) =>
      s.lesson_price == null ? "—" : s.lesson_price === 0 ? "معفي" : String(s.lesson_price);
    return {
      grade: (s: Student) => s.grade || "—",
      group: (s: Student) => {
        const g = s.group_id ? groupById.get(s.group_id) : undefined;
        return g ? groupLabel(g) : "—";
      },
      school: (s: Student) => s.school || "—",
      religion: (s: Student) => s.religion || "—",
      gender: (s: Student) => s.gender || "—",
      status: (s: Student) => (s.is_active ? "نشط" : "محظور"),
      data: (s: Student) => (incomplete(s) ? "بيانات ناقصة" : "بيانات مكتملة"),
      price: priceLabel,
      google: (s: Student) => (s.google_synced ? "مُزامَن" : "غير مُزامَن"),
      barcode: (s: Student) => (s.barcode_sent_at ? "أُرسل" : "لم يُرسل"),
      // The worst news across the student's numbers wins: one unreachable
      // guardian is the thing worth finding, and it would be hidden by a
      // second number that happens to work.
      whatsapp: (s: Student) => {
        const states = [...s.student_phones, ...s.parent_phones]
          .map((p) => reach[localPhone(p)])
          .filter((v) => v !== undefined);
        if (states.some((v) => v === false)) return "لم يصل";
        if (states.some((v) => v === true)) return "يصل";
        return "غير معروف";
      },
    } as const;
  }, [groupById, incomplete, reach]);
  type ColKey = keyof typeof colVal;

  // The chip bar. Order = display order; each is a searchable multi-select.
  const FIELDS: { key: ColKey; label: string }[] = [
    { key: "grade", label: "الصف" },
    { key: "group", label: "المجموعة" },
    { key: "school", label: "المدرسة" },
    { key: "religion", label: "الديانة" },
    { key: "gender", label: "النوع" },
    { key: "status", label: "الحالة" },
    { key: "data", label: "اكتمال البيانات" },
    { key: "price", label: "السعر" },
    { key: "google", label: "مزامنة Google" },
    { key: "barcode", label: "كارت الباركود" },
    { key: "whatsapp", label: "واتساب" },
  ];
  const [hiddenFields, setHiddenFields] = useState<Set<ColKey>>(new Set());

  const [colF, setColF] = useState<Partial<Record<ColKey, Set<string>>>>({});
  const setCol = (k: ColKey, s: Set<string>) => setColF((prev) => ({ ...prev, [k]: s }));

  // Options come from the whole dataset, so a value that exists only on a later
  // page is still offered as a filter.
  const distinct = useMemo(() => {
    const out = {} as Record<ColKey, string[]>;
    (Object.keys(colVal) as ColKey[]).forEach((k) => {
      out[k] = Array.from(new Set(allRows.map(colVal[k]))).sort((a, b) => a.localeCompare(b, "ar"));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, colVal]);

  /**
   * The students a barcode send would actually reach.
   *
   * <p>The same three rules the server applies when it picks the batch itself
   * (never sent, still active, has a number of their own), restated here because
   * this list is what the teacher is shown and what is then sent - if the two
   * ever disagreed, the preview would be a lie. The server's count on the button
   * is the authority for "how many are waiting"; this is the authority for "who".
   */
  const barcodeTargets = useMemo(
    () =>
      allRows.filter(
        (s) =>
          !s.barcode_sent_at &&
          s.is_active &&
          s.student_phones.some((p) => p.trim() !== ""),
      ),
    [allRows],
  );

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim();
    // Armed, the table IS the recipient list: it starts from the targets, and
    // any chip the teacher then adds narrows who gets a card - which is the
    // point of previewing rather than firing on the first press.
    const source = armedBarcode ? barcodeTargets : allRows;
    return source.filter(
      (s) =>
        matchesStudentSearch(s, term) &&
        (!dupOnly || dup.nameOrPhoneDup(s)) &&
        (!sharedParentOnly || dup.parentPhoneDup(s)) &&
        (Object.keys(colF) as ColKey[]).every((k) => {
          const set = colF[k];
          return !set || set.size === 0 || set.has(colVal[k](s));
        })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, armedBarcode, barcodeTargets, colF, colVal, debouncedSearch, dupOnly, sharedParentOnly, dup]);
  const anyColFilter = Object.values(colF).some((s) => s && s.size > 0);

  // When filtering by shared guardian number, order the results so the records
  // that share a number sit next to each other (then by name within a family).
  const ordered = useMemo(() => {
    if (!sharedParentOnly) return filtered;
    return [...filtered].sort((a, b) => {
      const ka = dup.parentGroupKey(a);
      const kb = dup.parentGroupKey(b);
      if (ka !== kb) return ka.localeCompare(kb);
      return a.name.localeCompare(b.name, "ar");
    });
  }, [filtered, sharedParentOnly, dup]);

  // Filter first, paginate second: the page window always slices the FILTERED
  // rows, so 50 matches at 10 per page are 5 full pages.
  const perPage = Number(rows) || 10;
  const totalCount = ordered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const current = Math.min(page, totalPages);
  const visibleRows = ordered.slice((current - 1) * perPage, current * perPage);

  // Reset to page 1 whenever the search, chip filters or page size change - but
  // NOT on mount, so a restored page survives navigation.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, rows, colF, dupOnly, sharedParentOnly, armedBarcode]);

  const hasFilters = !!search || anyColFilter || dupOnly || sharedParentOnly;
  function clearFilters() {
    setSearch("");
    setColF({});
    setDupOnly(false);
    setSharedParentOnly(false);
  }
  function removeTag(k: ColKey, v: string) {
    setColF((prev) => {
      const set = new Set(prev[k]);
      set.delete(v);
      return { ...prev, [k]: set };
    });
  }

  // Close the settings popover on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const activeTags = FIELDS.flatMap((f) =>
    Array.from(colF[f.key] ?? []).map((v) => ({ key: f.key, label: f.label, value: v })),
  );
  const shownFields = FIELDS.filter((f) => !hiddenFields.has(f.key));

  /**
   * Send the student their barcode card, straight from the row.
   *
   * <p>No confirmation step on purpose: it is one student, one card, to their own
   * number, and the desk needs it to be one click. It is NOT queued when offline
   * either - the card is rendered server-side at send time, so there is nothing
   * for the browser to hold on to; the button is simply disabled instead.
   */
  async function sendBarcode(s: Student) {
    setSendingBarcode(s.id);
    try {
      // A refusal comes back as a reason, not an error: WhatsApp turning the
      // message down is not the same event as the request failing, and the
      // server's wording ("no message is bound to the barcode") is the one that
      // tells the teacher what to go and fix.
      const r = await api.post<{ sent: boolean; phone: string | null; reason: string | null }>(
        `/students/${s.id}/barcode/send`,
      );
      if (r.sent) {
        toast.success(`تم إرسال الباركود إلى ${s.name}`);
        invalidate("/students"); // the row's mark has just changed
        reload();
      } else {
        toast.error(r.reason ?? "تعذّر إرسال الباركود");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إرسال الباركود");
    } finally {
      setSendingBarcode(null);
    }
  }

  /**
   * First press previews, second press sends. Nothing goes out on the first.
   *
   * <p>Arming clears every other filter, because the table has to show the whole
   * recipient list for the preview to mean anything - a leftover search would
   * display four names and then send to a hundred and forty. What the teacher
   * narrows to AFTERWARDS is deliberate and is honoured: chip the table down to
   * one group and the send covers that group only.
   */
  function armOrSendBarcodes() {
    if (!armedBarcode) {
      if (barcodeTargets.length === 0) {
        toast.info("كل الطلاب استلموا الباركود بالفعل");
        return;
      }
      clearFilters();
      setArmedBarcode(true);
      return;
    }
    void sendBarcodes(ordered);
  }

  /**
   * Send the card to exactly these students, in slices.
   *
   * <p>Sliced because each card is a PDF render, a media upload and a send: two
   * hundred of them inside one request would outlast every timeout between here
   * and the server with nothing to show for the wait. Each round trip reports
   * what it did, so the count on the button is real progress rather than a
   * spinner.
   *
   * <p>Nothing is queued offline - the card is rendered and uploaded server-side
   * at send time, so there is nothing for the browser to hold.
   */
  async function sendBarcodes(targets: Student[]) {
    if (targets.length === 0) return;
    const ids = targets.map((s) => s.id);
    let sent = 0;
    let failed = 0;
    setBulkProgress({ sent, failed, remaining: ids.length });
    try {
      for (let i = 0; i < ids.length; i += BARCODE_BATCH) {
        const slice = ids.slice(i, i + BARCODE_BATCH);
        const r = await api.post<BarcodeBatch>("/students/barcode/send", { ids: slice });
        if (r.blocked_reason) {
          toast.error(r.blocked_reason);
          return;
        }
        sent += r.sent;
        failed += r.failed;
        setBulkProgress({ sent, failed, remaining: ids.length - sent - failed });
        // A whole slice that sent nothing is a refusal that will repeat: the
        // students are only stamped once their card lands, so grinding through
        // the rest would collect the same failure once per family.
        if (r.sent === 0) break;
      }
      if (sent > 0) {
        toast.success(
          failed > 0
            ? `تم إرسال الباركود لـ ${sent} طالب، وتعذّر مع ${failed}`
            : `تم إرسال الباركود لـ ${sent} طالب`,
        );
      } else {
        toast.error(`تعذّر إرسال الباركود لـ ${failed} طالب — راجع سجل الرسائل لمعرفة السبب`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إرسال الباركود");
    } finally {
      setBulkProgress(null);
      setArmedBarcode(false);
      invalidate("/students");
      reload();
    }
  }

  async function handleDelete(s: Student) {
    const done = (queued: boolean) => {
      invalidate("/students"); // drops every cached page of the list
      reload();
      toast.success(
        queued ? `تم حذف "${s.name}" - بانتظار المزامنة عند عودة الاتصال` : `تم حذف "${s.name}"`,
      );
    };
    try {
      // Offline the delete is queued rather than refused. A student deleted from
      // the mirror is gone from every screen at once, and the server applies the
      // same delete on reconnect - where deleting an already-deleted student is
      // the outcome asked for, not an error.
      if (!online && sync.ready) {
        await sync.queueStudentDelete(s.id);
        done(true);
        return;
      }
      await api.del(`/students/${s.id}`);
      done(false);
    } catch (err) {
      if (isOfflineError(err) && sync.ready) {
        await sync.queueStudentDelete(s.id);
        done(true);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الطالب");
    } finally {
      setConfirmDelete(null);
    }
  }

  function handleSaved() {
    invalidate("/students");
    reload();
    setEditStudent(null);
  }

  /**
   * Everything a single student row derives, in one place so the wide table (on
   * sm+) and the stacked cards (on a phone) can never disagree about a student's
   * group, completeness, duplicate state or which actions the viewer may take.
   */
  const rowMeta = (s: Student) => {
    const g = s.group_id ? groupById.get(s.group_id) : undefined;
    const missing = incomplete(s);
    // Name/phone duplicate wins over a parent-number duplicate: once the
    // name/phone clash is fixed the row falls back to the parent-number colour on
    // the next load.
    const dupNamePhone = dup.nameOrPhoneDup(s);
    const dupParent = !dupNamePhone && dup.parentPhoneDup(s);
    // Each action is gated by its own permission, so a view-only assistant sees
    // none of them - and then the menu button itself is hidden rather than
    // opening on an empty list.
    const rowActions: RowAction[] = [
      ...(canSendBarcode
        ? [
            {
              key: "barcode",
              label: sendingBarcode === s.id ? "جارٍ الإرسال…" : "إرسال الباركود",
              icon: sendingBarcode === s.id ? Loader2 : Barcode,
              onSelect: () => sendBarcode(s),
              disabled:
                sendingBarcode === s.id ||
                !online ||
                waBarcode.disabled ||
                s.student_phones.length === 0,
              title: !online
                ? "لا يوجد اتصال بالإنترنت"
                : waBarcode.disabled
                  ? (waBarcode.reason ?? "إرسال واتساب غير متاح")
                  : s.student_phones.length === 0
                    ? "لا يوجد رقم هاتف للطالب"
                    : "إرسال الباركود للطالب عبر واتساب",
            },
          ]
        : []),
      ...(canAnalytics
        ? [
            {
              key: "analytics",
              label: "تقرير الطالب",
              icon: FileChartColumn,
              onSelect: () => navigate(`/students/${s.id}/analytics`),
            },
          ]
        : []),
      ...(canUpdate
        ? [{ key: "edit", label: "تعديل", icon: Pencil, onSelect: () => setEditStudent(s) }]
        : []),
      ...(canDelete
        ? [
            {
              key: "delete",
              label: "حذف",
              icon: Trash2,
              onSelect: () => setConfirmDelete(s),
              danger: true,
            },
          ]
        : []),
    ];
    return { g, missing, dupNamePhone, dupParent, rowActions };
  };

  return (
    <div>
      {/* Sticky enterprise filter bar */}
      <div className="sticky top-0 z-20 -mx-4 mt-3 border-b border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
        {/* Row 1 - instant search + advanced settings */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative order-1 w-full min-w-[200px] flex-1 sm:w-auto">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputMode="search"
              placeholder={STUDENT_SEARCH_PLACEHOLDER}
              aria-label="بحث"
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-9 text-slate-800 shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="مسح البحث"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {/* Says which of the three searches is running, so the leading-zero
                rule is discoverable instead of folklore. */}
            {searchModeLabel(search) && (
              <span className="pointer-events-none absolute -bottom-4 right-1 text-[11px] text-slate-400">
                {searchModeLabel(search)}
              </span>
            )}
          </div>
          <div className="relative order-2" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              title="إعدادات التصفية"
              className={`flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                settingsOpen
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              <SlidersHorizontal className="h-5 w-5" />
            </button>
            {settingsOpen && (
              <div className="animate-scale-up absolute left-0 top-full z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <p className="px-2 py-1 text-xs font-semibold text-slate-400">الفلاتر الظاهرة</p>
                <div className="max-h-72 overflow-auto">
                  {FIELDS.map((f) => {
                    const shown = !hiddenFields.has(f.key);
                    return (
                      <label
                        key={f.key}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={shown}
                          onChange={() =>
                            setHiddenFields((prev) => {
                              const next = new Set(prev);
                              shown ? next.add(f.key) : next.delete(f.key);
                              return next;
                            })
                          }
                          className="h-4 w-4 accent-accent"
                        />
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {/* Rows-per-page sits beside the add button, not down by the table. */}
          <div className="order-3 flex shrink-0 items-center gap-1.5 text-sm text-slate-500">
            <span>عرض</span>
            <div className="w-20">
              <Select value={rows} onChange={setRows} options={ROWS_OPTIONS.map((r) => ({ value: r, label: r }))} />
            </div>
          </div>
          {/* Send the card to whoever never got one. It carries its own count
              because that number IS the reason to press it - a button that only
              said "send barcodes" would give no way to tell "nobody is waiting"
              from "everybody is". At zero it stays visible but inert, so the
              answer to "did they all get it?" is on the screen either way. */}
          {canSendBarcode && (
            <div className="order-5 flex shrink-0 items-center">
              <button
                type="button"
                onClick={armOrSendBarcodes}
                disabled={
                  !!bulkProgress ||
                  !online ||
                  !backlog ||
                  backlog.pending === 0 ||
                  !!backlog.blocked_reason ||
                  (armedBarcode && totalCount === 0)
                }
                title={
                  !online
                    ? "لا يوجد اتصال بالإنترنت"
                    : !backlog
                      ? (backlogError ?? "تعذّر قراءة حالة الباركود — حدّث الصفحة")
                      : backlog.blocked_reason
                        ? backlog.blocked_reason
                        : backlog.pending === 0
                          ? "كل الطلاب استلموا الباركود بالفعل — أرسله لطالب بعينه من قائمة الصف"
                          : armedBarcode
                            ? "إرسال الباركود للطلاب المعروضين الآن"
                            : "عرض من سيصلهم الباركود قبل الإرسال"
                }
                className={`flex h-11 items-center gap-2 border px-4 font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  armedBarcode
                    ? "rounded-xl rounded-e-none border-accent bg-accent text-white hover:bg-accent-hover"
                    : "rounded-xl border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                {bulkProgress ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="tabular-nums">
                      {bulkProgress.sent + bulkProgress.failed} / {""}
                      {bulkProgress.sent + bulkProgress.failed + bulkProgress.remaining}
                    </span>
                  </>
                ) : armedBarcode ? (
                  <>
                    <Barcode className="h-5 w-5" />
                    إرسال ({totalCount.toLocaleString("ar-EG")})
                  </>
                ) : (
                  <>
                    <Barcode className="h-5 w-5 text-slate-400" />
                    إرسال الباركود
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-500">
                      {backlog?.pending ?? "—"}
                    </span>
                  </>
                )}
              </button>
              {armedBarcode && !bulkProgress && (
                <button
                  type="button"
                  onClick={() => setArmedBarcode(false)}
                  title="إلغاء"
                  aria-label="إلغاء إرسال الباركود"
                  className="flex h-11 items-center rounded-xl rounded-s-none border border-s-0 border-accent bg-accent px-2 text-white shadow-sm transition hover:bg-accent-hover"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          {canCreate && (
            <button
              onClick={() => setAddOpen(true)}
              className="order-6 flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 font-medium text-white shadow-sm transition hover:bg-accent-hover"
            >
              <Plus className="h-5 w-5" />
              طالب جديد
            </button>
          )}
        </div>

        {/* Row 2 - filter chips. On a phone they sit on ONE line that scrolls
            sideways instead of wrapping onto four rows that ate half the screen;
            from sm up they wrap as before. */}
        <div className="mt-4 flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 [&>*]:shrink-0 sm:mt-5 sm:flex-wrap sm:overflow-visible sm:whitespace-normal sm:pb-0">
          {shownFields.map((f) => (
            <MultiSelectFilter
              key={f.key}
              label={f.label}
              options={distinct[f.key]}
              selected={colF[f.key] ?? EMPTY_SET}
              onChange={(s) => setCol(f.key, s)}
            />
          ))}
          {/* Duplicates: same name, or a student phone shared with another
              record. Its pill wears the same purple as the rows it reveals. */}
          <button
            type="button"
            onClick={() => setDupOnly((v) => !v)}
            title="الطلاب الذين يتكرر اسمهم أو رقم هاتفهم مع طالب آخر"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              dupOnly
                ? "border-purple-300 bg-purple-50 text-purple-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <Copy className="h-4 w-4" />
            التكرارات
          </button>
          {/* Records sharing a guardian number, grouped together in the table. */}
          <button
            type="button"
            onClick={() => setSharedParentOnly((v) => !v)}
            title="الطلاب الذين يشتركون في رقم ولي أمر واحد، مرتّبين معًا"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              sharedParentOnly
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <Users2 className="h-4 w-4" />
            رقم ولي أمر مشترك
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 sm:ms-auto"
            >
              <X className="h-4 w-4" />
              مسح الكل
            </button>
          )}
        </div>

        {/* Row 3 - active value tags */}
        {activeTags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {activeTags.map((t) => (
              <span
                key={`${t.key}:${t.value}`}
                className="animate-scale-up flex items-center gap-1 rounded-full bg-accent/10 py-1 pe-1 ps-2.5 text-xs font-medium text-accent"
              >
                <span className="text-accent/70">{t.label}:</span>
                {t.value}
                <button
                  onClick={() => removeTag(t.key, t.value)}
                  aria-label={`إزالة ${t.value}`}
                  className="rounded-full p-0.5 transition hover:bg-accent/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Says what the table is showing right now. It matters most while a send
          is armed, because then the table is not a roster - it is the list of
          people about to be messaged. */}
      {armedBarcode && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-slate-700">
          <Barcode className="h-4 w-4 shrink-0 text-accent" />
          {totalCount === 0
            ? "لا يوجد طالب مطابق للفلاتر الحالية — وسّع الفلترة أو ألغِ الإرسال."
            : `هؤلاء من سيصلهم كارت الباركود (${totalCount.toLocaleString("ar-EG")}) على أرقامهم الشخصية — فلتر أكثر لو عايز تضيّق القائمة، ثم اضغط "إرسال".`}
        </div>
      )}

      {/* Result total + row-colour legend + page size */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-y-2 text-sm text-slate-500">
        <span>
          الإجمالي{" "}
          <span className="font-semibold text-slate-700">{totalCount.toLocaleString("ar-EG")}</span>
        </span>
        {/* What the coloured rows below mean. The swatches carry the same fill
            the rows use, so the key reads as a direct sample, not a guess. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-100 ring-1 ring-amber-400" />
            بيانات ناقصة
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-purple-100 ring-1 ring-purple-400" />
            تكرار الاسم/الرقم
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-100 ring-1 ring-sky-400" />
            تكرار رقم ولي الأمر
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-rose-100 ring-1 ring-rose-400" />
            محظور
          </span>
          {/* The green/red dots beside the phone numbers are NOT listed here.
              This legend explains row colours - facts about the record - and the
              dots are about one phone; putting them in the same line made a
              four-item key into a six-item one and taught the eye to skim it.
              Each dot carries its own tooltip instead. */}
        </div>
      </div>

      {loading ? (
        <LoaderBlock />
      ) : (
        // Eleven columns as percentage shares of the frame, which works down to
        // a laptop and breaks on a phone: at 375px each share is about fourteen
        // pixels and every cell turns into a column of single letters. The
        // shares are kept - they are right whenever there is room - and a floor
        // is put under them, so on a narrow screen the TABLE scrolls sideways
        // inside its own box instead of the whole page doing it.
        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1000px] table-fixed text-right text-sm">
            <colgroup>
              {/* Shares, adding up to exactly 100. App and Google columns moved
                  into the row-detail view, so the freed width goes to the
                  readable free-text columns. */}
              <col className="w-[4%]" />
              {/* The name truncates on one line; grade, sex and the barcode mark
                  share the line under it. */}
              <col className="w-[18%]" />
              {/* The phones carry eleven digits, so they take the widest share
                  after the name. */}
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              {/* School and group both wrap onto a second line when a name runs
                  long, so nothing is cut off. A point each came from الحالة and
                  the name, because these two were the columns actually wrapping
                  on a full-width screen. */}
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              {/* Price / status sized to their widest value: a three-digit price
                  and "محظور" (with its icon). Gender moved under the name as a
                  ♂/♀ mark, so it no longer needs a column. */}
              <col className="w-[5%]" />
              <col className="w-[6%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              {/* Wide enough that the "إجراءات" header fits without being clipped. */}
              <col className="w-[9%]" />
            </colgroup>
              <thead className={`${THEAD} font-medium`}>
                <tr>
                  <th className="px-2 py-2.5">#</th>
                  <th className="px-2 py-2.5">الطالب</th>
                  <th className="px-2 py-2.5">رقم الطالب</th>
                  <th className="px-2 py-2.5">رقم ولي الأمر</th>
                  <th className="px-2 py-2.5">المدرسة</th>
                  <th className="px-2 py-2.5">المجموعة</th>
                  <th className="px-2 py-2.5">السعر</th>
                  <th className="px-2 py-2.5">الحالة</th>
                  <th className="px-2 py-2.5">أنشئ في</th>
                  <th className="px-2 py-2.5">آخر تحديث</th>
                  <th className="whitespace-nowrap px-2 py-2.5 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((s) => {
                  const { g, missing, dupNamePhone, dupParent, rowActions } = rowMeta(s);
                  // Priority: blocked (rose) → name/phone dup (purple) → shared
                  // parent (sky) → incomplete (amber) → none.
                  const tone = !s.is_active
                    ? "bg-rose-100 hover:bg-rose-200"
                    : dupNamePhone
                      ? "bg-purple-100 hover:bg-purple-200"
                      : dupParent
                        ? "bg-sky-100 hover:bg-sky-200"
                        : missing
                          ? "bg-amber-100 hover:bg-amber-200"
                          : "hover:bg-slate-50/60";
                  return (
                    <tr
                      key={s.id}
                      // The whole row opens the full detail view; the action
                      // buttons stop propagation so they still do their own thing.
                      onClick={() => setViewStudent(s)}
                      className={`h-14 cursor-pointer transition ${tone}`}
                    >
                      <td className="px-2 font-medium text-slate-400">{s.serial}</td>
                      <td className="px-2">
                        <div className="truncate font-medium text-slate-800" title={s.name}>{s.name}</div>
                        {/* Grade with the student's sex as a medical ♂/♀ mark -
                            the old "النوع" column folded into one glyph here. */}
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="truncate">{s.grade ?? "-"}</span>
                          {s.gender && (
                            <span
                              title={s.gender}
                              className={`text-sm leading-none ${
                                s.gender === "أنثى" ? "text-pink-500" : "text-sky-600"
                              }`}
                            >
                              {s.gender === "أنثى" ? "♀" : "♂"}
                            </span>
                          )}
                          {/* Has this student got their card? A mark rather than
                              a twelfth column - the table is already at its
                              width, and the answer is one bit.

                              A FILLED badge, not a tinted glyph. This started as
                              a 14px icon in accent or slate-300, which on a row
                              already tinted amber or purple was two shades of
                              grey the eye slid straight past. Solid fill against
                              hollow outline is a difference visible without
                              looking for it, and it survives every row colour. */}
                          <span
                            title={
                              s.barcode_sent_at
                                ? `أُرسل الباركود في ${fmtDate(s.barcode_sent_at)}`
                                : "لم يُرسل الباركود بعد"
                            }
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 ${
                              s.barcode_sent_at
                                ? "bg-accent text-white ring-accent"
                                : "bg-white text-slate-400 ring-slate-300"
                            }`}
                          >
                            <Barcode className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </td>
                      {/* A number is never broken across two lines; on a frame
                          too narrow for eleven digits it truncates and the whole
                          number stays available on hover. */}
                      <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                        {s.student_phones.length ? (
                          s.student_phones.map((p) => <PhoneCell key={p} phone={p} reach={reach} />)
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                        {s.parent_phones.length ? (
                          s.parent_phones.map((p) => <PhoneCell key={p} phone={p} reach={reach} />)
                        ) : (
                          <Dash />
                        )}
                      </td>
                      {/* School and group wrap onto a second line instead of
                          being cut off - the column stays narrow either way. */}
                      <td className="px-2 leading-snug break-words text-slate-600">
                        {s.school || <Dash />}
                      </td>
                      <td className="px-2 leading-snug break-words text-slate-600">
                        {g ? groupLabel(g) : <Dash />}
                      </td>
                      <td className="px-2">
                        {s.lesson_price == null ? (
                          <Dash />
                        ) : s.lesson_price === 0 ? (
                          <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                            معفي
                          </span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            <Money value={s.lesson_price} className="text-slate-700" />
                            {s.is_discounted && (
                              <span className="rounded-md bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                                مُخَفَّض
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      {/* Status only - the reason lives in the edit form. */}
                      <td className="px-2">
                        {s.is_active ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                            <span className="text-slate-600">نشط</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 font-medium text-rose-700">
                            <Ban className="h-3.5 w-3.5 shrink-0" />
                            محظور
                          </span>
                        )}
                      </td>
                      <td className="px-2"><AuditCell at={s.created_at} by={s.created_by} /></td>
                      <td className="px-2"><AuditCell at={s.updated_at} by={s.updated_by} /></td>
                      {/* One menu instead of a strip of icons: every action
                          keeps its name and the column keeps its width. A normal
                          column - it scrolls with the rest of the table. */}
                      <td className="px-2 text-center" onClick={(e) => e.stopPropagation()}>
                        {rowActions.length > 0 && <RowActionsMenu actions={rowActions} />}
                      </td>
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-16 text-center text-slate-400">
                      <Users className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                      {hasFilters || anyColFilter ? "لا توجد نتائج مطابقة" : "لا يوجد طلاب بعد"}
                    </td>
                  </tr>
                )}
              </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination current={current} totalPages={totalPages} onChange={setPage} />}

      {addOpen && options && (
        <StudentForm
          grades={formGrades}
          groups={groups}
          options={options}
          onClose={() => setAddOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {editStudent && options && (
        <StudentForm
          initial={editStudent}
          grades={formGrades}
          groups={groups}
          options={options}
          onClose={() => setEditStudent(null)}
          onSaved={handleSaved}
        />
      )}

      {viewStudent && (
        <StudentDetails
          student={viewStudent}
          groups={groups}
          grades={grades}
          onClose={() => setViewStudent(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="حذف الطالب"
          message={`هل أنت متأكد من حذف "${confirmDelete.name}"؟`}
          confirmLabel="حذف"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {/* No confirm dialog for the bulk send. It used to quote the count back
          in a modal, which asked the teacher to trust a number; the armed table
          shows them the actual names instead, and the second press on the button
          is the confirmation. */}
    </div>
  );
}

