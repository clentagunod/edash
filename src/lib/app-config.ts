// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { getActiveSchool, getStoredSchool } from "./school-registry";
import { DEFAULT_GRADE_TERMS_SETTINGS } from "./grading-config";
import { normalizeRecordDocumentPreferences } from './record-document-preferences';
import { normalizeSignatureLibrary } from './printable-signatures';

import userPreferenceDefaults from "../../shared/user-preferences.json";

const env = import.meta.env;
const activeSchool = getActiveSchool();

const LOCAL_MAINTENANCE_ANIMATION_URL = "/assets/maintenance.json";

export const APP_CONFIG = Object.freeze({
  branding: Object.freeze({
    schoolName: activeSchool.name,
    nickname: activeSchool.nickname,
    productName: "E-Dash",
    dashboardName: "Realtime Enrollment Dashboard",
    logoFile: "edash/edash.png",
    schoolLogoUrl: activeSchool.logoUrl,
    faviconFile: "favicon.png",
    description: "A realtime learner enrollment, profiles, and school statistics dashboard.",
  }),
  // Keep the animation in the deployed app by default. A VITE_* override is
  // still supported when a different local filename or remote asset is needed.
  maintenanceAnimationUrl: env.VITE_MAINTENANCE_ANIMATION_URL || LOCAL_MAINTENANCE_ANIMATION_URL,
  schoolId: activeSchool.id,
  firebase: activeSchool.firebaseConfig,
  // Set this after deploying apps-script/AuditLog.gs as a Web App.
  auditLogApiUrl: activeSchool.auditLogApiUrl,
  feedbackApiUrl: activeSchool.feedbackApiUrl,
  assetsPath: "assets/",
  pagePath: "pages/",
  firestore: Object.freeze({
    schemaVersion: 3,
    schoolDefaults: Object.freeze({
      gradeTerms: DEFAULT_GRADE_TERMS_SETTINGS,
    }),
    schoolYearDefaults: Object.freeze({
      gradeTerms: DEFAULT_GRADE_TERMS_SETTINGS,
      isCurrent: false,
    }),
    settingsDefaults: Object.freeze({
      printableSignatures: Object.freeze(normalizeSignatureLibrary()),
      cardPrintingPreferences: Object.freeze({
        activeTemplate: "sf9",
        gradeTemplates: Object.freeze({ kinder: "sf9", grade1: "sf9", grade2: "sf9", grade3: "sf9", grade4: "sf9", grade5: "sf9", grade6: "sf9" }),
        attendanceMonths: Object.freeze(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]),
        attendanceRows: Object.freeze([{ id: "classDays", label: "Class days" }, { id: "daysPresent", label: "Present" }, { id: "daysAbsent", label: "Absent" }]),
      }),
      toggles: Object.freeze({
        canParentAccess: true,
        canPromoteStudents: false,
        trashConfg: "30",
        roundType: "nearest_integer",
        printables: Object.freeze(normalizeRecordDocumentPreferences()),
      }),
    }),
    userDefaults: Object.freeze({
      teacherPrefs: Object.freeze({ ...userPreferenceDefaults, hiddenLearnerColumns: Object.freeze([]) }),
    }),
    collections: Object.freeze({
      users: "users",
      schoolYears: "schoolYears",
      grades: "grades",
      settings: "settings",
      learners: "learners",
      dropouts: "dropouts",
      transferredOut: "transferredOut",
      publicStats: "publicStats",
    }),
    paths: Object.freeze({
      grades: "grades",
      sections: "sections",
      teachers: "teachers",
      learners: "learners",
      users: "users",
      assignments: "assignments",
      assignmentHistory: "assignmentHistory",
      gradeTermYears: "years",
    }),
    documents: Object.freeze({
      currentSchoolYear: "currentSchoolYear",
      curriculumSubjectPool: "curriculumSubjectPool",
      gradeTerms: "gradeTerms",
      toggles: "toggles",
      publicStatsSummary: "summary",
    }),
    // Canonical learner document fields; dynamic curriculum subject IDs may be
    // appended when a school administrator adds to the shared subject pool.
    learnerFields: Object.freeze([
      "firstName", "lastName", "middleName", "suffix", "age", "birthDate", "learnerId", "name", "gradeLevel", "section", "gender",
      "guardian", "contact", "enrollmentStatus", "eosyStatus", "schoolYear", "dateAdded", "is4Ps", "isIP", "isSNED", "isARAL", "isMuslim",
      "bosyHeight", "bosyWeight", "bosyNutritionalStatus", "mosyHeight", "mosyWeight", "mosyNutritionalStatus", "eosyHeight", "eosyWeight", "eosyNutritionalStatus",
      "bosyCRLA", "mosyCRLA", "eosyCRLA", "bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI", "bosyRMA", "mosyRMA", "eosyRMA",
      "filipino", "english", "math", "science", "aralPan", "esp", "music", "arts", "pe", "health", "epp", "motherTongue",
      "literacyLanguageCommunication", "socioEmotionalDevelopment", "valuesDevelopment", "physicalHealthMotorDevelopment",
      "aestheticCreativeDevelopment", "cognitiveDevelopment", "gmrc", "language", "readingLiteracy", "makabansa", "eppTle",
      "tle", "valuesEducation", "mapeh", "musicAndArts", "physicalEducationAndHealth", "gradesByTerm",
      "transferType", "transferIn", "transferOut", "transferSchoolId", "transferSchool", "transferSchoolAddress", "transferSchoolZipCode", "transferDate", "transferReason", "transferNotes", "documentStatus", "documentStatusCustom", "documentStatusDates", "anecdotalRecords", "teacherComments", "attendance", "progressionSourceSchoolYear", "progressionType", "extra",
    ]),
  }),
});

