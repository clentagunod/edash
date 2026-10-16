import { FormEvent, useEffect, useState } from 'react';
import { parentAuth } from '../lib/firebase';
import { fsGetParentAccessEnabled, fsGetParentCurrentSchoolYear, fsGetParentGradeTermCount, fsGetParentLearner } from '../lib/firestore-api';
import { LPSCache } from '../lib/cache';
import { Icon } from '../lib/icons';
import '../styles/pages/parent-portal.css';
import TestModeStamp from '../components/TestModeStamp';
import { APP_CONFIG, appBrandAssetUrl, updateSchoolFavicon } from '../lib/app-config';
import { getStoredSchool } from '../lib/school-registry';
import { parentGradeProfiles } from '../lib/parent-grades';
import { formatLearnerName } from '../lib/learner-sorting';

type Learner = Record<string, any>;

const LABELS: Record<string, string> = {
  learnerId: 'LRN', firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', suffix: 'Suffix',
  birthDate: 'Birthdate', age: 'Age', gradeLevel: 'Grade level', section: 'Section', gender: 'Gender',
  guardian: 'Parent / guardian', contact: 'Contact number', enrollmentStatus: 'Enrollment status',
  eosyStatus: 'End-of-year status', dateAdded: 'Date added', bosyHeight: 'Baseline height', bosyWeight: 'Baseline weight',
  bosyNutritionalStatus: 'Baseline nutritional status', mosyHeight: 'Midline height', mosyWeight: 'Midline weight',
  mosyNutritionalStatus: 'Midline nutritional status', eosyHeight: 'Endline height', eosyWeight: 'Endline weight',
  eosyNutritionalStatus: 'Endline nutritional status', transferType: 'Transfer type', transferSchool: 'Transfer school',
  transferDate: 'Transfer date', transferReason: 'Transfer reason', transferNotes: 'Transfer notes',
  filipino: 'Filipino', english: 'English', math: 'Mathematics', science: 'Science', aralPan: 'Araling Panlipunan',
  esp: 'ESP', music: 'Music', arts: 'Arts', pe: 'Physical Education', health: 'Health', epp: 'EPP', motherTongue: 'Mother Tongue',
  bosyCRLA: 'BOSY CRLA', mosyCRLA: 'MOSY CRLA', eosyCRLA: 'EOSY CRLA', bosyPhilIRI: 'BOSY Phil-IRI', mosyPhilIRI: 'MOSY Phil-IRI', eosyPhilIRI: 'EOSY Phil-IRI',
  bosyRMA: 'BOSY RMA', mosyRMA: 'MOSY RMA', eosyRMA: 'EOSY RMA',
};

const PROFILE_FIELDS = ['firstName', 'middleName', 'lastName', 'suffix', 'birthDate', 'age', 'gradeLevel', 'section', 'gender'];
const FAMILY_FIELDS = ['guardian', 'contact'];
const SCHOOL_FIELDS = ['enrollmentStatus', 'eosyStatus', 'dateAdded'];
const NUTRITION_FIELDS = [
  'bosyHeight', 'bosyWeight', 'bosyNutritionalStatus', 'mosyHeight', 'mosyWeight', 'mosyNutritionalStatus',
  'eosyHeight', 'eosyWeight', 'eosyNutritionalStatus',
];
const TRANSFER_FIELDS = ['transferType', 'transferSchool', 'transferDate', 'transferReason', 'transferNotes'];
const ASSESSMENT_FIELDS = ['bosyCRLA', 'mosyCRLA', 'eosyCRLA', 'bosyPhilIRI', 'mosyPhilIRI', 'eosyPhilIRI', 'bosyRMA', 'mosyRMA', 'eosyRMA'];
const PROGRAM_FIELDS = [
  ['is4Ps', '4Ps beneficiary'], ['isIP', 'IP learner'], ['isSNED', 'SNED learner'],
  ['isARAL', 'ARAL tagged'], ['isMuslim', 'Muslim learner'],
];
const PARENT_LOOKUP_CACHE_TTL_MS = 60 * 1000;

