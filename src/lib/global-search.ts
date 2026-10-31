// @ts-nocheck -- ported vanilla behavior; not yet fully typed.
/**
 * GLOBAL-SEARCH.JS
 * A website-wide command-palette search that lives in the shared topbar
 * (rendered by shell.renderShell, so it appears on every authenticated page).
 *
 * It indexes every navigation page AND its subcomponents — buttons, filters,
 * tables, modals, settings options, etc. — so a user can type, for example,
 * "add learner" and jump straight to the Add Learner button on the Learner
 * Masterlist, or "theme" to land on the theme selector inside Preferences.
 *
 * Keyboard: Ctrl/Cmd + K opens, Esc closes, ArrowUp/Down + Enter to select.
 */
import { APP_PAGE_PREFIX, canViewGradesProfile, isSchoolAdmin, isVisitorSession } from './app-config';
import { Icon } from './icons';
import { canAccessPrintable } from './printable-access';

/* ============================================================================
 * State (module singleton survives SPA route changes)
 * ========================================================================== */
const S = {
  open: false,
  query: '',
  activeIndex: -1,
  results: [],
  recentKeys: [],
  resultCache: new Map(),
  navEntries: [],
  subEntries: [],
  // Pending "jump to element" target set when a result is clicked. Applied on
  // the next shell render (the destination page's mount) via MutationObserver.
  pending: null,
  pendingTimer: null,
  pendingObserver: null,
};

let keysBound = false;
const RECENT_SEARCHES_KEY = 'edash.globalSearch.recent.v1';
const MAX_RECENT_SEARCHES = 8;
const MAX_CACHED_QUERIES = 50;

/* ============================================================================
 * Search index
 * ========================================================================== */
const ROLE_GATES = {
  admin: isSchoolAdmin,
  grades: canViewGradesProfile,
  printableRecords: () => canAccessPrintable('enrollment'),
  printableCard: () => canAccessPrintable('student-card'),
};

function E(page, label, href, selector, icon, keywords = '', role = null) {
  return { page, label, href, selector: selector || null, icon: icon || null, keywords, role };
}