export function appDocumentTitle(pageName: string = APP_CONFIG.branding.dashboardName) {
  if (pageName === APP_CONFIG.branding.schoolName) {
    return `${APP_CONFIG.branding.schoolName} — ${APP_CONFIG.branding.dashboardName}`;
  }
  return `${pageName} — ${APP_CONFIG.branding.nickname} ${APP_CONFIG.branding.dashboardName}`;
}

export function appSchoolFilePrefix() {
  const prefix = APP_CONFIG.branding.schoolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return prefix || "school";
}

export function appBrandAssetUrl(fileName) {
  const input = String(fileName || "").trim();
  try {
    const url = new URL(input, window.location.origin);
    if (url.protocol === "https:") return url.href;
    if (url.origin === window.location.origin && url.protocol === window.location.protocol) return `${url.pathname}${url.search}${url.hash}`;
  } catch (error) {
    return "/assets/edash/edash.png";
  }
  return "/assets/edash/edash.png";
}

export function preloadSchoolLogo(logoUrl = getStoredSchool()?.logoUrl) {
  const preload = document.querySelector('link[data-school-logo-preload]') || document.createElement("link");
  preload.rel = "preload";
  preload.as = "image";
  preload.href = appBrandAssetUrl(logoUrl || APP_CONFIG.branding.schoolLogoUrl);
  preload.setAttribute("data-school-logo-preload", "");
  preload.setAttribute("fetchpriority", "high");
  if (!preload.isConnected) document.head.append(preload);
}

export function updateSchoolFavicon(logoUrl = getStoredSchool()?.logoUrl) {
  preloadSchoolLogo(logoUrl);
  const favicon = document.querySelector('link[rel="icon"]') || document.createElement("link");
  favicon.rel = "icon";
  favicon.removeAttribute("onerror");
  favicon.href = appBrandAssetUrl(logoUrl || "/assets/edash/edash.png");
  if (!favicon.isConnected) document.head.append(favicon);
}

export const APP_IS_PAGES_ROUTE = /[\\/]pages[\\/]/i.test(window.location.pathname);
export const APP_PAGE_PREFIX = APP_IS_PAGES_ROUTE ? "" : "pages/";
export const APP_ASSET_PREFIX = APP_IS_PAGES_ROUTE ? "../assets/" : "assets/";
export const APP_LOGIN_PATH = "/login";
export let APP_USER_PROFILE = null;
export function setAppUserProfile(profile) { APP_USER_PROFILE = profile; }
export const VISITOR_SESSION_VALUE = String(Date.now() + 30 * 60 * 1000);

export function storedAppProfile() {
  try { return JSON.parse(sessionStorage.getItem("lps_user_profile") || "null"); } catch (error) { return null; }
}

export function hasVisitorEntryMarker() {
  return new URLSearchParams(window.location.search).get("visitor") === "1";
}

export function clearVisitorSession() {
  try {
    sessionStorage.removeItem("lps_guest_session");
    localStorage.removeItem("lps_guest_session");
    const profile = storedAppProfile();
    const isGuestProfile = !!profile && (
      profile.uid === "guest"
      || profile.role === "Visitor"
      || profile.role === "visitor"
      || (!profile.email && !profile.uid && profile.role === "Visitor")
    );
    if (isGuestProfile || !profile) {
      sessionStorage.removeItem("lps_user_profile");
    }
  } catch (error) {
    // Storage may be unavailable in private browsing or locked-down browser modes.
  }
}

