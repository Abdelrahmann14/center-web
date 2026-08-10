import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Users, Users2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { PhotoUpload } from "@/components/PhotoUpload";
import { Switch } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";

interface AdminSummary {
  id: string;
  username: string;
  email: string;
  active: boolean;
  student_count: number;
  assistant_count: number;
  photo: string | null;
  google_sync_enabled: boolean;
  whatsapp_enabled: boolean;
}
interface AdminModule {
  code: string;
  name_ar: string;
  description_ar: string | null;
  category: string;
  enabled: boolean;
}
const arNum = (n: number) => n.toLocaleString("ar-EG");

export default function TeacherDetailPage() {
  const { adminId } = useParams();
  const navigate = useNavigate();
  const [teacher, setTeacher] = useState<AdminSummary | null>(null);
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);

  useEffect(() => {
    if (!adminId) return;
    Promise.all([
      api.get<AdminSummary>(`/super/admins/${adminId}`),
      api.get<AdminModule[]>(`/super/admins/${adminId}/modules`),
    ])
      .then(([t, m]) => {
        setTeacher(t);
        setModules(m);
      })
      .finally(() => setLoading(false));
  }, [adminId]);

  async function toggleModule(m: AdminModule) {
    setBusyCode(m.code);
    try {
      await api.put(`/super/admins/${adminId}/modules/${m.code}`, { enabled: !m.enabled });
      setModules((list) => list.map((x) => (x.code === m.code ? { ...x, enabled: !x.enabled } : x)));
    } finally {
      setBusyCode(null);
    }
  }

  async function toggleGoogle() {
    if (!teacher) return;
    setGoogleBusy(true);
    try {
      await api.put(`/super/admins/${adminId}/google-sync`, { enabled: !teacher.google_sync_enabled });
      setTeacher((t) => (t ? { ...t, google_sync_enabled: !t.google_sync_enabled } : t));
    } finally {
      setGoogleBusy(false);
    }
  }

  async function toggleWhatsapp() {
    if (!teacher) return;
    setWaBusy(true);
    try {
      await api.put(`/super/admins/${adminId}/whatsapp-sync`, { enabled: !teacher.whatsapp_enabled });
      setTeacher((t) => (t ? { ...t, whatsapp_enabled: !t.whatsapp_enabled } : t));
    } finally {
      setWaBusy(false);
    }
  }

  if (loading) return <LoaderBlock />;
  if (!teacher) return <div className="text-slate-400">المدرّس غير موجود</div>;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("/users")}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
      >
        <ArrowRight className="h-4 w-4" />
        رجوع للمدرّسين
      </button>

      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PhotoUpload
            userId={teacher.id}
            name={teacher.username}
            photo={teacher.photo}
            onChange={(photo) => setTeacher((t) => (t ? { ...t, photo } : t))}
          />
          <div className="text-left">
            <h1 className="text-xl font-bold text-slate-800">{teacher.username}</h1>
            <p className="text-sm text-slate-500" dir="ltr">{teacher.email}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-md">
          <Stat icon={<Users className="h-4 w-4" />} label="الطلاب" value={arNum(teacher.student_count)} />
          <Stat icon={<Users2 className="h-4 w-4" />} label="المساعدون" value={arNum(teacher.assistant_count)} />
        </div>
      </div>

      {/* Integrations */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-slate-800">التكاملات</h2>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="font-semibold text-slate-800">مزامنة جهات اتصال Google</div>
            <div className="mt-0.5 text-xs text-slate-400">
              يسمح لهذا المدرّس بربط حساب Google وحفظ أرقام الطلاب وأولياء الأمور في جهات اتصاله تلقائيًا.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {googleBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <Switch checked={teacher.google_sync_enabled} onChange={toggleGoogle} disabled={googleBusy} />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="font-semibold text-slate-800">أرقام واتساب</div>
            <div className="mt-0.5 text-xs text-slate-400">
              يسمح لهذا المدرّس بربط أرقام واتساب وإرسال رسائل النظام من أرقامه الخاصة.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {waBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <Switch checked={teacher.whatsapp_enabled} onChange={toggleWhatsapp} disabled={waBusy} />
          </div>
        </div>
      </div>

      {/* Module toggles */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-slate-800">الوحدات والمزايا</h2>
        <div className="space-y-2">
          {modules.map((m) => (
            <div key={m.code} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800">{m.name_ar}</div>
                {m.description_ar && <div className="mt-0.5 truncate text-xs text-slate-400">{m.description_ar}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {busyCode === m.code && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                <Switch checked={m.enabled} onChange={() => toggleModule(m)} disabled={busyCode === m.code} />
              </div>
            </div>
          ))}
          {modules.length === 0 && <p className="text-sm text-slate-400">لا توجد وحدات</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-slate-800">{value}</div>
    </div>
  );
}
