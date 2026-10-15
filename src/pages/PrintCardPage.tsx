import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { CSSProperties } from 'react';
import { requireAuth } from '../lib/auth';
import {
  fsGetGradeLevelGradingConfigurations,
  fsGetGradeTermCount,
  fsGetGradeSubjectAssignments,
  fsGetLearners,
  fsGetPassingThreshold,
  fsGetSchoolYears,
  fsGetSections,
} from '../lib/firestore-api';
import { DEFAULT_GRADE_TERM_COUNT, finalGradeForDisplay, finalGradeRemark, gradeForTerm, gradeTermsForCount, numericalGradeAverage } from '../lib/academic-grades';
import { DEFAULT_PASSING_THRESHOLD } from '../lib/grading-config';
import {
  curriculumSubjectIdsForGrade,
  normalizeCurriculumGrade,
  normalizeCurriculumSubjectPool,
} from '../lib/curriculum-subjects';
import { getRegisteredSchools, getStoredSchool } from '../lib/school-registry';
import type { RegisteredSchool, SchoolInfo } from '../lib/school-registry';
import { isLetterGradedLevel } from '../lib/student-card';
import { formatLearnerName } from '../lib/learner-sorting';
import {
  CARD_BASE_HEIGHT_MM,
  CARD_BASE_WIDTH_MM,
  DEFAULT_SHEET_MARGIN,
  getCardPreviewScale,
  getLearnerIndexForSheetSlot,
  getPaperDimensions,
  makeDefaultCardLayouts,
  PAPER_SIZES,
  type CardLayout,
  type PaperOrientation,
  type PaperSizeId,
} from '../lib/student-card-layout';
import { APP_CONFIG, appBrandAssetUrl } from '../lib/app-config';
import { gradeLevelConfigKey } from '../lib/grading-config';
import '../styles/pages/print-card.css';

const MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
const PROGRAM_FILTERS = [
  { value: '4Ps', label: '4Ps Beneficiaries', field: 'is4Ps' },
  { value: 'IP', label: 'IP Learners', field: 'isIP' },
  { value: 'SNED', label: 'SNED Learners', field: 'isSNED' },
  { value: 'ARAL', label: 'ARAL Tagged', field: 'isARAL' },
  { value: 'Muslim', label: 'Muslim Learners', field: 'isMuslim' },
] as const;

type LearnerRecord = Record<string, unknown> & { learnerId?: string };
type Subject = { id: string; label: string };
type AttendanceEntry = Record<string, string>;
type ManualCardFields = {
  studentName: string;
  learnerId: string;
  age: string;
  gender: string;
  gradeLevel: string;
  section: string;
  schoolName: string;
  schoolYear: string;
  schoolHead: string;
  adviser: string;
  region: string;
  division: string;
  district: string;
  locality: string;
  track: string;
  comments: string;
  termComments: string[];
  admittedGrade: string;
  eligibleGrade: string;
  transferAdmittedIn: string;
  transferDate: string;
  attendance: {
    classDays: AttendanceEntry;
    daysPresent: AttendanceEntry;
    daysAbsent: AttendanceEntry;
  };
};

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function learnerName(learner: LearnerRecord): string {
  return formatLearnerName(learner) ||
    [learner.firstName, learner.middleName, learner.lastName].map(asText).filter(Boolean).join(' ').trim() ||
    asText(learner.learnerId) || 'Unnamed learner';
}

function cardGradeLabel(value: unknown): string {
  const grade = asText(value).trim();
  const match = grade.match(/^grade\s*(\d+)\b/i);
  return match ? match[1] : grade;
}

function regionLabel(value: string): string {
  const region = value.trim();
  if (!region) return '';
  return /^region\b/i.test(region) ? region : `Region ${region}`;
}

function localityFromDivisionOffice(divisionOffice: string): string {
  return divisionOffice.replace(/^schools division office of\s*/i, '').trim();
}

function emptyAttendance(): AttendanceEntry {
  return Object.fromEntries(MONTHS.map((month) => [month, '']));
}

function makeManualFields(
  schoolName: string,
  schoolYear: string,
  schoolHead = '',
  schoolInfo: Partial<SchoolInfo> = {},
  learner?: LearnerRecord | null,
  adviser = '',
): ManualCardFields {
  const birthDate = asText(learner?.birthDate || learner?.dateOfBirth);
  return {
    studentName: learner ? learnerName(learner) : '',
    learnerId: asText(learner?.learnerId || learner?.lrn),
    age: learner ? computedAge(birthDate) || asText(learner.age) : '',
    gender: asText(learner?.gender),
    gradeLevel: learner ? cardGradeLabel(learner.gradeLevel) : '',
    section: asText(learner?.section),
    schoolName,
    schoolYear,
    schoolHead,
    adviser,
    region: asText(schoolInfo.region),
    division: asText(schoolInfo.divisionOffice),
    district: asText(schoolInfo.district),
    locality: localityFromDivisionOffice(asText(schoolInfo.divisionOffice)),
    track: '',
    comments: '',
    termComments: ['', '', '', ''],
    admittedGrade: '',
    eligibleGrade: '',
    transferAdmittedIn: '',
    transferDate: '',
    attendance: {
      classDays: emptyAttendance(),
      daysPresent: emptyAttendance(),
      daysAbsent: emptyAttendance(),
    },
  };
}

function computedAge(birthDate: string): string {
  if (!birthDate) return '';
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? String(age) : '';
}

function displayAttendanceTotal(row: AttendanceEntry): string {
  const values = Object.values(row).filter((value) => value.trim() !== '');
  if (!values.length) return '';
  return String(values.reduce((sum, value) => sum + (Number(value) || 0), 0));
}

function gradeResult(average: string, passingThreshold: number, termsComplete: boolean): string {
  if (!termsComplete) return '';
  if (!average) return '';
  return Number(average) >= passingThreshold ? 'Promoted' : 'Retained';
}

function gradeDisplay(value: unknown): string {
  return asText(value).trim() || '';
}

