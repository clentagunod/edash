import { FormEvent, useEffect, useRef, useState } from 'react';
import { parentAuth } from '../lib/firebase';
import { fsGetParentAccessEnabled, fsGetParentCardPrintingPreferences, fsGetParentCurrentSchoolYear, fsGetParentGradeTermCount, fsGetParentLearner } from '../lib/firestore-api';
import { LPSCache } from '../lib/cache';
import { Icon } from '../lib/icons';
import '../styles/pages/parent-portal.css';
import TestModeStamp from '../components/TestModeStamp';
import { APP_CONFIG, appBrandAssetUrl, updateSchoolFavicon } from '../lib/app-config';
import { getStoredSchool } from '../lib/school-registry';
import { parentGradeProfiles } from '../lib/parent-grades';
import { formatLearnerName } from '../lib/learner-sorting';
import { DEFAULT_GRADE_TERM, DEFAULT_GRADE_TERM_COUNT, gradeTermsForCount } from '../lib/academic-grades';
import { learnerCardRecord, teacherCommentIndex, type AttendancePreferences, type AttendanceRecord } from '../lib/learner-card-record';
import { attendanceTotal } from '../lib/attendance';
import { documentStatusRecord } from '../lib/document-status';

type Learner = Record<string, any>;

const LABELS: Record<string, string> = {
  learnerId: 'LRN', firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', suffix: 'Suffix',
  birthDate: 'Birthdate', age: 'Age', gradeLevel: 'Grade level', section: 'Section', gender: 'Gender',
  guardian: 'Parent / guardian', contact: 'Contact number', enrollmentStatus: 'Enrollment status',
  eosyStatus: 'End-of-year status', dateAdded: 'Date added', bosyHeight: 'Baseline height', bosyWeight: 'Baseline weight',
  bosyNutritionalStatus: 'Baseline nutritional status', mosyHeight: 'Midline height', mosyWeight: 'Midline weight',
  mosyNutritionalStatus: 'Midline nutritional status', eosyHeight: 'Endline height', eosyWeight: 'Endline weight',
  eosyNutritionalStatus: 'Endline nutritional status', transferType: 'Transfer type', transferSchool: 'Transfer school', transferSchoolId: 'Transfer school ID', transferSchoolAddress: 'Transfer school address', transferSchoolZipCode: 'Transfer school ZIP code',
  transferDate: 'Transfer date', transferReason: 'Transfer reason', documentStatus: 'Document Status', documentStatusDate: 'Document Status date',
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
const TRANSFER_FIELDS = ['transferType', 'transferSchoolId', 'transferSchool', 'transferSchoolAddress', 'transferSchoolZipCode', 'transferDate', 'transferReason', 'documentStatus', 'documentStatusDate'];
const ASSESSMENT_FIELDS = ['bosyCRLA', 'mosyCRLA', 'eosyCRLA', 'bosyPhilIRI', 'mosyPhilIRI', 'eosyPhilIRI', 'bosyRMA', 'mosyRMA', 'eosyRMA'];
const PROGRAM_FIELDS = [
  ['is4Ps', '4Ps beneficiary'], ['isIP', 'IP learner'], ['isSNED', 'SNED learner'],
  ['isARAL', 'ARAL tagged'], ['isMuslim', 'Muslim learner'],
];
const PARENT_LOOKUP_CACHE_TTL_MS = 60 * 1000;

function PortalIcon({ name }: { name: keyof typeof Icon }) {
  return <span className="parent-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: Icon[name] || '' }} />;
}

function parentTransferRecord(learner: Learner): Learner {
  const status = documentStatusRecord(learner);
  return { ...learner, documentStatus: status.documentStatus === 'Custom' ? status.documentStatusCustom : status.documentStatus,
    documentStatusDate: status.documentStatusDates[status.documentStatus] || '' };
}

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

function DetailSection({ title, fields, learner, hidden = false, id }: { title: string; fields: string[]; learner: Learner; hidden?: boolean; id?: string }) {
  const visibleFields = fields.filter((field) => learner[field] !== undefined && learner[field] !== null && learner[field] !== '');
  if (!visibleFields.length) return null;
  return (
    <section className="parent-detail-section" id={id} aria-label={title}>
      <h3>{title}</h3>
      <dl className="parent-detail-grid">
        {visibleFields.map((field) => <div key={field}><dt>{LABELS[field] || field}</dt><dd className={hidden ? 'parent-sensitive-value' : ''}>{hidden ? 'Hidden' : formatValue(field, learner[field])}</dd></div>)}
      </dl>
    </section>
  );
}

function GradeProfiles({ learner, termCount, term, hidden }: { learner: Learner; termCount: number; term: string; hidden: boolean }) {
  const profiles = parentGradeProfiles(learner, termCount);
  const hasGrades = profiles.some(({ grades }) => grades.length > 0);
  return (
    <div className="parent-grade-profiles">
      {profiles.filter(({ id }) => id === term).map(({ id, label, grades }) => (
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

function ParentCardRecords({ learner, term, hidden, preferences, attendanceError }: {
  learner: Learner; term: string; hidden: boolean; preferences: AttendancePreferences | null; attendanceError: boolean;
}) {
  const card = learnerCardRecord(learner);
  const commentIndex = teacherCommentIndex(term);
  return (
    <>
      {commentIndex !== null && <section className="parent-detail-section parent-teacher-comments" aria-labelledby="parent-teacher-comments-title">
        <h3 id="parent-teacher-comments-title">Teacher Comments</h3>
        <p className={`parent-teacher-comment${hidden ? ' parent-sensitive-value' : ''}`}>
          {hidden ? 'Hidden' : card.teacherComments[commentIndex]?.trim() ? card.teacherComments[commentIndex] : 'No teacher comment recorded for this term.'}
        </p>
      </section>}
      <section className="parent-detail-section parent-attendance-record" aria-labelledby="parent-attendance-title">
        <h3 id="parent-attendance-title">Attendance record</h3>
        {preferences ? <div className="parent-attendance-scroll" role="region" aria-label="Monthly attendance" tabIndex={0}>
          <table className="parent-attendance-table">
            <thead><tr><th scope="col">Attendance</th>{preferences.attendanceMonths.map((month) => <th scope="col" key={month}>{month}</th>)}<th scope="col">Total</th></tr></thead>
            <tbody>{preferences.attendanceRows.map(({ id, label }) => {
              const row = card.attendance[id as keyof AttendanceRecord] || {};
              const values = preferences.attendanceMonths.map((month) => row[month] || '').filter((value) => value !== '');
              const total = attendanceTotal(values) || '—';
              return <tr key={id}><th scope="row">{label}</th>
                {preferences.attendanceMonths.map((month) => <td key={month} className={hidden ? 'parent-sensitive-value' : ''}>{hidden ? 'Hidden' : row[month] || '—'}</td>)}
                <td className={hidden ? 'parent-sensitive-value' : ''}>{hidden ? 'Hidden' : total}</td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <p className="parent-grade-empty" role="status">{attendanceError ? 'Attendance settings could not be loaded. Search again to retry.' : 'Loading attendance settings…'}</p>}
      </section>
    </>
  );
}

export default function ParentPortalPage() {
  const activeSchool = getStoredSchool();
  const schoolName = activeSchool?.name || APP_CONFIG.branding.schoolName;
  const schoolNickname = activeSchool?.nickname || APP_CONFIG.branding.nickname;
  const schoolLogoUrl = activeSchool?.logoUrl || APP_CONFIG.branding.schoolLogoUrl;
  const directSchoolEntry = window.location.pathname.startsWith('/parent/');
  const backHref = directSchoolEntry ? '/select-school' : '/login';
  const [learnerId, setLearnerId] = useState('');
  const [learner, setLearner] = useState<Learner | null>(null);
  const [message, setMessage] = useState('');
  const [initializationError, setInitializationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [schoolYear, setSchoolYear] = useState('');
  const [gradeTermCount, setGradeTermCount] = useState(DEFAULT_GRADE_TERM_COUNT);
  const [selectedTerm, setSelectedTerm] = useState(DEFAULT_GRADE_TERM);
  const [cardPreferences, setCardPreferences] = useState<AttendancePreferences | null>(null);
  const [attendanceError, setAttendanceError] = useState(false);
  const [showGrades, setShowGrades] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
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
        initializationMessage = 'Parent Portal is temporarily unavailable. Please contact the school office.';
      } else if (error?.code === 'permission-denied' || String(error?.code || '').endsWith('/permission-denied')) {
        initializationMessage = 'The school record service is unavailable right now. Please try again later or contact the school office.';
      } else {
        initializationMessage = 'The current school year could not be loaded. Please try again later or contact the school office.';
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

  useEffect(() => {
    if (learner) resultHeading.current?.focus();
  }, [learner]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const normalizedId = learnerId.trim();
    setLearner(null);
    setShowGrades(false);
    setSelectedTerm(DEFAULT_GRADE_TERM);
    setGradeTermCount(DEFAULT_GRADE_TERM_COUNT);
    setCardPreferences(null);
    setAttendanceError(false);
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
        const [termResult, preferenceResult] = await Promise.allSettled([
          fsGetParentGradeTermCount(schoolYear), fsGetParentCardPrintingPreferences(),
        ]);
        if (preferenceResult.status === 'fulfilled') setCardPreferences(preferenceResult.value);
        else setAttendanceError(true);
        if (termResult.status === 'fulfilled') setGradeTermCount(termResult.value);
        else {
          const error = termResult.reason;
          console.error('Parent portal grade-term settings could not be loaded.', error);
          if (error?.code === 'permission-denied' || String(error?.code || '').endsWith('/permission-denied')) {
            setMessage('The learner record loaded, but grade details are temporarily unavailable. Please try again later.');
          } else {
            setMessage('The learner record loaded, but grade settings could not be loaded. Some grade details may be unavailable.');
          }
        }
      }
    } catch (error: any) {
      console.error('Parent portal learner lookup failed.', error);
      if (error?.code === 'permission-denied' || String(error?.code || '').endsWith('/permission-denied')) {
        setMessage('This record is unavailable right now. Check the LRN or contact the school office for assistance.');
      } else if (['auth/operation-not-allowed', 'auth/admin-restricted-operation'].includes(error?.code)) {
        setMessage('Parent Portal is temporarily unavailable. Please contact the school office.');
      } else if (error?.code === 'auth/timeout') {
        setMessage('The connection is taking longer than expected. Refresh the page and try again.');
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
        <a className="parent-skip-link" href="#parentLearnerId">Skip to learner search</a>
        <header className="parent-portal-header">
          <div className="parent-portal-header-inner">
            <a className="parent-portal-brand" href={backHref} aria-label={directSchoolEntry ? 'Choose another school' : 'Back to login'}>
              <span className="parent-portal-brand-mark">
                <img src={appBrandAssetUrl(schoolLogoUrl)} alt={`${schoolNickname} logo`} width="40" height="40" onError={(event) => { event.currentTarget.style.display = 'none'; const fallback = event.currentTarget.nextElementSibling as SVGElement | null; if (fallback) fallback.style.display = 'block'; }} />
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
              </span>
              <span><strong>{schoolName}</strong><small>Parent information portal</small></span>
            </a>
            <div className="parent-portal-header-actions">
              <button className="parent-portal-theme-toggle" type="button" onClick={() => setIsDarkMode((value) => !value)} aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={isDarkMode} title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
                <PortalIcon name={isDarkMode ? 'sun' : 'moon'} />
              </button>
              <a className="parent-portal-back" href={backHref} aria-label={directSchoolEntry ? 'Choose another school' : 'Back to sign in'}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                <span>{directSchoolEntry ? 'Choose another school' : 'Back to sign in'}</span>
              </a>
            </div>
          </div>
        </header>
        <div className="parent-portal-content">
          <section className="parent-portal-intro" aria-labelledby="parent-portal-title">
            <div><h1 id="parent-portal-title">Parent Portal</h1><p>View your child&apos;s school information and academic records at {schoolName}.</p></div>
            <div className="parent-school-year"><PortalIcon name="calendar" /><span>School year<strong>{schoolYear || (initializationError ? 'Unavailable' : 'Loading…')}</strong></span></div>
          </section>
          <div className="parent-portal-workspace">
            <aside className="parent-lookup-sidebar" aria-label="Learner lookup">
              <form className="parent-search-card" onSubmit={handleSubmit} aria-busy={loading} aria-labelledby="parent-search-title">
                <h2 id="parent-search-title">Find a learner</h2>
                <p className="parent-search-description">Use the LRN provided by your school.</p>
                <label htmlFor="parentLearnerId">Learner reference number</label>
                <div className="parent-search-row">
                  <input id="parentLearnerId" value={learnerId} onChange={(event) => setLearnerId(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="Enter 12-digit LRN" autoComplete="off" inputMode="numeric" maxLength={12} required disabled={loading} aria-describedby="parent-lrn-help" />
                  <p id="parent-lrn-help" className="parent-field-hint">Enter all 12 digits, without spaces.</p>
                  <button type="submit" disabled={loading}><PortalIcon name="search" />{loading ? 'Searching...' : 'Search record'}</button>
                </div>
                {message && <p className="parent-portal-message" role="alert"><PortalIcon name="info" /><span>{message}</span></p>}
                <p className="parent-search-note"><PortalIcon name="eye" /><span>View-only access. Records cannot be edited here.</span></p>
              </form>
              <section className="parent-lookup-help" aria-labelledby="parent-help-title">
                <h2 id="parent-help-title">Need help?</h2>
                <p>Your child&apos;s LRN is on their report card. If you need the number or notice an incorrect detail, contact the school office.</p>
              </section>
            </aside>
            <div className="parent-record-area">
              {!learner && <section className="parent-empty-state" aria-labelledby="parent-empty-title" aria-busy={loading}>
                <div className="parent-empty-heading"><PortalIcon name="learnerCard" /><span>Learner record</span></div>
                <div className="parent-empty-content">
                  <h2 id="parent-empty-title">{loading ? 'Finding learner record' : message ? 'No record to display' : 'No learner selected'}</h2>
                  <p role={loading ? 'status' : undefined}>{loading ? 'Please wait while we retrieve the school record.' : 'Enter your child’s learner reference number to view their information for the current school year.'}</p>
                  {!loading && <dl className="parent-record-guide">
                    <div><PortalIcon name="userRound" /><dt>Learner profile</dt><dd>Personal, class, and guardian information</dd></div>
                    <div><PortalIcon name="book" /><dt>Learner card</dt><dd>Grades, attendance, and teacher comments</dd></div>
                    <div><PortalIcon name="clipboard" /><dt>Other records</dt><dd>Nutrition, transfer, and additional information</dd></div>
                  </dl>}
                </div>
                <p className="parent-empty-footnote">Records are maintained by {schoolName}.</p>
              </section>}
              {learner && (
                <article className="parent-result" aria-labelledby="parent-learner-name">
                  <header className="parent-result-heading">
                    <div className="parent-learner-identity">
                      <span className="parent-learner-avatar" aria-hidden="true"><PortalIcon name="userRound" /></span>
                      <div><span className="parent-portal-kicker">Learner record</span><h2 id="parent-learner-name" ref={resultHeading} tabIndex={-1}>{formatLearnerName(learner, 'Learner record')}</h2><p><span>LRN <strong>{learner.learnerId}</strong></span>{learner.gradeLevel && <span>{learner.gradeLevel}{learner.section ? ` · ${learner.section}` : ''}</span>}</p></div>
                    </div>
                    <span className="parent-readonly-badge">Read only</span>
                  </header>
                  <nav className="parent-record-nav" aria-label="Learner record sections">
                    <a href="#parent-profile">Profile</a><a href="#parent-learner-card">Learner card</a><a href="#parent-other-records">Other records</a>
                  </nav>
                  <div className="parent-record-content">
                    <section className="parent-record-group" id="parent-profile" aria-labelledby="parent-profile-title" tabIndex={-1}>
                      <div className="parent-record-group-heading"><h2 id="parent-profile-title">Profile</h2><p>Personal information and school enrollment.</p></div>
                      <DetailSection title="Learner information" fields={PROFILE_FIELDS} learner={learner} />
                      <DetailSection title="Parent or guardian" fields={FAMILY_FIELDS} learner={learner} />
                      <DetailSection title="School record" fields={SCHOOL_FIELDS} learner={learner} />
                      <section className="parent-detail-section" aria-label="Programs and learner groups">
                        <h3>Programs and learner groups</h3>
                        <div className="parent-programs">
                          {PROGRAM_FIELDS.filter(([field]) => learner[field]).map(([, label]) => <span key={label}>{label}</span>)}
                          {!PROGRAM_FIELDS.some(([field]) => learner[field]) && <p>No program tags recorded.</p>}
                        </div>
                      </section>
                    </section>
                    <section className="parent-record-group" id="parent-learner-card" aria-labelledby="parent-card-title" tabIndex={-1}>
                      <div className="parent-detail-section-heading">
                        <div className="parent-record-group-heading"><h2 id="parent-card-title">Learner Card</h2><p>Academic performance and attendance.</p></div>
                        <button className="parent-visibility-toggle" type="button" onClick={() => setShowGrades((value) => !value)} aria-pressed={showGrades} aria-label={showGrades ? 'Hide grades, teacher comments, attendance, assessments, and anecdotal records' : 'Show grades, teacher comments, attendance, assessments, and anecdotal records'}><PortalIcon name="eye" />{showGrades ? 'Hide details' : 'Show details'}</button>
                      </div>
                      <div className="parent-card-toolbar">
                        <label className="parent-card-term" htmlFor="parentCardTerm">Academic term
                          <select id="parentCardTerm" value={selectedTerm} onChange={(event) => setSelectedTerm(event.target.value)}>
                            {gradeTermsForCount(gradeTermCount).map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
                          </select>
                        </label>
                        {!showGrades && <p>Details are hidden. Select “Show details” to view.</p>}
                      </div>
                      <GradeProfiles learner={learner} termCount={gradeTermCount} term={selectedTerm} hidden={!showGrades} />
                      <ParentCardRecords learner={learner} term={selectedTerm} hidden={!showGrades} preferences={cardPreferences} attendanceError={attendanceError} />
                      <DetailSection title="Assessments" fields={ASSESSMENT_FIELDS} learner={learner} hidden={!showGrades} />
                    </section>
                    <section className="parent-record-group" id="parent-other-records" aria-labelledby="parent-other-title" tabIndex={-1}>
                      <div className="parent-record-group-heading"><h2 id="parent-other-title">Other records</h2><p>Additional information recorded by the school.</p></div>
                      <DetailSection title="Nutrition record" fields={NUTRITION_FIELDS} learner={learner} />
                      <DetailSection title="Transfer information" fields={TRANSFER_FIELDS} learner={parentTransferRecord(learner)} />
                      {learner.extra && Object.keys(learner.extra).length > 0 && <DetailSection title="Additional information" fields={Object.keys(learner.extra)} learner={learner.extra} />}
                      <section className="parent-detail-section parent-anecdotal-records" aria-labelledby="parent-anecdotal-records-title">
                        <h3 id="parent-anecdotal-records-title">Anecdotal Records</h3>
                        <p className={`parent-anecdotal-text${showGrades ? '' : ' parent-sensitive-value'}`}>{!showGrades ? 'Hidden' : typeof learner.anecdotalRecords === 'string' && learner.anecdotalRecords.trim() ? learner.anecdotalRecords : 'No anecdotal records recorded.'}</p>
                        {!showGrades && <p className="parent-anecdotal-hint">Use “Show details” in the Learner Card section to view these records.</p>}
                      </section>
                    </section>
                  </div>
                </article>
              )}
            </div>
          </div>
        </div>
        <footer className="parent-portal-footer"><span>© {new Date().getFullYear()} {schoolName}</span><span>Courtesy of <a href="https://clentindustries.vercel.app/" target="_blank" rel="noopener noreferrer">ClentIndustries</a></span></footer>
      </main>
      <TestModeStamp />
    </>
  );
}
