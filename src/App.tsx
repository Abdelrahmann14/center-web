import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { api, ApiError } from "@/lib/api";
import { toast, ToastViewport } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import LoginPage from "@/pages/LoginPage";
import DashboardLayout from "@/pages/DashboardLayout";
import DashboardHome from "@/pages/DashboardHome";
import SuperAdminLayout from "@/pages/SuperAdminLayout";
import SuperUsersPage from "@/modules/superadmin/UsersPage";
import TeacherDetailPage from "@/modules/superadmin/TeacherDetailPage";
import GradesAdminPage from "@/modules/superadmin/GradesAdminPage";
import SystemNotificationsPage from "@/modules/superadmin/SystemNotificationsPage";
import ServicesPage from "@/modules/superadmin/ServicesPage";
import GroupsPage from "@/modules/groups/GroupsPage";
import UsersPage from "@/modules/users/UsersPage";
import AnalyticsPage from "@/modules/analytics/AnalyticsPage";
import GradesPage from "@/modules/grades/GradesPage";
import ServiceIntegrationsPage from "@/modules/services/ServiceIntegrationsPage";
import AdminMessagingPage from "@/modules/notifications/AdminMessagingPage";
import StudentsPage from "@/modules/students/StudentsPage";
import StudentAnalyticsPage from "@/modules/students/StudentAnalyticsPage";
import LecturesPage from "@/modules/lectures/LecturesPage";
import LessonGroupPage from "@/modules/lectures/LessonGroupPage";
import LessonRegistrationPage from "@/modules/registration/LessonRegistrationPage";
import OfflineAttendancePage from "@/modules/attendance/OfflineAttendancePage";
import ExamsPage from "@/modules/exams/ExamsPage";
import ExamBuilderPage from "@/modules/exams/ExamBuilderPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, restoring } = useAuth();
  // Wait for the stored session to be checked - otherwise a reload bounces a
  // signed-in user to the login page before /auth/me answers.
  if (restoring) return <LoaderBlock />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, effectiveRole, restoring, can } = useAuth();
  const navigate = useNavigate();

  // Google OAuth returns to the app root with ?code&scope=...contacts... . Once a
  // signed-in admin lands back here, exchange the code then clean the URL.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const scope = params.get("scope") ?? "";
    if (code && scope.includes("contacts")) {
      api
        .post("/google/connect", { code })
        .then(() => toast.success("تم ربط حساب Google بنجاح"))
        .catch((e) => toast.error(e instanceof ApiError ? e.message : "تعذّر ربط حساب Google"))
        .finally(() => navigate("/services", { replace: true }));
    }
  }, [user, navigate]);

  // The super admin always gets the platform console; they can no longer browse
  // into a teacher's workspace.
  const superMode = user?.role === "super_admin";

  // Toasts sit top-center for admins/assistants; the super admin keeps top-right.
  const viewport = <ToastViewport position={superMode ? "top-right" : "top-center"} />;

  if (restoring)
    return (
      <>
        {viewport}
        <LoaderBlock />
      </>
    );

  // Exams are permission-gated: an admin holds every exam permission, and may
  // delegate any of them to an assistant.
  const canExams = ["EXAM_CREATE", "EXAM_UPDATE", "EXAM_DELETE", "EXAM_PUBLISH"].some(can);

  // Analytics, groups/centers, assistants and integrations belong to the
  // workspace owner alone.
  const isAdmin = effectiveRole === "admin";

  return (
    <>
      {viewport}
      <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />

      {superMode ? (
        <Route
          path="/"
          element={
            <Protected>
              <SuperAdminLayout />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/users" replace />} />
          <Route path="users" element={<SuperUsersPage />} />
          <Route path="teachers/:adminId" element={<TeacherDetailPage />} />
          <Route path="grades" element={<GradesAdminPage />} />
          <Route path="notifications" element={<SystemNotificationsPage />} />
          <Route path="services" element={<ServicesPage />} />
        </Route>
      ) : (
        <Route
          path="/"
          element={
            <Protected>
              <DashboardLayout />
            </Protected>
          }
        >
          <Route index element={<DashboardHome />} />
          <Route
            path="students"
            element={can("STUDENT_VIEW") ? <StudentsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="students/:studentId/analytics"
            element={can("STUDENT_ANALYTICS") ? <StudentAnalyticsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="lectures"
            element={can("LESSON_VIEW") ? <LecturesPage /> : <Navigate to="/" replace />}
          />
          <Route path="lectures/:lectureId/groups/:groupId" element={<LessonGroupPage />} />
          {/* Lesson registration is a User-role responsibility, not the Admin's. */}
          <Route
            path="lesson-registration"
            element={can("REGISTRATION_ACCESS") ? <LessonRegistrationPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="offline-attendance"
            element={can("ATTENDANCE_ACCESS") ? <OfflineAttendancePage /> : <Navigate to="/" replace />}
          />
          {/* Exams: any exam permission grants access (admin holds them all). */}
          <Route
            path="exams"
            element={canExams ? <ExamsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="exams/:examId/build"
            element={canExams ? <ExamBuilderPage /> : <Navigate to="/" replace />}
          />
          {/* Admin-only areas: never delegated, so they check the role, not a
              permission - there is no permission to grant for these screens. */}
          <Route path="groups" element={isAdmin ? <GroupsPage /> : <Navigate to="/" replace />} />
          <Route path="analytics" element={isAdmin ? <AnalyticsPage /> : <Navigate to="/" replace />} />
          <Route path="grades" element={isAdmin ? <GradesPage /> : <Navigate to="/" replace />} />
          <Route path="users" element={isAdmin ? <UsersPage /> : <Navigate to="/" replace />} />
          <Route
            path="notifications"
            element={can("NOTIFICATION_SEND") ? <AdminMessagingPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="services"
            element={isAdmin ? <ServiceIntegrationsPage /> : <Navigate to="/" replace />}
          />
        </Route>
      )}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