function getInputValue(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>): string {
  return event.currentTarget.value;
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'student-card';
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type TermColumn = { id: string; label: string };
type SheetSide = 'front' | 'back';

function StudentCardReport({
  learner,
  manual,
  subjects,
  termColumns,
  termCount,
  autoCalculateFinalGrades,
  passingThreshold,
  schoolLogoUrl,
  schoolYear,
  side = 'both',
  transform,
  className,
}: {
  learner: LearnerRecord;
  manual: ManualCardFields;
  subjects: Subject[];
  termColumns: TermColumn[];
  termCount: number;
  autoCalculateFinalGrades: boolean;
  passingThreshold: number;
  schoolLogoUrl: string;
  schoolYear: string;
  side?: 'both' | 'front' | 'back';
  transform?: string;
  className?: string;
}) {
  const finalGrades = subjects.map((subject) => finalGradeForDisplay(
    learner,
    subject.id,
    termCount,
    autoCalculateFinalGrades,
  ));
  const finalRemarks = subjects.map((subject, index) => finalGradeRemark(
    finalGrades[index],
    termColumns.map(({ id }) => gradeForTerm(learner, id, subject.id)),
    passingThreshold,
  ));
  const allTermsComplete = finalRemarks.length > 0 && finalRemarks.every(Boolean);
  const generalAverage = allTermsComplete ? numericalGradeAverage(finalGrades, subjects.length) : '';
  const gradeRowHeight = subjects.length
    ? Math.max(6, Math.min(17, 150 / subjects.length))
    : 17;
  const printGradeRowHeight = subjects.length
    ? Math.max(1.8, Math.min(4.1, 45 / subjects.length))
    : 4.1;
  const gradeTableStyle = {
    '--sf9-grade-row-height': `${gradeRowHeight}px`,
    '--sf9-grade-print-row-height': `${printGradeRowHeight}mm`,
  } as CSSProperties;

  return (
    <article className={`sf9-report-card${className ? ` ${className}` : ''}`} style={transform ? { transform } : undefined}>
      {side !== 'back' && <section className="sf9-card-side sf9-card-front">
        <header className="sf9-letterhead">
          <img src="/assets/edash/deped-seal.png" alt="Department of Education seal" />
          <div className="sf9-letterhead-copy">
            <p>Republic of the Philippines</p>
            <p>Department of Education</p>
            {manual.region && <p>{regionLabel(manual.region)}</p>}
            {manual.division && <p className="sf9-division-name">{manual.division}</p>}
            <p>{manual.district ? `District of ${manual.district}` : ''}</p>
            <p>{[manual.district, manual.locality].filter(Boolean).join(', ')}</p>
            <h2>{manual.schoolName || 'School Name'}</h2>
          </div>
          <img src={schoolLogoUrl} alt={`${manual.schoolName || 'School'} logo`} />
        </header>

        <div className="sf9-report-title">
          <h1>LEARNER’S PERFORMANCE REPORT</h1>
          <p>School Year {manual.schoolYear}</p>
        </div>

        <table className="sf9-identity-table">
          <colgroup>
            <col className="sf9-identity-label-column" />
            <col className="sf9-identity-name-column" />
            <col className="sf9-identity-age-label-column" />
            <col className="sf9-identity-age-column" />
            <col className="sf9-identity-sex-label-column" />
            <col className="sf9-identity-sex-column" />
          </colgroup>
          <tbody>
            <tr>
              <th>Name:</th><td>{manual.studentName}</td>
              <th>Age:</th><td>{manual.age}</td>
              <th>Sex:</th><td>{manual.gender}</td>
            </tr>
            <tr>
              <th>LRN:</th><td>{manual.learnerId}</td>
              <th>Grade:</th><td>{cardGradeLabel(manual.gradeLevel)}</td>
              <th>Section:</th><td>{manual.section}</td>
            </tr>
            <tr className="sf9-track-row"><th>Track (SHS only):</th><td colSpan={5}>{manual.track}</td></tr>
          </tbody>
        </table>

        <p className="sf9-greeting"><strong>Dear Parents,</strong><br />This Performance Report shows the ability and progress your child has made in the different learning areas as well as his/her core values. The school welcomes you should you desire to know more about your child’s progress.</p>

        <div className="sf9-front-signatures">
          <div><strong>{manual.schoolHead}</strong><span>School Head</span></div>
          <div><strong>{manual.adviser}</strong><span>Adviser</span></div>
        </div>

        <section className="sf9-section">
          <h2>LEARNING PROGRESS AND ACHIEVEMENT</h2>
          <table className="sf9-data-table sf9-grade-table" style={gradeTableStyle}>
            <thead>
              <tr><th rowSpan={2}>Learning Areas</th><th colSpan={termColumns.length}>TERM</th><th rowSpan={2}>Final Grade</th><th rowSpan={2}>Remarks</th></tr>
              <tr>{termColumns.map(({ label, id }) => <th key={id}>{label.match(/^\d+/)?.[0] || ''}</th>)}</tr>
            </thead>
            <tbody>
              {subjects.length ? subjects.map((subject, index) => {
                const finalGrade = finalGrades[index];
                return (
                  <tr key={subject.id}>
                    <th>{subject.label}</th>
                    {termColumns.map(({ id }) => <td key={id}>{gradeDisplay(gradeForTerm(learner, id, subject.id))}</td>)}
                    <td>{gradeDisplay(finalGrade)}</td><td>{finalRemarks[index]}</td>
                  </tr>
                );
              }) : (
                <tr><td className="sf9-no-subjects" colSpan={termColumns.length + 3}>No subjects are assigned to {asText(learner.gradeLevel) || 'this grade'} for {schoolYear}.</td></tr>
              )}
              {subjects.length > 0 && <tr className="sf9-general-average">
                <th colSpan={termColumns.length + 1}>General Average</th>
                <td>{generalAverage}</td>
                <td>{gradeResult(generalAverage, passingThreshold, allTermsComplete)}</td>
              </tr>}
            </tbody>
          </table>
        </section>

        <section className="sf9-descriptor-section">
          <h2>PERFORMANCE DESCRIPTORS</h2>
          <table className="sf9-data-table sf9-descriptor-table">
            <thead><tr><th>Grading Scale</th><th>Description</th><th>Remarks</th></tr></thead>
            <tbody>
              <tr><td>90–100</td><td>Advancing</td><td>Passed</td></tr>
              <tr><td>80–89</td><td>Benchmarking</td><td>Passed</td></tr>
              <tr><td>75–79</td><td>Connecting</td><td>Passed</td></tr>
              <tr><td>65–74</td><td>Developing</td><td>Failed</td></tr>
              <tr><td>0–64</td><td>Emerging</td><td>Failed</td></tr>
            </tbody>
          </table>
        </section>
      </section>}

      {side !== 'front' && <section className="sf9-card-side sf9-card-back">
        <section className="sf9-attendance-section">
          <h2>ATTENDANCE RECORD</h2>
          <table className="sf9-data-table sf9-attendance-table">
            <thead><tr><th>Month</th>{MONTHS.map((month) => <th key={month}>{month}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {([
                ['classDays', 'No. of Class Days'],
                ['daysPresent', 'No. of Days Present'],
                ['daysAbsent', 'No. of Days Absent'],
              ] as const).map(([key, label]) => (
                <tr key={key}><th>{label}</th>{MONTHS.map((month) => <td key={month}>{manual.attendance[key][month]}</td>)}<td>{displayAttendanceTotal(manual.attendance[key])}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="sf9-comments-section">
          <h2>TEACHER’S COMMENTS/REMARKS</h2>
          {termColumns.map(({ label, id }, index) => <div className="sf9-comment-box" key={id}><strong>{label}</strong><p>{manual.termComments[index] || (index === 0 ? manual.comments : '')}</p></div>)}
        </section>

        <section className="sf9-parent-signature-section">
          <h2>PARENTS/GUARDIAN’S SIGNATURE</h2>
          {termColumns.map(({ label, id }) => <div className="sf9-signature-line" key={id}><span>{label}</span></div>)}
        </section>

        <section className="sf9-transfer-section">
          <h2>CERTIFICATE OF TRANSFER</h2>
          <p>This is to certify that the above-named learner has satisfactorily completed the requirements for the grade level indicated.</p>
          <div className="sf9-transfer-fields"><span>Admitted to Grade: <strong>{manual.admittedGrade}</strong></span><span>Eligible for Admission to Grade: <strong>{manual.eligibleGrade}</strong></span></div>
          <div className="sf9-approval"><span className="sf9-approval-label">Approved:</span><div className="sf9-approval-adviser"><strong>{manual.adviser}</strong><small>Adviser</small></div><div className="sf9-approval-school-head"><strong>{manual.schoolHead}</strong><small>School Head</small></div></div>
        </section>

        <section className="sf9-cancellation-section">
          <h2>CANCELLATION OF ELIGIBILITY TO TRANSFER</h2>
          <div><span>Admitted in: <strong>{manual.transferAdmittedIn}</strong></span><span>Date: <strong>{manual.transferDate}</strong></span></div>
        </section>
      </section>}
    </article>
  );
}

export default function PrintCardPage() {
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<{
    index: number;
    side: SheetSide;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    layout: CardLayout;
  } | null>(null);
  const yearLoadRequest = useRef(0);
  const [students, setStudents] = useState<LearnerRecord[]>([]);
  const [schoolYears, setSchoolYears] = useState<string[]>([]);
  const [sections, setSections] = useState<Array<Record<string, unknown>>>([]);
  const [subjectsById, setSubjectsById] = useState<Record<string, Subject>>({});
  const [assignments, setAssignments] = useState<Record<string, { configured?: boolean; subjectIds?: unknown }>>({});
  const [gradeConfigurations, setGradeConfigurations] = useState<Record<string, { gradingType?: string; finalGradeMode?: string }>>({});
  const [gradeTermCount, setGradeTermCount] = useState(DEFAULT_GRADE_TERM_COUNT);
  const [passingThreshold, setPassingThreshold] = useState(DEFAULT_PASSING_THRESHOLD);
  const [school, setSchool] = useState<RegisteredSchool | null>(getStoredSchool());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedLearnerId, setSelectedLearnerId] = useState('');
  const [selectedPrintIds, setSelectedPrintIds] = useState<string[]>([]);
  const [paperSizeId, setPaperSizeId] = useState<PaperSizeId>('a4');
  const [paperOrientation, setPaperOrientation] = useState<PaperOrientation>('landscape');
  const [studioMode, setStudioMode] = useState<'edit' | 'view'>('edit');
  const [activeSheetSide, setActiveSheetSide] = useState<SheetSide>('front');
  const [cardLayoutsBySide, setCardLayoutsBySide] = useState<Record<SheetSide, CardLayout[]>>({ front: [], back: [] });
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [manualByStudent, setManualByStudent] = useState<Record<string, ManualCardFields>>({});
  const [previewScale, setPreviewScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [schoolHeadName, setSchoolHeadName] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [mobileViewport, setMobileViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 780px)').matches,
  );

  const paper = PAPER_SIZES[paperSizeId];
  const { width: paperWidth, height: paperHeight } = getPaperDimensions(paperSizeId, paperOrientation);
  const layoutDefaults = useMemo(
    () => ({
      front: makeDefaultCardLayouts(selectedPrintIds.length, paperWidth, paperHeight, 'front'),
      back: makeDefaultCardLayouts(selectedPrintIds.length, paperWidth, paperHeight, 'back'),
    }),
    [selectedPrintIds.length, paperWidth, paperHeight],
  );
  const cardLayouts = cardLayoutsBySide[activeSheetSide];

  useEffect(() => {
    setCardLayoutsBySide(layoutDefaults);
  }, [layoutDefaults]);

  useEffect(() => {
    const pageStyle = document.createElement('style');
    pageStyle.dataset.studentCardPage = 'true';
    pageStyle.textContent = `@page { size: ${paperWidth}mm ${paperHeight}mm; margin: 0; }`;
    document.head.append(pageStyle);
    return () => pageStyle.remove();
  }, [paperWidth, paperHeight]);

  useEffect(() => {
    let active = true;
    async function loadInitialData() {
      try {
        await requireAuth();
        const [years, registeredSchools] = await Promise.all([
          fsGetSchoolYears(),
          getRegisteredSchools().catch((directoryLoadError: unknown) => {
            if (active) setDirectoryError(directoryLoadError instanceof Error ? directoryLoadError.message : 'Could not load school display details from the central school directory.');
            return [] as RegisteredSchool[];
          }),
        ]);
        if (!active) return;
        const storedSchool = getStoredSchool();
        const registeredSchool = registeredSchools.find(({ id }) => id === APP_CONFIG.schoolId) || storedSchool;
        if (registeredSchool) setSchool(registeredSchool);
        const registryHead = asText(registeredSchool?.schoolHead?.name);
        setSchoolHeadName(registryHead);

        const yearOptions = years.map(({ schoolYear }) => asText(schoolYear)).filter(Boolean);
        const requestedYear = new URLSearchParams(window.location.search).get('schoolYear') || '';
        const storedYear = sessionStorage.getItem('lps_selected_school_year') || '';
        const initialYear = [requestedYear, storedYear, asText(years.find(({ isCurrent }) => isCurrent)?.schoolYear), yearOptions[0]]
          .find((year) => yearOptions.includes(year)) || '';
        setSchoolYears(yearOptions);
        if (initialYear) await loadYear(initialYear, activeGuard);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load student-card data.');
      } finally {
        if (active) setLoading(false);
      }
    }
    const activeGuard = () => active;
    void loadInitialData();
    return () => { active = false; };
  }, []);

  async function loadYear(year: string, isActive: () => boolean = () => true) {
    const requestId = ++yearLoadRequest.current;
    const isCurrentRequest = () => requestId === yearLoadRequest.current && isActive();
    setLoading(true);
    setError('');
    setSelectedYear(year);
    setStudents([]);
    setSections([]);
    setSelectedLearnerId('');
    setSelectedPrintIds([]);
    try {
      const [records, sectionRows, curriculum, grading, configuredTermCount, configuredPassingThreshold] = await Promise.all([
        fsGetLearners(year),
        fsGetSections(year),
        fsGetGradeSubjectAssignments(year),
        fsGetGradeLevelGradingConfigurations(year),
        fsGetGradeTermCount(year),
        fsGetPassingThreshold(year),
      ]);
      if (!isCurrentRequest()) return;
      setStudents(records as LearnerRecord[]);
      setSections(sectionRows as Array<Record<string, unknown>>);
      setAssignments(curriculum.grades || {});
      setGradeConfigurations(grading.gradeLevels || {});
      setGradeTermCount(configuredTermCount);
      setPassingThreshold(configuredPassingThreshold);
      setSubjectsById(Object.fromEntries(normalizeCurriculumSubjectPool(curriculum.subjects).map((subject) => [subject.id, subject])));
    } catch (loadError) {
      if (isCurrentRequest()) setError(loadError instanceof Error ? loadError.message : `Could not load learner data for ${year}.`);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  const selectedLearner = useMemo(
    () => students.find((learner) => asText(learner.learnerId) === selectedLearnerId) || null,
    [students, selectedLearnerId],
  );
  const selectedPrintLearners = useMemo(
    () => selectedPrintIds
      .map((id) => students.find((learner) => asText(learner.learnerId) === id))
      .filter((learner): learner is LearnerRecord => Boolean(learner)),
    [students, selectedPrintIds],
  );
  const templateUnavailable = Boolean(
    selectedLearner && isLetterGradedLevel(selectedLearner.gradeLevel, gradeConfigurations),
  );
  const autoCalculateFinalGrades = (learner: LearnerRecord) => {
    const configuration = gradeConfigurations[gradeLevelConfigKey(asText(learner.gradeLevel))];
    return configuration?.gradingType !== 'letter' && configuration?.finalGradeMode !== 'manual';
  };
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return students.filter((learner) => {
      const identity = `${learnerName(learner)} ${asText(learner.learnerId)} ${asText(learner.lrn)}`.toLocaleLowerCase();
      const matchesGrade = !gradeFilter || normalizeCurriculumGrade(learner.gradeLevel) === normalizeCurriculumGrade(gradeFilter);
      const matchesGender = !genderFilter || asText(learner.gender).toLocaleLowerCase() === genderFilter.toLocaleLowerCase();
      const selectedProgram = PROGRAM_FILTERS.find(({ value }) => value === programFilter);
      const matchesProgram = !selectedProgram || learner[selectedProgram.field] === true;
      return (!query || identity.includes(query)) && matchesGrade && matchesGender && matchesProgram;
    }).sort((first, second) => learnerName(first).localeCompare(learnerName(second), undefined, { sensitivity: 'base' }));
  }, [students, search, gradeFilter, genderFilter, programFilter]);

  const studentKey = selectedLearner ? `${selectedYear}:${asText(selectedLearner.learnerId)}` : '';
  const sectionAdviser = selectedLearner
    ? asText(sections.find((section) =>
      normalizeCurriculumGrade(section.gradeLevel) === normalizeCurriculumGrade(selectedLearner.gradeLevel) &&
      asText(section.section).trim() === asText(selectedLearner.section).trim(),
    )?.adviser)
    : '';
  const manual = manualByStudent[studentKey] || makeManualFields(
    school?.name || APP_CONFIG.branding.schoolName,
    selectedYear,
    schoolHeadName,
    school?.schoolInfo,
    selectedLearner,
    sectionAdviser,
  );
  const gradeTerms = gradeTermsForCount(gradeTermCount);
  const termColumns = gradeTerms.filter(({ id }) => id !== 'final');
  const selectedSubjects = selectedLearner
    ? curriculumSubjectIdsForGrade(assignments, selectedLearner.gradeLevel, false, Object.values(subjectsById))
      .map((id) => subjectsById[id])
      .filter((subject): subject is Subject => Boolean(subject))
    : [];
  const cardSubjects = selectedSubjects;
  const gradeRowHeight = cardSubjects.length
    ? Math.max(6, Math.min(17, 150 / cardSubjects.length))
    : 17;
  const printGradeRowHeight = cardSubjects.length
    ? Math.max(1.8, Math.min(4.1, 45 / cardSubjects.length))
    : 4.1;
  const gradeTableStyle = {
    '--sf9-grade-row-height': `${gradeRowHeight}px`,
    '--sf9-grade-print-row-height': `${printGradeRowHeight}mm`,
  } as CSSProperties;

  useEffect(() => {
    if (!selectedLearner || !studentKey || manualByStudent[studentKey]) return;
    setManualByStudent((previous) => ({
      ...previous,
      [studentKey]: {
        ...makeManualFields(
          school?.name || APP_CONFIG.branding.schoolName,
          selectedYear,
          schoolHeadName,
          school?.schoolInfo,
          selectedLearner,
          sectionAdviser,
        ),
      },
    }));
  }, [selectedLearner, studentKey, selectedYear, school?.name, schoolHeadName, sectionAdviser, manualByStudent]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(1, Math.max(0.3, entry.contentRect.width / 990));
      setPreviewScale(scale);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 780px)');
    const updateViewport = (event: MediaQueryListEvent) => setMobileViewport(event.matches);
    setMobileViewport(mobileQuery.matches);
    mobileQuery.addEventListener('change', updateViewport);
    return () => mobileQuery.removeEventListener('change', updateViewport);
  }, []);

  function updateManual(field: keyof ManualCardFields, value: string) {
    if (!studentKey) return;
    setManualByStudent((previous) => {
      const current = previous[studentKey] || { ...manual, attendance: { ...manual.attendance } };
      return { ...previous, [studentKey]: { ...current, [field]: value } };
    });
  }

  function updateAttendance(row: keyof ManualCardFields['attendance'], month: string, value: string) {
    if (!studentKey) return;
    setManualByStudent((previous) => {
      const current = previous[studentKey] || manual;
      return {
        ...previous,
        [studentKey]: {
          ...current,
          attendance: {
            ...current.attendance,
            [row]: { ...current.attendance[row], [month]: value },
          },
        },
      };
    });
  }

  function updateTermComment(index: number, value: string) {
    if (!studentKey) return;
    setManualByStudent((previous) => {
      const current = previous[studentKey] || manual;
      const termComments = [...current.termComments];
      termComments[index] = value;
      return { ...previous, [studentKey]: { ...current, termComments } };
    });
  }

  function handleYearChange(event: ChangeEvent<HTMLSelectElement>) {
    void loadYear(event.currentTarget.value);
  }

  function togglePrintLearner(learnerId: string, checked: boolean) {
    setSelectedPrintIds((current) => {
      if (!checked) return current.filter((id) => id !== learnerId);
      if (current.includes(learnerId) || current.length >= 2) return current;
      return [...current, learnerId];
    });
  }

  function beginCardAdjustment(event: ReactPointerEvent<HTMLElement>, index: number, mode: 'move' | 'resize') {
    const layout = cardLayouts[index];
    if (studioMode !== 'edit' || !layout) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = {
      index,
      side: activeSheetSide,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      layout,
    };
  }

  function adjustCardWithKeyboard(index: number, event: ReactKeyboardEvent<HTMLElement>, resize = false) {
    if (studioMode !== 'edit' || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    setCardLayoutsBySide((previous) => ({
      ...previous,
      [activeSheetSide]: previous[activeSheetSide].map((layout, layoutIndex) => {
      if (layoutIndex !== index) return layout;
      if (resize) {
        const widthDelta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const heightDelta = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        return {
          ...layout,
          width: Math.max(18, Math.min(paperWidth - layout.x - DEFAULT_SHEET_MARGIN, layout.width + widthDelta)),
          height: Math.max(18, Math.min(paperHeight - layout.y - DEFAULT_SHEET_MARGIN, layout.height + heightDelta)),
        };
      }
      const deltaX = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const deltaY = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      return {
        ...layout,
        x: Math.max(DEFAULT_SHEET_MARGIN, Math.min(paperWidth - DEFAULT_SHEET_MARGIN - layout.width, layout.x + deltaX)),
        y: Math.max(DEFAULT_SHEET_MARGIN, Math.min(paperHeight - DEFAULT_SHEET_MARGIN - layout.height, layout.y + deltaY)),
      };
      }),
    }));
  }

  function updateCardAdjustment(event: ReactPointerEvent<HTMLDivElement>) {
    const activePointer = activePointerRef.current;
    const canvas = canvasRef.current;
    if (!activePointer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const deltaX = (event.clientX - activePointer.startX) / rect.width * paperWidth;
    const deltaY = (event.clientY - activePointer.startY) / rect.height * paperHeight;
    const { index, layout, mode, side } = activePointer;

    setCardLayoutsBySide((previous) => ({
      ...previous,
      [side]: previous[side].map((cardLayout, layoutIndex) => {
      if (layoutIndex !== index) return cardLayout;
      if (mode === 'move') {
        return {
          ...cardLayout,
          x: Math.max(DEFAULT_SHEET_MARGIN, Math.min(paperWidth - DEFAULT_SHEET_MARGIN - layout.width, layout.x + deltaX)),
          y: Math.max(DEFAULT_SHEET_MARGIN, Math.min(paperHeight - DEFAULT_SHEET_MARGIN - layout.height, layout.y + deltaY)),
        };
      }

      return {
        ...cardLayout,
        width: Math.max(18, Math.min(paperWidth - layout.x - DEFAULT_SHEET_MARGIN, layout.width + deltaX)),
        height: Math.max(18, Math.min(paperHeight - layout.y - DEFAULT_SHEET_MARGIN, layout.height + deltaY)),
      };
      }),
    }));
  }

  function finishCardAdjustment() {
    activePointerRef.current = null;
  }

  async function exportCard(format: 'pdf' | 'docx' | 'png') {
    if (!selectedLearner || templateUnavailable || exporting) return;
    const card = document.querySelector<HTMLElement>('.student-card-export-source .sf9-report-card');
    if (!card) {
      setExportError('The student card preview is not available to export.');
      return;
    }

    setExportError('');
    setExporting(true);
    setExportMenuOpen(false);
    try {
      const { toPng } = await import('html-to-image');
      const image = await toPng(card, {
        width: 990,
        height: 900,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: { transform: 'none', transformOrigin: 'top left', boxShadow: 'none' },
      });
      const fileBase = safeFileName(`${learnerName(selectedLearner)}-${selectedYear}`);

      if (format === 'png') {
        const imageResponse = await fetch(image);
        if (!imageResponse.ok) throw new Error('Could not prepare the PNG image.');
        downloadBlob(await imageResponse.blob(), `${fileBase}.png`);
      } else if (format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [272.7, 248.7], compress: true });
        pdf.addImage(image, 'PNG', 6.35, 6.35, 260, 236);
        pdf.save(`${fileBase}.pdf`);
      } else {
        const { Document, ImageRun, Packer, Paragraph } = await import('docx');
        const document = new Document({
          sections: [{
            properties: {
              page: {
                size: { width: 15461, height: 14101, orientation: 'landscape' },
                margin: { top: 360, right: 360, bottom: 360, left: 360 },
              },
            },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [new ImageRun({
                  type: 'png',
                  data: image,
                  transformation: { width: 982, height: 893 },
                })],
              }),
            ],
          }],
        });
        downloadBlob(await Packer.toBlob(document), `${fileBase}.docx`);
      }
    } catch (exportFailure) {
      setExportError(exportFailure instanceof Error ? exportFailure.message : 'Could not export the student card.');
    } finally {
      setExporting(false);
    }
  }

  const finalGrades = selectedLearner
    ? cardSubjects.map((subject) => finalGradeForDisplay(
      selectedLearner,
      subject.id,
      gradeTermCount,
      autoCalculateFinalGrades(selectedLearner),
    ))
    : [];
  const finalRemarks = selectedLearner
    ? cardSubjects.map((subject, index) => finalGradeRemark(
      finalGrades[index],
      termColumns.map(({ id }) => gradeForTerm(selectedLearner, id, subject.id)),
      passingThreshold,
    ))
    : [];
  const allSelectedTermsComplete = finalRemarks.length > 0 && finalRemarks.every(Boolean);
  const selectedGeneralAverage = allSelectedTermsComplete
    ? numericalGradeAverage(finalGrades, cardSubjects.length)
    : '';
  const printCards = selectedPrintLearners.map((learner) => {
    const id = asText(learner.learnerId);
    const key = `${selectedYear}:${id}`;
    const adviser = asText(sections.find((section) =>
      normalizeCurriculumGrade(section.gradeLevel) === normalizeCurriculumGrade(learner.gradeLevel) &&
      asText(section.section).trim() === asText(learner.section).trim(),
    )?.adviser);
    return {
      learner,
      manual: manualByStudent[key] || makeManualFields(
        school?.name || APP_CONFIG.branding.schoolName,
        selectedYear,
        schoolHeadName,
        school?.schoolInfo,
        learner,
        adviser,
      ),
      subjects: curriculumSubjectIdsForGrade(assignments, learner.gradeLevel, false, Object.values(subjectsById))
        .map((subjectId) => subjectsById[subjectId])
        .filter((subject): subject is Subject => Boolean(subject)),
      unavailable: isLetterGradedLevel(learner.gradeLevel, gradeConfigurations),
    };
  });
  const printBatchHasUnavailableTemplate = printCards.some(({ unavailable }) => unavailable);
  const schoolLogoUrl = appBrandAssetUrl(school?.logoUrl || APP_CONFIG.branding.schoolLogoUrl);

  return (
    <main className="student-card-app">
      <header className="student-card-topbar">
        <div>
          <span className="student-card-eyebrow">Academic records</span>
          <h1>Print Student Card</h1>
          <p>Choose a learner, complete any missing details, then print the school-year performance report.</p>
          {mobileViewport && <p className="student-card-mobile-print-note" role="status">Card printing is disabled on mobile. Open this workspace on a desktop to print.</p>}
        </div>
        <div className="student-card-top-actions">
          <button type="button" className="student-card-button student-card-button--quiet" onClick={() => window.close()}>Close workspace</button>
          <div className="student-card-export">
            <button
              type="button"
              className="student-card-button"
              aria-expanded={exportMenuOpen}
              aria-haspopup="true"
              disabled={!selectedLearner || templateUnavailable || exporting}
              onClick={() => setExportMenuOpen((open) => !open)}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            {exportMenuOpen && (
              <div className="student-card-export-menu">
                <button type="button" disabled={exporting} onClick={() => void exportCard('pdf')}>Download PDF</button>
                <button type="button" disabled={exporting} onClick={() => void exportCard('docx')}>Download Word (.docx)</button>
                <button type="button" disabled={exporting} onClick={() => void exportCard('png')}>Download PNG</button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="student-card-button student-card-button--primary"
            disabled={!selectedPrintLearners.length || printBatchHasUnavailableTemplate || mobileViewport}
            title={mobileViewport
              ? 'Card printing is available on desktop view.'
              : printBatchHasUnavailableTemplate
                ? 'Remove learners whose grade uses the unavailable Letter Grade template.'
                : !selectedPrintLearners.length
                  ? 'Select a learner for printing.'
                : undefined}
            onClick={() => window.print()}
          >
            Print {selectedPrintIds.length === 2 ? '2 Cards' : 'Card'}
          </button>
        </div>
      </header>

      <div className="student-card-workspace">
        <aside className="student-card-editor" aria-label="Student card editor">
          <section className="student-card-editor-section">
            <div className="student-card-section-heading">
              <div><span className="student-card-eyebrow">1 · Select</span><h2>Find a learner</h2></div>
              <span className="student-card-result-count">{filteredStudents.length}</span>
            </div>
            <label className="student-card-field">
              <span>Search by name or learner ID</span>
              <input value={search} onChange={(event) => setSearch(getInputValue(event))} placeholder="Name or LRN" type="search" />
            </label>
            <div className="student-card-filter-grid">
              <label className="student-card-field">
                <span>Grade level</span>
                <select value={gradeFilter} onChange={(event) => setGradeFilter(getInputValue(event))}>
                  <option value="">All grades</option>
                  {['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'].map((grade) => <option key={grade}>{grade}</option>)}
                </select>
              </label>
              <label className="student-card-field">
                <span>Program</span>
                <select value={programFilter} onChange={(event) => setProgramFilter(getInputValue(event))}>
                  <option value="">All programs</option>
                  {PROGRAM_FILTERS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="student-card-field">
                <span>Gender</span>
                <select value={genderFilter} onChange={(event) => setGenderFilter(getInputValue(event))}>
                  <option value="">All genders</option><option>Male</option><option>Female</option>
                </select>
              </label>
              <label className="student-card-field">
                <span>Data school year</span>
                <select value={selectedYear} onChange={handleYearChange} disabled={loading || !schoolYears.length}>
                  {schoolYears.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
            </div>
            {error && <p className="student-card-alert" role="alert">{error}</p>}
            {directoryError && <p className="student-card-alert student-card-alert--warning" role="status">School-head directory data could not be loaded: {directoryError}</p>}
            {templateUnavailable && <p className="student-card-alert student-card-alert--warning" role="status">Template is not available for now for {asText(selectedLearner?.gradeLevel)} because this level uses Letter Grade.</p>}
            {exportError && <p className="student-card-alert" role="alert">{exportError}</p>}
            <div className="student-card-learner-list" role="list" aria-label="Matching learners">
              {loading ? <p className="student-card-list-state">Loading learners…</p> : filteredStudents.length ? filteredStudents.map((learner) => {
                const id = asText(learner.learnerId);
                const unavailable = isLetterGradedLevel(learner.gradeLevel, gradeConfigurations);
                const isPrintSelected = selectedPrintIds.includes(id);
                return (
                  <div className={`student-card-learner-option${id === selectedLearnerId ? ' is-selected' : ''}`} key={id} role="listitem">
                    <button type="button" className="student-card-learner-select" aria-current={id === selectedLearnerId ? 'true' : undefined} onClick={() => setSelectedLearnerId(id)}>
                      <strong>{learnerName(learner)}</strong>
                      <span>{asText(learner.learnerId || learner.lrn) || 'No learner ID'} · {asText(learner.gradeLevel) || 'No grade'} - {asText(learner.section) || '—'}</span>
                    </button>
                    <label className="student-card-learner-check">
                      <input
                        type="checkbox"
                        checked={isPrintSelected}
                        disabled={unavailable || (!isPrintSelected && selectedPrintIds.length >= 2)}
                        aria-label={`Include ${learnerName(learner)} in print batch`}
                        onChange={(event) => togglePrintLearner(id, event.currentTarget.checked)}
                      />
                      Print
                    </label>
                  </div>
                );
              }) : <p className="student-card-list-state">{students.length ? 'No learners match these filters.' : 'No learners are available for this school year.'}</p>}
            </div>
            <p className="student-card-print-selection">{selectedPrintIds.length}/2 learners selected for side-by-side printing.</p>
          </section>

          {selectedLearner && !templateUnavailable && (
            <section className="student-card-editor-section">
              <div className="student-card-section-heading">
                <div><span className="student-card-eyebrow">2 · Customize</span><h2>Card information</h2>                </div>
              </div>
              <div className="student-card-form-grid">
                <label className="student-card-field student-card-field--wide"><span>Learner name</span><input value={manual.studentName} onChange={(event) => updateManual('studentName', getInputValue(event))} /></label>
                <label className="student-card-field"><span>LRN</span><input value={manual.learnerId} onChange={(event) => updateManual('learnerId', getInputValue(event))} /></label>
                <label className="student-card-field"><span>Age</span><input value={manual.age} onChange={(event) => updateManual('age', getInputValue(event))} /></label>
                <label className="student-card-field"><span>Sex</span><input value={manual.gender} onChange={(event) => updateManual('gender', getInputValue(event))} /></label>
                <label className="student-card-field"><span>Grade</span><input value={manual.gradeLevel} onChange={(event) => updateManual('gradeLevel', cardGradeLabel(getInputValue(event)))} /></label>
                <label className="student-card-field"><span>Section</span><input value={manual.section} onChange={(event) => updateManual('section', getInputValue(event))} /></label>
              </div>
              <div className="student-card-form-grid">
                <label className="student-card-field student-card-field--wide"><span>School name</span><input value={manual.schoolName} onChange={(event) => updateManual('schoolName', getInputValue(event))} /></label>
                <label className="student-card-field"><span>School year</span><input value={manual.schoolYear} onChange={(event) => updateManual('schoolYear', getInputValue(event))} /></label>
                <label className="student-card-field"><span>Region</span><input value={manual.region} onChange={(event) => updateManual('region', getInputValue(event))} /></label>
                <label className="student-card-field student-card-field--wide"><span>Schools division office</span><input value={manual.division} onChange={(event) => updateManual('division', getInputValue(event))} /></label>
                <label className="student-card-field"><span>District</span><input value={manual.district} onChange={(event) => updateManual('district', getInputValue(event))} /></label>
                <label className="student-card-field"><span>Municipality / province</span><input value={manual.locality} onChange={(event) => updateManual('locality', getInputValue(event))} /></label>
                <label className="student-card-field"><span>School head</span><input value={manual.schoolHead} onChange={(event) => updateManual('schoolHead', getInputValue(event))} /></label>
                <label className="student-card-field"><span>Adviser</span><input value={manual.adviser || sectionAdviser} onChange={(event) => updateManual('adviser', getInputValue(event))} /></label>
                <label className="student-card-field"><span>Track (SHS only)</span><input value={manual.track} onChange={(event) => updateManual('track', getInputValue(event))} /></label>
                <fieldset className="student-card-attendance-fields student-card-field--wide">
                  <legend>Teacher comments / remarks</legend>
                  <div className="student-card-form-grid">
                    {termColumns.map(({ id, label }, index) => (
                      <label className="student-card-field student-card-field--wide" key={id}>
                        <span>{label}</span>
                        <textarea value={manual.termComments[index] || ''} onChange={(event) => updateTermComment(index, getInputValue(event))} rows={2} />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="student-card-attendance-fields student-card-field--wide">
                  <legend>Attendance record · enter each month</legend>
                  <div className="student-card-attendance-inputs">
                    {MONTHS.map((month) => <span key={month}>{month}</span>)}
                    {(['classDays', 'daysPresent', 'daysAbsent'] as const).map((row) => (
                      <div className="student-card-attendance-input-row" key={row}>
                        <strong>{row === 'classDays' ? 'Class days' : row === 'daysPresent' ? 'Present' : 'Absent'}</strong>
                        {MONTHS.map((month) => (
                          <input
                            key={month}
                            aria-label={`${row === 'classDays' ? 'Class days' : row === 'daysPresent' ? 'Days present' : 'Days absent'} ${month}`}
                            inputMode="numeric"
                            value={manual.attendance[row][month]}
                            onChange={(event) => updateAttendance(row, month, getInputValue(event))}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="student-card-attendance-fields student-card-field--wide">
                  <legend>Certificate of transfer</legend>
                  <div className="student-card-form-grid">
                    <label className="student-card-field"><span>Admitted to grade</span><input value={manual.admittedGrade} onChange={(event) => updateManual('admittedGrade', getInputValue(event))} /></label>
                    <label className="student-card-field"><span>Eligible for admission to grade</span><input value={manual.eligibleGrade} onChange={(event) => updateManual('eligibleGrade', getInputValue(event))} /></label>
                    <label className="student-card-field"><span>Cancellation · admitted in</span><input value={manual.transferAdmittedIn} onChange={(event) => updateManual('transferAdmittedIn', getInputValue(event))} /></label>
                    <label className="student-card-field"><span>Cancellation · date</span><input value={manual.transferDate} onChange={(event) => updateManual('transferDate', getInputValue(event))} /></label>
                  </div>
                </fieldset>
              </div>
            </section>
          )}
        </aside>

        <section className="student-card-studio" aria-label="Print layout studio">
          <header className="student-card-studio-header">
            <div>
              <span className="student-card-eyebrow">Print layout</span>
              <h2>Arrange cards on paper</h2>
              <p>{selectedPrintLearners.length ? `${selectedPrintLearners.length} learner${selectedPrintLearners.length === 1 ? '' : 's'} selected · front and back print on separate sheets` : 'Select one or two learners to build a print layout.'}</p>
            </div>
            <div className="student-card-mode-switch" role="group" aria-label="Preview mode">
              <button type="button" aria-pressed={studioMode === 'edit'} className={studioMode === 'edit' ? 'is-active' : ''} onClick={() => setStudioMode('edit')}>Edit layout</button>
              <button type="button" aria-pressed={studioMode === 'view'} className={studioMode === 'view' ? 'is-active' : ''} onClick={() => setStudioMode('view')}>View only</button>
            </div>
          </header>

          <div className="student-card-studio-toolbar">
            <label className="student-card-paper-control">
              <span>Paper size</span>
              <select value={paperSizeId} onChange={(event) => setPaperSizeId(getInputValue(event) as PaperSizeId)}>
                {Object.entries(PAPER_SIZES).map(([id, size]) => <option key={id} value={id}>{size.label}</option>)}
              </select>
            </label>
            <div className="student-card-orientation-control" role="group" aria-label="Paper orientation">
              <span>Orientation</span>
              <div>
                {(['landscape', 'portrait'] as const).map((orientation) => (
                  <button
                    type="button"
                    key={orientation}
                    aria-pressed={paperOrientation === orientation}
                    className={paperOrientation === orientation ? 'is-active' : ''}
                    onClick={() => setPaperOrientation(orientation)}
                  >
                    {orientation === 'landscape' ? 'Landscape' : 'Portrait'}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="student-card-button student-card-button--quiet" onClick={() => setCardLayoutsBySide(layoutDefaults)} disabled={!selectedPrintLearners.length}>
              Default setup
            </button>
          </div>

          <nav className="student-card-sheet-tabs" aria-label="Preview sheet">
            <button type="button" aria-pressed={activeSheetSide === 'front'} className={activeSheetSide === 'front' ? 'is-active' : ''} onClick={() => setActiveSheetSide('front')}>
              <span>01</span><strong>Fronts</strong><small>Sheet 1</small>
            </button>
            <button type="button" aria-pressed={activeSheetSide === 'back'} className={activeSheetSide === 'back' ? 'is-active' : ''} onClick={() => setActiveSheetSide('back')}>
              <span>02</span><strong>Backs</strong><small>Sheet 2</small>
            </button>
          </nav>

          <div className="student-card-canvas-stage">
            <div
              className={`student-card-paper-canvas${studioMode === 'edit' ? ' is-editing' : ''}`}
              ref={canvasRef}
              aria-label={`${paper.label} ${paperOrientation} ${activeSheetSide} sheet preview`}
              style={{ aspectRatio: `${paperWidth} / ${paperHeight}` }}
              onPointerMove={updateCardAdjustment}
              onPointerUp={finishCardAdjustment}
              onPointerCancel={finishCardAdjustment}
            >
              {printCards.map((_, slotIndex) => {
                const learnerIndex = getLearnerIndexForSheetSlot(slotIndex, printCards.length, activeSheetSide);
                const { learner, manual: cardManual, subjects, unavailable } = printCards[learnerIndex];
                const layout = cardLayoutsBySide[activeSheetSide][slotIndex];
                if (!layout || unavailable) return null;
                const previewScaleXY = getCardPreviewScale(
                  layout,
                  paperWidth,
                  paperHeight,
                  canvasSize.width,
                  canvasSize.height,
                );
                const positionStyle: CSSProperties = {
                  left: `${layout.x / paperWidth * 100}%`,
                  top: `${layout.y / paperHeight * 100}%`,
                  width: `${layout.width / paperWidth * 100}%`,
                  height: `${layout.height / paperHeight * 100}%`,
                  '--card-preview-scale-x': String(previewScaleXY.x),
                  '--card-preview-scale-y': String(previewScaleXY.y),
                  '--card-scale-x': String(layout.width / CARD_BASE_WIDTH_MM),
                  '--card-scale-y': String(layout.height / CARD_BASE_HEIGHT_MM),
                } as CSSProperties;
                return (
                  <div
                    key={asText(learner.learnerId)}
                    className="student-card-canvas-card"
                    style={positionStyle}
                    role="group"
                    aria-label={`${learnerName(learner)} ${activeSheetSide} card`}
                    tabIndex={studioMode === 'edit' ? 0 : undefined}
                    onPointerDown={(event) => beginCardAdjustment(event, slotIndex, 'move')}
                    onKeyDown={(event) => adjustCardWithKeyboard(slotIndex, event)}
                  >
                    {studioMode === 'edit' && <span className="student-card-canvas-label">{slotIndex + 1} · {learnerName(learner)}</span>}
                    <StudentCardReport
                      learner={learner}
                      manual={cardManual}
                      subjects={subjects}
                      termColumns={termColumns}
                      termCount={gradeTermCount}
                      autoCalculateFinalGrades={autoCalculateFinalGrades(learner)}
                      passingThreshold={passingThreshold}
                      schoolLogoUrl={schoolLogoUrl}
                      schoolYear={selectedYear}
                      side={activeSheetSide}
                      className="student-card-canvas-report"
                    />
                    {studioMode === 'edit' && (
                      <button
                        type="button"
                        className="student-card-canvas-resize"
                        aria-label={`Resize ${learnerName(learner)} card`}
                        title="Drag to resize · use arrow keys for precision"
                        onPointerDown={(event) => beginCardAdjustment(event, slotIndex, 'resize')}
                        onKeyDown={(event) => adjustCardWithKeyboard(slotIndex, event, true)}
                      />
                    )}
                  </div>
                );
              })}
              {!selectedPrintLearners.length && <div className="student-card-canvas-empty">Choose a learner to see the paper layout.</div>}
            </div>
            <div className="student-card-canvas-caption">
              <span>{paper.label} · {paperWidth} × {paperHeight} mm · {paperOrientation}</span>
              <span>{studioMode === 'edit' ? 'Drag cards to move · drag the corner to resize · arrow keys for precision' : 'View only · layout controls are disabled'}</span>
            </div>
          </div>
          {printBatchHasUnavailableTemplate && <p className="student-card-alert student-card-alert--warning" role="status">One or more selected learners use a Letter Grade template that is not available for printing.</p>}
        </section>

        <section className="student-card-preview-pane student-card-export-source" aria-label="Student card export source" aria-hidden="true">
          <div className="student-card-preview-toolbar"><div><span className="student-card-eyebrow">Live preview</span><strong>{selectedLearner ? learnerName(selectedLearner) : 'Select a learner to begin'}</strong></div><span>Reference size · front / back</span></div>
          <div className="student-card-preview-scroll">
            <div className="student-card-preview-fit" ref={previewRef} style={{ height: `${900 * previewScale}px` }}>
              {templateUnavailable ? (
                <div className="student-card-unavailable" role="status">
                  <strong>Template is not available for now</strong>
                  <span>{asText(selectedLearner?.gradeLevel)} uses Letter Grade. Printing and export are disabled for this learner.</span>
                </div>
              ) : selectedLearner ? (
                <article className="sf9-report-card" style={{ transform: `scale(${previewScale})` }}>
                  <section className="sf9-card-side sf9-card-front">
                  <header className="sf9-letterhead">
                    <img src="/assets/edash/deped-seal.png" alt="Department of Education seal" />
                    <div className="sf9-letterhead-copy">
                      <p>Republic of the Philippines</p>
                      <p>Department of Education</p>
                      {manual.region && <p>{regionLabel(manual.region)}</p>}
                      {manual.division && <p className="sf9-division-name">{manual.division}</p>}
                      <p>{manual.district ? `District of ${manual.district}` : ''}</p>
                      <p>{[manual.district, manual.locality].filter(Boolean).join(', ')}</p>
                      <h2>{manual.schoolName || 'School Name'}</h2>
                    </div>
                    <img src={appBrandAssetUrl(school?.logoUrl || APP_CONFIG.branding.schoolLogoUrl)} alt={`${manual.schoolName || 'School'} logo`} />
                  </header>

                  <div className="sf9-report-title">
                    <h1>LEARNER’S PERFORMANCE REPORT</h1>
                    <p>School Year {manual.schoolYear}</p>
                  </div>

                  <table className="sf9-identity-table">
                    <colgroup>
                      <col className="sf9-identity-label-column" />
                      <col className="sf9-identity-name-column" />
                      <col className="sf9-identity-age-label-column" />
                      <col className="sf9-identity-age-column" />
                      <col className="sf9-identity-sex-label-column" />
                      <col className="sf9-identity-sex-column" />
                    </colgroup>
                    <tbody>
                      <tr>
                        <th>Name:</th><td>{manual.studentName}</td>
                        <th>Age:</th><td>{manual.age}</td>
                        <th>Sex:</th><td>{manual.gender}</td>
                      </tr>
                      <tr>
                        <th>LRN:</th><td>{manual.learnerId}</td>
                        <th>Grade:</th><td>{cardGradeLabel(manual.gradeLevel)}</td>
                        <th>Section:</th><td>{manual.section}</td>
                      </tr>
                      <tr className="sf9-track-row"><th>Track (SHS only):</th><td colSpan={5}>{manual.track}</td></tr>
                    </tbody>
                  </table>

                  <p className="sf9-greeting"><strong>Dear Parents,</strong><br />This Performance Report shows the ability and progress your child has made in the different learning areas as well as his/her core values. The school welcomes you should you desire to know more about your child’s progress.</p>

                  <div className="sf9-front-signatures">
                    <div><strong>{manual.schoolHead}</strong><span>School Head</span></div>
                    <div><strong>{manual.adviser}</strong><span>Adviser</span></div>
                  </div>

                  <section className="sf9-section">
                    <h2>LEARNING PROGRESS AND ACHIEVEMENT</h2>
                    <table className="sf9-data-table sf9-grade-table" style={gradeTableStyle}>
                      <thead>
                        <tr><th rowSpan={2}>Learning Areas</th><th colSpan={termColumns.length}>TERM</th><th rowSpan={2}>Final Grade</th><th rowSpan={2}>Remarks</th></tr>
                        <tr>{termColumns.map(({ label, id }) => <th key={id}>{label.match(/^\d+/)?.[0] || ''}</th>)}</tr>
                      </thead>
                      <tbody>
                        {cardSubjects.length ? cardSubjects.map((subject, index) => {
                          const finalGrade = finalGrades[index];
                          return (
                            <tr key={subject.id}>
                              <th>{subject.label}</th>
                              {termColumns.map(({ id }) => <td key={id}>{gradeDisplay(gradeForTerm(selectedLearner, id, subject.id))}</td>)}
                              <td>{gradeDisplay(finalGrade)}</td><td>{finalRemarks[index]}</td>
                            </tr>
                          );
                        }) : (
                          <tr><td className="sf9-no-subjects" colSpan={termColumns.length + 3}>No subjects are assigned to {asText(selectedLearner.gradeLevel) || 'this grade'} for {selectedYear}.</td></tr>
                        )}
                        {cardSubjects.length > 0 && <tr className="sf9-general-average">
                          <th colSpan={termColumns.length + 1}>General Average</th>
                          <td>{selectedGeneralAverage}</td>
                          <td>{gradeResult(selectedGeneralAverage, passingThreshold, allSelectedTermsComplete)}</td>
                        </tr>}
                      </tbody>
                    </table>
                  </section>

                  <section className="sf9-descriptor-section">
                    <h2>PERFORMANCE DESCRIPTORS</h2>
                    <table className="sf9-data-table sf9-descriptor-table">
                      <thead><tr><th>Grading Scale</th><th>Description</th><th>Remarks</th></tr></thead>
                      <tbody>
                        <tr><td>90–100</td><td>Advancing</td><td>Passed</td></tr>
                        <tr><td>80–89</td><td>Benchmarking</td><td>Passed</td></tr>
                        <tr><td>75–79</td><td>Connecting</td><td>Passed</td></tr>
                        <tr><td>65–74</td><td>Developing</td><td>Failed</td></tr>
                        <tr><td>0–64</td><td>Emerging</td><td>Failed</td></tr>
                      </tbody>
                    </table>
                  </section>
                  </section>

                  <section className="sf9-card-side sf9-card-back">
                  <section className="sf9-attendance-section">
                    <h2>ATTENDANCE RECORD</h2>
                    <table className="sf9-data-table sf9-attendance-table">
                      <thead><tr><th>Month</th>{MONTHS.map((month) => <th key={month}>{month}</th>)}<th>Total</th></tr></thead>
                      <tbody>
                        {([
                          ['classDays', 'No. of Class Days'],
                          ['daysPresent', 'No. of Days Present'],
                          ['daysAbsent', 'No. of Days Absent'],
                        ] as const).map(([key, label]) => (
                          <tr key={key}><th>{label}</th>{MONTHS.map((month) => <td key={month}>{manual.attendance[key][month]}</td>)}<td>{displayAttendanceTotal(manual.attendance[key])}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  <section className="sf9-comments-section">
                    <h2>TEACHER’S COMMENTS/REMARKS</h2>
                    {termColumns.map(({ label, id }, index) => <div className="sf9-comment-box" key={id}><strong>{label}</strong><p>{manual.termComments[index] || (index === 0 ? manual.comments : '')}</p></div>)}
                  </section>

                  <section className="sf9-parent-signature-section">
                    <h2>PARENTS/GUARDIAN’S SIGNATURE</h2>
                    {termColumns.map(({ label, id }) => <div className="sf9-signature-line" key={id}><span>{label}</span></div>)}
                  </section>

                  <section className="sf9-transfer-section">
                    <h2>CERTIFICATE OF TRANSFER</h2>
                    <p>This is to certify that the above-named learner has satisfactorily completed the requirements for the grade level indicated.</p>
                    <div className="sf9-transfer-fields"><span>Admitted to Grade: <strong>{manual.admittedGrade}</strong></span><span>Eligible for Admission to Grade: <strong>{manual.eligibleGrade}</strong></span></div>
                    <div className="sf9-approval"><span className="sf9-approval-label">Approved:</span><div className="sf9-approval-adviser"><strong>{manual.adviser}</strong><small>Adviser</small></div><div className="sf9-approval-school-head"><strong>{manual.schoolHead}</strong><small>School Head</small></div></div>
                  </section>

                  <section className="sf9-cancellation-section">
                    <h2>CANCELLATION OF ELIGIBILITY TO TRANSFER</h2>
                    <div><span>Admitted in: <strong>{manual.transferAdmittedIn}</strong></span><span>Date: <strong>{manual.transferDate}</strong></span></div>
                  </section>
                  </section>
                </article>
              ) : <div className="student-card-empty-preview">{loading ? 'Loading student records…' : 'Choose a learner from the list to preview the card.'}</div>}
            </div>
          </div>
        </section>
        <div className="student-card-print-only" aria-hidden="true">
          {(['front', 'back'] as const).map((side) => (
            <div
              key={side}
              className={`student-card-print-sheet student-card-print-sheet--${side}s`}
              style={{ width: `${paperWidth}mm`, height: `${paperHeight}mm` }}
            >
              {printCards.map((_, slotIndex) => {
                const learnerIndex = getLearnerIndexForSheetSlot(slotIndex, printCards.length, side);
                const { learner, manual: cardManual, subjects, unavailable } = printCards[learnerIndex];
                const layout = cardLayoutsBySide[side][slotIndex];
                if (!layout || unavailable) return null;
                const positionStyle: CSSProperties = {
                  left: `${layout.x}mm`,
                  top: `${layout.y}mm`,
                  width: `${layout.width}mm`,
                  height: `${layout.height}mm`,
                  '--card-scale-x': String(layout.width / CARD_BASE_WIDTH_MM),
                  '--card-scale-y': String(layout.height / CARD_BASE_HEIGHT_MM),
                } as CSSProperties;
                return (
                  <div key={`${side}-${asText(learner.learnerId)}`} className="student-card-print-position" style={positionStyle}>
                    <StudentCardReport
                      learner={learner}
                      manual={cardManual}
                      subjects={subjects}
                      termColumns={termColumns}
                      termCount={gradeTermCount}
                      autoCalculateFinalGrades={autoCalculateFinalGrades(learner)}
                      passingThreshold={passingThreshold}
                      schoolLogoUrl={schoolLogoUrl}
                      schoolYear={selectedYear}
                      side={side}
                      className="student-card-canvas-report"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