export function ensureVisitorSession(force = false) {
  if (!force && !hasVisitorEntryMarker()) return false;
  try {
    const expiry = String(Date.now() + 30 * 60 * 1000);
    sessionStorage.setItem("lps_guest_session", "1");
    localStorage.setItem("lps_guest_session", expiry);
    sessionStorage.setItem("lps_user_profile", JSON.stringify({ email: "", uid: "guest", role: "Visitor" }));
  } catch (error) {
    // The auth guard will show the regular login flow if browser storage is unavailable.
  }
  return true;
}

export function appSessionId() {
  const key = "lps_session_id";
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch (error) {
    return "browser-session";
  }
}

export function normalizedAppRole(role) {
  const value = String(role || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (value === "schooladmin" || value === "admin" || value === "schooladministrator") return "School Admin";
  if (value === "registrar") return "Registrar";
  if (value === "teacher") return "Teacher";
  if (value === "visitor") return "Visitor";
  return String(role || "").trim();
}

export function appRole() {
  const profile = APP_USER_PROFILE || storedAppProfile() || {};
  return normalizedAppRole(profile.role);
}

function normalizeTeacherGradeValue(value) {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  if (['kinder', 'kindergarten', 'kg', '0'].includes(normalized)) return 'Kinder';
  const match = normalized.match(/^grade\s*(\d+)$/) || normalized.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

export function normalizeTeacherAssignmentRecord(assignment, fallback = {}) {
  if (!assignment || typeof assignment !== 'object') return null;
  const schoolYear = String(assignment.schoolYear || fallback.schoolYear || '').trim();
  const gradeLevel = normalizeTeacherGradeValue(assignment.gradeLevel || assignment.gradeKey || fallback.gradeLevel || '');
  const section = String(assignment.section || assignment.sectionKey || fallback.section || '').trim();
  const teacherName = String(assignment.teacherName || assignment.adviser || fallback.teacherName || fallback.name || '').trim();
  if (!schoolYear || !gradeLevel || !section) return null;
  return {
    schoolYear,
    gradeLevel,
    section,
    ...(teacherName ? { teacherName } : {}),
  };
}

export function normalizeTeacherAssignmentsForStorage(assignments = []) {
  const unique = new Map();
  const candidates = Array.isArray(assignments) ? assignments : [assignments];
  candidates.forEach((assignment) => {
    const normalized = normalizeTeacherAssignmentRecord(assignment);
    if (!normalized) return;
    const key = [normalized.schoolYear, normalized.gradeLevel, normalized.section].join('|').toLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  });
  return [...unique.values()];
}

/**
 * Builds the stable key shared by teacher assignments and Trash records.
 * Keep the delimiter and part order aligned with the Trash access checks in
 * firestore.rules.
 */
export function teacherAssignmentSecurityKey(assignment) {
  const normalizeKeyPart = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
  const schoolYear = normalizeKeyPart(assignment?.schoolYear).replace(/[–—]/g, '-').replace(/\s*[\/-]\s*/g, '-');
  const gradeLevel = normalizeKeyPart(assignment?.gradeLevel);
  const section = normalizeKeyPart(assignment?.section);
  if (!schoolYear || !gradeLevel || !section) return null;
  return `${schoolYear}::${gradeLevel}::${section}`;
}

/** Flat, de-duplicated key list for every assignment — see teacherAssignmentSecurityKey(). */
export function teacherAssignmentSecurityKeys(assignments = []) {
  const keys = (Array.isArray(assignments) ? assignments : [assignments])
    .map(teacherAssignmentSecurityKey)
    .filter(Boolean);
  return [...new Set(keys)];
}

export function teacherAssignmentsForProfile(profile = APP_USER_PROFILE || storedAppProfile() || {}) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const rawAssignments = Array.isArray(source.teacherAssignments) ? source.teacherAssignments : [];
  // `teacherAssignment` is the legacy single-assignment field. The admin
  // console mirrors the FIRST item of `teacherAssignments` into it, so reading
  // both would always duplicate the first section for multi-section teachers.
  // When the canonical list exists we use it exclusively and only fall back to
  // the legacy field for profiles that predate multi-section support.
  const candidates = rawAssignments.length
    ? rawAssignments
    : source.teacherAssignment ? [source.teacherAssignment] : [];
  const normalized = normalizeTeacherAssignmentsForStorage(candidates);
  // De-duplicate defensively: a malformed/legacy profile may contain the same
  // section more than once, and the teacher coverage summary must reflect
  // exactly what this teacher's account covers — one row per section.
  return normalized;
}

export function teacherAssignmentsForSchoolYear(profile, schoolYear) {
  const normalizedYear = String(schoolYear || "")
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s*[\/-]\s*/g, "-")
    .replace(/\s+/g, "");
  if (!normalizedYear) return [];
  return teacherAssignmentsForProfile(profile).filter((assignment) => {
    const assignmentYear = String(assignment.schoolYear || "")
      .trim()
      .replace(/[–—]/g, "-")
      .replace(/\s*[\/-]\s*/g, "-")
      .replace(/\s+/g, "");
    return assignmentYear === normalizedYear;
  });
}

