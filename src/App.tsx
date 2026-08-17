import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { api, ApiError } from "@/lib/api";
import { GOOGLE_CONNECTED } from "@/lib/appEvents";
import { toast, ToastViewport } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import LoginPage from "@/pages/LoginPage";
import DashboardLayout from "@/pages/DashboardLayout";
import DashboardHome from "@/pages/DashboardHome";

/**
 * Every screen below the shell is loaded on demand.
 *
 * <p>They used to be static imports, which put all thirty of them - plus
 * everything they pull in - into ONE 976 kB bundle that every user downloaded
 * before seeing the login form. Nobody ever needs all of it: an assistant can
 * never open the super-admin console, an admin never opens the exam builder
 * unless they go there, and the desk spends its whole day on one screen.
 *
 * <p>The shell (login, layout, home) stays eagerly imported: it is what the
 * first paint needs, so splitting it would only add a round trip.
 *
 * <p>Route-level rather than component-level, because a route is the natural
 * boundary the router already suspends on and the chunks stay big enough to be
 * worth their own request.
 */
const SuperAdminLayout = lazy(() => import("@/pages/SuperAdminLayout"));
const SuperUsersPage = lazy(() => import("@/modules/superadmin/UsersPage"));
const TeacherDetailPage = lazy(() => import("@/modules/superadmin/TeacherDetailPage"));
const GradesAdminPage = lazy(() => import("@/modules/superadmin/GradesAdminPage"));
const SystemNotificationsPage = lazy(() => import("@/modules/superadmin/SystemNotificationsPage"));
const ServicesPage = lazy(() => import("@/modules/superadmin/ServicesPage"));
const GroupsPage = lazy(() => import("@/modules/groups/GroupsPage"));
const UsersPage = lazy(() => import("@/modules/users/UsersPage"));
const AnalyticsPage = lazy(() => import("@/modules/analytics/AnalyticsPage"));
const GradesPage = lazy(() => import("@/modules/grades/GradesPage"));
const ServiceIntegrationsPage = lazy(() => import("@/modules/services/ServiceIntegrationsPage"));
const AdminMessagingPage = lazy(() => import("@/modules/notifications/AdminMessagingPage"));
const StudentsPage = lazy(() => import("@/modules/students/StudentsPage"));
const StudentAnalyticsPage = lazy(() => import("@/modules/students/StudentAnalyticsPage"));
const LecturesPage = lazy(() => import("@/modules/lectures/LecturesPage"));
const LessonGroupPage = lazy(() => import("@/modules/lectures/LessonGroupPage"));
const LessonRegistrationPage = lazy(() => import("@/modules/registration/LessonRegistrationPage"));
const FinancialsPage = lazy(() => import("@/modules/finance/FinancialsPage"));
const ExamsPage = lazy(() => import("@/modules/exams/ExamsPage"));
const ExamBuilderPage = lazy(() => import("@/modules/exams/ExamBuilderPage"));

/**
 * OAuth codes this tab has already handed to the server. Module scope, not a
 * ref: it has to outlive a remount of the component, which is exactly what the
 * development double-render is.
 */
const redeemedGoogleCodes = new Set<string>();

function Protected({ children }: { children: React.ReactNode }) {
  const { user, restoring } = useAuth();
  // Wait for the stored session to be checked - otherwise a reload bounces a
  // signed-in user to the login page before /auth/me answers.
  if (restoring) return <LoaderBlock />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, effectiveRole, restoring, can, hasModule } = useAuth();
  const navigate = useNavigate();

  // Google OAuth returns to the app root with ?code&scope=...contacts... . Once a
  // signed-in admin lands back here, exchange the code then clean the URL.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const scope = params.get("scope") ?? "";
    if (!code || !scope.includes("contacts")) return;
    // A Google code may be redeemed ONCE. This effect ran twice - React runs
    // every effect twice in development, and both runs saw the same code still
    // sitting in the URL - so the account was connected by the first call and
    // the second was refused, which is why a success and a failure arrived
    // together. The code is claimed and stripped from the URL synchronously
    // here, before any await, so nothing can read it a second time (a reload
    // included).
    if (redeemedGoogleCodes.has(code)) return;
    redeemedGoogleCodes.add(code);
    window.history.replaceState({}, "", window.location.pathname);
    // Straight to the page this belongs to, on its own tab, rather than letting
    // the home page paint first and jump a moment later.
    navigate("/services?tab=contacts", { replace: true });
    api
      .post("/google/connect", { code })
      .then(() => {
        toast.success("تم ربط حساب Google بنجاح");
        // The services page is already open by now and read its status BEFORE
        // this exchange finished, so it is still showing "no account linked".
        // Tell it to read again rather than leaving the user to reload.
        window.dispatchEvent(new Event(GOOGLE_CONNECTED));
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "تعذّر ربط حساب Google"));
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

  // The admin's own screens carry no permission to delegate, so they are gated
  // on the module instead: the super admin can switch any screen off per admin,
  // and every module ships enabled.
  const adminScreen = (moduleCode: string) => isAdmin && hasModule(moduleCode);

  return (
    <>
      {viewport}
      {/* One boundary around the whole route tree: a lazily loaded screen shows
          the same loader the app already uses while its chunk arrives. */}
      <Suspense fallback={<LoaderBlock />}>
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
          {/* Financials reads money, so viewing it is its own permission - an
              assistant who registers lessons does not see the takings unless
              the admin grants it. */}
          <Route
            path="financials"
            element={can("FINANCE_VIEW") ? <FinancialsPage /> : <Navigate to="/" replace />}
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
          <Route path="groups" element={adminScreen("GROUPS") ? <GroupsPage /> : <Navigate to="/" replace />} />
          <Route path="analytics" element={adminScreen("ANALYTICS") ? <AnalyticsPage /> : <Navigate to="/" replace />} />
          <Route path="grades" element={adminScreen("GROUPS") ? <GradesPage /> : <Navigate to="/" replace />} />
          <Route path="users" element={adminScreen("ASSISTANTS") ? <UsersPage /> : <Navigate to="/" replace />} />
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
    </Suspense>
    </>
  );
}