function waitForInitialAuthState(): Promise<any> {
  if (parentAuth.currentUser) return Promise.resolve(parentAuth.currentUser);
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (callback: (value: any) => void, value: any) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      callback(value);
    };
    const timeout = window.setTimeout(() => {
      finish(reject, Object.assign(new Error('Firebase Authentication did not initialize.'), { code: 'auth/timeout' }));
    }, 5000);
    unsubscribe = parentAuth.onAuthStateChanged(
      (user: any) => finish(resolve, user || null),
      (error: any) => finish(reject, error),
    );
    if (settled) unsubscribe();
  });
}

async function ensureParentAuthentication() {
  const currentUser = await waitForInitialAuthState();
  if (currentUser?.isAnonymous) return currentUser;
  if (currentUser) await parentAuth.signOut();
  const credential = await parentAuth.signInAnonymously();
  return credential.user;
}

function formatValue(key: string, value: any) {
  if (value && typeof value.toDate === 'function') return value.toDate().toLocaleDateString();
  if (key === 'birthDate' && value) {
    const dateOnly = String(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (dateOnly) {
      const date = new Date(`${dateOnly}T00:00:00`);
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
    }
  }
  if (key === 'dateAdded' && value) return new Date(value).toLocaleDateString();
  if (key.endsWith('Height') && value !== '') {
    const centimeters = Number(value);
    return Number.isFinite(centimeters) ? `${(centimeters / 100).toFixed(2)} m (${centimeters.toFixed(1)} cm)` : String(value);
  }
  if (key.endsWith('Weight') && value !== '') return `${Number(value).toFixed(1)} kg`;
  if (key === 'enrollmentStatus') return String(value).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return String(value);
}

function DetailSection({ title, fields, learner, hidden = false }: { title: string; fields: string[]; learner: Learner; hidden?: boolean }) {
  const visibleFields = fields.filter((field) => learner[field] !== undefined && learner[field] !== null && learner[field] !== '');
  if (!visibleFields.length) return null;
  return (
    <section className="parent-detail-section">
      <h2>{title}</h2>
      <dl className="parent-detail-grid">
        {visibleFields.map((field) => <div key={field}><dt>{LABELS[field] || field}</dt><dd className={hidden ? 'parent-sensitive-value' : ''}>{hidden ? 'Hidden' : formatValue(field, learner[field])}</dd></div>)}
      </dl>
    </section>
  );
}

function GradeProfiles({ learner, termCount, hidden }: { learner: Learner; termCount: number; hidden: boolean }) {
  const profiles = parentGradeProfiles(learner, termCount);
  const hasGrades = profiles.some(({ grades }) => grades.length > 0);
  return (
    <div className="parent-grade-profiles">
      {profiles.map(({ id, label, grades }) => (
        <section className="parent-grade-profile" key={id}>
          <h3>{label}</h3>
          {grades.length ? (
            <dl className="parent-detail-grid">
              {grades.map(({ id: subjectId, label: subject, value }) => (
                <div key={subjectId}>
                  <dt>{subject}</dt>
                  <dd className={hidden ? 'parent-sensitive-value' : ''}>{hidden ? 'Hidden' : String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : hasGrades ? <p className="parent-grade-empty">No grades recorded for this term.</p> : null}
        </section>
      ))}
      {!hasGrades && <p className="parent-grade-empty">No grade profiles are available for this learner yet.</p>}
    </div>
  );
}

export default function ParentPortalPage() {
  const activeSchool = getStoredSchool();
  const schoolName = activeSchool?.name || APP_CONFIG.branding.schoolName;
  const schoolNickname = activeSchool?.nickname || APP_CONFIG.branding.nickname;
  const schoolLogoUrl = activeSchool?.logoUrl || APP_CONFIG.branding.schoolLogoUrl;
  const [learnerId, setLearnerId] = useState('');
  const [learner, setLearner] = useState<Learner | null>(null);
  const [message, setMessage] = useState('');
  const [initializationError, setInitializationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [schoolYear, setSchoolYear] = useState('');
  const [gradeTermCount, setGradeTermCount] = useState(3);
  const [showGrades, setShowGrades] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      return window.localStorage.getItem('parent-portal-theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.title = `Parent Portal — ${schoolName}`;
    updateSchoolFavicon(schoolLogoUrl);
    const hadStaffDarkMode = document.body.classList.contains('dark-mode');
    document.body.classList.remove('dark-mode');
    void (async () => {
      await ensureParentAuthentication();
      const currentYear = await fsGetParentCurrentSchoolYear();
      if (!currentYear) throw new Error('No current school year is configured.');
      setInitializationError('');
      setSchoolYear(currentYear);
    })().catch((error) => {
      console.error('Unable to initialize the parent portal.', error);
      let initializationMessage: string;
      if (['auth/operation-not-allowed', 'auth/admin-restricted-operation'].includes(error?.code)) {
        initializationMessage = 'Parent lookup sign-in is disabled. Enable Anonymous sign-in in Firebase Authentication for this school project.';
      } else if (error?.code === 'permission-denied' || String(error?.code || '').endsWith('/permission-denied')) {
        initializationMessage = 'The parent portal could not read school-year settings. Deploy the latest firestore.rules to this school project.';
      } else {
        initializationMessage = 'The current school year could not be loaded. Check the tenant Firebase connection and current-year settings, then try again.';
      }
      setInitializationError(initializationMessage);
      setMessage(initializationMessage);
    });
    return () => {
      document.body.classList.toggle('dark-mode', hadStaffDarkMode);
    };
  }, [schoolLogoUrl, schoolName]);

  useEffect(() => {
    try {
      window.localStorage.setItem('parent-portal-theme', isDarkMode ? 'dark' : 'light');
    } catch {
      // Theme preference remains session-local when storage is unavailable.
    }
  }, [isDarkMode]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedId = learnerId.trim();
    setLearner(null);
    setShowGrades(false);
    setMessage('');
    if (!normalizedId) {
      setMessage('Enter the learner reference number to continue.');
      return;
    }
    if (!/^\d{12}$/.test(normalizedId)) {
      setMessage('Enter the complete 12-digit learner reference number.');
      return;
    }
    if (!schoolYear) {
      setMessage(initializationError || 'The current school year is unavailable right now. Please try again shortly.');
      return;
    }
    setLoading(true);
    try {
      await ensureParentAuthentication();
      if (!(await fsGetParentAccessEnabled())) {
        setMessage('Parent Portal access is temporarily unavailable. Your search was received, but learner information cannot be shown right now. Please try again later or contact the school office for assistance.');
        return;
      }
      const cacheKey = `parent_learner_lookup_${JSON.stringify([schoolYear, normalizedId])}`;
      const result = await LPSCache.getOrLoadMemory(
        cacheKey,
        () => fsGetParentLearner(normalizedId, schoolYear),
        PARENT_LOOKUP_CACHE_TTL_MS,
      );
      if (!result) setMessage('No active learner record was found for that LRN. Check the number and try again.');
      else {
        setLearner(result);
        try {
          setGradeTermCount(await fsGetParentGradeTermCount(schoolYear));
        } catch (error: any) {
          console.error('Parent portal grade-term settings could not be loaded.', error);
          if (error?.code === 'permission-denied' || String(error?.code || '').endsWith('/permission-denied')) {
            setMessage(`The learner record loaded, but Firestore denied access to settings/gradeTerms/years/${schoolYear}. Check the grade-term read rule in the selected school project.`);
          } else {
            setMessage('The learner record loaded, but grade settings could not be loaded. Some grade details may be unavailable.');
          }
        }
      }
    } catch (error: any) {
      console.error('Parent portal learner lookup failed.', error);
      if (error?.code === 'permission-denied' || String(error?.code || '').endsWith('/permission-denied')) {
        setMessage(`Firestore denied the anonymous read at schoolYears/${schoolYear}/learners/${normalizedId}. Confirm this exact document exists in the selected school project and is not marked dropped or transferred. If it is correct, verify anonymous access rules are published to that same project.`);
      } else if (['auth/operation-not-allowed', 'auth/admin-restricted-operation'].includes(error?.code)) {
        setMessage('Parent lookup sign-in is disabled. Enable Anonymous sign-in in Firebase Authentication for this school project.');
      } else if (error?.code === 'auth/timeout') {
        setMessage('Firebase Authentication did not finish loading. Refresh the page and try again.');
      } else {
        setMessage('We could not complete the lookup. Please try again or contact the school office.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <main className={`parent-portal-shell${isDarkMode ? ' parent-portal-dark' : ''}`}>
      <header className="parent-portal-header">
        <a className="parent-portal-brand" href="/login" aria-label="Back to login">
          <span className="parent-portal-brand-mark">
            <img src={appBrandAssetUrl(schoolLogoUrl)} alt={`${schoolNickname} logo`} width="30" height="30" onError={(event) => { event.currentTarget.style.display = 'none'; const fallback = event.currentTarget.nextElementSibling as SVGElement | null; if (fallback) fallback.style.display = 'block'; }} />
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
          </span>
          <span><strong>{schoolNickname}</strong><small>Parent information portal</small></span>
        </a>
        <div className="parent-portal-header-actions">
          <button
            className="parent-portal-theme-toggle"
            type="button"
            onClick={() => setIsDarkMode((value) => !value)}
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={isDarkMode}
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: Icon.sun }} /> : <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: Icon.moon }} />}
          </button>
          <a className="parent-portal-back" href="/login">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            <span>Back to sign in</span>
          </a>
        </div>
      </header>
      <div className="parent-portal-content">
        <section className="parent-portal-intro">
          <span className="parent-portal-kicker">Read-only access</span>
          <h1>Find your child&apos;s school record.</h1>
          <p>Enter the learner reference number provided by {APP_CONFIG.branding.schoolName} to view the latest available information.</p>
        </section>
        <form className="parent-search-card" onSubmit={handleSubmit}>
          <label htmlFor="parentLearnerId">Learner reference number</label>
          <div className="parent-search-row">
            <input id="parentLearnerId" value={learnerId} onChange={(event) => setLearnerId(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="Enter 12-digit LRN" autoComplete="off" inputMode="numeric" maxLength={12} required />
            <button type="submit" disabled={loading}>{loading ? 'Searching...' : 'Search record'}</button>
          </div>
          <p className="parent-search-note">Information is displayed for viewing only. Nothing can be edited from this portal.</p>
          {message && <p className="parent-portal-message" role="alert">{message}</p>}
        </form>
        {learner && (
          <section className="parent-result" aria-live="polite">
            <div className="parent-result-heading">
              <div><span className="parent-portal-kicker">Learner record</span><h2>{formatLearnerName(learner, 'Learner record')}</h2><p>{learner.learnerId} {schoolYear ? `• ${schoolYear}` : ''}</p></div>
              <span className="parent-readonly-badge">Read only</span>
            </div>
            <div className="parent-programs">
              {PROGRAM_FIELDS.filter(([field]) => learner[field]).map(([, label]) => <span key={label}>{label}</span>)}
              {!PROGRAM_FIELDS.some(([field]) => learner[field]) && <span>Not tagged in a program</span>}
            </div>
            <DetailSection title="Learner profile" fields={PROFILE_FIELDS} learner={learner} />
            <DetailSection title="Parent or guardian" fields={FAMILY_FIELDS} learner={learner} />
            <DetailSection title="School record" fields={SCHOOL_FIELDS} learner={learner} />
            <DetailSection title="Nutrition record" fields={NUTRITION_FIELDS} learner={learner} />
            <section className="parent-detail-section">
              <div className="parent-detail-section-heading"><h2>Grades and assessments</h2><button className="parent-visibility-toggle" type="button" onClick={() => setShowGrades((value) => !value)} aria-pressed={showGrades} aria-label={showGrades ? 'Hide grades' : 'Show grades'} title={showGrades ? 'Hide grades' : 'Show grades'}><span aria-hidden="true">{showGrades ? '◉' : '◌'}</span> {showGrades ? 'Hide grades' : 'Show grades'}</button></div>
              <GradeProfiles learner={learner} termCount={gradeTermCount} hidden={!showGrades} />
              <DetailSection title="" fields={ASSESSMENT_FIELDS} learner={learner} hidden={!showGrades} />
            </section>
            <DetailSection title="Transfer information" fields={TRANSFER_FIELDS} learner={learner} />
            {learner.extra && Object.keys(learner.extra).length > 0 && <DetailSection title="Additional information" fields={Object.keys(learner.extra)} learner={learner.extra} />}
          </section>
        )}
      </div>
      <footer className="parent-portal-footer">© {new Date().getFullYear()} {APP_CONFIG.branding.schoolName} · Courtesy of <a href="https://clentindustries.vercel.app/" target="_blank" rel="noopener noreferrer">ClentIndustries</a></footer>
      </main>
      <TestModeStamp />
    </>
  );
}