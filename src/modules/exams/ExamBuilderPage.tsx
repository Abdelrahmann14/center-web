// The exam builder: two panels. The LEFT panel holds the exam-wide creation
// settings (answer-label style, multi-correct, notes, bonus, and the live score
// tally). The RIGHT panel (larger) is the actual builder: questions, choices,
// correct answers, per-question score, ordering. Save cleans empty questions and
// choices, checks the score distribution, and replaces the exam's question set.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Award, Check, Loader2, Plus, Settings2, StickyNote, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { invalidate } from "@/lib/dataCache";
import { useToast } from "@/components/Toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { FormNotice, Select, Switch, inputClass } from "@/components/ui";
import { labelFor, type ExamDetail, type LabelStyle } from "./types";

// Builder-local shapes: scores are strings so the number inputs type cleanly
// (intermediate "1.", empty); mapped to numbers on save.
interface BuilderChoice {
  label: string;
  text: string;
  correct: boolean;
}
interface BuilderQuestion {
  text: string;
  scoreStr: string;
  allowMultiple: boolean;
  bonus: boolean;
  bonusStr: string;
  note: string | null; // null = no note box; string (incl. "") = box shown
  choices: BuilderChoice[];
}

function blankChoices(style: LabelStyle, count: number): BuilderChoice[] {
  return Array.from({ length: count }, (_, i) => ({ label: labelFor(style, i), text: "", correct: false }));
}

function blankQuestion(style: LabelStyle): BuilderQuestion {
  return { text: "", scoreStr: "1", allowMultiple: false, bonus: false, bonusStr: "", note: null, choices: blankChoices(style, 4) };
}