const CURATED = [
  /* ---- Dashboard ------------------------------------------------------- */
  E('Dashboard', 'Learner Distribution by Program', 'dashboard.html', '#donutSvg', 'barChart', 'donut chart program'),
  E('Dashboard', 'Learners by Grade Level', 'dashboard.html', '#gradeBarChart', 'barChart', 'bar chart grade'),
  E('Dashboard', 'Recent Added Learners', 'dashboard.html', '#recentTableBody', 'users', 'recently added learners'),
  E('Dashboard', 'Program Summary', 'dashboard.html', '#programSummary', 'clipboard', 'programs summary tags'),
  E('Dashboard', "Today's date", 'dashboard.html', '#todayDate', 'calendar', 'date today'),

  /* ---- Learner Masterlist ---------------------------------------------- */
  E('Learner Masterlist', 'Add Learner', 'masterlist.html', '#addLearnerBtn', 'plus', 'add new learner create'),
  E('Learner Masterlist', 'Search learners', 'masterlist.html', '#searchInput', 'search', 'search by name learner id lrn'),
  E('Learner Masterlist', 'Filter by grade level', 'masterlist.html', '#gradeFilter', 'search', 'grade filter kinder grade 1 2 3 4 5 6'),
  E('Learner Masterlist', 'Filter by program', 'masterlist.html', '#programFilter', 'search', 'program filter 4ps ip sned aral muslim'),
  E('Learner Masterlist', 'Filter by gender', 'masterlist.html', '#genderFilter', 'search', 'gender filter male female'),
  E('Learner Masterlist', 'Learner table', 'masterlist.html', '#learnersTableBody', 'users', 'list learners table records'),
  E('Learner Masterlist', 'Pagination', 'masterlist.html', '#pagerBtns', 'chevronRight', 'pages next previous'),

  /* ---- Program pages ---------------------------------------------------- */
  E('4Ps Beneficiaries', 'Add Learner', 'program-4ps.html', '#addLearnerBtn', 'plus', 'add new learner create'),
  E('4Ps Beneficiaries', 'Search learners', 'program-4ps.html', '#searchInput', 'search', 'search by name learner id'),
  E('4Ps Beneficiaries', 'Filter by grade level', 'program-4ps.html', '#gradeFilter', 'search', 'grade filter'),
  E('4Ps Beneficiaries', 'Learner table', 'program-4ps.html', '#learnersTableBody', 'users', 'list learners table'),

  E('IP Learners', 'Add Learner', 'program-ip.html', '#addLearnerBtn', 'plus', 'add new learner create'),
  E('IP Learners', 'Search learners', 'program-ip.html', '#searchInput', 'search', 'search by name learner id'),
  E('IP Learners', 'Filter by grade level', 'program-ip.html', '#gradeFilter', 'search', 'grade filter'),
  E('IP Learners', 'Learner table', 'program-ip.html', '#learnersTableBody', 'users', 'list learners table'),

  E('SNED Learners', 'Add Learner', 'program-sned.html', '#addLearnerBtn', 'plus', 'add new learner create'),
  E('SNED Learners', 'Search learners', 'program-sned.html', '#searchInput', 'search', 'search by name learner id'),
  E('SNED Learners', 'Filter by grade level', 'program-sned.html', '#gradeFilter', 'search', 'grade filter'),
  E('SNED Learners', 'Learner table', 'program-sned.html', '#learnersTableBody', 'users', 'list learners table'),

  E('ARAL Tagged Learners', 'Add Learner', 'program-aral.html', '#addLearnerBtn', 'plus', 'add new learner create'),
  E('ARAL Tagged Learners', 'Search learners', 'program-aral.html', '#searchInput', 'search', 'search by name learner id'),
  E('ARAL Tagged Learners', 'Filter by grade level', 'program-aral.html', '#gradeFilter', 'search', 'grade filter'),
  E('ARAL Tagged Learners', 'Learner table', 'program-aral.html', '#learnersTableBody', 'users', 'list learners table'),

  E('Muslim Learners', 'Add Learner', 'program-muslim.html', '#addLearnerBtn', 'plus', 'add new learner create'),
  E('Muslim Learners', 'Search learners', 'program-muslim.html', '#searchInput', 'search', 'search by name learner id'),
  E('Muslim Learners', 'Filter by grade level', 'program-muslim.html', '#gradeFilter', 'search', 'grade filter'),
  E('Muslim Learners', 'Learner table', 'program-muslim.html', '#learnersTableBody', 'users', 'list learners table'),

  /* ---- Enrollment Data --------------------------------------------------- */
  E('Enrollment Data', 'Enrollment table', 'enrollment-data.html', '#enrollmentTableBody', 'sheet', 'sections enrollment by grade'),
  E('Enrollment Data', 'Male total', 'enrollment-data.html', '#enrollmentTotalMale', 'users', 'enrollment male'),
  E('Enrollment Data', 'Female total', 'enrollment-data.html', '#enrollmentTotalFemale', 'users', 'enrollment female'),
  E('Enrollment Data', 'Overall total', 'enrollment-data.html', '#enrollmentGrandTotal', 'users', 'enrollment total'),

  /* ---- Data -------------------------------------------------------------- */
  E('Data', 'Search records', 'data.html', '#dataSearch', 'search', 'search name lrn'),
  E('Data', 'Filter by grade level', 'data.html', '#dataGrade', 'search', 'grade filter'),
  E('Data', 'Filter by program', 'data.html', '#dataProgram', 'search', 'program filter'),
  E('Data', 'Filter by gender', 'data.html', '#dataGender', 'search', 'gender filter'),
  E('Data', 'Download filtered Excel', 'data.html', '#downloadFilteredBtn', 'download', 'export filtered excel'),
  E('Data', 'Download full masterlist', 'data.html', '#downloadAllBtn', 'download', 'export all learners excel'),
  E('Data', 'Download CSV', 'data.html', '#downloadCsvBtn', 'download', 'export csv'),
  E('Data', 'Download Transferred Out', 'data.html', '#downloadTransferredOutBtn', 'download', 'export transferred out'),
  E('Data', 'Download Dropout Info', 'data.html', '#downloadDropoutBtn', 'download', 'export dropout info'),
  E('Data', 'Refresh preview', 'data.html', '#dataRefreshBtn', 'chevronRight', 'refresh records'),

  /* ---- Statistics -------------------------------------------------------- */
  E('Statistics', 'Export Excel', 'reports.html', '#exportBtn', 'download', 'export report excel'),
  E('Statistics', 'Learners by Grade Level', 'reports.html', '#gradeBarChart', 'barChart', 'bar chart grade'),
  E('Statistics', 'Program Distribution', 'reports.html', '#donutSvg', 'barChart', 'donut program'),
  E('Statistics', 'Grade and Program Breakdown', 'reports.html', '#breakdownTableBody', 'clipboard', 'breakdown table'),

  /* ---- EOSY Status Report ------------------------------------------------ */
  E('EOSY Status Report', 'Search learners', 'eosy-report.html', '#eosySearch', 'search', 'search lrn section'),
  E('EOSY Status Report', 'Filter by EOSY status', 'eosy-report.html', '#eosyStatusFilter', 'search', 'status promoted retained dropped'),
  E('EOSY Status Report', 'Filter by grade level', 'eosy-report.html', '#eosyGradeFilter', 'search', 'grade filter'),
  E('EOSY Status Report', 'Sort A-Z', 'eosy-report.html', '#eosySortDirection', 'chevronRight', 'sort direction'),
  E('EOSY Status Report', 'EOSY table', 'eosy-report.html', '#eosyStatusTableBody', 'clipboard', 'statuses table'),

  /* ---- Grades Profile ---------------------------------------------------- */
  E('Grades Profile', 'Export Excel', 'grades-profile.html', '#exportGradesBtn', 'download', 'export grades excel'),
  E('Grades Profile', 'Search learners', 'grades-profile.html', '#gradesSearch', 'search', 'search name lrn'),
  E('Grades Profile', 'Filter by grade level', 'grades-profile.html', '#gradesGradeFilter', 'search', 'grade filter'),
  E('Grades Profile', 'Filter by program', 'grades-profile.html', '#gradesProgramFilter', 'search', 'program filter'),
  E('Grades Profile', 'Filter by gender', 'grades-profile.html', '#gradesGenderFilter', 'search', 'gender filter'),
  E('Grades Profile', 'Sort by', 'grades-profile.html', '#gradesSort', 'chevronRight', 'sort surname id grade section average'),
  E('Grades Profile', 'Grade term navigation', 'grades-profile.html', '#gradesTermNavigation', 'clipboard', 'terms term1 term2 term3 final'),
  E('Grades Profile', 'Subject grades table', 'grades-profile.html', '#gradesTableBody', 'graduationCap', 'grades table'),

  /* ---- Reading Profile --------------------------------------------------- */
  E('Reading Profile', 'Export Excel', 'reading-profile.html', '#exportReadingBtn', 'download', 'export reading excel'),
  E('Reading Profile', 'Learner view', 'reading-profile.html', '#readingLearnersTab', 'users', 'learners tab'),
  E('Reading Profile', 'Graphs view', 'reading-profile.html', '#readingGraphsTab', 'barChart', 'graphs tab chart'),
  E('Reading Profile', 'Search learners', 'reading-profile.html', '#readingSearch', 'search', 'search lrn'),
  E('Reading Profile', 'Filter by assessment period', 'reading-profile.html', '#readingPeriodFilter', 'search', 'bosy mosy eosy period'),
  E('Reading Profile', 'Filter by grade level', 'reading-profile.html', '#readingGradeFilter', 'search', 'grade filter'),
  E('Reading Profile', 'Filter by sex', 'reading-profile.html', '#readingSexFilter', 'search', 'gender male female'),
  E('Reading Profile', 'Filter by classification', 'reading-profile.html', '#readingStatusFilter', 'search', 'crla phil-iri classification'),
  E('Reading Profile', 'Reading table', 'reading-profile.html', '#readingTableBody', 'book', 'learners table'),
  E('Reading Profile', 'Reading graphs', 'reading-profile.html', '#readingProfileCharts', 'barChart', 'charts'),

  /* ---- Math Profile ------------------------------------------------------ */
  E('Math Profile', 'Export Excel', 'math-profile.html', '#exportMathBtn', 'download', 'export math excel'),
  E('Math Profile', 'Learner view', 'math-profile.html', '#mathLearnersTab', 'users', 'learners tab'),
  E('Math Profile', 'Graphs view', 'math-profile.html', '#mathGraphsTab', 'barChart', 'graphs tab'),
  E('Math Profile', 'Search learners', 'math-profile.html', '#mathSearch', 'search', 'search lrn'),
  E('Math Profile', 'Filter by assessment period', 'math-profile.html', '#mathPeriodFilter', 'search', 'bosy mosy eosy'),
  E('Math Profile', 'Filter by sex', 'math-profile.html', '#mathSexFilter', 'search', 'gender'),
  E('Math Profile', 'Filter by grade level', 'math-profile.html', '#mathGradeFilter', 'search', 'grade'),
  E('Math Profile', 'Filter by classification', 'math-profile.html', '#mathStatusFilter', 'search', 'rma proficient'),
  E('Math Profile', 'Math table', 'math-profile.html', '#mathTableBody', 'math', 'learners table'),
  E('Math Profile', 'Math graphs', 'math-profile.html', '#mathProfileCharts', 'barChart', 'charts'),

  /* ---- Nutritional Status ------------------------------------------------ */
  E('Nutritional Status', 'Export Excel', 'nutritional-status.html', '#exportNutritionBtn', 'download', 'export nutrition excel'),
  E('Nutritional Status', 'Learner view', 'nutritional-status.html', '#nutritionLearnersTab', 'users', 'learners tab'),
  E('Nutritional Status', 'Graphs view', 'nutritional-status.html', '#nutritionGraphsTab', 'barChart', 'graphs tab'),
  E('Nutritional Status', 'Search learners', 'nutritional-status.html', '#nutritionSearch', 'search', 'search lrn'),
  E('Nutritional Status', 'Filter by assessment period', 'nutritional-status.html', '#nutritionPeriodFilter', 'search', 'baseline midline endline'),
  E('Nutritional Status', 'Filter by sex', 'nutritional-status.html', '#nutritionSexFilter', 'search', 'gender'),
  E('Nutritional Status', 'Filter by grade level', 'nutritional-status.html', '#nutritionGradeFilter', 'search', 'grade'),
  E('Nutritional Status', 'Filter by status', 'nutritional-status.html', '#nutritionStatusFilter', 'search', 'normal wasted obese'),
  E('Nutritional Status', 'Nutrition table', 'nutritional-status.html', '#nutritionTableBody', 'activity', 'learners table'),
  E('Nutritional Status', 'Nutrition graphs', 'nutritional-status.html', '#nutritionProfileCharts', 'barChart', 'charts'),

  /* ---- Transfer Info ----------------------------------------------------- */
  E('Transfer Info', 'Search records', 'transfer-info.html', '#transferSearch', 'search', 'search school lrn'),
  E('Transfer Info', 'Filter by transfer type', 'transfer-info.html', '#transferTypeFilter', 'search', 'transfer in out'),
  E('Transfer Info', 'Filter by grade level', 'transfer-info.html', '#transferGradeFilter', 'search', 'grade'),
  E('Transfer Info', 'Filter by sex', 'transfer-info.html', '#transferGenderFilter', 'search', 'gender'),
  E('Transfer Info', 'Transfer table', 'transfer-info.html', '#transferTableBody', 'transfer', 'records table'),

  /* ---- Dropout Info ------------------------------------------------------ */
  E('Dropout Info', 'Search records', 'dropout.html', '#dropoutSearch', 'search', 'search lrn grade'),
  E('Dropout Info', 'Filter by grade level', 'dropout.html', '#dropoutGradeFilter', 'search', 'grade'),
  E('Dropout Info', 'Filter by sex', 'dropout.html', '#dropoutGenderFilter', 'search', 'gender'),
  E('Dropout Info', 'Dropout table', 'dropout.html', '#dropoutTableBody', 'alertTriangle', 'records table'),

  /* ---- Promotion / Retention --------------------------------------------- */
  E('Promotion', 'Search learners', 'promotion.html', '#promotionSearch', 'search', 'search lrn'),
  E('Promotion', 'Promoted learners table', 'promotion.html', '#promotionTableBody', 'graduationCap', 'promote learners list'),
  E('Retention', 'Search learners', 'retention.html', '#promotionSearch', 'search', 'search lrn'),
  E('Retention', 'Retained learners table', 'retention.html', '#promotionTableBody', 'rotateCcw', 'retain learners list'),

  /* ---- Audit Log --------------------------------------------------------- */
  E('Audit Log', 'Refresh log', 'audit-log.html', '#auditRefreshBtn', 'chevronRight', 'refresh audit entries', 'admin'),
  E('Audit Log', 'Search audit log', 'audit-log.html', '#auditSearch', 'search', 'search user action sheet', 'admin'),
  E('Audit Log', 'Audit table', 'audit-log.html', '#auditTableBody', 'clipboard', 'entries log table', 'admin'),

  /* ---- Website Feedback -------------------------------------------------- */
  E('Website Feedback', 'Feedback form', 'feedback.html', '#feedbackForm', 'info', 'form email'),
  E('Website Feedback', 'Email field', 'feedback.html', '#feedbackEmail', 'users', 'email'),
  E('Website Feedback', 'Rating fields', 'feedback.html', '#feedbackRatingFields', 'heart', 'rating 1-5'),
  E('Website Feedback', 'Comment box', 'feedback.html', '#feedbackComment', 'edit', 'feedback comment textarea'),
  E('Website Feedback', 'Submit feedback', 'feedback.html', '#feedbackSubmitBtn', 'chevronRight', 'submit send'),

  /* ---- Utilities --------------------------------------------------------- */
  E('Utilities', 'Grade Calculator', 'utilities.html', '#utilitySubjectGrid', 'sigma', 'calculate average grades'),
  E('Utilities', 'BMI Calculator', 'utilities.html', '.utility-bmi-grid', 'calculator', 'calculate bmi height weight'),

  /* ---- Grade Calculator -------------------------------------------------- */
  E('Grade Calculator', 'Subject grades', 'grade-calculator.html', '#utilitySubjectGrid', 'sigma', 'enter grades'),
  E('Grade Calculator', 'Calculate average', 'grade-calculator.html', '#calculateGradeBtn', 'chevronRight', 'average compute'),
  E('Grade Calculator', 'Clear', 'grade-calculator.html', '#resetGradeBtn', 'x', 'reset'),

  /* ---- BMI Calculator ---------------------------------------------------- */
  E('BMI Calculator', 'Height input', 'bmi-calculator.html', '#utilityHeight', 'calculator', 'height meters'),
  E('BMI Calculator', 'Weight input', 'bmi-calculator.html', '#utilityWeight', 'calculator', 'weight kg'),
  E('BMI Calculator', 'Calculate BMI', 'bmi-calculator.html', '#calculateBmiBtn', 'chevronRight', 'compute bmi'),
  E('BMI Calculator', 'Clear', 'bmi-calculator.html', '#resetBmiBtn', 'x', 'reset'),

  /* ---- Settings ---------------------------------------------------------- */
  E('Settings', 'Upload a Profile Photo', 'settings.html', '#uploadProfilePhoto', 'edit', 'upload photo avatar'),
  E('Settings', 'Remove profile photo', 'settings.html', '#removeProfilePhoto', 'trash', 'remove photo avatar'),
  E('Settings', 'Account Settings', 'settings.html', '#openAccountSettings', 'settings', 'account name password'),
  E('Settings', 'Preferences', 'settings.html', 'a[href="preferences.html"]', 'settings', 'themes inspection options'),
  E('Settings', 'Admin Console', 'settings.html', '#adminConsoleOption', 'settings', 'manage users years backup', 'admin'),

  /* ---- Preferences ------------------------------------------------------- */
  E('Preferences', 'Theme selector', 'preferences.html', '#themePreferenceSelect', 'settings', 'theme light dark dracula monokai beach nord forest clentindustries'),
  E('Preferences', 'Learner Inspection toggle', 'preferences.html', '#learnerInspectionToggle', 'eye', 'inspect learner action'),

  /* ---- Admin Console ----------------------------------------------------- */
  E('Admin Console', 'School structure', 'manage-users.html', '#adminStructureTab', 'settings', 'years grades sections curriculum', 'admin'),
  E('Admin Console', 'Access management', 'manage-users.html', '#adminAccessTab', 'settings', 'users roles accounts', 'admin'),
  E('Admin Console', 'Database backup', 'manage-users.html', '#adminBackupTab', 'download', 'backup export data', 'admin'),
  E('Admin Console', 'Audit log', 'manage-users.html', '#adminAuditTab', 'clipboard', 'activity history', 'admin'),
  E('Admin Console', 'Add school year', 'manage-users.html', '#openYearModalBtn', 'plus', 'new school year', 'admin'),
  E('Admin Console', 'Add section', 'manage-users.html', '#openSectionModalBtn', 'plus', 'new section', 'admin'),
  E('Admin Console', 'Add User', 'manage-users.html', '#addUserBtn', 'plus', 'new user account', 'admin'),

  /* ---- Print Card -------------------------------------------------------- */
  E('Learner Card (SF9)', 'Print Card', 'student-card.html', '#openPrintableStudio', 'learnerCard', 'print report card learner student card grades printables', 'printableCard'),
  E('Good Moral Certificate', 'Print Good Moral Certificate', 'good-moral.html', '#openPrintableStudio', 'moralCertificate', 'certificate good moral conduct printables', 'printableRecords'),
  E('Certificate of Enrollment', 'Print Certificate of Enrollment', 'certificate-of-enrollment.html', '#openPrintableStudio', 'enrollmentCertificate', 'certificate enrollment coe printables', 'printableRecords'),
  E('Request for Permanent Records (SF10)', 'Print SF10 Request', 'request-permanent-records.html', '#openPrintableStudio', 'recordsRequest', 'sf10 form 137 permanent records request printables', 'printableRecords'),
  E('Envelope template for Outgoing Records', 'Print outgoing envelope', 'outgoing-records-envelope.html', '#openPrintableStudio', 'outgoingEnvelope', 'envelope outgoing transfer records printables', 'printableRecords'),
];

