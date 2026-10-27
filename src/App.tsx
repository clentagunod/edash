import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SchoolSelectionPage from './pages/SchoolSelectionPage';
import ParentPortalPage from './pages/ParentPortalPage';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import RouteLoadingFallback from './components/RouteLoadingFallback';
import MaintenancePage from './pages/MaintenancePage';
import { APP_CONFIG, isVisitorSession } from './lib/app-config';
import { auth } from './lib/firebase';
import { resolveMaintenanceMode, startModeSettingsListener, useModeSettings } from './lib/mode-settings';
import { clearTenantSession } from './lib/tenant-session';
import { handlePageLinkClick } from './lib/page-navigation';
import { clearStoredSchool, getRegisteredSchools, getStoredSchool, sameSchoolRegistration, storeActiveSchool } from './lib/school-registry';

const initialTenantSchool = getStoredSchool();

function EduAiAvailabilityNotice({ schoolId }: { schoolId: string }) {
  const [visible, setVisible] = useState(() => {
    try {
      return sessionStorage.getItem(`edash.eduaiNoticeSeen.${schoolId}`) !== 'true';
    } catch (error) {
      console.error('Could not read EduAI announcement state:', error);
      return true;
    }
  });

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(`edash.eduaiNoticeSeen.${schoolId}`, 'true');
    } catch (error) {
      console.error('Could not save EduAI announcement state:', error);
    }
  }, [schoolId, visible]);

  if (!visible) return null;
  return (
    <aside className="eduai-availability-notice" role="status" aria-live="polite" aria-label="EduAI is Available">
      <span className="eduai-availability-art" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <path d="M24 4.5 27.7 18l13.8 4.5-13.8 4.1L24 40.5l-3.7-13.9L6.5 22.5 20.3 18 24 4.5Z" />
          <path d="m38 5 .9 3.1L42 9l-3.1.9L38 13l-.9-3.1L34 9l3.1-.9L38 5Z" />
        </svg>
      </span>
      <div className="eduai-availability-copy">
        <span className="eduai-availability-eyebrow">A new school sidekick</span>
        <strong>EduAI is Available</strong>
        <p>A little more help for planning, teaching, and learner support.</p>
        <Link
          className="eduai-availability-link"
          to="/pages/eduai.html"
          onClick={() => setVisible(false)}
        >
          Meet EduAI
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4 10h12m-5-5 5 5-5 5" />
          </svg>
        </Link>
      </div>
      <button
        className="eduai-availability-close"
        type="button"
        aria-label="Dismiss EduAI availability announcement"
        onClick={() => setVisible(false)}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>
    </aside>
  );
}

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MasterlistPage = lazy(() => import('./pages/MasterlistPage'));
const Program4psPage = lazy(() => import('./pages/Program4psPage'));
const ProgramIpPage = lazy(() => import('./pages/ProgramIpPage'));
const ProgramSnedPage = lazy(() => import('./pages/ProgramSnedPage'));
const ProgramAralPage = lazy(() => import('./pages/ProgramAralPage'));
const ProgramMuslimPage = lazy(() => import('./pages/ProgramMuslimPage'));
const EnrollmentDataPage = lazy(() => import('./pages/EnrollmentDataPage'));
const DataPage = lazy(() => import('./pages/DataPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const EosyReportPage = lazy(() => import('./pages/EosyReportPage'));
const GradesProfilePage = lazy(() => import('./pages/GradesProfilePage'));
const PrintCardPage = lazy(() => import('./pages/PrintCardPage'));
const ReadingProfilePage = lazy(() => import('./pages/ReadingProfilePage'));
const MathProfilePage = lazy(() => import('./pages/MathProfilePage'));
const NutritionalStatusPage = lazy(() => import('./pages/NutritionalStatusPage'));
const TransferInfoPage = lazy(() => import('./pages/TransferInfoPage'));
const DropoutPage = lazy(() => import('./pages/DropoutPage'));
const PromotionPage = lazy(() => import('./pages/PromotionPage'));
const RetentionPage = lazy(() => import('./pages/RetentionPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const TrashPage = lazy(() => import('./pages/TrashPage'));
const UtilitiesPage = lazy(() => import('./pages/UtilitiesPage'));
const BmiCalculatorPage = lazy(() => import('./pages/BmiCalculatorPage'));
const GradeCalculatorPage = lazy(() => import('./pages/GradeCalculatorPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ManageUsersPage = lazy(() => import('./pages/ManageUsersPage'));
const EduaiPage = lazy(() => import('./pages/EduaiPage'));
const PreferencesPage = lazy(() => import('./pages/PreferencesPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));

function SchoolRegistrationGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<'checking' | 'active' | 'denied' | 'unavailable'>('checking');
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);
  const [eduAiEnabled, setEduAiEnabled] = useState(false);
  const isPublicRoute = location.pathname === '/' ||
    location.pathname === '/index.html' ||
    location.pathname === '/select-school' ||
    location.pathname === '/privacy-policy';

  useEffect(() => {
    if (isPublicRoute) {
      setStatus('checking');
      setVerifiedPath(null);
      return;
    }
    let disposed = false;
    let verificationRun = 0;
    setStatus('checking');
    setVerifiedPath(null);

    const verifyRegistration = async () => {
      const run = ++verificationRun;
      const school = getStoredSchool();
      if (!school || !initialTenantSchool || !sameSchoolRegistration(initialTenantSchool, school)) {
        if (!school) clearStoredSchool();
        clearTenantSession();
        try {
          await auth.signOut();
        } catch (error) {
          console.error('Could not sign out after the selected school changed:', error);
        }
        if (!disposed && run === verificationRun) {
          setStatus('denied');
          setVerifiedPath(location.pathname);
        }
        return;
      }
      try {
        const registeredSchools = await getRegisteredSchools();
        if (disposed || run !== verificationRun) return;
        const latestSchool = getStoredSchool();
        if (!latestSchool || !sameSchoolRegistration(initialTenantSchool, latestSchool) ||
          !sameSchoolRegistration(school, latestSchool)) {
          clearTenantSession();
          try {
            await auth.signOut();
          } catch (error) {
            console.error('Could not sign out after the selected school changed:', error);
          }
          if (!disposed && run === verificationRun) {
            setStatus('denied');
            setVerifiedPath(location.pathname);
          }
          return;
        }
        const registeredSchool = registeredSchools.find((registered) => registered.id === school.id);
        if (registeredSchool && sameSchoolRegistration(registeredSchool, school)) {
          setEduAiEnabled(registeredSchool.canUseEduAI === true);
          if (registeredSchool.colorGradientTag !== school.colorGradientTag) {
            storeActiveSchool(registeredSchool);
            if (location.pathname === '/login') {
              window.location.reload();
              return;
            }
          }
          setStatus('active');
          setVerifiedPath(location.pathname);
          return;
        }
        if (registeredSchool) {
          clearTenantSession();
          try {
            await auth.signOut();
          } catch (error) {
            console.error('Could not sign out after school registration settings changed:', error);
            if (!disposed) {
              if (run !== verificationRun) return;
              setStatus('unavailable');
              setVerifiedPath(location.pathname);
            }
            return;
          }
          if (disposed || run !== verificationRun) return;
          storeActiveSchool(registeredSchool);
          window.location.reload();
          return;
        }
        clearStoredSchool();
        clearTenantSession();
        try {
          await auth.signOut();
        } catch (error) {
          console.error('Could not sign out after school registration was revoked:', error);
        }
        if (disposed || run !== verificationRun) return;
        setStatus('denied');
        setVerifiedPath(location.pathname);
      } catch (error) {
        if (!disposed && run === verificationRun) {
          setStatus('unavailable');
          setVerifiedPath(location.pathname);
          console.error('Could not verify school registration:', error);
        }
      }
    };

    const onStorageChange = (event: StorageEvent) => {
      if (event.key !== null && event.key !== 'edash.activeSchool') return;
      setStatus('checking');
      setVerifiedPath(null);
      void verifyRegistration();
    };

    void verifyRegistration();
    const interval = window.setInterval(() => void verifyRegistration(), 35_000);
    window.addEventListener('storage', onStorageChange);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [isPublicRoute, location.pathname, retry]);

  if (isPublicRoute) return children;
  const routeStatus = verifiedPath === location.pathname ? status : 'checking';
  if (routeStatus === 'active') {
    const activeSchool = getStoredSchool();
    const showEduAiNotice = eduAiEnabled &&
      location.pathname.startsWith('/pages/') &&
      location.pathname !== '/pages/eduai.html' &&
      !isVisitorSession();
    return (
      <>
        {children}
        {showEduAiNotice && activeSchool && <EduAiAvailabilityNotice key={activeSchool.id} schoolId={activeSchool.id} />}
      </>
    );
  }
  if (routeStatus === 'denied') return <Navigate to="/select-school" replace />;

  if (routeStatus === 'checking') {
    return <RouteLoadingFallback pageLoading={location.pathname.startsWith('/pages/')} />;
  }

  return (
    <main className="school-access-error" role="alert" aria-live="assertive">
      <div className="school-access-error-content">
        <strong>School access could not be verified</strong>
        <span>The school directory is temporarily unavailable. Access is paused to protect school data.</span>
        <button className="school-access-retry" type="button" onClick={() => setRetry((value) => value + 1)}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M16.2 8A6.5 6.5 0 1 0 16.5 10M16.2 4.5V8h-3.5" />
          </svg>
          Try again
        </button>
      </div>
    </main>
  );
}

/**
 * Route paths intentionally mirror the legacy site's file layout
 * ("/pages/dashboard.html", "/pages/masterlist.html", ...) so every
 * hard-coded <a href="masterlist.html"> inside the ported markup
 * (see src/pages/markup/*.html) keeps working completely unmodified —
 * relative links resolve to these exact paths. See
 * README.md for the architecture overview.
 */
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [modeSettingsRetry, setModeSettingsRetry] = useState(0);
  const modeSettings = useModeSettings();

  useEffect(() => startModeSettingsListener(), [modeSettingsRetry]);

  useEffect(() => {
    const onPageLinkClick = (event: MouseEvent) => handlePageLinkClick(event, navigate);
    document.addEventListener('click', onPageLinkClick);
    return () => document.removeEventListener('click', onPageLinkClick);
  }, [navigate]);

  if (resolveMaintenanceMode(modeSettings.isMaintenanceMode)) {
    return <MaintenancePage />;
  }
  if (modeSettings.status === 'loading') {
    return <RouteLoadingFallback pageLoading={false} />;
  }
  if (modeSettings.status === 'error') {
    return (
      <main className="school-access-error" role="alert" aria-live="assertive">
        <div className="school-access-error-content">
          <strong>Mode settings could not be loaded</strong>
          <span>The centralized E-Dash settings are temporarily unavailable.</span>
          <button className="school-access-retry" type="button" onClick={() => setModeSettingsRetry((value) => value + 1)}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  const isPageRoute = location.pathname.startsWith('/pages/');
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback pageLoading={isPageRoute} />}>
        <SchoolRegistrationGate>
          <Routes>
          <Route path="/" element={<Navigate to="/select-school" replace />} />
          <Route path="/index.html" element={<Navigate to="/select-school" replace />} />
          <Route path="/select-school" element={<SchoolSelectionPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/parent.html" element={<ParentPortalPage />} />

          <Route path="/pages/dashboard.html" element={<DashboardPage />} />
          <Route path="/pages/masterlist.html" element={<MasterlistPage />} />
          <Route path="/pages/program-4ps.html" element={<Program4psPage />} />
          <Route path="/pages/program-ip.html" element={<ProgramIpPage />} />
          <Route path="/pages/program-sned.html" element={<ProgramSnedPage />} />
          <Route path="/pages/program-aral.html" element={<ProgramAralPage />} />
          <Route path="/pages/program-muslim.html" element={<ProgramMuslimPage />} />
          <Route path="/pages/enrollment-data.html" element={<EnrollmentDataPage />} />
          <Route path="/pages/data.html" element={<DataPage />} />
          <Route path="/pages/reports.html" element={<ReportsPage />} />
          <Route path="/pages/eosy-report.html" element={<EosyReportPage />} />
          <Route path="/pages/grades-profile.html" element={<GradesProfilePage />} />
          <Route path="/pages/print-card.html" element={<PrintCardPage />} />
          <Route path="/pages/reading-profile.html" element={<ReadingProfilePage />} />
          <Route path="/pages/math-profile.html" element={<MathProfilePage />} />
          <Route path="/pages/nutritional-status.html" element={<NutritionalStatusPage />} />
          <Route path="/pages/transfer-info.html" element={<TransferInfoPage />} />
          <Route path="/pages/dropout.html" element={<DropoutPage />} />
          <Route path="/pages/promotion.html" element={<PromotionPage />} />
          <Route path="/pages/retention.html" element={<RetentionPage />} />
          <Route path="/pages/audit-log.html" element={<AuditLogPage />} />
          <Route path="/pages/feedback.html" element={<FeedbackPage />} />
          <Route path="/pages/trash.html" element={<TrashPage />} />
          <Route path="/pages/utilities.html" element={<UtilitiesPage />} />
          <Route path="/pages/bmi-calculator.html" element={<BmiCalculatorPage />} />
          <Route path="/pages/grade-calculator.html" element={<GradeCalculatorPage />} />
          <Route path="/pages/settings.html" element={<SettingsPage />} />
          <Route path="/pages/preferences.html" element={<PreferencesPage />} />
          <Route path="/pages/manage-users.html" element={<ManageUsersPage />} />
          <Route path="/pages/eduai.html" element={<EduaiPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SchoolRegistrationGate>
      </Suspense>
    </RouteErrorBoundary>
  );
}