export default function ExamBuilderPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [questions, setQuestions] = useState<BuilderQuestion[]>([]);
  const [labelStyle, setLabelStyle] = useState<LabelStyle>("arabic");
  const [allowMultipleCorrect, setAllowMultipleCorrect] = useState(false);
  const [notesEnabled, setNotesEnabled] = useState(false);
  const [bonusEnabled, setBonusEnabled] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!examId) return;
    api
      .get<ExamDetail>(`/exams/${examId}`)
      .then((d) => {
        setExam(d);
        setLabelStyle(d.label_style ?? "arabic");
        setAllowMultipleCorrect(d.allow_multiple_correct);
        setNotesEnabled(d.notes_enabled);
        setBonusEnabled(d.bonus_enabled);
        setQuestions(
          d.questions.length
            ? d.questions.map((q) => ({
                text: q.text,
                scoreStr: String(q.score ?? 1),
                allowMultiple: q.allow_multiple,
                bonus: q.bonus,
                bonusStr: q.bonus_score != null ? String(q.bonus_score) : "",
                note: q.note ?? null,
                choices: q.choices.map((c) => ({ label: c.label, text: c.text, correct: c.correct })),
              }))
            : [blankQuestion(d.label_style ?? "arabic")],
        );
      })
      .catch(() => setError("تعذّر تحميل الاختبار"))
      .finally(() => setLoading(false));
  }, [examId]);

  // --- Question / choice mutations -------------------------------------
  function setQuestion(qi: number, patch: Partial<BuilderQuestion>) {
    setQuestions((qs) => qs.map((q, i) => (i === qi ? { ...q, ...patch } : q)));
  }
  function setChoice(qi: number, ci: number, patch: Partial<BuilderChoice>) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qi ? { ...q, choices: q.choices.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : q,
      ),
    );
  }
  // Single-answer questions behave like radios; multi-answer toggle each choice.
  function markCorrect(qi: number, ci: number) {
    setQuestions((qs) =>
      qs.map((q, i) => {
        if (i !== qi) return q;
        const multi = allowMultipleCorrect && q.allowMultiple;
        return {
          ...q,
          choices: q.choices.map((c, j) =>
            multi ? (j === ci ? { ...c, correct: !c.correct } : c) : { ...c, correct: j === ci },
          ),
        };
      }),
    );
  }
  function addChoice(qi: number) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qi
          ? { ...q, choices: [...q.choices, { label: labelFor(labelStyle, q.choices.length), text: "", correct: false }] }
          : q,
      ),
    );
  }
  function removeChoice(qi: number, ci: number) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qi
          ? { ...q, choices: q.choices.filter((_, j) => j !== ci).map((c, k) => ({ ...c, label: labelFor(labelStyle, k) })) }
          : q,
      ),
    );
  }
  function addQuestion() {
    setQuestions((qs) => [...qs, blankQuestion(labelStyle)]);
  }
  function removeQuestion(qi: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== qi));
  }
  // Turning multi off collapses to a single correct answer (keep the first).
  function toggleQuestionMulti(qi: number) {
    setQuestions((qs) =>
      qs.map((q, i) => {
        if (i !== qi) return q;
        if (!q.allowMultiple) return { ...q, allowMultiple: true };
        let kept = false;
        return {
          ...q,
          allowMultiple: false,
          choices: q.choices.map((c) => {
            if (c.correct && !kept) {
              kept = true;
              return c;
            }
            return { ...c, correct: false };
          }),
        };
      }),
    );
  }

  // Switching label style re-labels every choice by its position.
  function changeStyle(style: string) {
    const s: LabelStyle = style === "english" ? "english" : "arabic";
    setLabelStyle(s);
    setQuestions((qs) => qs.map((q) => ({ ...q, choices: q.choices.map((c, i) => ({ ...c, label: labelFor(s, i) })) })));
  }

  // Live tally of the regular (non-bonus) scores against the exam max.
  const regularSum = useMemo(
    () => questions.filter((q) => !(bonusEnabled && q.bonus)).reduce((sum, q) => sum + (Number(q.scoreStr) || 0), 0),
    [questions, bonusEnabled],
  );
  const maxScore = exam?.max_score ?? 0;
  const sumOk = regularSum === maxScore;

  // Save is always allowed: it preserves the current work as a draft, however
  // incomplete. The exam only becomes publishable once the server confirms every
  // validation passes (returned `complete`).
  async function save() {
    setError("");
    // Cleanup: drop blank questions, and within each, drop blank choices.
    const cleaned = questions
      .filter((q) => q.text.trim() !== "")
      .map((q) => ({ ...q, choices: q.choices.filter((c) => c.text.trim() !== "") }));

    setSaving(true);
    try {
      const saved = await api.put<ExamDetail>(`/exams/${examId}/questions`, {
        label_style: labelStyle,
        allow_multiple_correct: allowMultipleCorrect,
        notes_enabled: notesEnabled,
        bonus_enabled: bonusEnabled,
        questions: cleaned.map((q) => {
          const isBonus = bonusEnabled && q.bonus;
          return {
            text: q.text.trim(),
            score: isBonus ? 0 : Number(q.scoreStr) || 0,
            allow_multiple: allowMultipleCorrect && q.allowMultiple,
            bonus: isBonus,
            bonus_score: isBonus ? Number(q.bonusStr) || 0 : null,
            note: notesEnabled && q.note != null && q.note.trim() !== "" ? q.note.trim() : null,
            choices: q.choices.map((c) => ({ label: c.label.trim(), text: c.text.trim(), correct: c.correct })),
          };
        }),
      });
      invalidate("/exams");
      if (saved.complete) {
        toast("تم حفظ الاختبار. الاختبار مكتمل وجاهز للنشر.");
      } else {
        toast(
          "تم حفظ مسودة الاختبار بنجاح. الاختبار غير مكتمل ويمكن تعديله في أي وقت، لكن لا يمكن نشره حتى تكتمل جميع عمليات التحقق المطلوبة.",
          "success",
          7000,
        );
      }
      navigate("/exams");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoaderBlock />;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/exams")}
            className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            title="رجوع"
          >
            <ArrowRight className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{exam?.name ?? "بناء الاختبار"}</h1>
            {exam?.grade && <p className="text-sm text-slate-500">{exam.grade}</p>}
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          حفظ الاختبار
        </button>
      </div>

      {error && <div className="mb-4"><FormNotice message={error} /></div>}

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* LEFT: exam creation settings */}
        <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-4 lg:w-80 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-slate-800">
              <Settings2 className="h-5 w-5 text-accent" />
              <h2 className="font-bold">إعدادات الاختبار</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">نمط تسمية الإجابات</label>
                <Select
                  value={labelStyle}
                  onChange={changeStyle}
                  options={[
                    { value: "arabic", label: "عربي (أ، ب، ج، د)" },
                    { value: "english", label: "إنجليزي (A, B, C, D)" },
                  ]}
                />
              </div>

              <SettingRow
                label="السماح بأكثر من إجابة صحيحة"
                checked={allowMultipleCorrect}
                onChange={() => setAllowMultipleCorrect((v) => !v)}
              />
              <SettingRow label="ملاحظات الأسئلة" checked={notesEnabled} onChange={() => setNotesEnabled((v) => !v)} />
              <SettingRow label="تفعيل أسئلة البونص" checked={bonusEnabled} onChange={() => setBonusEnabled((v) => !v)} />
            </div>
          </div>

          {/* Live score tally */}
          <div
            className={`rounded-2xl border p-4 shadow-sm ${
              sumOk ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Award className="h-4 w-4" />
              توزيع الدرجات
            </div>
            <div className="mt-2 flex items-baseline gap-1" dir="ltr">
              <span className={`text-2xl font-bold ${sumOk ? "text-green-700" : "text-amber-700"}`}>{regularSum}</span>
              <span className="text-slate-500">/ {maxScore}</span>
            </div>
            <p className={`mt-1 text-xs ${sumOk ? "text-green-700" : "text-amber-700"}`}>
              {sumOk ? "مجموع الدرجات مطابق للدرجة النهائية." : "مجموع درجات الأسئلة يجب أن يساوي الدرجة النهائية."}
            </p>
          </div>
        </aside>

        {/* RIGHT: the builder */}
        <div className="min-w-0 flex-1 space-y-4">
          {questions.map((q, qi) => {
            const multi = allowMultipleCorrect && q.allowMultiple;
            return (
              <div key={qi} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                    {qi + 1}
                  </span>
                  <input
                    className={inputClass}
                    dir="auto"
                    value={q.text}
                    onChange={(e) => setQuestion(qi, { text: e.target.value })}
                    placeholder="نص السؤال"
                  />
                  {questions.length > 1 && (
                    <button
                      onClick={() => removeQuestion(qi)}
                      className="shrink-0 rounded-lg p-2 text-rose-500 hover:bg-rose-50"
                      title="حذف السؤال"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Note box (student speech-bubble preview) */}
                {notesEnabled && q.note !== null && (
                  <div className="mb-3 ms-9 rounded-2xl rounded-tr-sm border border-accent/30 bg-accent/5 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-xs font-semibold text-accent">
                        <StickyNote className="h-3.5 w-3.5" />
                        ملاحظة
                      </span>
                      <button
                        onClick={() => setQuestion(qi, { note: null })}
                        className="rounded p-0.5 text-slate-400 hover:text-rose-500"
                        title="حذف الملاحظة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      dir="auto"
                      rows={2}
                      value={q.note}
                      onChange={(e) => setQuestion(qi, { note: e.target.value })}
                      placeholder="اكتب ملاحظة تظهر فوق السؤال للطالب"
                    />
                  </div>
                )}

                {/* Per-question controls */}
                <div className="mb-3 ms-9 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {!(bonusEnabled && q.bonus) && (
                    <ScoreField label="الدرجة" value={q.scoreStr} onChange={(v) => setQuestion(qi, { scoreStr: v })} />
                  )}
                  {allowMultipleCorrect && (
                    <InlineToggle label="أكثر من إجابة" checked={q.allowMultiple} onChange={() => toggleQuestionMulti(qi)} />
                  )}
                  {bonusEnabled && (
                    <InlineToggle label="سؤال بونص" checked={q.bonus} onChange={() => setQuestion(qi, { bonus: !q.bonus })} />
                  )}
                  {bonusEnabled && q.bonus && (
                    <ScoreField label="درجة البونص" value={q.bonusStr} onChange={(v) => setQuestion(qi, { bonusStr: v })} />
                  )}
                  {notesEnabled && q.note === null && (
                    <button
                      onClick={() => setQuestion(qi, { note: "" })}
                      className="flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover"
                    >
                      <Plus className="h-4 w-4" />
                      ملاحظة
                    </button>
                  )}
                </div>

                {/* Choices */}
                <div className="space-y-2 ms-9">
                  {q.choices.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => markCorrect(qi, ci)}
                        title="تحديد كإجابة صحيحة"
                        className={`flex h-7 w-7 shrink-0 items-center justify-center border transition ${
                          multi ? "rounded-md" : "rounded-full"
                        } ${
                          c.correct
                            ? "border-green-600 bg-green-600 text-white"
                            : "border-slate-300 text-transparent hover:border-green-500"
                        }`}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <input
                        className={`${inputClass} w-16 text-center`}
                        dir="auto"
                        value={c.label}
                        onChange={(e) => setChoice(qi, ci, { label: e.target.value })}
                        placeholder={labelFor(labelStyle, ci)}
                      />
                      <input
                        className={inputClass}
                        dir="auto"
                        value={c.text}
                        onChange={(e) => setChoice(qi, ci, { text: e.target.value })}
                        placeholder="نص الاختيار"
                      />
                      {q.choices.length > 2 && (
                        <button
                          onClick={() => removeChoice(qi, ci)}
                          className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-rose-500"
                          title="حذف الاختيار"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => addChoice(qi)}
                    className="flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
                  >
                    <Plus className="h-4 w-4" />
                    إضافة اختيار
                  </button>
                </div>
              </div>
            );
          })}

          <button
            onClick={addQuestion}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-3 font-medium text-slate-600 hover:border-accent hover:text-accent"
          >
            <Plus className="h-5 w-5" />
            إضافة سؤال
          </button>
        </div>
      </div>
    </div>
  );
}

// A labelled on/off row for the settings panel.
function SettingRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

// A compact inline toggle used within a question's controls row.
function InlineToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <Switch checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

// A small numeric score input (integers or .5 steps).
function ScoreField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      {label}
      <input
        type="number"
        min="0.5"
        step="0.5"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-center outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </label>
  );
}