/* ============================================================================
 * Small helpers
 * ========================================================================== */
function pageHref(fileName) {
  return `${APP_PAGE_PREFIX}${fileName}${isVisitorSession() ? '?visitor=1' : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function isFocusableElement(element) {
  if (!element) return false;
  const tag = String(element.tagName || '').toUpperCase();
  return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY'].includes(tag)
    || element.hasAttribute('tabindex');
}

function flashTarget(element) {
  if (!element) return;
  try { element.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (error) { /* jsdom-safe */ }
  element.classList.remove('global-search-flash');
  void element.offsetWidth;
  element.classList.add('global-search-flash');
  window.setTimeout(() => element.classList.remove('global-search-flash'), 1800);
  if (isFocusableElement(element)) {
    try { element.focus({ preventScroll: true }); } catch (error) { /* no-op */ }
  }
}

function clearPending() {
  S.pending = null;
  window.clearTimeout(S.pendingTimer);
  if (S.pendingObserver) {
    S.pendingObserver.disconnect();
    S.pendingObserver = null;
  }
}

function applyPendingFocus() {
  const pending = S.pending;
  if (!pending) { clearPending(); return; }
  const path = window.location.pathname || '';
  if (!path.endsWith(`/${pending.href}`)) { clearPending(); return; }
  const element = pending.selector ? document.querySelector(pending.selector) : null;
  if (element) { flashTarget(element); clearPending(); return; }
  // Element may be rendered asynchronously after the page mounts.
  if (!S.pendingObserver) {
    S.pendingObserver = new MutationObserver(() => {
      const target = pending.selector ? document.querySelector(pending.selector) : null;
      if (target) { flashTarget(target); clearPending(); }
    });
    S.pendingObserver.observe(document.body, { childList: true, subtree: true });
  }
  window.clearTimeout(S.pendingTimer);
  S.pendingTimer = window.setTimeout(clearPending, 4000);
}

/* ============================================================================
 * Panel UI
 * ========================================================================== */
function currentInput() { return document.getElementById('globalSearchInput'); }
function currentResults() { return document.getElementById('globalSearchResults'); }
function currentPanel() { return document.getElementById('globalSearchPanel'); }
function currentWrap() { return document.getElementById('globalSearch'); }

function entryKey(entry) {
  return JSON.stringify([entry.href, entry.selector || '', entry.label]);
}

function loadRecentKeys() {
  try {
    const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const keys = stored ? JSON.parse(stored) : [];
    return Array.isArray(keys)
      ? keys.filter((key) => typeof key === 'string').slice(0, MAX_RECENT_SEARCHES)
      : [];
  } catch (error) {
    console.warn('Global search recent history could not be loaded.', error);
    return [];
  }
}

function saveRecentKeys() {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(S.recentKeys));
  } catch (error) {
    console.warn('Global search recent history could not be saved.', error);
  }
}

function rememberEntry(key) {
  if (!key) return;
  const entry = [...S.navEntries, ...S.subEntries].find((candidate) => entryKey(candidate) === key);
  if (!entry || entry.isPage) return;
  S.recentKeys = [key, ...S.recentKeys.filter((recentKey) => recentKey !== key)]
    .slice(0, MAX_RECENT_SEARCHES);
  saveRecentKeys();
}

function recentEntries() {
  const availableEntries = [...S.navEntries, ...S.subEntries];
  const entriesByKey = new Map(availableEntries.map((entry) => [entryKey(entry), entry]));
  const componentEntries = S.recentKeys
    .map((key) => entriesByKey.get(key))
    .filter((entry) => entry && !entry.isPage);
  const validKeys = componentEntries.map(entryKey);
  if (validKeys.length !== S.recentKeys.length) {
    S.recentKeys = validKeys;
    saveRecentKeys();
  }
  return componentEntries;
}

function resultRow(entry, isRecent = false) {
  const icon = entry.icon && Icon[entry.icon] ? Icon[entry.icon] : '';
  const subtext = entry.isPage ? 'Open page' : entry.page;
  const key = entryKey(entry);
  const link = `
    <a class="global-search-item" href="${escapeHtml(pageHref(entry.href))}" role="option" aria-selected="false"
       data-href="${escapeHtml(entry.href)}" data-selector="${escapeHtml(entry.selector || '')}"
       data-entry-key="${escapeHtml(key)}" data-is-page="${Boolean(entry.isPage)}">
      <span class="gsi-icon">${icon}</span>
      <span class="gsi-copy"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(subtext)}</small></span>
      <span class="gsi-enter">↵</span>
    </a>`;
  if (!isRecent) return link;
  return `
    <div class="gsi-recent-row">
      ${link}
      <button class="gsi-recent-remove" type="button" data-entry-key="${escapeHtml(key)}"
        aria-label="Remove ${escapeHtml(entry.label)} from recently opened" title="Remove from recently opened">
        ${Icon.x}
      </button>
    </div>`;
}

function findMatches(query) {
  if (S.resultCache.has(query)) return S.resultCache.get(query);

  const matches = (entry) => `${entry.page} ${entry.label} ${entry.keywords || ''}`.toLowerCase().includes(query);
  const pages = S.navEntries.filter(matches);
  const byPage = new Map();
  S.subEntries.filter(matches).forEach((entry) => {
    const list = byPage.get(entry.page) || [];
    list.push(entry);
    byPage.set(entry.page, list);
  });
  const groups = [];
  if (pages.length) groups.push({ title: 'Pages', entries: pages });
  byPage.forEach((entries, pageName) => groups.push({ title: `Within ${pageName}`, entries }));

  if (S.resultCache.size >= MAX_CACHED_QUERIES) {
    S.resultCache.delete(S.resultCache.keys().next().value);
  }
  S.resultCache.set(query, groups);
  return groups;
}

function renderResults() {
  const container = currentResults();
  if (!container) return;
  container.innerHTML = '';
  S.results = [];
  S.activeIndex = -1;

  const query = S.query.trim().toLowerCase();
  if (!query) {
    const recent = recentEntries();
    if (recent.length) {
      container.innerHTML = '<div class="gsi-group">Recently opened</div>' + recent.map((entry) => resultRow(entry, true)).join('');
      S.results = [...container.querySelectorAll('.global-search-item')];
    } else if (S.navEntries.length) {
      container.innerHTML = '<div class="gsi-group">Pages</div>' + S.navEntries.map((entry) => resultRow(entry)).join('');
      S.results = [...container.querySelectorAll('.global-search-item')];
    } else {
      container.innerHTML = '<div class="gsi-empty">Nothing available in this workspace.</div>';
    }
    return;
  }

  let total = 0;
  let html = '';
  for (const group of findMatches(query)) {
    if (total >= 60) break;
    const list = group.entries.slice(0, 12);
    html += `<div class="gsi-group">${escapeHtml(group.title)}</div>${list.map((entry) => resultRow(entry)).join('')}`;
    total += list.length;
  }
  if (!html) html = `<div class="gsi-empty">No matches for “${escapeHtml(query)}”.</div>`;
  container.innerHTML = html;
  S.results = [...container.querySelectorAll('.global-search-item')];
}

function setActive(index) {
  if (!S.results.length) return;
  const next = (index + S.results.length) % S.results.length;
  S.results.forEach((el, i) => {
    el.classList.toggle('is-active', i === next);
    el.setAttribute('aria-selected', String(i === next));
  });
  S.activeIndex = next;
  try { S.results[next].scrollIntoView({ block: 'nearest' }); } catch (error) { /* jsdom-safe */ }
}

function openPanel() {
  const panel = currentPanel();
  const wrap = currentWrap();
  const input = currentInput();
  if (!panel || !wrap || !input) return;
  S.open = true;
  panel.hidden = false;
  wrap.classList.add('is-open');
  input.setAttribute('aria-expanded', 'true');
  renderResults();
}

function closePanel(blurInput = false) {
  const panel = currentPanel();
  const input = currentInput();
  if (!panel) return;
  S.open = false;
  panel.hidden = true;
  const wrap = currentWrap();
  if (wrap) wrap.classList.remove('is-open');
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    if (blurInput) { try { input.blur(); } catch (error) { /* no-op */ } }
  }
  S.results = [];
  S.activeIndex = -1;
}

function onInput(event) {
  if (!S.open) openPanel();
  S.query = event.target.value;
  S.activeIndex = -1;
  renderResults();
}

function onInputFocus() {
  openPanel();
}

function onInputKeydown(event) {
  if (event.key === 'ArrowDown') { event.preventDefault(); setActive(S.activeIndex + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(S.activeIndex - 1); }
  else if (event.key === 'Enter') {
    event.preventDefault();
    const active = S.results[S.activeIndex] || S.results[0];
    if (active) active.click();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePanel();
  }
}

function onResultClick(event) {
  const removeButton = event.target.closest('.gsi-recent-remove');
  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    const key = removeButton.dataset.entryKey;
    S.recentKeys = S.recentKeys.filter((recentKey) => recentKey !== key);
    saveRecentKeys();
    renderResults();
    return;
  }

  const link = event.target.closest('.global-search-item');
  if (!link) return;
  const href = link.dataset.href || '';
  const selector = link.dataset.selector || '';
  rememberEntry(link.dataset.entryKey);
  const input = currentInput();
  if (input) input.value = '';
  const path = window.location.pathname || '';
  const onSamePage = path.endsWith(`/${href}`);

  if (onSamePage) {
    event.preventDefault();
    S.query = '';
    closePanel(true);
    if (selector) {
      const element = document.querySelector(selector);
      if (element) flashTarget(element);
    }
    return;
  }

  if (selector) S.pending = { href, selector };
  S.query = '';
  closePanel(true);
  // Default anchor navigation proceeds; App.tsx intercepts /pages/ links and
  // the destination renderShell re-mounts the search, applying S.pending.
}

function bindGlobalKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const input = currentInput();
      if (!input) return;
      if (S.open) closePanel(true);
      else {
        openPanel();
        input.focus();
      }
    } else if (event.key === 'Escape' && S.open) {
      closePanel();
    }
  });
  document.addEventListener('click', (event) => {
    if (S.open && !event.target.closest('.global-search')) closePanel();
  });
}

/**
 * Mounts the global search bar into the topbar. Called by shell.renderShell
 * after it rebuilds the topbar on every page render.
 */
export function mountGlobalSearch(navItems = []) {
  const wrap = currentWrap();
  const input = currentInput();
  const panel = currentPanel();
  const results = currentResults();
  if (!wrap || !input || !panel || !results) return;

  bindGlobalKeys();
  S.open = false;
  S.query = input.value;
  panel.hidden = true;
  wrap.classList.remove('is-open');
  input.setAttribute('aria-expanded', 'false');

  // Rebuild the index from the role-filtered nav the shell already computed.
  S.navEntries = (navItems || []).map((item) => ({
    isPage: true,
    page: item.label,
    label: item.label,
    href: item.href,
    icon: item.icon,
    keywords: item.group || '',
    selector: null,
  }));
  const navHrefs = new Set(S.navEntries.map((entry) => entry.href));
  S.subEntries = CURATED.filter((entry) =>
    (!entry.role || (ROLE_GATES[entry.role] && ROLE_GATES[entry.role]())) &&
    (navHrefs.has(entry.href) || !isVisitorSession()),
  );
  S.recentKeys = loadRecentKeys();
  S.resultCache.clear();

  // Re-bind (the topbar DOM was recreated on this render).
  input.onfocus = onInputFocus;
  input.oninput = onInput;
  input.onkeydown = onInputKeydown;
  panel.onmousedown = (event) => event.stopPropagation();
  results.onclick = onResultClick;

  applyPendingFocus();
}