export function teacherCoverageSummary(profile = APP_USER_PROFILE || storedAppProfile() || {}) {
  const assignments = teacherAssignmentsForProfile(profile);
  return assignments.map((assignment) => {
    const gradeLevel = String(assignment.gradeLevel || assignment.gradeKey || "Grade not assigned").trim();
    const sectionValue = String(assignment.section || assignment.sectionKey || "").trim();
    const sectionLabel = sectionValue ? `Section ${sectionValue}` : "Section not assigned";
    return {
      schoolYear: String(assignment.schoolYear || "Current school year").trim() || "Current school year",
      gradeLevel,
      section: sectionLabel,
    };
  });
}

export function hasRealUserProfile(profile) {
  if (!profile || typeof profile !== "object") return false;
  const uid = String(profile.uid || "").trim();
  const email = String(profile.email || "").trim();
  if (uid && uid !== "guest") return true;
  return Boolean(email && email.includes("@"));
}

export function isVisitorSession() {
  try {
    const activeUser = typeof firebase !== "undefined" && firebase.auth ? firebase.auth().currentUser : null;
    const profile = storedAppProfile();
    const hasSignedInUser = !!(activeUser && activeUser.uid && activeUser.uid !== "guest") || hasRealUserProfile(profile);
    if (hasSignedInUser) {
      clearVisitorSession();
      return false;
    }

    const localValue = Number(localStorage.getItem("lps_guest_session"));
    if (Number.isFinite(localValue) && localValue < Date.now()) {
      localStorage.removeItem("lps_guest_session");
      sessionStorage.removeItem("lps_guest_session");
      sessionStorage.removeItem("lps_user_profile");
      return false;
    }

    if (profile && (profile.uid === "guest" || profile.role === "Visitor" || profile.role === "visitor")) {
      return true;
    }

    if (hasVisitorEntryMarker()) {
      ensureVisitorSession();
      return true;
    }

    const sessionGuest = sessionStorage.getItem("lps_guest_session") === "1";
    const localGuest = Number.isFinite(localValue) && localValue > Date.now();

    if (!localGuest && sessionGuest) {
      const guestProfile = storedAppProfile();
      if (!guestProfile || guestProfile.uid !== "guest") {
        sessionStorage.removeItem("lps_guest_session");
        return false;
      }
    }

    return Boolean(localGuest || (sessionGuest && storedAppProfile()?.uid === "guest"));
  } catch (error) {
    return false;
  }
}
export function canManageLearners() { return ["School Admin", "Registrar", "Teacher"].includes(appRole()); }
export function isSchoolAdmin() { return appRole() === "School Admin"; }
export function isRegistrar() { return appRole() === "Registrar"; }
export function isTeacher() { return appRole() === "Teacher"; }
export function canViewGradesProfile() {
  const role = appRole();
  return !role || ["School Admin", "Registrar", "Teacher"].includes(role);
}

export function paginationPageNumbers(page, pageCount) {
  const windowSize = 5;
  const safePage = Math.max(1, Math.min(pageCount, Number(page) || 1));
  const groupStart = Math.min(safePage, Math.max(1, pageCount - windowSize + 1));
  const groupEnd = Math.min(pageCount, groupStart + windowSize - 1);
  const pages = [];
  for (let value = groupStart; value <= groupEnd; value += 1) pages.push(value);
  return pages;
}

export function formSnapshot(form) {
  if (!form) return "";
  return JSON.stringify([...form.elements].map((field) => ({
    id: field.id || field.name || "",
    type: field.type || "",
    value: field.type === "checkbox" || field.type === "radio" ? field.checked : field.value,
  })));
}

export function confirmDiscardChanges(form, initialSnapshot, itemName = "form") {
  if (formSnapshot(form) === initialSnapshot) return true;
  return window.confirm(`You have unsaved changes in this ${itemName}.\n\nDo you want to discard them and close? Your changes will not be saved.`);
}
