// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { normalizeUserPreferences, validUserPreferences } from "./user-preferences";
import { LPSApi } from './sheets-api';
import { displayNameFromEmail } from './auth';
import { PROGRAM_FIELD_MAP } from './learner-list';
import { auth, db, getUserCreationAuth, parentDb, userCreationAuth } from './firebase';
import { APP_CONFIG, appRole, appSessionId, isTeacher, isVisitorSession, normalizeTeacherAssignmentsForStorage, setAppUserProfile, storedAppProfile, teacherAssignmentSecurityKeys } from './app-config';
import { LPSCache, PUBLIC_STATS_CACHE_TTL_MS } from './cache';
import { CURRICULUM_GRADE_LEVELS, CURRICULUM_SUBJECTS, curriculumSubjectIdFromLabel, isCustomCurriculumSubjectId, normalizeCurriculumGrade, normalizeCurriculumSubjectIds, normalizeCurriculumSubjectPool } from './curriculum-subjects';
import { isAppTheme } from './themes';
import { DEFAULT_GRADE_TERM_COUNT, DEFAULT_ROUND_TYPE, GRADE_ROUND_TYPES, MAX_GRADE_TERM_COUNT, MIN_GRADE_TERM_COUNT } from './academic-grades';
import { DEFAULT_PASSING_THRESHOLD, gradeLevelConfigKey, normalizeGradeLevelGrading, normalizePassingThreshold } from './grading-config';
import { formatLearnerName } from './learner-sorting';
import { CERTIFICATE_PREFERENCES_DOCUMENT, normalizeCertificatePreferences, validateCertificatePreferences, type CertificatePreferences } from './certificate-preferences';

/**
 * ============================================================================
 * FIRESTORE-API.JS
 * ============================================================================
 * The live-data API for tenant operations. It overrides the corresponding
 * LPSApi methods from sheets-api.js so the website uses Firestore for school
 * years, learner records, user profiles, grades, and school settings.
 *
 * WHAT LIVES IN FIRESTORE (this file):
 *   - users            → accounts, roles, status (see README Part 2)
 *   - schoolYears/{year} → { schoolYear, isCurrent }
 *   - schoolYears/{year}/grades/{grade}/sections/{section}/teachers/{uid}
 *   - settings          → key/value app settings (e.g. currentSchoolYear)
 *   - schoolYears/{year}/learners/{lrn}
 *   - schoolYears/{year}/dropouts/{lrn}
 *   - schoolYears/{year}/transferredOut/{lrn}
 *
 * Optional services that stay outside Firestore:
 *   - AuditLog   (apps-script/AuditLog.gs)
 *   - Feedback   (apps-script/Feedback.gs)
 *
 * Firestore Security Rules (firestore.rules) are the real access control —
 * this file assumes a signed-in Firebase user and lets the rules reject
 * anything a role shouldn't be able to do.
 * ============================================================================
 */

export const FS_USERS = APP_CONFIG.firestore.collections.users;
export const FS_SCHOOL_YEARS = APP_CONFIG.firestore.collections.schoolYears;
export const FS_GRADES = APP_CONFIG.firestore.collections.grades;
export const FS_SETTINGS = APP_CONFIG.firestore.collections.settings;
export const FS_LEARNERS = APP_CONFIG.firestore.collections.learners;
export const FS_DROPOUTS = APP_CONFIG.firestore.collections.dropouts;
export const FS_TRANSFERRED_OUT = APP_CONFIG.firestore.collections.transferredOut;
export const FS_PUBLIC_STATS = APP_CONFIG.firestore.collections.publicStats;
export const FS_PATHS = APP_CONFIG.firestore.paths;
export const FS_DOCUMENTS = APP_CONFIG.firestore.documents;
export const FS_LEARNER_FIELD_ORDER = APP_CONFIG.firestore.learnerFields;
let FS_DYNAMIC_CURRICULUM_SUBJECT_IDS = [];

export function fsCanonicalLearner_(learner) {
  const result = {};
  FS_LEARNER_FIELD_ORDER.forEach((field) => { result[field] = learner[field] ?? (field === "extra" ? {} : ""); });
  FS_DYNAMIC_CURRICULUM_SUBJECT_IDS.forEach((field) => { result[field] = learner[field] ?? ""; });
  return result;
}

export function fsLearnersCollection_(schoolYear) {
  const year = String(schoolYear || "").trim();
  if (!year) throw new Error("A school year is required to read learner records.");
  return db.collection(FS_SCHOOL_YEARS).doc(year).collection(FS_LEARNERS);
}

export function fsNormalizeKey_(value, fallback = "unassigned") {
  const key = fsNormalizeValue_(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key || fallback;
}

export function fsTeacherAssignments_() {
  if (!isTeacher()) return null;
  const profile = storedAppProfile() || {};
  const rawAssignments = Array.isArray(profile.teacherAssignments)
    ? profile.teacherAssignments
    : profile.teacherAssignment ? [profile.teacherAssignment] : [];
  const assignments = normalizeTeacherAssignmentsForStorage(rawAssignments).map((assignment) => {
    const schoolYear = fsNormalizeSchoolYear_(assignment.schoolYear || profile.schoolYear);
    const gradeLevel = fsNormalizeGrade_(assignment.gradeLevel || profile.gradeLevel);
    const section = String(assignment.section || profile.section || "").trim();
    const teacherName = String(assignment.teacherName || profile.name || "").trim();
    return schoolYear && gradeLevel && section ? {
      schoolYear,
      gradeLevel,
      section,
      teacherName: teacherName || "Teacher",
    } : null;
  }).filter(Boolean);
  return assignments.length ? assignments : null;
}

export function fsTeacherAssignment_() {
  return fsTeacherAssignments_()?.[0] || null;
}

export function fsTeacherAssignmentsForSchoolYear_(schoolYear) {
  const normalizedYear = fsNormalizeSchoolYear_(schoolYear);
  return (fsTeacherAssignments_() || []).filter((assignment) => fsNormalizeSchoolYear_(assignment.schoolYear) === normalizedYear);
}

export function fsArchiveCollection_(archive, schoolYear) {
  const year = String(schoolYear || "").trim();
  if (!year) throw new Error("A school year is required to read archived learner records.");
  const root = String(archive || "").toLowerCase() === "dropout" ? FS_DROPOUTS : FS_TRANSFERRED_OUT;
  return db.collection(FS_SCHOOL_YEARS).doc(year).collection(root);
}

function fsTrashCollection_(schoolYear) {
  const year = String(schoolYear || "").trim();
  if (!year) throw new Error("A school year is required to access Trash.");
  return db.collection(FS_SCHOOL_YEARS).doc(year).collection("trash");
}

export const FS_TRASH_RETENTION_OPTIONS = ["7", "15", "30", "never"];
export async function fsGetTrashRetention() {
  const snapshot = await db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles).get();
  const value = snapshot.exists ? snapshot.data()?.trashConfg : undefined;
  return FS_TRASH_RETENTION_OPTIONS.includes(value) ? value : "30";
}
export async function fsSetTrashRetention(value) {
  if (!FS_TRASH_RETENTION_OPTIONS.includes(String(value))) throw new Error("Choose a valid Trash retention period.");
  try {
    await fsWriteAuditedSettings_(db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles), { trashConfg: String(value) });
    return String(value);
  } catch (error) { throw fsError_("Update Trash retention", error); }
}

export async function fsGetTrash(schoolYear) {
  const collection = fsTrashCollection_(schoolYear);
  if (isTeacher()) {
    const keys = teacherAssignmentSecurityKeys(fsTeacherAssignmentsForSchoolYear_(schoolYear));
    if (!keys.length) return [];
    const snapshots = await Promise.all(keys.map((key) =>
      collection.where("teacherAssignmentSecurityKey", "==", key).get()
    ));
    const items = new Map();
    snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => {
      items.set(doc.id, { trashId: doc.id, ...doc.data() });
    }));
    return [...items.values()].sort((left, right) =>
      new Date(right.deletedAt || 0).getTime() - new Date(left.deletedAt || 0).getTime()
    );
  }

  if (appRole() === "School Admin") await fsEnsureTeacherTrashAccessKeys_();
  const snapshot = await collection.orderBy("deletedAt", "desc").get();
  const items = snapshot.docs.map((doc) => ({ trashId: doc.id, ...doc.data() }));
  const updates = items.flatMap((item, index) => {
    const key = teacherAssignmentSecurityKeys([{
      schoolYear: item.schoolYear || schoolYear,
      gradeLevel: item.learner?.gradeLevel,
      section: item.learner?.section,
    }])[0];
    return key && item.teacherAssignmentSecurityKey !== key
      ? [{ ref: snapshot.docs[index].ref, key }]
      : [];
  });
  for (let index = 0; index < updates.length; index += 450) {
    const batch = db.batch();
    updates.slice(index, index + 450).forEach(({ ref, key }) => {
      batch.update(ref, { teacherAssignmentSecurityKey: key });
    });
    await batch.commit();
  }
  const updatedKeys = new Map(updates.map(({ ref, key }) => [ref.id, key]));
  return items.map((item) => updatedKeys.has(item.trashId)
    ? { ...item, teacherAssignmentSecurityKey: updatedKeys.get(item.trashId) }
    : item);
}

async function fsEnsureTeacherTrashAccessKeys_() {
  const snapshot = await db.collection(FS_USERS).where("role", "==", "Teacher").get();
  const updates = snapshot.docs.flatMap((doc) => {
    const assignments = fsTeacherAssignmentsFromProfile_(doc.data() || {});
    const keys = teacherAssignmentSecurityKeys(assignments);
    const profileKeys = doc.data()?.teacherAssignmentSecurityKeys || [];
    return JSON.stringify(profileKeys) === JSON.stringify(keys) ? [] : [{ ref: doc.ref, keys }];
  });
  for (let index = 0; index < updates.length; index += 450) {
    const batch = db.batch();
    updates.slice(index, index + 450).forEach(({ ref, keys }) => {
      batch.update(ref, { teacherAssignmentSecurityKeys: keys });
    });
    await batch.commit();
  }
}

async function fsMoveLearnerToTrash_(schoolYear, sourceCollection, learnerId) {
  const id = String(learnerId || "").trim();
  if (!id || id.includes("/")) throw new Error("A valid learner ID is required.");
  const source = db.collection(FS_SCHOOL_YEARS).doc(schoolYear).collection(sourceCollection).doc(id);
  const snapshot = await source.get();
  if (!snapshot.exists) throw new Error("This learner record was already removed or could not be found.");
  const trashRef = fsTrashCollection_(schoolYear).doc();
  const profile = storedAppProfile() || {};
  const batch = db.batch();
  const learner = snapshot.data();
  const teacherAssignmentSecurityKey = teacherAssignmentSecurityKeys([{
    schoolYear,
    gradeLevel: learner.gradeLevel,
    section: learner.section,
  }])[0] || "";
  batch.set(trashRef, { learnerId: id, schoolYear, sourceCollection, learner, teacherAssignmentSecurityKey, deletedAt: new Date().toISOString(), deletedBy: auth.currentUser?.uid || "", deletedByName: profile.name || auth.currentUser?.email || "" });
  batch.delete(source);
  await batch.commit();
  return { deleted: true, trashId: trashRef.id };
}

export async function fsRestoreTrashItem(schoolYear, trashId) {
  const itemRef = fsTrashCollection_(schoolYear).doc(String(trashId || ""));
  const item = await itemRef.get();
  if (!item.exists) throw new Error("This Trash item was already removed.");
  const data = item.data();
  const collection = [FS_LEARNERS, FS_DROPOUTS, FS_TRANSFERRED_OUT].includes(data.sourceCollection) ? data.sourceCollection : "";
  if (!collection || !data.learnerId || !data.learner) throw new Error("This Trash item is invalid and cannot be restored.");
  const targetRef = db.collection(FS_SCHOOL_YEARS).doc(schoolYear).collection(collection).doc(data.learnerId);
  const restoringAsTeacher = isTeacher() && collection === FS_LEARNERS;
  await db.runTransaction(async (transaction) => {
    const currentItem = await transaction.get(itemRef);
    const currentTarget = await transaction.get(targetRef);
    if (!currentItem.exists) throw new Error("This Trash item was already removed.");
    if (currentTarget.exists) throw new Error("A learner with this ID already exists in the original collection. Remove or reconcile that record before restoring.");
    transaction.set(targetRef, restoringAsTeacher ? { ...data.learner, __trashRestoreId: String(trashId) } : data.learner);
    transaction.delete(itemRef);
  });
  if (restoringAsTeacher) {
    try {
      await targetRef.update({ __trashRestoreId: firebase.firestore.FieldValue.delete() });
    } catch (error) {
      console.error("Learner was restored, but its temporary Trash restore marker could not be cleared.", error);
    }
  }
  fsInvalidateReadCaches_(schoolYear);
  fsSchedulePublicStatsRefresh_();
  return { restored: true };
}

export async function fsPermanentlyDeleteTrashItem(schoolYear, trashId) {
  await fsTrashCollection_(schoolYear).doc(String(trashId || "")).delete();
  return { deleted: true };
}

function fsGradesCollection_(schoolYear) {
  return db.collection(FS_SCHOOL_YEARS).doc(String(schoolYear || "").trim()).collection(FS_GRADES);
}

export function fsError_(context, error) {
  console.error(context, error);
  if (error && error.code === "permission-denied") {
    return new Error("You don't have permission to do that. Contact your school admin if this seems wrong.");
  }
  return new Error(error && error.message ? error.message : `${context} failed.`);
}

export function fsInvalidateReadCaches_(schoolYear = "") {
  if (typeof LPSCache === "undefined") return;
  LPSCache.clear("firestore_learners_");
  LPSCache.clear("firestore_teacher_assignments_");
  LPSCache.clear("firestore_sections_");
  LPSCache.clear("firestore_profile_");
  LPSCache.clear("parent_learner_lookup_");
  LPSCache.remove("firestore_public_stats");
  LPSCache.remove("firestore_users");
  LPSCache.remove("firestore_school_years");
  if (schoolYear) LPSCache.remove(`firestore_learners_${schoolYear}`);
}

/** Record the changed fields only, after a successful settings write. */
export async function fsWriteAuditedSettings_(ref, value) {
  const snapshot = await ref.get();
  const previous = snapshot.exists ? snapshot.data() || {} : {};
  await ref.set(value, { merge: true });
  const oldValue = {};
  const newValue = {};
  for (const [key, next] of Object.entries(value)) {
    if (["updatedAt", "updatedBy"].includes(key)) continue;
    if (JSON.stringify(previous[key]) === JSON.stringify(next)) continue;
    oldValue[key] = previous[key] ?? null;
    newValue[key] = next;
  }
  if (Object.keys(newValue).length) fsAudit_("SETTINGS_UPDATE", {
    sheet: "settings", recordId: ref.path || ref.id,
    oldValue: JSON.stringify(oldValue), newValue: JSON.stringify(newValue),
  });
}

/** Best-effort audit log write to the existing Sheets-backed AuditLog. Never blocks the caller. */
export function fsAudit_(action, details) {
  if (typeof LPSApi !== "undefined" && LPSApi.recordAuditEvent) {
    LPSApi.recordAuditEvent(action, { ipSession: typeof appSessionId === "function" ? appSessionId() : "", ...details }).catch(() => {});
  }
}

/* ---------------------------------------------------------------------------
 * SHARED LIVE DATA REGISTRY
 * ---------------------------------------------------------------------------
 * One Firestore onSnapshot per (collection, year) is shared by every page and
 * subscriber in this tab, so ten pages watching the same learners year use ONE
 * listener instead of ten separate query streams.
 *
 * Every snapshot:
 *   1. is kept in memory (fsLiveData_) so one-shot readers (fsGetLearners,
 *      fsGetSections, fsGetUsers, publicStats, school years) return instantly
 *      instead of issuing their own redundant query, and
 *   2. seeds the shared LPSCache so a brand-new page load renders the freshest
 *      data already seen this session and then receives push updates.
 *
 * Subscriptions are ref-counted: the underlying listener is torn down only
 * when the last subscriber unsubscribes. A new subscriber immediately receives
 * the latest snapshot (fast first paint, then live updates).
 * ------------------------------------------------------------------------- */

const fsLiveStores_ = new Map();

function fsLiveKey_(kind, id) {
  return `${kind}${id || id === 0 ? `|${String(id).trim()}` : ""}`;
}

function fsLiveData_(kind, id) {
  const entry = fsLiveStores_.get(fsLiveKey_(kind, id));
  return entry ? entry.data : null;
}

function fsLiveSet_(key, data, cacheKey, cacheTtl = 600000) {
  const entry = fsLiveStores_.get(key);
  if (!entry) return;
  entry.data = data;
  if (cacheKey && typeof LPSCache !== "undefined" && typeof LPSCache.write === "function") {
    try { LPSCache.write(cacheKey, data, cacheTtl); } catch (error) { /* Seeding the cache is optional. */ }
  }
  entry.listeners.forEach((listener) => {
    try { listener(data); } catch (error) { /* A renderer must never break the store. */ }
  });
}

function fsLiveError_(key, error) {
  const entry = fsLiveStores_.get(key);
  if (!entry) return;
  entry.onErrors.forEach((listener) => {
    try { listener(error); } catch (e) { /* Ignore viewer errors. */ }
  });
}

function fsSubscribeLive_(key, startListener, onChange, onError) {
  let entry = fsLiveStores_.get(key);
  if (!entry) {
    entry = { data: null, listeners: new Set(), onErrors: new Set(), unsub: null, started: false };
    fsLiveStores_.set(key, entry);
  }
  if (!entry.started) {
    entry.started = true;
    try { entry.unsub = startListener(key); }
    catch (error) { fsLiveError_(key, error); }
  }
  if (typeof onChange === "function") entry.listeners.add(onChange);
  if (typeof onError === "function") entry.onErrors.add(onError);
  if (entry.data !== null && typeof onChange === "function") {
    try { onChange(entry.data); } catch (error) { /* Already rendered? Ignore replays. */ }
  }
  return () => {
    if (typeof onChange === "function") entry.listeners.delete(onChange);
    if (typeof onError === "function") entry.onErrors.delete(onError);
    if (entry.listeners.size === 0 && entry.onErrors.size === 0) {
      if (entry.unsub) { try { entry.unsub(); } catch (error) { /* Ignore teardown errors. */ } }
      fsLiveStores_.delete(key);
    }
  };
}

function fsSubscribeLiveLearners_(schoolYear, onChange, onError) {
  if (isTeacher()) {
    const userId = String(auth.currentUser?.uid || storedAppProfile()?.uid || "").trim();
    const key = fsLiveKey_("teacher-assigned-learners", `${userId}|${schoolYear}`);
    return fsSubscribeLive_(key, () => {
      const assignments = [...new Map(fsTeacherAssignmentPairsForSchoolYear_(schoolYear)
        .map((assignment) => [
          `${fsNormalizeValue_(assignment.gradeLevel)}|${fsNormalizeValue_(assignment.section)}`,
          assignment,
        ])).values()];
      if (!assignments.length) {
        fsLiveSet_(key, [], `firestore_teacher_assignments_${userId}_${schoolYear}`, 1000);
        return () => {};
      }

      const learnersByAssignment = new Map();
      const initialSnapshots = new Set();
      const unsubscribers = assignments.map((assignment) => {
        const assignmentKey = `${fsNormalizeValue_(assignment.gradeLevel)}|${fsNormalizeValue_(assignment.section)}`;
        return fsLearnersCollection_(schoolYear)
          .where("gradeLevel", "==", assignment.gradeLevel)
          .where("section", "==", assignment.section)
          .onSnapshot((snapshot) => {
            const learners = new Map();
            snapshot.docs.forEach((doc) => {
              const learner = { learnerId: doc.id, ...doc.data() };
              if (fsIsActiveLearner_(learner)) {
                learners.set(String(learner.learnerId), {
                  ...learner,
                  dateAdded: fsLearnerDate_(learner.dateAdded || learner.createdAt || learner.addedAt),
                });
              }
            });
            learnersByAssignment.set(assignmentKey, learners);
            initialSnapshots.add(assignmentKey);
            if (initialSnapshots.size !== assignments.length) return;
            const merged = new Map();
            learnersByAssignment.forEach((records) => records.forEach((learner, learnerId) => merged.set(learnerId, learner)));
            fsLiveSet_(key, [...merged.values()], `firestore_teacher_assignments_${userId}_${schoolYear}`, 1000);
          }, (error) => fsLiveError_(key, fsError_("Live teacher learner updates", error)));
      });
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    }, onChange, onError);
  }
  const key = fsLiveKey_("learners", schoolYear);
  return fsSubscribeLive_(key, () =>
    fsLearnersCollection_(schoolYear).onSnapshot(
      (snapshot) => fsLiveSet_(key, snapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() })).filter(fsIsActiveLearner_), `firestore_learners_${schoolYear}`, 1000),
      (error) => fsLiveError_(key, fsError_("Live learner updates", error))
    ), onChange, onError);
}

function fsSubscribeTeacherLearners_(schoolYear, onChange, onError) {
  const userId = String(auth.currentUser?.uid || "").trim();
  if (!userId) return fsSubscribeLiveLearners_(schoolYear, onChange, onError);
  let learnerUnsubscribe = null;
  let stopped = false;
  let activePath = "";
  const userRef = db.collection(FS_USERS).doc(userId);
  const updateProfile = (data) => {
    const current = storedAppProfile() || {};
    const profile = { ...current, ...data, uid: userId, userId };
    setAppUserProfile(profile);
    try { sessionStorage.setItem("lps_user_profile", JSON.stringify(profile)); } catch (error) { /* Ignore unavailable storage. */ }
  };
  const rebind = (data) => {
    updateProfile(data || {});
    const assignments = fsTeacherAssignmentPairsForSchoolYear_(schoolYear);
    const path = assignments.length
      ? assignments.map((assignment) => `${assignment.gradeLevel}|${assignment.section}`).sort().join(";")
      : "unassigned";
    if (path === activePath) return;
    activePath = path;
    learnerUnsubscribe?.();
    learnerUnsubscribe = null;
    if (stopped) return;
    if (!assignments.length) {
      if (typeof onChange === "function") onChange([]);
      return;
    }
    learnerUnsubscribe = fsSubscribeLiveLearners_(schoolYear, onChange, onError);
  };
  const userUnsubscribe = userRef.onSnapshot((snapshot) => {
    if (!snapshot.exists) return rebind({});
    rebind({ ...snapshot.data(), userId, uid: userId });
  }, (error) => {
    if (typeof onError === "function") onError(fsError_("Live teacher assignment updates", error));
  });
  return () => {
    stopped = true;
    learnerUnsubscribe?.();
    userUnsubscribe?.();
  };
}

/* ---------------------------------------------------------------------------
 * USERS (fully migrated to Firestore)
 * ------------------------------------------------------------------------- */

/**
 * Reads the signed-in user's own profile from Firestore. Falls back to a
 * "Visitor" profile if no matching document exists yet (e.g. the very first
 * admin, before anyone has added them — see README Part 2, "Bootstrapping
 * the first admin").
 *
 * `user` is optional but recommended: callers that already know who is signed
 * in (e.g. `requireAuth`, which restores the session from storage) should
 * pass that user through. Firestore reads still go out with the SDK's own
 * auth token, but this lets the profile resolve even in the brief window
 * while the Firebase Auth SDK is still restoring the persisted session and
 * `firebase.auth().currentUser` is not set yet.
 */
export async function fsGetMyProfile(user = null) {
  const activeUser = user || firebase.auth().currentUser;
  const userId = String(activeUser?.uid || "").trim();
  if (!activeUser || !userId || userId === "guest") throw new Error("Not signed in.");
  const email = String(activeUser.email || "");
  const load = async () => {
    const doc = await db.collection(FS_USERS).doc(userId).get();
    const fallback = {
      userId,
      uid: userId,
      name: displayNameFromEmail(email),
      email,
      role: "Visitor",
      status: "Active",
      teacherPrefs: { ...APP_CONFIG.firestore.userDefaults.teacherPrefs },
    };
    if (!doc.exists) return fallback;
    const data = doc.data() || {};
    const teacherAssignments = normalizeTeacherAssignmentsForStorage(Array.isArray(data.teacherAssignments) ? data.teacherAssignments : data.teacherAssignment ? [data.teacherAssignment] : []);
    return {
      userId: doc.id || userId,
      ...data,
      uid: userId,
      email: data.email || email,
      name: data.name || displayNameFromEmail(email),
      role: data.role || "Visitor",
      status: data.status || "Active",
      teacherPrefs: fsNormalizeTeacherPrefs(data.teacherPrefs),
      teacherAssignment: teacherAssignments[0] || data.teacherAssignment || null,
      teacherAssignments,
    };
  };
  return load();
}

export async function fsGetUsers() {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("users", "");
  if (Array.isArray(live)) return live;
  const load = async () => {
    const snapshot = await db.collection(FS_USERS).orderBy("name").get();
    return snapshot.docs.map((doc) => ({ userId: doc.id, ...doc.data() }));
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad("firestore_users", load, 30000, 120000);
}

function fsTeacherAssignmentsFromProfile_(profile = {}) {
  return normalizeTeacherAssignmentsForStorage(
    Array.isArray(profile.teacherAssignments)
      ? profile.teacherAssignments
      : profile.teacherAssignment ? [profile.teacherAssignment] : [],
  );
}

function fsTeacherAssignmentsByYear_(assignments) {
  const byYear = new Map();
  normalizeTeacherAssignmentsForStorage(assignments).forEach((assignment) => {
    const year = fsNormalizeSchoolYear_(assignment.schoolYear);
    if (!year) return;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ ...assignment, schoolYear: year });
  });
  return byYear;
}

async function fsSyncTeacherSectionLinks_(userId, profile = {}, previousAssignments = []) {
  if (!userId) return;
  const assignments = fsTeacherAssignmentsFromProfile_(profile);
  const wanted = new Map();
  assignments.forEach((assignment) => {
    const year = fsNormalizeSchoolYear_(assignment.schoolYear);
    const gradeLevel = fsNormalizeGrade_(assignment.gradeLevel);
    const sectionName = String(assignment.section || "").trim();
    if (!/^\d{4}-\d{4}$/.test(year) || !gradeLevel || !sectionName) return;
    const gradeKey = fsNormalizeKey_(gradeLevel);
    const sectionKey = fsNormalizeKey_(sectionName);
    wanted.set(`${year}/${gradeKey}/${sectionKey}`, { year, gradeLevel, sectionName, gradeKey, sectionKey, assignment });
  });

  const operations = [];
  normalizeTeacherAssignmentsForStorage(previousAssignments).forEach((assignment) => {
    const year = fsNormalizeSchoolYear_(assignment.schoolYear);
    const gradeKey = fsNormalizeKey_(assignment.gradeLevel);
    const sectionKey = fsNormalizeKey_(assignment.section);
    if (!/^\d{4}-\d{4}$/.test(year) || wanted.has(`${year}/${gradeKey}/${sectionKey}`)) return;
    const teacherRef = fsGradesCollection_(year).doc(gradeKey)
      .collection(FS_PATHS.sections).doc(sectionKey)
      .collection(FS_PATHS.teachers).doc(userId);
    operations.push((batch) => batch.delete(teacherRef));
  });

  const teacherName = String(profile.name || "").trim();
  wanted.forEach(({ year, gradeLevel, sectionName, gradeKey, sectionKey, assignment }) => {
    const gradeRef = fsGradesCollection_(year).doc(gradeKey);
    const sectionRef = gradeRef.collection(FS_PATHS.sections).doc(sectionKey);
    operations.push((batch) => batch.set(gradeRef, {
      schoolYear: year,
      gradeLevel,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(sectionRef, {
      schoolYear: year,
      gradeLevel,
      section: sectionName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(sectionRef.collection(FS_PATHS.teachers).doc(userId), {
      teacherUid: userId,
      teacherName: String(assignment.teacherName || teacherName || "Teacher"),
      schoolYear: year,
      gradeLevel,
      section: sectionName,
      status: profile.status || "Active",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }));
  });

  for (let index = 0; index < operations.length; index += 400) {
    const batch = db.batch();
    operations.slice(index, index + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

function fsQueueTeacherAssignmentHistory_(batch, userRef, assignments, includeYears = []) {
  const history = fsTeacherAssignmentsByYear_(assignments);
  includeYears.forEach((yearValue) => {
    const year = fsNormalizeSchoolYear_(yearValue);
    if (/^\d{4}-\d{4}$/.test(year) && !history.has(year)) history.set(year, []);
  });
  history.forEach((yearAssignments, schoolYear) => {
    batch.set(userRef.collection(FS_PATHS.assignmentHistory).doc(schoolYear), {
      schoolYear,
      assignments: yearAssignments,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid || "",
    }, { merge: true });
  });
  return history.size;
}

async function fsWriteTeacherAssignmentHistory_(userRef, assignments) {
  const byYear = fsTeacherAssignmentsByYear_(assignments);
  const entries = [...byYear.entries()];
  for (let index = 0; index < entries.length; index += 450) {
    const batch = db.batch();
    entries.slice(index, index + 450).forEach(([schoolYear, yearAssignments]) => {
      batch.set(userRef.collection(FS_PATHS.assignmentHistory).doc(schoolYear), {
        schoolYear,
        assignments: yearAssignments,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      }, { merge: true });
    });
    await batch.commit();
  }
  return entries.length;
}

async function fsCopyTeacherAssignmentsForYear_(sourceYear, targetYear, targetSections) {
  const users = await db.collection(FS_USERS).get();
  const targetSectionsByKey = new Set(targetSections.map((section) =>
    `${fsNormalizeValue_(fsNormalizeGrade_(section.gradeLevel))}::${fsNormalizeValue_(section.section)}`));
  const copies = [];
  users.docs.forEach((doc) => {
    const profile = doc.data() || {};
    if (profile.role !== "Teacher") return;
    const assignments = fsTeacherAssignmentsFromProfile_(profile);
    const sourceAssignments = assignments.filter((assignment) => fsNormalizeSchoolYear_(assignment.schoolYear) === sourceYear);
    if (!sourceAssignments.length || assignments.some((assignment) => fsNormalizeSchoolYear_(assignment.schoolYear) === targetYear)) return;
    const newYearAssignments = sourceAssignments
      .filter((assignment) => targetSectionsByKey.has(
        `${fsNormalizeValue_(fsNormalizeGrade_(assignment.gradeLevel))}::${fsNormalizeValue_(assignment.section)}`))
      .map((assignment) => ({ ...assignment, schoolYear: targetYear }));
    if (!newYearAssignments.length) return;
    copies.push({
      ref: doc.ref,
      assignments: normalizeTeacherAssignmentsForStorage([...assignments, ...newYearAssignments]),
      newYearAssignments,
      previousAssignments: assignments,
      profile,
    });
  });
  for (let index = 0; index < copies.length; index += 200) {
    const batch = db.batch();
    copies.slice(index, index + 200).forEach(({ ref, assignments, newYearAssignments }) => {
      batch.set(ref, {
        teacherAssignments: assignments,
        teacherAssignment: newYearAssignments[0] || assignments[0] || null,
        teacherAssignmentSecurityKeys: teacherAssignmentSecurityKeys(assignments),
      }, { merge: true });
      batch.set(ref.collection(FS_PATHS.assignmentHistory).doc(targetYear), {
        schoolYear: targetYear,
        assignments: newYearAssignments,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      }, { merge: true });
    });
    await batch.commit();
  }
  await Promise.all(copies.map(({ ref, assignments, previousAssignments, profile }) =>
    fsSyncTeacherSectionLinks_(ref.id, { ...profile, teacherAssignments: assignments }, previousAssignments)));
  return {
    teachers: copies.length,
    assignments: copies.reduce((total, copy) => total + copy.newYearAssignments.length, 0),
  };
}

export async function fsAddUser(record) {
  let createdUser = null;
  let creationAuth = null;
  try {
    const email = String(record.email || "").trim();
    const password = String(record.password || "");
    if (!email || password.length < 6) throw new Error("A valid email and a password of at least 6 characters are required.");

    const normalizedEmail = email.toLowerCase();
    const existingUsers = await db.collection(FS_USERS).where("email", "==", normalizedEmail).limit(1).get();
    if (!existingUsers.empty) {
      throw new Error("A user with this email already exists in the directory.");
    }

    creationAuth = getUserCreationAuth();
    await creationAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    const credential = await creationAuth.createUserWithEmailAndPassword(email, password);
    createdUser = credential.user;
    const userId = createdUser.uid;
    const teacherAssignments = record.role === "Teacher" ? normalizeTeacherAssignmentsForStorage(record.teacherAssignments || (record.teacherAssignment ? [record.teacherAssignment] : [])) : [];
    const userRef = db.collection(FS_USERS).doc(userId);
    const userBatch = db.batch();
    userBatch.set(userRef, {
      name: record.name,
      email: normalizedEmail,
      role: record.role,
      status: record.status || "Invited",
      teacherAssignment: record.role === "Teacher" ? teacherAssignments[0] || null : null,
      teacherAssignments,
      teacherAssignmentSecurityKeys: teacherAssignmentSecurityKeys(teacherAssignments),
      teacherPrefs: fsNormalizeTeacherPrefs(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    fsQueueTeacherAssignmentHistory_(userBatch, userRef, teacherAssignments);
    await userBatch.commit();
    if (record.role === "Teacher") {
      await fsSyncTeacherSectionLinks_(userId, { name: record.name, status: record.status || "Invited", teacherAssignments });
    }
    try { await creationAuth.signOut(); } catch (signOutError) { /* Secondary auth cleanup is best effort. */ }
    fsInvalidateReadCaches_();
    fsAudit_("USER_ADD", { sheet: "users", recordId: userId, newValue: JSON.stringify({ name: record.name, email: normalizedEmail, role: record.role, status: record.status || "Invited", teacherAssignments: record.teacherAssignments || [] }) });
    return { userId };
  } catch (error) {
    if (createdUser) {
      try { await createdUser.delete(); } catch (deleteError) { console.error("Could not roll back Firebase user creation.", deleteError); }
    }
    try { await creationAuth?.signOut(); } catch (signOutError) { /* Preserve the original error. */ }
    if (error.code === "auth/email-already-in-use") throw new Error("That email already has a Firebase Authentication account.");
    if (error.code === "auth/weak-password") throw new Error("Firebase requires a stronger password.");
    if (error && error.message && error.message.includes("already exists")) throw new Error("A user with this email already exists in the directory.");
    throw fsError_("Add user", error);
  }
}

export async function fsUpdateUser(userId, record) {
  try {
    const ref = db.collection(FS_USERS).doc(userId);
    const before = await ref.get();
    const existingProfile = before.exists ? before.data() || {} : {};
    const existingAssignments = fsTeacherAssignmentsFromProfile_(existingProfile);
    const requestedAssignments = normalizeTeacherAssignmentsForStorage(record.teacherAssignments || (record.teacherAssignment ? [record.teacherAssignment] : []));
    let teacherAssignments = [];
    let assignmentsForHistory = existingAssignments;
    let assignmentHistoryYears = [];
    if (record.role === "Teacher") {
      const targetYear = fsNormalizeSchoolYear_(record.teacherAssignmentSchoolYear || requestedAssignments[0]?.schoolYear);
      if (!/^\d{4}-\d{4}$/.test(targetYear) || requestedAssignments.some((assignment) => assignment.schoolYear !== targetYear)) {
        throw new Error("Teacher assignments must belong to one selected school year.");
      }
      teacherAssignments = [
        ...existingAssignments.filter((assignment) => assignment.schoolYear !== targetYear),
        ...requestedAssignments,
      ];
      teacherAssignments = normalizeTeacherAssignmentsForStorage(teacherAssignments);
      assignmentsForHistory = teacherAssignments;
      assignmentHistoryYears = [targetYear];
    }
    const batch = db.batch();
    batch.set(ref, {
      name: record.name,
      email: record.email,
      role: record.role,
      status: record.status,
      teacherAssignment: teacherAssignments.find((assignment) => assignment.schoolYear === record.teacherAssignmentSchoolYear) || teacherAssignments[0] || null,
      teacherAssignments,
      teacherAssignmentSecurityKeys: teacherAssignmentSecurityKeys(teacherAssignments),
    }, { merge: true });
    fsQueueTeacherAssignmentHistory_(batch, ref, assignmentsForHistory, assignmentHistoryYears);
    await batch.commit();
    if (record.role === "Teacher" || existingProfile.role === "Teacher") {
      await fsSyncTeacherSectionLinks_(userId, {
        name: record.name || existingProfile.name,
        status: record.status || existingProfile.status,
        teacherAssignments,
      }, existingAssignments);
    }
    fsInvalidateReadCaches_();
    fsAudit_("USER_UPDATE", {
      sheet: "users", recordId: userId,
      oldValue: before.exists ? JSON.stringify(before.data()) : "",
      newValue: JSON.stringify(record),
    });
    return { updated: true };
  } catch (error) {
    throw fsError_("Update user", error);
  }
}

export async function fsUpdateMyProfileName(name) {
  const user = firebase.auth().currentUser;
  const value = String(name || "").trim();
  if (!user) throw new Error("Not signed in.");
  if (value.length < 2) throw new Error("Username must be at least 2 characters.");
  if (value.length > 80) throw new Error("Username must be 80 characters or fewer.");
  try {
    const ref = db.collection(FS_USERS).doc(user.uid);
    const before = await ref.get();
    await ref.update({ name: value });
    fsInvalidateReadCaches_();
    const merged = { ...(before.exists ? before.data() : {}), name: value, email: user.email || before.data()?.email || "", uid: user.uid || before.id, role: before.data()?.role || "School Staff" };
    fsAudit_("USER_UPDATE", { sheet: "users", recordId: user.uid, newValue: JSON.stringify(merged) });
    return merged;
  } catch (error) {
    throw fsError_("Update username", error);
  }
}

export function fsNormalizeTeacherPrefs(prefs = {}) {
  return normalizeUserPreferences(prefs);
}

export async function fsUpdateMyTeacherPrefs(prefs) {
  const user = firebase.auth().currentUser;
  if (!user?.uid) throw new Error("Not signed in.");
  if (!validUserPreferences(prefs)) {
    throw new Error("Invalid account preferences.");
  }
  const teacherPrefs = fsNormalizeTeacherPrefs(prefs);
  try {
    await db.collection(FS_USERS).doc(user.uid).update({ teacherPrefs });
    const currentProfile = storedAppProfile() || {};
    const nextProfile = { ...currentProfile, teacherPrefs };
    setAppUserProfile(nextProfile);
    try {
      sessionStorage.setItem("lps_user_profile", JSON.stringify(nextProfile));
    } catch (error) {
      console.warn("Could not cache account preferences for this session.", error);
    }
    return teacherPrefs;
  } catch (error) {
    throw fsError_("Update account preferences", error);
  }
}

export async function fsUpdateMyPhotoURL(photoURL) {
  const user = firebase.auth().currentUser;
  const value = String(photoURL || "").trim();
  if (!user?.uid) throw new Error("Not signed in.");
  if (value && (!/^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\//.test(value) || value.length > 2048)) {
    throw new Error("Invalid profile photo URL.");
  }
  try {
    await db.collection(FS_USERS).doc(user.uid).update({ photoURL: value });
    const currentProfile = storedAppProfile() || {};
    const nextProfile = { ...currentProfile, photoURL: value };
    setAppUserProfile(nextProfile);
    try {
      sessionStorage.setItem("lps_user_profile", JSON.stringify(nextProfile));
    } catch (error) {
      console.warn("Could not cache the profile photo for this session.", error);
    }
    return nextProfile;
  } catch (error) {
    throw fsError_("Update profile photo", error);
  }
}

export async function fsDeleteUser(userId) {
  if (!userId) throw new Error("A user ID is required.");
  if (auth.currentUser?.uid && userId === auth.currentUser.uid) {
    throw new Error("You cannot delete your own account. Ask another School Admin to remove it.");
  }
  try {
    const ref = db.collection(FS_USERS).doc(userId);
    const profile = await ref.get();
    if (profile.exists && profile.data()?.role === "Teacher") {
      await fsSyncTeacherSectionLinks_(userId, { teacherAssignments: [] }, fsTeacherAssignmentsFromProfile_(profile.data()));
    }
    await LPSApi.deleteAuthUsers([userId]);

    fsInvalidateReadCaches_();
    fsAudit_("USER_DELETE", { sheet: "users", recordId: userId, oldValue: JSON.stringify(profile.data() || {}) });
    return { deleted: true };
  } catch (error) {
    throw fsError_("Remove user", error);
  }
}

export async function fsDeleteUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) throw new Error("Select at least one user to remove.");
  if (auth.currentUser?.uid && userIds.includes(auth.currentUser.uid)) {
    throw new Error("You cannot delete your own account. Ask another School Admin to remove it.");
  }
  try {
    const profiles = await Promise.all(userIds.map((id) => db.collection(FS_USERS).doc(id).get()));
    await Promise.all(profiles.map((profile, index) => profile.exists && profile.data()?.role === "Teacher"
      ? fsSyncTeacherSectionLinks_(userIds[index], { teacherAssignments: [] }, fsTeacherAssignmentsFromProfile_(profile.data()))
      : Promise.resolve()));
    await LPSApi.deleteAuthUsers(userIds);
    const batch = db.batch();
    userIds.forEach((id) => batch.delete(db.collection(FS_USERS).doc(id)));
    await batch.commit();

    fsInvalidateReadCaches_();
    userIds.forEach((id, index) => fsAudit_("USER_DELETE", { sheet: "users", recordId: id, oldValue: JSON.stringify(profiles[index].data() || {}) }));
    return { deleted: userIds.length };
  } catch (error) {
    throw fsError_("Remove users", error);
  }
}

/** Live updates for the Manage Users table — shares one listener per browser tab and seeds the users cache. Returns an unsubscribe function. */
export function fsSubscribeUsers(onChange, onError) {
  const key = fsLiveKey_("users", "");
  return fsSubscribeLive_(key, () =>
    db.collection(FS_USERS).orderBy("name").onSnapshot(
      (snapshot) => fsLiveSet_(key, snapshot.docs.map((doc) => ({ userId: doc.id, ...doc.data() })), "firestore_users"),
      (error) => fsLiveError_(key, fsError_("Live user updates", error))
    ), onChange, onError);
}

// Swap the Sheets-backed implementations for the Firestore-backed ones.
// Every page keeps calling LPSApi.* exactly as before.
//
// This is exposed as an explicit function AND attempted at module load:
// - The module-load attempt covers the common (safe) import order, where
//   sheets-api has already finished evaluating before firestore-api's body
//   runs (e.g. pages that import firestore-api directly).
// - `initFirestoreApi()` is also called from main.tsx once every module has
//   loaded. That guarantees the overrides are installed on the login page
//   too — without dragging firestore-api into auth.ts, which would create a
//   sheets-api → shell → auth → firestore-api → sheets-api circular import
//   where LPSApi may not exist yet and the patch would silently be skipped
//   (or throw) depending on load order.
export function initFirestoreApi() {
  if (typeof LPSApi === "undefined" || typeof LPSApi.getMyProfile !== "function") return;
  LPSApi.getMyProfile = fsGetMyProfile;
  LPSApi.getUsers = fsGetUsers;
  LPSApi.addUser = fsAddUser;
  LPSApi.updateUser = fsUpdateUser;
  LPSApi.updateMyProfileName = fsUpdateMyProfileName;
  LPSApi.deleteUser = fsDeleteUser;
  LPSApi.deleteUsers = fsDeleteUsers;
}

if (typeof LPSApi !== "undefined") {
  try {
    initFirestoreApi();
  } catch (error) {
    // A cycle may still have LPSApi uninitialized; main.tsx calls
    // initFirestoreApi() again once every module has finished loading.
  }
}

/* ---------------------------------------------------------------------------
 * SCHOOL YEARS / SECTIONS / SETTINGS (small, low-write reference data —
 * cheap to keep live in Firestore so every page reflects the current school
 * year instantly instead of waiting on a Sheets round trip)
 * ------------------------------------------------------------------------- */

export async function fsGetSchoolYears() {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("schoolYears", "");
  if (Array.isArray(live)) return live;
  const load = async () => {
    const snapshot = await db.collection(FS_SCHOOL_YEARS).get();
    const years = snapshot.docs
      .map((doc) => ({ schoolYear: doc.id, ...doc.data() }))
      .filter((year) => String(year.schoolYear || "").trim())
      .sort((a, b) => fsSchoolYearSortValue_(b.schoolYear) - fsSchoolYearSortValue_(a.schoolYear));
    if (years.length) return years;
    const current = await fsGetSetting("currentSchoolYear");
    return current ? [{ schoolYear: String(current), isCurrent: true }] : [];
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad("firestore_school_years", load, 30000, 120000);
}

export async function fsGetCurrentSchoolYear() {
  const [years, configuredYear] = await Promise.all([
    fsGetSchoolYears(),
    fsGetSetting(FS_DOCUMENTS.currentSchoolYear),
  ]);
  const configured = fsNormalizeSchoolYear_(configuredYear);
  if (/^\d{4}-\d{4}$/.test(configured)) return configured;
  const current = years.find((year) => year.isCurrent)?.schoolYear || "";
  if (/^\d{4}-\d{4}$/.test(current)) return current;
  const latest = years[0]?.schoolYear || "";
  return /^\d{4}-\d{4}$/.test(latest) ? latest : "";
}

export async function fsGetParentCurrentSchoolYear() {
  const currentSetting = await parentDb.collection(FS_SETTINGS).doc(FS_DOCUMENTS.currentSchoolYear).get();
  const configured = fsNormalizeSchoolYear_(currentSetting.exists ? currentSetting.data()?.value : "");
  if (/^\d{4}-\d{4}$/.test(configured)) return configured;

  const snapshot = await parentDb.collection(FS_SCHOOL_YEARS).get();
  const years = snapshot.docs
    .map((doc) => ({ schoolYear: doc.id, ...doc.data() }))
    .filter((year) => /^\d{4}-\d{4}$/.test(fsNormalizeSchoolYear_(year.schoolYear)))
    .sort((a, b) => fsSchoolYearSortValue_(b.schoolYear) - fsSchoolYearSortValue_(a.schoolYear));
  const current = years.find((year) => year.isCurrent)?.schoolYear || "";
  return current || years[0]?.schoolYear || "";
}

/**
 * Returns the aggregate `publicStats/summary` document, or `null` when it
 * has not been created yet (e.g. a brand-new deployment, or a school year
 * that currently has zero learners and has never triggered a recompute).
 *
 * IMPORTANT: this intentionally never throws for a "not found" doc — a
 * missing aggregate is a normal, valid state (zero learners), not an error.
 * The null result is cached for the public-stat TTL too, avoiding repeated
 * missing-document reads. Genuine Firestore errors (network, permissions)
 * still reject the returned promise.
 */
export async function fsGetPublicStats() {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("publicStats", "summary");
  if (live) return live;
  const readStats = async () => {
    const snapshot = await db.collection(FS_PUBLIC_STATS).doc(FS_DOCUMENTS.publicStatsSummary).get();
    return snapshot.exists ? snapshot.data() : null;
  };
  if (typeof LPSCache === "undefined") return readStats();
  return LPSCache.getOrLoad("firestore_public_stats", readStats, PUBLIC_STATS_CACHE_TTL_MS, 3600000);
}

export async function fsGetPublicEnrollmentData() {
  const stats = await fsGetPublicStats();
  return (stats && stats.enrollmentData) || { schoolYear: stats?.schoolYear || "", rows: [], gradeTotals: [], grandTotal: { male: 0, female: 0, total: 0 } };
}

export function fsSubscribePublicStats(onChange, onError) {
  const key = fsLiveKey_("publicStats", "summary");
  return fsSubscribeLive_(key, () =>
    db.collection(FS_PUBLIC_STATS).doc(FS_DOCUMENTS.publicStatsSummary).onSnapshot(
      (snapshot) => fsLiveSet_(key, snapshot.exists ? snapshot.data() : null, "firestore_public_stats"),
      (error) => fsLiveError_(key, fsError_("Live public statistics", error))
    ), onChange, onError);
}

/** Live school-year metadata. Mirrors fsGetSchoolYears' shape (merged with the
 *  `currentSchoolYear` setting) and shares ONE Firestore listener per tab. */
export function fsSubscribeSchoolYears(onChange, onError) {
  const key = fsLiveKey_("schoolYears", "");
  return fsSubscribeLive_(key, () => {
    let years = [];
    let currentSetting = null;
    const emit = () => {
      let merged = [];
      if (years.length) merged = years;
      else if (currentSetting) merged = [{ schoolYear: String(currentSetting), isCurrent: true }];
      fsLiveSet_(key, merged, "firestore_school_years");
    };
    const unsubYears = db.collection(FS_SCHOOL_YEARS).onSnapshot(
      (snapshot) => {
        years = snapshot.docs
          .map((doc) => ({ schoolYear: doc.id, ...doc.data() }))
          .filter((year) => String(year.schoolYear || "").trim())
          .sort((a, b) => fsSchoolYearSortValue_(b.schoolYear) - fsSchoolYearSortValue_(a.schoolYear));
        emit();
      },
      (error) => fsLiveError_(key, fsError_("Live school years", error))
    );
    const unsubSetting = db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.currentSchoolYear).onSnapshot(
      (snapshot) => {
        currentSetting = snapshot.exists ? snapshot.data().value : null;
        emit();
      },
      (error) => fsLiveError_(key, fsError_("Live school years", error))
    );
    return () => { unsubYears(); unsubSetting(); };
  }, onChange, onError);
}

/** Live section directory for a school year — used by the enrollment page. */
export function fsSubscribeSections(schoolYear, onChange, onError) {
  const key = fsLiveKey_("sections", schoolYear);
  return fsSubscribeLive_(key, () => {
    let query = db.collectionGroup(FS_PATHS.sections);
    if (schoolYear) query = query.where("schoolYear", "==", String(schoolYear));
    return query.onSnapshot(
      async (snapshot) => {
        try {
          const sections = await Promise.all(snapshot.docs.map(async (doc) => {
            const data = doc.data();
            const teacherSnapshot = await doc.ref.collection(FS_PATHS.teachers).get();
            const teacher = teacherSnapshot.docs[0]?.data() || {};
            const gradeDoc = doc.ref.parent.parent;
            const gradeLevel = data.gradeLevel || gradeDoc?.id || "";
            const yearDoc = gradeDoc?.parent?.parent;
            const year = String(data.schoolYear || yearDoc?.id || schoolYear || "");
            return {
              ...data,
              schoolYear: year,
              gradeLevel,
              adviser: teacher.teacherName || teacher.name || data.adviser || "",
              teacherUid: teacherSnapshot.docs[0]?.id || "",
              id: fsSectionId_(year, gradeLevel, data.section || doc.id),
            };
          }));
          fsLiveSet_(key, sections, `firestore_sections_${schoolYear || "all"}`);
        } catch (error) {
          fsLiveError_(key, fsError_("Live sections", error));
        }
      },
      (error) => fsLiveError_(key, fsError_("Live sections", error))
    );
  }, onChange, onError);
}

export async function fsRefreshPublicStats() {
  const years = await fsGetSchoolYears();
  const current = years.find((year) => year.isCurrent) || years[0];
  const learnersByYear = await Promise.all(years.map((year) => fsGetAllLearners_(year.schoolYear)));
  const learners = current ? learnersByYear[years.findIndex((year) => year.schoolYear === current.schoolYear)] || [] : [];
  const programFields = ["is4Ps", "isIP", "isSNED", "isARAL", "isMuslim"];
  const gradeCounts = {};
  learners.forEach((learner) => {
    const grade = learner.gradeLevel || "—";
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
  });
  const taggedCount = learners.filter((learner) => programFields.some((field) => learner[field])).length;
  const enrollmentData = current ? await fsGetEnrollmentData(current.schoolYear, learners) : { schoolYear: "", rows: [], gradeTotals: [], grandTotal: { male: 0, female: 0, total: 0 } };
  const stats = {
    totalLearners: learners.length,
    programsTracked: programFields.filter((field) => learners.some((learner) => learner[field])).length,
    fourPsCount: learners.filter((learner) => learner.is4Ps).length,
    ipCount: learners.filter((learner) => learner.isIP).length,
    snedCount: learners.filter((learner) => learner.isSNED).length,
    aralCount: learners.filter((learner) => learner.isARAL).length,
    muslimCount: learners.filter((learner) => learner.isMuslim).length,
    maleCount: learners.filter((learner) => learner.gender === "Male").length,
    femaleCount: learners.filter((learner) => learner.gender === "Female").length,
    notTaggedCount: learners.length - taggedCount,
    gradeLevels: Object.entries(gradeCounts).map(([label, value]) => ({ label, value })),
    recentLearners: [],
    enrollmentData,
    schoolYear: current?.schoolYear || "",
    syncStatus: current ? "Live" : "Unavailable",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection(FS_PUBLIC_STATS).doc(FS_DOCUMENTS.publicStatsSummary).set(stats, { merge: true });
  if (typeof LPSCache !== "undefined") LPSCache.write("firestore_public_stats", stats, PUBLIC_STATS_CACHE_TTL_MS);
  return stats;
}

let fsPublicStatsRefreshTimer_ = null;

export function fsSchedulePublicStatsRefresh_() {
  if (fsPublicStatsRefreshTimer_) clearTimeout(fsPublicStatsRefreshTimer_);
  fsPublicStatsRefreshTimer_ = setTimeout(() => {
    fsPublicStatsRefreshTimer_ = null;
    void fsRefreshPublicStats().catch(() => {});
  }, 250);
}

export function fsPublicActive_(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT" && eosyStatus !== "dropped out" && !learner?.transferOut;
}

export function fsPublicMetricDelta_(before, after, field) {
  return Number(Boolean(fsPublicActive_(after) && after?.[field])) - Number(Boolean(fsPublicActive_(before) && before?.[field]));
}

export async function fsUpdatePublicStatsForChange_(schoolYear, before, after) {
  const ref = db.collection(FS_PUBLIC_STATS).doc(FS_DOCUMENTS.publicStatsSummary);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const stats = snapshot.data();
    if (stats.schoolYear && stats.schoolYear !== schoolYear) return;
    const fields = [["is4Ps", "fourPsCount"], ["isIP", "ipCount"], ["isSNED", "snedCount"], ["isARAL", "aralCount"], ["isMuslim", "muslimCount"]];
    const update = {};
    update.recentLearners = [];
    update.totalLearners = Number(stats.totalLearners || 0) + Number(fsPublicActive_(after)) - Number(fsPublicActive_(before));
    update.maleCount = Number(stats.maleCount || 0) + (fsPublicActive_(after) && after?.gender === "Male" ? 1 : 0) - (fsPublicActive_(before) && before?.gender === "Male" ? 1 : 0);
    update.femaleCount = Number(stats.femaleCount || 0) + (fsPublicActive_(after) && after?.gender === "Female" ? 1 : 0) - (fsPublicActive_(before) && before?.gender === "Female" ? 1 : 0);
    fields.forEach(([field, countField]) => { update[countField] = Number(stats[countField] || 0) + fsPublicMetricDelta_(before, after, field); });
    update.notTaggedCount = Math.max(0, update.totalLearners - fields.reduce((count, [, countField]) => count + Number(update[countField] || 0), 0));
    const gradeCounts = Object.fromEntries((stats.gradeLevels || []).map((item) => [item.label, Number(item.value || 0)]));
    if (fsPublicActive_(before) && before?.gradeLevel) gradeCounts[before.gradeLevel] = Math.max(0, (gradeCounts[before.gradeLevel] || 0) - 1);
    if (fsPublicActive_(after) && after?.gradeLevel) gradeCounts[after.gradeLevel] = (gradeCounts[after.gradeLevel] || 0) + 1;
    update.gradeLevels = Object.entries(gradeCounts).filter(([, value]) => value > 0).map(([label, value]) => ({ label, value }));
    const enrollmentData = stats.enrollmentData ? JSON.parse(JSON.stringify(stats.enrollmentData)) : null;
    if (enrollmentData?.rows) {
      const adjustRows = (learner, amount) => {
        if (!fsPublicActive_(learner)) return;
        const row = enrollmentData.rows.find((item) => item.gradeLevel === learner.gradeLevel && item.section === learner.section);
        if (!row) return;
        row[learner.gender === "Male" ? "male" : "female"] = Math.max(0, Number(row[learner.gender === "Male" ? "male" : "female"] || 0) + amount);
        row.total = Math.max(0, Number(row.total || 0) + amount);
      };
      adjustRows(before, -1);
      adjustRows(after, 1);
      enrollmentData.grandTotal = enrollmentData.rows.reduce((total, row) => ({ male: total.male + Number(row.male || 0), female: total.female + Number(row.female || 0), total: total.total + Number(row.total || 0) }), { male: 0, female: 0, total: 0 });
      update.enrollmentData = enrollmentData;
    }
    update.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    transaction.set(ref, update, { merge: true });
  });
  if (typeof LPSCache !== "undefined") LPSCache.remove("firestore_public_stats");
}

export function fsSchoolYearSortValue_(value) {
  const match = String(value || "").match(/(\d{4})\D+(\d{4})/);
  return match ? Number(match[1]) * 10000 + Number(match[2]) : 0;
}

export function fsNormalizeSchoolYear_(value) {
  const text = String(value || "").trim().replace(/[–—]/g, "-").replace(/\s+/g, "");
  const match = text.match(/^(\d{4})[-/]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : String(value || "").trim();
}

export async function fsCreateSchoolYear(schoolYear, makeCurrent = false, copyFromYear = "") {
  const normalized = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(normalized)) throw new Error("School year must use the format YYYY-YYYY.");
  const [startYear, endYear] = normalized.split("-").map(Number);
  if (endYear !== startYear + 1) throw new Error("School years must use consecutive years (for example, 2026-2027).");
  const knownYears = await fsGetSchoolYears();
  const latestStartYear = knownYears.reduce((latest, year) => {
    const parsedYear = Number(String(year.schoolYear || "").slice(0, 4));
    return Number.isFinite(parsedYear) ? Math.max(latest, parsedYear) : latest;
  }, 0);
  if (startYear <= latestStartYear) {
    throw new Error(`Create a school year after the latest configured year (${knownYears[0]?.schoolYear || "none"}).`);
  }
  const existing = await db.collection(FS_SCHOOL_YEARS).doc(normalized).get();
  if (existing.exists) throw new Error(`School year ${normalized} already exists.`);
  const currentYear = knownYears.find((year) => year.isCurrent)?.schoolYear || "";
  let copiedSections = 0;
  let copiedCurriculumGrades = 0;
  let copiedGradingLevels = 0;
  let copiedTeacherAssignments = 0;
  const sourceYear = fsNormalizeSchoolYear_(copyFromYear || currentYear);
  if (sourceYear && sourceYear !== normalized) {
    const source = await fsGetSections(sourceYear);
    if (source.length) {
      await Promise.all(source.map((section) => fsSaveSection({
        schoolYear: normalized,
        gradeLevel: section.gradeLevel,
        section: section.section,
        adviser: "",
      })));
      copiedSections = source.length;
    }
    const targetSections = await fsGetSections(normalized);
    const [sourceCurriculum, sourceTermCount, sourcePassingThreshold] = await Promise.all([
      fsGetGradeSubjectAssignments(sourceYear),
      fsGetGradeTermCount(sourceYear),
      fsGetPassingThreshold(sourceYear),
    ]);
    const configuredGrades = Object.entries(sourceCurriculum.grades).filter(([, grade]) => grade.configured);
    await Promise.all(configuredGrades.map(([gradeLevel, grade]) =>
      fsSaveGradeSubjectAssignment(normalized, gradeLevel, grade.subjectIds)));
    copiedCurriculumGrades = configuredGrades.length;
    await fsSetGradeTermCount(sourceTermCount, normalized);
    await fsSetPassingThreshold(sourcePassingThreshold, normalized);
    copiedGradingLevels = await fsCopyGradeLevelGradingConfigurations(sourceYear, normalized);
    const copiedAssignments = await fsCopyTeacherAssignmentsForYear_(sourceYear, normalized, targetSections);
    copiedTeacherAssignments = copiedAssignments.assignments;
  }
  await db.collection(FS_SCHOOL_YEARS).doc(normalized).set({ schoolYear: normalized, isCurrent: false }, { merge: true });
  const rollover = makeCurrent ? await fsSetCurrentSchoolYear(normalized) : { resetTeacherAssignments: 0, preservedTeacherAssignments: 0 };
  fsInvalidateReadCaches_();
  fsAudit_("SCHOOL_YEAR_ADD", { sheet: "schoolYears", recordId: normalized, newValue: JSON.stringify({ schoolYear: normalized, sourceYear, copiedSections, copiedCurriculumGrades, copiedGradingLevels, copiedTeacherAssignments }) });
  return { schoolYear: normalized, isCurrent: Boolean(makeCurrent), copiedSections, copiedCurriculumGrades, copiedGradingLevels, copiedTeacherAssignments, ...rollover };
}

export async function fsSetCurrentSchoolYear(schoolYear) {
  const normalized = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(normalized)) throw new Error("School year must use the format YYYY-YYYY.");
  const target = await db.collection(FS_SCHOOL_YEARS).doc(normalized).get();
  if (!target.exists) throw new Error(`School year ${normalized} was not found.`);

  const years = await db.collection(FS_SCHOOL_YEARS).get();
  const currentSetting = await db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.currentSchoolYear).get();
  const alreadyCurrent = target.data()?.isCurrent === true
    && currentSetting.exists
    && currentSetting.data()?.value === normalized;
  let teacherProfiles = [];
  let preservedTeacherAssignments = 0;
  if (!alreadyCurrent) {
    const users = await db.collection(FS_USERS).get();
    teacherProfiles = users.docs.filter((doc) => {
      const profile = doc.data() || {};
      return profile.role === "Teacher";
    });
    for (const doc of teacherProfiles) {
      const assignments = fsTeacherAssignmentsFromProfile_(doc.data() || {});
      preservedTeacherAssignments += assignments.length;
      await fsWriteTeacherAssignmentHistory_(doc.ref, assignments);
    }
    for (let index = 0; index < teacherProfiles.length; index += 450) {
      const assignmentBatch = db.batch();
      teacherProfiles.slice(index, index + 450).forEach((doc) => {
        assignmentBatch.set(doc.ref, { activeSchoolYear: normalized }, { merge: true });
      });
      await assignmentBatch.commit();
    }
  }

  const batch = db.batch();
  years.docs.forEach((doc) => batch.set(doc.ref, { isCurrent: doc.id === normalized }, { merge: true }));
  batch.set(db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.currentSchoolYear), { value: normalized }, { merge: true });
  await batch.commit();
  fsInvalidateReadCaches_();
  if (!alreadyCurrent) fsAudit_("SCHOOL_YEAR_CURRENT", { sheet: "schoolYears", recordId: normalized, oldValue: JSON.stringify({ schoolYear: currentSetting.data()?.value || "" }), newValue: JSON.stringify({ schoolYear: normalized, preservedTeacherAssignments }) });
  return { schoolYear: normalized, isCurrent: true, resetTeacherAssignments: 0, preservedTeacherAssignments };
}

export async function fsGetSections(schoolYear) {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("sections", schoolYear);
  if (Array.isArray(live)) return live;
  const load = async () => {
    const years = schoolYear ? [String(schoolYear)] : (await fsGetSchoolYears()).map((year) => year.schoolYear);
    const sectionsByYear = await Promise.all(years.map(async (year) => {
      const grades = await fsGradesCollection_(year).get();
      return Promise.all(grades.docs.map(async (gradeDoc) => {
        const gradeData = gradeDoc.data() || {};
        const sectionSnapshot = await gradeDoc.ref.collection(FS_PATHS.sections).get();
        return Promise.all(sectionSnapshot.docs.map(async (sectionDoc) => {
          const data = sectionDoc.data() || {};
          const teachers = await sectionDoc.ref.collection(FS_PATHS.teachers).get();
          const teacher = teachers.docs[0]?.data() || {};
          return {
            ...data,
            schoolYear: year,
            gradeLevel: data.gradeLevel || gradeData.gradeLevel || "",
            adviser: teacher.teacherName || teacher.name || data.adviser || "",
            teacherUid: teachers.docs[0]?.id || "",
            id: fsSectionId_(year, data.gradeLevel || gradeData.gradeLevel, data.section || sectionDoc.id),
          };
        }));
      }));
    }));
    return sectionsByYear.flat(2);
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad(`firestore_sections_${schoolYear || "all"}`, load, 30000, 120000);
}

export async function fsGetGradeSubjectAssignments(schoolYear) {
  const year = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to load curriculum subjects.");
  const load = async () => {
    const [snapshot, subjects] = await Promise.all([
      fsGradesCollection_(year).get(),
      fsGetCurriculumSubjectPool(),
    ]);
    const grades = {};
    snapshot.docs.forEach((document) => {
      const data = document.data();
      const gradeLevel = normalizeCurriculumGrade(data.gradeLevel);
      if (!CURRICULUM_GRADE_LEVELS.includes(gradeLevel)) return;
      grades[gradeLevel] = {
        configured: data.subjectsConfigured === true,
        subjectIds: normalizeCurriculumSubjectIds(data.subjectIds, subjects),
      };
    });
    return { schoolYear: year, grades, subjects };
  };
  const result = typeof LPSCache === "undefined"
    ? load()
    : LPSCache.getOrLoad(`firestore_curriculum_subjects_${year}`, load, 15000);
  const [curriculum, subjects] = await Promise.all([result, fsGetCurriculumSubjectPool()]);
  return { ...curriculum, subjects };
}

export async function fsGetCurriculumSubjectPool() {
  const load = async () => {
    const snapshot = await db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.curriculumSubjectPool).get();
    return normalizeCurriculumSubjectPool(snapshot.exists ? snapshot.data()?.subjects : CURRICULUM_SUBJECTS);
  };
  const subjects = typeof LPSCache === "undefined"
    ? load()
    : await LPSCache.getOrLoad("firestore_curriculum_subject_pool", load, 60000);
  FS_DYNAMIC_CURRICULUM_SUBJECT_IDS = subjects
    .map(({ id }) => id)
    .filter((id) => !FS_LEARNER_FIELD_ORDER.includes(id));
  return subjects;
}

export async function fsAddCurriculumSubject(label) {
  const candidate = curriculumSubjectIdFromLabel(label);
  if (!candidate || candidate.label.length > 80) {
    throw new Error("Enter a subject name between 1 and 80 characters.");
  }
  const ref = db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.curriculumSubjectPool);
  let subjects;
  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const currentSubjects = normalizeCurriculumSubjectPool(snapshot.exists ? snapshot.data()?.subjects : CURRICULUM_SUBJECTS);
      const duplicate = currentSubjects.find(({ id, label: existingLabel }) =>
        id.toLowerCase() === candidate.id.toLowerCase()
        || existingLabel.toLowerCase() === candidate.label.toLowerCase()
      );
      if (duplicate) throw new Error(`“${duplicate.label}” is already in the shared subject pool.`);
      subjects = [...currentSubjects, candidate];
      transaction.set(ref, {
        subjects,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      }, { merge: true });
    });
  } catch (error) {
    throw fsError_("Adding curriculum subject", error);
  }
  if (typeof LPSCache !== "undefined") {
    LPSCache.remove("firestore_curriculum_subject_pool");
    LPSCache.clear("firestore_curriculum_subjects_");
  }
  FS_DYNAMIC_CURRICULUM_SUBJECT_IDS = subjects
    .map(({ id }) => id)
    .filter((id) => !FS_LEARNER_FIELD_ORDER.includes(id));
  fsAudit_("CURRICULUM_SUBJECT_ADD", { sheet: "settings", recordId: candidate.id, newValue: JSON.stringify({ subjectId: candidate.id, label: candidate.label }) });
  return { subject: candidate, subjects };
}

export async function fsRemoveCurriculumSubject(subjectId) {
  if (!isCustomCurriculumSubjectId(subjectId)) {
    throw new Error("Only custom curriculum subjects can be removed.");
  }
  const ref = db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.curriculumSubjectPool);
  let removedSubject;
  let subjects;
  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const currentSubjects = normalizeCurriculumSubjectPool(snapshot.exists ? snapshot.data()?.subjects : CURRICULUM_SUBJECTS);
      removedSubject = currentSubjects.find(({ id }) => id === subjectId);
      if (!removedSubject || !isCustomCurriculumSubjectId(removedSubject.id)) {
        throw new Error("The custom subject was not found in the shared subject pool.");
      }
      subjects = currentSubjects.filter(({ id }) => id !== subjectId);
      transaction.set(ref, {
        subjects,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      }, { merge: true });
    });
  } catch (error) {
    throw fsError_("Removing curriculum subject", error);
  }
  if (typeof LPSCache !== "undefined") {
    LPSCache.remove("firestore_curriculum_subject_pool");
    LPSCache.clear("firestore_curriculum_subjects_");
  }
  FS_DYNAMIC_CURRICULUM_SUBJECT_IDS = subjects
    .map(({ id }) => id)
    .filter((id) => !FS_LEARNER_FIELD_ORDER.includes(id));
  fsAudit_("CURRICULUM_SUBJECT_DELETE", { sheet: "settings", recordId: subjectId, oldValue: JSON.stringify({ subjectId, label: removedSubject.label }) });
  return { subject: removedSubject, subjects };
}

export async function fsSaveGradeSubjectAssignment(schoolYear, gradeLevel, subjectIds) {
  const year = fsNormalizeSchoolYear_(schoolYear);
  const grade = normalizeCurriculumGrade(gradeLevel);
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to save curriculum subjects.");
  if (!CURRICULUM_GRADE_LEVELS.includes(grade)) throw new Error("Choose a supported grade level.");
  if (!Array.isArray(subjectIds) || subjectIds.some((id) => typeof id !== "string")) {
    throw new Error("Curriculum subjects must be a list of subject IDs.");
  }
  const subjects = await fsGetCurriculumSubjectPool();
  const normalizedSubjectIds = normalizeCurriculumSubjectIds(subjectIds, subjects);
  if (normalizedSubjectIds.length !== new Set(subjectIds).size) {
    throw new Error("One or more selected subjects are not in the approved subject pool.");
  }
  const gradeRef = fsGradesCollection_(year).doc(fsNormalizeKey_(grade));
  const before = await gradeRef.get();
  try {
    await gradeRef.set({
      schoolYear: year,
      gradeLevel: grade,
      subjectsConfigured: true,
      subjectIds: normalizedSubjectIds,
      curriculumSchemaVersion: 1,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid || "",
    }, { merge: true });
  } catch (error) {
    throw fsError_("Saving curriculum subjects", error);
  }
  if (typeof LPSCache !== "undefined") LPSCache.remove(`firestore_curriculum_subjects_${year}`);
  fsInvalidateReadCaches_(year);
  fsAudit_("CURRICULUM_UPDATE", { sheet: "schoolYears", recordId: `${year}|${grade}`, oldValue: JSON.stringify({ subjectIds: before.data()?.subjectIds || [] }), newValue: JSON.stringify({ schoolYear: year, gradeLevel: grade, subjectIds: normalizedSubjectIds }) });
  return { schoolYear: year, gradeLevel: grade, subjectIds: normalizedSubjectIds, configured: true };
}

export function fsSectionId_(schoolYear, gradeLevel, section, adviser = "") {
  return `${schoolYear}|${fsNormalizeKey_(gradeLevel)}|${fsNormalizeKey_(section)}`;
}

export async function fsSaveSection(section) {
  const schoolYear = fsNormalizeSchoolYear_(section.schoolYear);
  const gradeLevel = fsNormalizeGrade_(section.gradeLevel);
  const sectionName = String(section.section || "").trim();
  const adviser = String(section.adviser || "").trim();
  if (!/^\d{4}-\d{4}$/.test(schoolYear) || !gradeLevel || !sectionName) throw new Error("School year, grade level, and section name are required.");
  const gradeRef = fsGradesCollection_(schoolYear).doc(fsNormalizeKey_(gradeLevel));
  const sectionRef = gradeRef.collection(FS_PATHS.sections).doc(fsNormalizeKey_(sectionName));
  const oldLocation = String(section.id || "").split("|");
  const oldGradeKey = oldLocation[1] || "";
  const oldSectionKey = oldLocation[2] || "";
  const before = await (section.id ? fsGradesCollection_(schoolYear).doc(oldGradeKey).collection(FS_PATHS.sections).doc(oldSectionKey) : sectionRef).get();
  if (section.id) {
    if (oldGradeKey && oldSectionKey &&
      (oldGradeKey !== fsNormalizeKey_(gradeLevel) || oldSectionKey !== fsNormalizeKey_(sectionName))) {
      const oldSectionRef = fsGradesCollection_(schoolYear).doc(oldGradeKey).collection(FS_PATHS.sections).doc(oldSectionKey);
      const oldTeachers = await oldSectionRef.collection(FS_PATHS.teachers).get();
      const batch = db.batch();
      oldTeachers.docs.forEach((teacherDoc) => batch.delete(teacherDoc.ref));
      batch.delete(oldSectionRef);
      await batch.commit();
    }
  }
  await gradeRef.set({ schoolYear, gradeLevel, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await sectionRef.set({ schoolYear, gradeLevel, section: sectionName, adviser, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  if (adviser) {
    const matchingTeachers = await db.collection(FS_USERS).where("name", "==", adviser).limit(1).get();
    if (!matchingTeachers.empty) {
      const teacherDoc = matchingTeachers.docs[0];
      await sectionRef.collection(FS_PATHS.teachers).doc(teacherDoc.id).set({
        teacherUid: teacherDoc.id,
        teacherName: adviser,
        schoolYear,
        gradeLevel,
        section: sectionName,
        status: teacherDoc.data()?.status || "Active",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
  fsInvalidateReadCaches_(schoolYear);
  fsAudit_(before.exists ? "SECTION_UPDATE" : "SECTION_ADD", { sheet: "sections", recordId: fsSectionId_(schoolYear, gradeLevel, sectionName), oldValue: JSON.stringify(before.data() || {}), newValue: JSON.stringify({ schoolYear, gradeLevel, section: sectionName, adviser }) });
  return { id: fsSectionId_(schoolYear, gradeLevel, sectionName), schoolYear, gradeLevel, section: sectionName, adviser };
}

export async function fsDeleteSection(sectionId) {
  if (!sectionId) throw new Error("A section ID is required.");
  const [schoolYear, gradeKey, sectionKey] = String(sectionId).split("|");
  if (!schoolYear || !gradeKey || !sectionKey) throw new Error("Invalid section ID.");
  const sectionRef = fsGradesCollection_(schoolYear).doc(gradeKey).collection(FS_PATHS.sections).doc(sectionKey);
  const before = await sectionRef.get();
  const teachers = await sectionRef.collection(FS_PATHS.teachers).get();
  const batch = db.batch();
  teachers.docs.forEach((teacherDoc) => batch.delete(teacherDoc.ref));
  batch.delete(sectionRef);
  await batch.commit();
  fsInvalidateReadCaches_(schoolYear);
  if (before.exists) fsAudit_("SECTION_DELETE", { sheet: "sections", recordId: sectionId, oldValue: JSON.stringify(before.data()) });
  return { deleted: true };
}

export function fsNormalizeGrade_(value) {
  const text = String(value || "").trim();
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(key)) return "Kinder";
  const match = key.match(/^grade\s*(\d+)$/) || key.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

export function fsNormalizeValue_(value) {
  return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " ");
}

export async function fsGetEnrollmentData(schoolYear, learnersOverride = null) {
  const [sections, learners] = await Promise.all([fsGetSections(schoolYear), learnersOverride || fsGetLearners(schoolYear)]);
  const sectionMap = new Map();
  sections.forEach((section) => {
    if (section.schoolYear && fsNormalizeValue_(section.schoolYear) !== fsNormalizeValue_(schoolYear)) return;
    const gradeLevel = fsNormalizeGrade_(section.gradeLevel);
    const sectionName = String(section.section || "").trim();
    if (!gradeLevel || !sectionName) return;
    sectionMap.set(`${fsNormalizeValue_(gradeLevel)}|${fsNormalizeValue_(sectionName)}`, {
      schoolYear,
      gradeLevel,
      section: sectionName,
      adviser: String(section.adviser || section.teacher || "").trim(),
    });
  });
  const counts = new Map();
  learners.forEach((learner) => {
    if (String(learner.enrollmentStatus || "ACTIVE").toUpperCase() === "TRANSFERRED_OUT" || learner.transferOut) return;
    const gradeLevel = fsNormalizeGrade_(learner.gradeLevel);
    const sectionName = String(learner.section || "").trim();
    if (!gradeLevel || !sectionName) return;
    const key = `${fsNormalizeValue_(gradeLevel)}|${fsNormalizeValue_(sectionName)}`;
    const count = counts.get(key) || { male: 0, female: 0, total: 0 };
    count.total += 1;
    if (fsNormalizeValue_(learner.gender) === "male") count.male += 1;
    if (fsNormalizeValue_(learner.gender) === "female") count.female += 1;
    counts.set(key, count);
  });
  const rows = [...sectionMap.entries()].map(([key, section]) => ({ ...section, ...(counts.get(key) || { male: 0, female: 0, total: 0 }) }));
  const gradeOrder = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
  rows.sort((a, b) => (gradeOrder.indexOf(a.gradeLevel) - gradeOrder.indexOf(b.gradeLevel)) || a.section.localeCompare(b.section));
  const gradeTotals = gradeOrder.map((gradeLevel) => {
    const gradeRows = rows.filter((row) => row.gradeLevel === gradeLevel);
    return {
      gradeLevel,
      male: gradeRows.reduce((sum, row) => sum + row.male, 0),
      female: gradeRows.reduce((sum, row) => sum + row.female, 0),
      total: gradeRows.reduce((sum, row) => sum + row.total, 0),
    };
  }).filter((row) => row.total > 0 || rows.some((item) => item.gradeLevel === row.gradeLevel));
  const grandTotal = gradeTotals.reduce((total, row) => ({
    male: total.male + row.male,
    female: total.female + row.female,
    total: total.total + row.total,
  }), { male: 0, female: 0, total: 0 });
  return { schoolYear, rows, gradeTotals, grandTotal };
}

export async function fsSyncEnrollmentData(schoolYear) {
  const result = await fsGetEnrollmentData(schoolYear);
  return { updated: 0, skipped: result.rows.length, schoolYear: result.schoolYear };
}

export function fsLearnerName_(learner) {
  return formatLearnerName(learner);
}

export function fsBmi_(height, weight) {
  const heightMeters = Number(height) / 100;
  const kilograms = Number(weight);
  return heightMeters > 0 && kilograms > 0 ? Math.round((kilograms / (heightMeters * heightMeters)) * 100) / 100 : "";
}

export function fsProfileChange_(learner, fields) {
  const values = fields.map((field) => learner[field]);
  if (!values[0] && !values[1] && !values[2]) return "No change recorded";
  if (values[2] && values[0] && values[2] !== values[0]) return `${values[0]} → ${values[2]}`;
  return "Profile recorded";
}

export async function fsGetNutritionStatus(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => ({
    ...learner,
    name: fsLearnerName_(learner),
    bosyBmi: fsBmi_(learner.bosyHeight, learner.bosyWeight),
    mosyBmi: fsBmi_(learner.mosyHeight, learner.mosyWeight),
    eosyBmi: fsBmi_(learner.eosyHeight, learner.eosyWeight),
    heightChange: Number(learner.eosyHeight) && Number(learner.bosyHeight) ? Number(learner.eosyHeight) - Number(learner.bosyHeight) : null,
    weightChange: Number(learner.eosyWeight) && Number(learner.bosyWeight) ? Number(learner.eosyWeight) - Number(learner.bosyWeight) : null,
    statusChange: fsProfileChange_(learner, ["bosyNutritionalStatus", "mosyNutritionalStatus", "eosyNutritionalStatus"]),
  }));
}

export async function fsGetReadingProfiles(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => {
    const hasCrla = learner.bosyCRLA || learner.mosyCRLA || learner.eosyCRLA;
    const hasPhilIri = learner.bosyPhilIRI || learner.mosyPhilIRI || learner.eosyPhilIRI;
    const prefix = hasCrla ? "CRLA" : "Phil-IRI";
    const fields = hasCrla ? ["bosyCRLA", "mosyCRLA", "eosyCRLA"] : ["bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI"];
    return {
      ...learner, name: fsLearnerName_(learner), reference: prefix,
      bosy: learner[fields[0]] || "", mosy: learner[fields[1]] || "", eosy: learner[fields[2]] || "",
      change: fsProfileChange_(learner, fields),
    };
  }).filter((learner) => learner.bosy || learner.mosy || learner.eosy);
}

export async function fsGetMathProfiles(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => ({
    ...learner, name: fsLearnerName_(learner),
    bosy: learner.bosyRMA || "", mosy: learner.mosyRMA || "", eosy: learner.eosyRMA || "",
    change: fsProfileChange_(learner, ["bosyRMA", "mosyRMA", "eosyRMA"]),
  })).filter((learner) => learner.bosy || learner.mosy || learner.eosy);
}

export async function fsGetGradesProfiles(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => ({ ...learner, name: fsLearnerName_(learner) }));
}

export async function fsGetTransferRecords(schoolYear, type = "all", gradeLevel = "", gender = "") {
  const assignments = fsTeacherAssignmentsForSchoolYear_(schoolYear);
  // Teachers only ever see their own assigned grade-sections (from
  // users/{uid}.teacherAssignments); a teacher with no coverage for this
  // school year gets an explicit empty scope, never a school-wide read
  // (which the security rules reject for teachers).
  if (isTeacher() && !assignments.length) return [];
  const [activeSnapshot, archivedSnapshot] = await Promise.all([
    assignments.length
      ? Promise.all(assignments.map((assignment) => fsLearnersCollection_(schoolYear)
          .where("gradeLevel", "==", assignment.gradeLevel)
          .where("section", "==", assignment.section)
          .get())).then((snapshots) => snapshots.flatMap((snapshot) =>
        snapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() }))
      ))
      : fsLearnersCollection_(schoolYear).get().then((snapshot) => snapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() }))),
    fsArchiveCollection_("transferredOut", schoolYear).get(),
  ]);
  const learners = [
    ...activeSnapshot.map((learner) => ({ ...learner, schoolYear })),
    ...archivedSnapshot.docs.map((doc) => ({ learnerId: doc.id, schoolYear, ...doc.data() })),
  ];
  const scopedLearners = assignments.length
    ? learners.filter((learner) => assignments.some((assignment) => fsNormalizeValue_(learner.gradeLevel) === fsNormalizeValue_(assignment.gradeLevel)
      && fsNormalizeValue_(learner.section) === fsNormalizeValue_(assignment.section)))
    : learners;
  const normalizedType = String(type || "all").trim().toLowerCase();
  const requestedType = normalizedType === "in" || normalizedType === "transfer in" ? "Transfer In"
    : normalizedType === "out" || normalizedType === "transfer out" ? "Transfer Out" : "";
  const seen = new Set();
  return scopedLearners.filter((learner) => {
    const transferType = learner.transferType || (learner.transferIn ? "Transfer In" : learner.transferOut ? "Transfer Out" : "");
    const uniqueKey = `${learner.learnerId}|${transferType}`;
    if (!transferType || seen.has(uniqueKey)) return false;
    seen.add(uniqueKey);
    return (!requestedType || transferType === requestedType)
      && (!gradeLevel || fsNormalizeGrade_(learner.gradeLevel) === fsNormalizeGrade_(gradeLevel))
      && (!gender || fsNormalizeValue_(learner.gender) === fsNormalizeValue_(gender));
  }).map((learner) => ({ ...learner, name: fsLearnerName_(learner), transferType: learner.transferType || (learner.transferIn ? "Transfer In" : "Transfer Out") }));
}

export async function fsGetArchiveRecords(archive, schoolYear) {
  const archiveName = String(archive || "").toLowerCase();
  const snapshot = await fsArchiveCollection_(archiveName, schoolYear).get();
  const records = snapshot.docs.map((doc) => ({ learnerId: doc.id, schoolYear, ...doc.data() }));
  const assignments = fsTeacherAssignmentsForSchoolYear_(schoolYear);
  // Teachers only ever see their own assigned grade-sections (from
  // users/{uid}.teacherAssignments); a teacher with no coverage for this
  // school year gets an explicit empty scope, never a school-wide read
  // (which the security rules reject for teachers).
  if (isTeacher() && !assignments.length) return [];
  const scopedRecords = assignments.length
    ? records.filter((record) => assignments.some((assignment) => fsNormalizeValue_(record.gradeLevel) === fsNormalizeValue_(assignment.gradeLevel)
      && fsNormalizeValue_(record.section) === fsNormalizeValue_(assignment.section)))
    : records;
  if (archiveName !== "dropout") return scopedRecords;
  // Compatibility for records tagged before archive transitions were added:
  // they live in the ACTIVE Learners collection but still carry dropout flags,
  // so the scoped query must NOT filter by "active" (fsIsActiveLearner_).
  const activeSnapshot = assignments.length
    ? (await Promise.all(assignments.map((assignment) => fsLearnersCollection_(schoolYear)
        .where("gradeLevel", "==", assignment.gradeLevel)
        .where("section", "==", assignment.section)
        .get()))).flatMap((snapshot) => snapshot.docs)
    : (await fsLearnersCollection_(schoolYear).get()).docs;
  const legacyDropouts = activeSnapshot
    .map((doc) => ({ learnerId: doc.id, schoolYear, ...doc.data() }))
    .filter((learner) => fsLearnerArchiveType_(learner) === "dropout");
  const scopedLegacyDropouts = assignments.length
    ? legacyDropouts.filter((record) => assignments.some((assignment) => fsNormalizeValue_(record.gradeLevel) === fsNormalizeValue_(assignment.gradeLevel)
      && fsNormalizeValue_(record.section) === fsNormalizeValue_(assignment.section)))
    : legacyDropouts;
  const seen = new Set(scopedRecords.map((record) => record.learnerId));
  return scopedRecords.concat(scopedLegacyDropouts.filter((record) => !seen.has(record.learnerId)));
}

export async function fsUpdateArchiveRecord(archive, schoolYear, learnerId, learner) {
  const archiveName = String(archive || "").toLowerCase();
  const collection = archiveName === "learners" ? fsLearnersCollection_(schoolYear) : fsArchiveCollection_(archiveName, schoolYear);
  const ref = collection.doc(learnerId);
  const before = await ref.get();
  if (!before.exists) throw new Error("Archived learner record was not found.");
  const update = { ...fsCanonicalLearner_(learner), schoolYear };
  await ref.set(update, { merge: true });
  fsInvalidateReadCaches_(schoolYear);
  void fsUpdatePublicStatsForChange_(schoolYear, {}, {}).catch(() => {});
  fsAudit_("LEARNER_UPDATE", { sheet: `${archiveName}_${schoolYear}`, recordId: learnerId, oldValue: JSON.stringify(before.data()), newValue: JSON.stringify(learner) });
  return { updated: true };
}

export async function fsDeleteArchiveRecord(archive, schoolYear, learnerId) {
  const archiveName = String(archive || "").toLowerCase();
  if (archiveName === "learners") return fsDeleteLearner(schoolYear, learnerId);
  const collection = fsArchiveCollection_(archiveName, schoolYear);
  const ref = collection.doc(String(learnerId || "").trim());
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("This archived learner was already removed or could not be found.");
    await fsMoveLearnerToTrash_(String(schoolYear || "").trim(), archiveName === "dropout" ? FS_DROPOUTS : FS_TRANSFERRED_OUT, learnerId);
    fsInvalidateReadCaches_(schoolYear);
    await fsRefreshPublicStats();
    fsAudit_("LEARNER_DELETE", { sheet: `${archiveName}_${schoolYear}`, recordId: learnerId, oldValue: JSON.stringify(snapshot.data()) });
    return { deleted: true };
  } catch (error) {
    throw fsError_("Remove archived learner", error);
  }
}

export async function fsCancelLearnerMovement(archive, schoolYear, learnerId) {
  const archiveName = String(archive || "").trim().toLowerCase();
  const year = String(schoolYear || "").trim();
  const id = String(learnerId || "").trim();
  if (!year) throw new Error("A school year is required to restore this learner.");
  if (!id) throw new Error("A learner ID is required to restore this learner.");
  if (!["learners", "dropout", "transferredout"].includes(archiveName)) {
    throw new Error("Unsupported learner movement record.");
  }

  const learnerRef = fsLearnersCollection_(year).doc(id);
  const sourceRef = archiveName === "learners"
    ? learnerRef
    : fsArchiveCollection_(archiveName, year).doc(id);
  const resetMovementFields = {
    enrollmentStatus: "ACTIVE",
    eosyStatus: "",
    transferType: "",
    transferIn: false,
    transferOut: false,
    transferSchool: "",
    transferDate: "",
    transferReason: "",
    transferNotes: "",
    learnerId: id,
    schoolYear: year,
  };

  try {
    const sourceSnapshot = await sourceRef.get();
    if (!sourceSnapshot.exists) throw new Error("This learner movement record was not found.");

    if (archiveName === "learners") {
      await learnerRef.set({ ...sourceSnapshot.data(), ...resetMovementFields });
    } else {
      const activeSnapshot = await learnerRef.get();
      const restoredLearner = {
        ...sourceSnapshot.data(),
        ...(activeSnapshot.exists ? activeSnapshot.data() : {}),
        ...resetMovementFields,
      };
      const batch = db.batch();
      batch.set(learnerRef, restoredLearner);
      batch.delete(sourceRef);
      await batch.commit();
    }

    fsInvalidateReadCaches_(year);
    fsSchedulePublicStatsRefresh_();
    fsAudit_("LEARNER_MOVEMENT_CANCEL", {
      sheet: `${archiveName}_${year}`,
      recordId: id,
      oldValue: JSON.stringify(sourceSnapshot.data()),
      newValue: JSON.stringify(resetMovementFields),
    });
    return { restored: true, learnerId: id };
  } catch (error) {
    throw fsError_("Cancel learner movement", error);
  }
}

export async function fsGetReportsData(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  const gradeOrder = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
  const breakdown = gradeOrder.map((gradeLevel) => {
    const rows = learners.filter((learner) => fsNormalizeGrade_(learner.gradeLevel) === gradeLevel);
    return {
      gradeLevel, total: rows.length, male: rows.filter((row) => row.gender === "Male").length, female: rows.filter((row) => row.gender === "Female").length,
      fourPs: rows.filter((row) => row.is4Ps).length, ip: rows.filter((row) => row.isIP).length, sned: rows.filter((row) => row.isSNED).length,
      aral: rows.filter((row) => row.isARAL).length, muslim: rows.filter((row) => row.isMuslim).length,
    };
  }).filter((row) => row.total);
  const tagged = learners.filter((learner) => learner.is4Ps || learner.isIP || learner.isSNED || learner.isARAL || learner.isMuslim).length;
  const profileGraph = (fields) => gradeOrder.map((gradeLevel) => ({ label: gradeLevel, value: learners.filter((learner) => fsNormalizeGrade_(learner.gradeLevel) === gradeLevel && fields.some((field) => learner[field])).length })).filter((row) => row.value);
  return {
    schoolYear, learners: learners.map((learner) => ({ ...learner, name: fsLearnerName_(learner) })), breakdown,
    totalLearners: learners.length, fourPsCount: learners.filter((row) => row.is4Ps).length, ipCount: learners.filter((row) => row.isIP).length,
    snedCount: learners.filter((row) => row.isSNED).length, aralCount: learners.filter((row) => row.isARAL).length, muslimCount: learners.filter((row) => row.isMuslim).length,
    maleCount: learners.filter((row) => row.gender === "Male").length, femaleCount: learners.filter((row) => row.gender === "Female").length,
    notTaggedCount: learners.length - tagged, gradeLevels: breakdown.map((row) => ({ label: row.gradeLevel, value: row.total })),
    readingProfiles: profileGraph(["bosyCRLA", "mosyCRLA", "eosyCRLA", "bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI"]),
    mathProfiles: profileGraph(["bosyRMA", "mosyRMA", "eosyRMA"]),
    nutritionProfiles: profileGraph(["bosyNutritionalStatus", "mosyNutritionalStatus", "eosyNutritionalStatus"]),
  };
}

export async function fsGetSetting(key) {
  const doc = await db.collection(FS_SETTINGS).doc(key).get();
  return doc.exists ? doc.data().value : null;
}

async function fsReadParentAccessToggle_(database) {
  const doc = await database.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles).get();
  const value = doc.exists ? doc.data()?.canParentAccess : undefined;
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error("Invalid Parent Access setting. The canParentAccess value must be true or false.");
  }
  return {
    canParentAccess: value ?? APP_CONFIG.firestore.settingsDefaults.toggles.canParentAccess,
    configured: typeof value === "boolean",
  };
}

export async function fsGetParentAccessConfiguration() {
  return fsReadParentAccessToggle_(db);
}

export async function fsGetParentAccessEnabled() {
  return (await fsReadParentAccessToggle_(parentDb)).canParentAccess;
}

export async function fsSetParentAccessEnabled(enabled) {
  if (typeof enabled !== "boolean") throw new Error("Parent Access must be enabled or disabled.");
  try {
    await fsWriteAuditedSettings_(db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles), {
      canParentAccess: enabled,
    });
    return enabled;
  } catch (error) {
    throw fsError_("Update Parent Access", error);
  }
}

export async function fsGetPromotionConfiguration() {
  const doc = await db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles).get();
  const value = doc.exists ? doc.data()?.canPromoteStudents : undefined;
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error("Invalid Promotion setting. The canPromoteStudents value must be true or false.");
  }
  return { canPromoteStudents: value ?? false, configured: typeof value === "boolean" };
}

export async function fsSetCanPromoteStudents(enabled) {
  if (typeof enabled !== "boolean") throw new Error("Promotion access must be enabled or disabled.");
  try {
    await fsWriteAuditedSettings_(db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles), {
      canPromoteStudents: enabled,
    });
    return enabled;
  } catch (error) {
    throw fsError_("Update Promotion access", error);
  }
}

export async function fsGetRoundType() {
  const doc = await db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles).get();
  const value = doc.exists ? doc.data()?.roundType : undefined;
  if (value !== undefined && !GRADE_ROUND_TYPES.includes(value)) throw new Error("Invalid grade rounding setting.");
  return value ?? DEFAULT_ROUND_TYPE;
}

export async function fsSetRoundType(roundType) {
  if (!GRADE_ROUND_TYPES.includes(roundType)) throw new Error("Choose a valid grade rounding option.");
  try {
    await fsWriteAuditedSettings_(db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.toggles), { roundType });
    return roundType;
  } catch (error) {
    throw fsError_("Update grade rounding", error);
  }
}

const DEFAULT_CARD_PRINTING_PREFERENCES = {
  activeTemplate: "sf9",
  gradeTemplates: { kinder: "sf9", grade1: "sf9", grade2: "sf9", grade3: "sf9", grade4: "sf9", grade5: "sf9", grade6: "sf9" },
  attendanceMonths: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
  attendanceRows: [
    { id: "classDays", label: "Class days" },
    { id: "daysPresent", label: "Present" },
    { id: "daysAbsent", label: "Absent" },
  ],
};

export async function fsGetCertificatePreferences(): Promise<CertificatePreferences> {
  const snapshot = await db.collection(FS_SETTINGS).doc(CERTIFICATE_PREFERENCES_DOCUMENT).get();
  return normalizeCertificatePreferences(snapshot.exists ? snapshot.data() : undefined);
}

/** Each open studio receives policy changes from the tenant's shared settings. */
export function fsSubscribeCertificatePreferences(next: (value: CertificatePreferences) => void, error: (failure: Error) => void): () => void {
  return db.collection(FS_SETTINGS).doc(CERTIFICATE_PREFERENCES_DOCUMENT).onSnapshot(
    (snapshot) => next(normalizeCertificatePreferences(snapshot.exists ? snapshot.data() : undefined)), error,
  );
}

export async function fsSetCertificatePreferences(input: unknown): Promise<CertificatePreferences> {
  const preferences = validateCertificatePreferences(input);
  await fsWriteAuditedSettings_(db.collection(FS_SETTINGS).doc(CERTIFICATE_PREFERENCES_DOCUMENT), {
    ...preferences,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: auth.currentUser?.uid || '',
  });
  return preferences;
}

export async function fsGetCardPrintingPreferences() {
  const doc = await db.collection(FS_SETTINGS).doc("cardPrintingPreferences").get();
  const value = doc.exists ? doc.data() : {};
  const months = Array.isArray(value.attendanceMonths)
    ? value.attendanceMonths.map((month) => String(month || "").trim()).filter(Boolean)
    : DEFAULT_CARD_PRINTING_PREFERENCES.attendanceMonths;
  const attendanceRowIds = new Set(["classDays", "daysPresent", "daysAbsent"]);
  const configuredRows = Array.isArray(value.attendanceRows) && value.attendanceRows.length
    ? value.attendanceRows.filter((row) => row && attendanceRowIds.has(row.id) && typeof row.label === "string")
    : [];
  const attendanceRows = configuredRows.length === 3 && new Set(configuredRows.map(({ id }) => id)).size === 3
    ? configuredRows
    : DEFAULT_CARD_PRINTING_PREFERENCES.attendanceRows;
  return {
    activeTemplate: typeof value.activeTemplate === "string" ? value.activeTemplate : DEFAULT_CARD_PRINTING_PREFERENCES.activeTemplate,
    gradeTemplates: { ...DEFAULT_CARD_PRINTING_PREFERENCES.gradeTemplates, ...(value.gradeTemplates || {}) },
    attendanceMonths: months.length ? months : DEFAULT_CARD_PRINTING_PREFERENCES.attendanceMonths,
    attendanceRows: attendanceRows.length ? attendanceRows : DEFAULT_CARD_PRINTING_PREFERENCES.attendanceRows,
  };
}

export async function fsSetCardPrintingPreferences(preferences) {
  if (!preferences || typeof preferences !== "object") throw new Error("Card Printing preferences are invalid.");
  const months = [...new Set((preferences.attendanceMonths || []).map((month) => String(month || "").trim()).filter(Boolean))];
  const attendanceRows = (preferences.attendanceRows || []).map((row) => ({ id: String(row.id || "").trim(), label: String(row.label || "").trim() }))
    .filter((row) => row.id && row.label);
  if (!months.length || months.length > 24 || attendanceRows.length !== 3 || new Set(attendanceRows.map(({ id }) => id)).size !== 3) {
    throw new Error("Use 1–24 unique attendance months and provide all three attendance row labels.");
  }
  const value = {
    activeTemplate: String(preferences.activeTemplate || "sf9"),
    gradeTemplates: preferences.gradeTemplates && typeof preferences.gradeTemplates === "object" ? preferences.gradeTemplates : {},
    attendanceMonths: months,
    attendanceRows,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: auth.currentUser?.uid || "",
  };
  try {
    await fsWriteAuditedSettings_(db.collection(FS_SETTINGS).doc("cardPrintingPreferences"), value);
    return await fsGetCardPrintingPreferences();
  } catch (error) {
    throw fsError_("Update Card Printing preferences", error);
  }
}

export async function fsGetPromotionCandidates(schoolYear, eosyStatus = "Promoted") {
  const requestedStatus = String(eosyStatus || "").trim().toLowerCase();
  if (!["promoted", "retained"].includes(requestedStatus)) throw new Error("Choose Promoted or Retained learners.");
  const learners = await fsGetLearners(schoolYear);
  return learners.filter((learner) => String(learner.eosyStatus || "").trim().toLowerCase() === requestedStatus);
}

export async function fsPromoteLearner(sourceSchoolYear, targetSchoolYear, learnerId, updatedLearner, progressionType = "promotion") {
  const normalizedProgressionType = String(progressionType || "promotion").trim().toLowerCase();
  if (!["promotion", "retention"].includes(normalizedProgressionType)) throw new Error("Unsupported learner progression type.");
  const requiredStatus = normalizedProgressionType === "retention" ? "retained" : "promoted";
  const statusLabel = normalizedProgressionType === "retention" ? "Retained" : "Promoted";
  const sourceYear = fsNormalizeSchoolYear_(sourceSchoolYear);
  const targetYear = fsNormalizeSchoolYear_(targetSchoolYear);
  const id = String(learnerId || "").trim();
  if (!/^\d{4}-\d{4}$/.test(sourceYear) || !/^\d{4}-\d{4}$/.test(targetYear)) {
    throw new Error("Choose valid source and succeeding school years.");
  }
  if (Number(targetYear.slice(0, 4)) <= Number(sourceYear.slice(0, 4))) {
    throw new Error("The target school year must follow the learner's current school year.");
  }
  if (!id) throw new Error("A learner ID is required for learner progression.");
  if (isTeacher()) {
    const configuration = await fsGetPromotionConfiguration();
    if (!configuration.canPromoteStudents) throw new Error("Student promotion and retention are disabled for teachers by the school administrator.");
  }

  try {
    const sourceRef = fsLearnersCollection_(sourceYear).doc(id);
    const targetGrade = fsNormalizeGrade_(updatedLearner?.gradeLevel);
    const targetSection = String(updatedLearner?.section || "").trim();
    const rawAge = updatedLearner?.age;
    const ageValue = Number(updatedLearner?.age);
    if (!targetGrade || !targetSection) throw new Error("Choose a grade and section configured for the target school year.");
    if (rawAge == null || String(rawAge).trim() === "" || !Number.isInteger(ageValue) || ageValue < 0 || ageValue > 120) {
      throw new Error("Enter a valid learner age.");
    }
    const targetSections = await fsGetSections(targetYear);
    if (!targetSections.some((section) =>
      fsNormalizeGrade_(section.gradeLevel) === targetGrade
      && fsNormalizeValue_(section.section) === fsNormalizeValue_(targetSection))) {
      throw new Error(`Grade ${targetGrade} · ${targetSection} is not configured for ${targetYear}.`);
    }

    const targetRef = fsLearnersCollection_(targetYear).doc(id);
    const learnerData = await db.runTransaction(async (transaction) => {
      const [sourceSnapshot, existingTarget] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(targetRef),
      ]);
      if (!sourceSnapshot.exists) throw new Error("The source learner record could not be found.");
      if (existingTarget.exists) {
        throw new Error(`Learner ${id} already has a record in ${targetYear}; no record was overwritten.`);
      }
      const sourceLearner = { learnerId: id, ...sourceSnapshot.data() };
      if (String(sourceLearner.eosyStatus || "").trim().toLowerCase() !== requiredStatus) {
        throw new Error(`Only learners marked ${statusLabel} in EOSY status can continue through ${normalizedProgressionType}.`);
      }
      if (normalizedProgressionType === "retention" && fsNormalizeGrade_(sourceLearner.gradeLevel) !== targetGrade) {
        throw new Error("A retained learner must stay in the same grade level.");
      }
      if (isTeacher() && !fsTeacherAssignmentPairsForSchoolYear_(sourceYear).some((assignment) =>
        fsNormalizeValue_(assignment.gradeLevel) === fsNormalizeValue_(sourceLearner.gradeLevel)
        && fsNormalizeValue_(assignment.section) === fsNormalizeValue_(sourceLearner.section))) {
        throw new Error("You can only promote learners in your assigned sections.");
      }
      const promotedRecord = {
        ...sourceLearner,
        ...updatedLearner,
        ...fsCanonicalLearner_(updatedLearner),
        learnerId: id,
        name: fsLearnerName_({ ...sourceLearner, ...updatedLearner }),
        schoolYear: targetYear,
        gradeLevel: targetGrade,
        section: targetSection,
        age: ageValue,
        dateAdded: firebase.firestore.FieldValue.serverTimestamp(),
        enrollmentStatus: "ACTIVE",
        eosyStatus: "",
        transferType: "",
        transferIn: false,
        transferOut: false,
        transferSchool: "",
        transferDate: "",
        transferReason: "",
        transferNotes: "",
        progressionSourceSchoolYear: sourceYear,
        progressionType: normalizedProgressionType,
      };
      transaction.set(targetRef, promotedRecord);
      return { ...promotedRecord, previousYearLearner: sourceLearner };
    });
    fsInvalidateReadCaches_(sourceYear);
    fsInvalidateReadCaches_(targetYear);
    fsSchedulePublicStatsRefresh_();
    fsAudit_(normalizedProgressionType === "retention" ? "LEARNER_RETAIN" : "LEARNER_PROMOTE", {
      sheet: `learners_${targetYear}`,
      recordId: id,
      oldValue: JSON.stringify(learnerData.previousYearLearner),
      newValue: JSON.stringify({ ...learnerData, previousYearLearner: undefined, dateAdded: "" }),
    });
    return { learnerId: id, sourceSchoolYear: sourceYear, schoolYear: targetYear };
  } catch (error) {
    throw fsError_(normalizedProgressionType === "retention" ? "Retain learner" : "Promote learner", error);
  }
}

function fsGradeTermsYearRef_(schoolYear) {
  return db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.gradeTerms).collection(FS_PATHS.gradeTermYears).doc(fsNormalizeSchoolYear_(schoolYear));
}

export async function fsGetGradeTermCount(schoolYear = "") {
  const requestedYear = fsNormalizeSchoolYear_(schoolYear);
  const years = await fsGetSchoolYears();
  const currentYear = years.find((entry) => entry.isCurrent)?.schoolYear || "";
  const year = requestedYear || currentYear;
  const yearDoc = /^\d{4}-\d{4}$/.test(year) ? await fsGradeTermsYearRef_(year).get() : null;
  const doc = yearDoc?.exists
    ? yearDoc
    : year === currentYear
      ? await db.collection(FS_SETTINGS).doc(FS_DOCUMENTS.gradeTerms).get()
      : null;
  if (!doc?.exists) return DEFAULT_GRADE_TERM_COUNT;
  const termCount = doc.data()?.termCount;
  if (!Number.isInteger(termCount) || termCount < MIN_GRADE_TERM_COUNT || termCount > MAX_GRADE_TERM_COUNT) {
    throw new Error(`Invalid grade term setting for ${year || "the current school year"}.`);
  }
  return termCount;
}

export async function fsSetGradeTermCount(termCount, schoolYear = "") {
  if (!Number.isInteger(termCount) || termCount < MIN_GRADE_TERM_COUNT || termCount > MAX_GRADE_TERM_COUNT) {
    throw new Error(`Choose between ${MIN_GRADE_TERM_COUNT} and ${MAX_GRADE_TERM_COUNT} grade terms.`);
  }
  const year = fsNormalizeSchoolYear_(schoolYear)
    || (await fsGetSchoolYears()).find((entry) => entry.isCurrent)?.schoolYear
    || "";
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to save grade terms.");
  try {
    await fsWriteAuditedSettings_(fsGradeTermsYearRef_(year), {
      schoolYear: year,
      termCount,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid || "",
    });
    return termCount;
  } catch (error) {
    if (error?.code === "permission-denied") {
      throw new Error(
        `Firestore denied the grade-term update for ${year}. Sign in with an active School Admin account and deploy the latest firestore.rules to this school's Firebase project.`,
      );
    }
    throw fsError_("Update grade term count", error);
  }
}

export async function fsGetPassingThreshold(schoolYear = "") {
  const year = fsNormalizeSchoolYear_(schoolYear)
    || (await fsGetSchoolYears()).find((entry) => entry.isCurrent)?.schoolYear
    || "";
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to load the passing threshold.");
  const doc = await fsGradeTermsYearRef_(year).get();
  if (!doc.exists || doc.data()?.passingThreshold == null) return DEFAULT_PASSING_THRESHOLD;
  try {
    return normalizePassingThreshold(doc.data().passingThreshold);
  } catch {
    throw new Error(`Invalid passing threshold for ${year}.`);
  }
}

export async function fsSetPassingThreshold(passingThreshold, schoolYear = "") {
  const threshold = normalizePassingThreshold(passingThreshold);
  const year = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to save the passing threshold.");
  try {
    await fsWriteAuditedSettings_(fsGradeTermsYearRef_(year), {
      schoolYear: year,
      passingThreshold: threshold,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid || "",
    });
    return threshold;
  } catch (error) {
    if (error?.code === "permission-denied") {
      throw new Error(
        `Firestore denied the passing-threshold update for ${year}. Sign in with an active School Admin account and deploy the latest firestore.rules to this school's Firebase project.`,
      );
    }
    throw fsError_("Update passing threshold", error);
  }
}

export async function fsGetGradeLevelGradingConfigurations(schoolYear = "") {
  const year = fsNormalizeSchoolYear_(schoolYear)
    || (await fsGetSchoolYears()).find((entry) => entry.isCurrent)?.schoolYear
    || "";
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to load grade-level grading settings.");
  const doc = await fsGradeTermsYearRef_(year).get();
  const stored = doc.exists ? doc.data()?.gradeLevels || {} : {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error(`Invalid grade-level grading settings for ${year}.`);
  }
  const gradeLevels = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid grading configuration for ${key} in ${year}.`);
    }
    gradeLevels[key] = {
      gradeLevel: String(value.gradeLevel || key),
      ...normalizeGradeLevelGrading(value),
    };
  }
  return { schoolYear: year, gradeLevels };
}

export async function fsSetGradeLevelGradingConfiguration(schoolYear, gradeLevel, configuration) {
  const year = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to save grade-level grading settings.");
  const gradeKey = gradeLevelConfigKey(gradeLevel);
  if (!CURRICULUM_GRADE_LEVELS.some((grade) => gradeLevelConfigKey(grade) === gradeKey)) {
    throw new Error("Choose a valid grade level.");
  }
  if (!configuration || !["numerical", "letter"].includes(configuration.gradingType)) {
    throw new Error("Choose Numerical Grade or Letter Grade.");
  }
  const normalized = normalizeGradeLevelGrading(configuration);
  try {
    const ref = fsGradeTermsYearRef_(year);
    const existing = await ref.get();
    const current = existing.exists ? existing.data()?.gradeLevels || {} : {};
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`Invalid grade-level grading settings for ${year}.`);
    }
    const gradeLevels = { ...current, [gradeKey]: { gradeLevel: String(gradeLevel).trim(), ...normalized } };
    await fsWriteAuditedSettings_(ref, {
      schoolYear: year,
      gradeLevels,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid || "",
    });
    return { schoolYear: year, gradeKey, configuration: gradeLevels[gradeKey] };
  } catch (error) {
    if (error?.code === "permission-denied") {
      throw new Error(
        `Firestore denied the grade-level grading update for ${year}. Sign in with an active School Admin account and deploy the latest firestore.rules to this school's Firebase project.`,
      );
    }
    throw fsError_("Update grade-level grading configuration", error);
  }
}

export async function fsCopyGradeLevelGradingConfigurations(sourceYear, targetYear) {
  const source = await fsGradeTermsYearRef_(sourceYear).get();
  const stored = source.exists ? source.data()?.gradeLevels || {} : {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error(`Invalid grade-level grading settings for ${sourceYear}.`);
  }
  const gradeLevels = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid grading configuration for ${key} in ${sourceYear}.`);
    }
    gradeLevels[key] = { gradeLevel: String(value.gradeLevel || key), ...normalizeGradeLevelGrading(value) };
  }
  if (!Object.keys(gradeLevels).length) return 0;
  await fsWriteAuditedSettings_(fsGradeTermsYearRef_(targetYear), {
    schoolYear: targetYear,
    gradeLevels,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: auth.currentUser?.uid || "",
  });
  return Object.keys(gradeLevels).length;
}

if (typeof LPSApi !== "undefined") {
  LPSApi.getPublicStats = fsGetPublicStats;
  LPSApi.getPublicEnrollmentData = fsGetPublicEnrollmentData;
  LPSApi.refreshPublicStats = fsRefreshPublicStats;
  LPSApi.getSchoolYears = fsGetSchoolYears;
  LPSApi.createSchoolYear = fsCreateSchoolYear;
  LPSApi.setCurrentSchoolYear = fsSetCurrentSchoolYear;
  LPSApi.getSections = fsGetSections;
  LPSApi.saveSection = fsSaveSection;
  LPSApi.deleteSection = fsDeleteSection;
  LPSApi.getGradeSubjectAssignments = fsGetGradeSubjectAssignments;
  LPSApi.saveGradeSubjectAssignment = fsSaveGradeSubjectAssignment;
  LPSApi.getCurriculumSubjectPool = fsGetCurriculumSubjectPool;
  LPSApi.addCurriculumSubject = fsAddCurriculumSubject;
  LPSApi.removeCurriculumSubject = fsRemoveCurriculumSubject;
  LPSApi.getSetting = fsGetSetting;
  LPSApi.getEnrollmentData = (schoolYear) => isVisitorSession() ? fsGetPublicEnrollmentData() : fsGetEnrollmentData(schoolYear);
  LPSApi.syncEnrollmentData = fsSyncEnrollmentData;
  LPSApi.getNutritionStatus = fsGetNutritionStatus;
  LPSApi.getReadingProfiles = fsGetReadingProfiles;
  LPSApi.getMathProfiles = fsGetMathProfiles;
  LPSApi.getGradesProfiles = fsGetGradesProfiles;
  LPSApi.getTransferRecords = fsGetTransferRecords;
  LPSApi.getReportsData = fsGetReportsData;
  LPSApi.getArchiveRecords = fsGetArchiveRecords;
  LPSApi.updateArchiveRecord = fsUpdateArchiveRecord;
  LPSApi.deleteArchiveRecord = fsDeleteArchiveRecord;
  LPSApi.cancelLearnerMovement = fsCancelLearnerMovement;
  LPSApi.getPromotionCandidates = fsGetPromotionCandidates;
  LPSApi.promoteLearner = fsPromoteLearner;
}

/* ---------------------------------------------------------------------------
 * LEARNERS (Phase 2 scaffolding)
 * ------------------------------------------------------------------------- */
// These helpers are ready to use but NOT yet wired into learner-list.js,
// data.js, dashboard.js, etc. — those pages still read/write learners
// through sheets-api.js today. Switching a page over is a matter of
// replacing its LPSApi.getLearners(...)-style calls with the equivalent
// fs* call below, one page at a time. See README.md and SETUP_README.md,
// Part 5, for the recommended order and a worked example (dashboard.js).

export function fsTeacherAssignmentPairsForSchoolYear_(schoolYear) {
  const normalizedYear = fsNormalizeSchoolYear_(schoolYear);
  return (fsTeacherAssignments_() || [])
    .filter((assignment) => fsNormalizeSchoolYear_(assignment.schoolYear) === normalizedYear)
    .map((assignment) => ({
      gradeLevel: fsNormalizeGrade_(assignment.gradeLevel),
      section: String(assignment.section || "").trim(),
    }))
    .filter((assignment) => assignment.gradeLevel && assignment.section);
}

export async function fsGetTeacherScopedLearners_(schoolYear) {
  const assignments = fsTeacherAssignmentPairsForSchoolYear_(schoolYear);
  if (!assignments.length) return [];
  const snapshots = await Promise.all(assignments.map((assignment) =>
    fsLearnersCollection_(schoolYear)
      .where("gradeLevel", "==", assignment.gradeLevel)
      .where("section", "==", assignment.section)
      .get()
  ));
  const merged = new Map();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => {
      const learner = { learnerId: doc.id, ...doc.data() };
      if (!fsIsActiveLearner_(learner)) return;
      merged.set(String(learner.learnerId), learner);
    });
  });
  return [...merged.values()].map((learner) => ({
    ...learner,
    dateAdded: fsLearnerDate_(learner.dateAdded || learner.createdAt || learner.addedAt),
  }));
}

export async function fsGetLearners(schoolYear) {
  if (isTeacher()) {
    const userId = String(auth.currentUser?.uid || storedAppProfile()?.uid || "").trim();
    const live = fsLiveData_("teacher-assigned-learners", `${userId}|${schoolYear}`);
    if (Array.isArray(live)) return live;
    return typeof LPSCache === "undefined"
      ? fsGetTeacherScopedLearners_(schoolYear)
      : LPSCache.getOrLoad(`firestore_teacher_assignments_${userId}_${schoolYear}`, () => fsGetTeacherScopedLearners_(schoolYear), 1000);
  }
  const live = fsLiveData_("learners", schoolYear);
  if (Array.isArray(live)) return live;
  const load = async () => {
    const snapshot = await fsLearnersCollection_(schoolYear).get();
    return snapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() })).filter(fsIsActiveLearner_);
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad(`firestore_learners_${schoolYear}`, load, 1000);
}

export function fsIsActiveLearner_(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT" && eosyStatus !== "dropped out" && !learner?.transferOut;
}

export function fsLearnerArchiveType_(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  const transferType = String(learner?.transferType || "").trim().toLowerCase();
  if (learner?.transferOut || enrollmentStatus === "TRANSFERRED_OUT" || transferType === "transfer out") return "transferredOut";
  if (enrollmentStatus === "DROPPED_OUT" || eosyStatus === "dropped out") return "dropout";
  return "";
}

export async function fsGetAllLearners_(schoolYear) {
  const snapshot = await fsLearnersCollection_(schoolYear).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { ...data, learnerId: doc.id, dateAdded: data.dateAdded || data.createdAt || data.addedAt || "" };
  });
}

export function fsLearnerDate_(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value === "object" && Number.isFinite(Number(value.seconds ?? value._seconds))) {
    return new Date(Number(value.seconds ?? value._seconds) * 1000).toISOString();
  }
  return value || "";
}

export async function fsGetLearner(learnerId, schoolYear) {
  const assignments = fsTeacherAssignments_() || [];
  const yearAssignments = assignments.filter((item) => item.schoolYear === fsNormalizeSchoolYear_(schoolYear));
  if (isTeacher()) {
    const snapshot = await fsLearnersCollection_(schoolYear).doc(learnerId).get();
    if (!snapshot.exists) return null;
    const learner = { ...snapshot.data(), learnerId: snapshot.id, dateAdded: fsLearnerDate_(snapshot.data().dateAdded || snapshot.data().createdAt || snapshot.data().addedAt) };
    const allowed = yearAssignments.some((assignment) =>
      fsNormalizeValue_(fsNormalizeGrade_(learner.gradeLevel)) === fsNormalizeValue_(assignment.gradeLevel)
      && fsNormalizeValue_(String(learner.section || "")) === fsNormalizeValue_(assignment.section)
    );
    return allowed ? learner : null;
  }
  const doc = await fsLearnersCollection_(schoolYear).doc(learnerId).get();
  return doc.exists ? { ...doc.data(), learnerId: doc.id, dateAdded: fsLearnerDate_(doc.data().dateAdded || doc.data().createdAt || doc.data().addedAt) } : null;
}

export async function fsGetParentLearner(learnerId, schoolYear) {
  const normalizedId = String(learnerId || "").trim();
  const year = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{12}$/.test(normalizedId)) throw new Error("Enter a valid 12-digit learner reference number.");
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to search learner records.");
  const snapshot = await parentDb.collection(FS_SCHOOL_YEARS).doc(year).collection(FS_LEARNERS).doc(normalizedId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  if (
    data.enrollmentStatus === "TRANSFERRED_OUT"
    || data.enrollmentStatus === "DROPPED_OUT"
    || data.eosyStatus === "Dropped Out"
    || data.transferOut === true
  ) return null;
  return {
    ...data,
    learnerId: snapshot.id,
    dateAdded: fsLearnerDate_(data.dateAdded || data.createdAt || data.addedAt),
  };
}

export async function fsGetParentGradeTermCount(schoolYear) {
  const year = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("A valid school year is required to read grade terms.");
  const yearRef = parentDb.collection(FS_SETTINGS)
    .doc(FS_DOCUMENTS.gradeTerms)
    .collection(FS_PATHS.gradeTermYears)
    .doc(year);
  const yearDoc = await yearRef.get();
  let doc = yearDoc;
  if (!doc.exists) {
    const currentSetting = await parentDb.collection(FS_SETTINGS).doc(FS_DOCUMENTS.currentSchoolYear).get();
    const isCurrentYear = fsNormalizeSchoolYear_(currentSetting.exists ? currentSetting.data()?.value : "") === year;
    if (isCurrentYear) doc = await parentDb.collection(FS_SETTINGS).doc(FS_DOCUMENTS.gradeTerms).get();
  }
  if (!doc?.exists) return DEFAULT_GRADE_TERM_COUNT;
  const termCount = doc.data()?.termCount;
  if (!Number.isInteger(termCount) || termCount < MIN_GRADE_TERM_COUNT || termCount > MAX_GRADE_TERM_COUNT) {
    throw new Error(`Invalid grade term setting for ${year}.`);
  }
  return termCount;
}

export async function fsGetLearnerPage(options = {}) {
  const allLearners = (await fsGetLearners(options.schoolYear)).map((learner) => ({
    ...learner,
    dateAdded: fsLearnerDate_(learner.dateAdded || learner.createdAt || learner.addedAt),
  }));
  const query = String(options.search || "").toLowerCase();
  const filtered = allLearners.filter((learner) => {
    const programField = options.program && PROGRAM_FIELD_MAP[options.program];
    return (!query || `${learner.firstName || ""} ${learner.lastName || ""} ${learner.learnerId}`.toLowerCase().includes(query))
      && (!options.gradeLevel || fsNormalizeValue_(fsNormalizeGrade_(learner.gradeLevel)) === fsNormalizeValue_(fsNormalizeGrade_(options.gradeLevel)))
      && (!options.section || String(learner.section || "").trim().toLowerCase() === String(options.section).trim().toLowerCase())
      && (!options.gender || learner.gender === options.gender)
      && (!programField || learner[programField]);
  });
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Number(options.pageSize) || 10);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}

export async function fsGetLearnerSchema(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  const knownFields = new Set([
    "learnerId", "firstName", "middleName", "lastName", "suffix", "birthDate", "age", "gradeLevel", "section", "gender",
    "enrollmentStatus", "eosyStatus", "guardian", "contact", "dateAdded", "is4Ps", "isIP", "isSNED", "isARAL", "isMuslim",
    "anecdotalRecords", "extra",
    ...FS_DYNAMIC_CURRICULUM_SUBJECT_IDS,
  ]);
  const extraFields = new Set();
  learners.forEach((learner) => {
    Object.keys(learner).forEach((field) => { if (!knownFields.has(field)) extraFields.add(field); });
    Object.keys(learner.extra || {}).forEach((field) => extraFields.add(field));
  });
  return { extraFields: [...extraFields] };
}

/** Real-time learner list — the dashboard, masterlist, reports, and data pages
 *  share ONE Firestore listener per school year and update instantly when any
 *  device adds/edits/removes a learner, with no manual refresh. */
export function fsSubscribeLearners(schoolYear, onChange, onError) {
  return isTeacher() ? fsSubscribeTeacherLearners_(schoolYear, onChange, onError) : fsSubscribeLiveLearners_(schoolYear, onChange, onError);
}

function fsRecentLearnerSortValue_(value) {
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

export function fsSubscribeRecentLearners(schoolYear, onChange, onError) {
  // Derived from the SAME shared learners store as fsSubscribeLearners — the
  // dashboard no longer needs a second Firestore query for the "recent" list.
  return fsSubscribeLiveLearners_(schoolYear, (learners) => {
    const recent = (learners || []).slice()
      .sort((a, b) => (fsRecentLearnerSortValue_(b.dateAdded || b.createdAt || b.addedAt) - fsRecentLearnerSortValue_(a.dateAdded || a.createdAt || a.addedAt))
        || String(b.learnerId || "").localeCompare(String(a.learnerId || "")))
      .slice(0, 5)
      .map((learner) => ({ ...learner, dateAdded: fsLearnerDate_(learner.dateAdded || learner.createdAt || learner.addedAt) }));
    if (typeof onChange === "function") onChange(recent);
  }, onError);
}

export async function fsAddLearner(schoolYear, learner) {
  try {
    const learnerId = String(learner.learnerId || "").trim();
    if (!/^\d{12}$/.test(learnerId)) throw new Error("A valid 12-digit LRN is required.");
    const archiveType = fsLearnerArchiveType_(learner);
    const collection = archiveType ? fsArchiveCollection_(archiveType, schoolYear) : fsLearnersCollection_(schoolYear);
    const ref = collection.doc(learnerId);
    const canonical = { ...fsCanonicalLearner_(learner), learnerId, schoolYear, dateAdded: firebase.firestore.FieldValue.serverTimestamp() };
    await ref.set(canonical);
    fsInvalidateReadCaches_(schoolYear);
    fsSchedulePublicStatsRefresh_();
    fsAudit_("LEARNER_ADD", { sheet: archiveType ? `${archiveType}_${schoolYear}` : `learners_${schoolYear}`, recordId: ref.id, newValue: JSON.stringify(learner) });
    return { learnerId: ref.id };
  } catch (error) {
    throw fsError_("Add learner", error);
  }
}

export async function fsUpdateLearner(schoolYear, learnerId, learner) {
  try {
    const ref = fsLearnersCollection_(schoolYear).doc(learnerId);
    const update = fsCanonicalLearner_(learner);
    if (!Object.prototype.hasOwnProperty.call(learner, "dateAdded")) delete update.dateAdded;
    const archiveType = fsLearnerArchiveType_(learner);
    let before = null;
    if (archiveType) {
      before = await ref.get();
      if (!before.exists) throw new Error("This learner record could not be found.");
      const merged = { ...before.data(), ...update, learnerId, schoolYear };
      const batch = db.batch();
      batch.set(fsArchiveCollection_(archiveType, schoolYear).doc(learnerId), { ...merged, schoolYear }, { merge: true });
      batch.delete(ref);
      await batch.commit();
    } else {
      await ref.set(update, { merge: true });
    }
    fsInvalidateReadCaches_(schoolYear);
    fsSchedulePublicStatsRefresh_();
    fsAudit_("LEARNER_UPDATE", {
      sheet: archiveType ? `${archiveType}_${schoolYear}` : `learners_${schoolYear}`, recordId: learnerId,
      oldValue: before?.exists ? JSON.stringify(before.data()) : "",
      newValue: JSON.stringify(learner),
    });
    return { updated: true };
  } catch (error) {
    throw fsError_("Update learner", error);
  }
}

/**
 * Deletes one learner. Signature is always `(schoolYear, learnerId)` —
 * matching every call site (learner-list.ts's confirmDelete, the LPSApi
 * bridge below). A previous version of this function tried to guess which
 * argument was which via regex heuristics; that guesswork silently matched
 * a "YYYY-YYYY" school year as the learner ID (since it didn't fit either
 * heuristic pattern), so it deleted the wrong — usually non-existent —
 * document. Firestore's `.delete()` on a non-existent document succeeds
 * without error, so the UI reported success while nothing was actually
 * removed. Explicit, validated positional arguments avoid that failure
 * mode entirely.
 */
export async function fsDeleteLearner(schoolYear, learnerId) {
  const targetYear = String(schoolYear || "").trim();
  const targetId = String(learnerId || "").trim();
  if (!targetYear) throw new Error("A school year is required to delete a learner.");
  if (!targetId) throw new Error("A learner ID is required to delete a learner.");
  try {
    const before = await fsLearnersCollection_(targetYear).doc(targetId).get();
    if (!before.exists) throw new Error("This learner record was already removed or could not be found.");
    await fsMoveLearnerToTrash_(targetYear, FS_LEARNERS, targetId);
    fsInvalidateReadCaches_(targetYear);
    fsSchedulePublicStatsRefresh_();
    fsAudit_("LEARNER_DELETE", { sheet: `learners_${targetYear}`, recordId: targetId, oldValue: JSON.stringify(before.data()) });
    return { deleted: true };
  } catch (error) {
    throw fsError_("Remove learner", error);
  }
}

/** Bulk-deletes learners. Signature is always `(schoolYear, learnerIds)`. */
export async function fsDeleteLearners(schoolYear, learnerIds) {
  const targetYear = String(schoolYear || "").trim();
  const targetIds = Array.isArray(learnerIds) ? learnerIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (!targetYear) throw new Error("A school year is required to delete learners.");
  if (!targetIds.length) throw new Error("At least one learner must be selected.");
  try {
    for (const learnerId of targetIds) await fsMoveLearnerToTrash_(targetYear, FS_LEARNERS, learnerId);
    fsInvalidateReadCaches_(targetYear);
    fsSchedulePublicStatsRefresh_();
    fsAudit_("LEARNER_DELETE", { sheet: `learners_${targetYear}`, recordId: targetIds.join(", ") });
    return { deleted: targetIds.length };
  } catch (error) {
    throw fsError_("Remove learners", error);
  }
}

if (typeof LPSApi !== "undefined") {
  LPSApi.getLearners = fsGetLearnerPage;
  LPSApi.getLearner = fsGetLearner;
  LPSApi.getLearnerSchema = fsGetLearnerSchema;
  LPSApi.getEnrollmentSections = fsGetSections;
  LPSApi.addLearner = (learner, schoolYear) => fsAddLearner(schoolYear, learner);
  LPSApi.updateLearner = (learnerId, learner, schoolYear) => fsUpdateLearner(schoolYear, learnerId, learner);
  LPSApi.deleteLearner = (learnerId, schoolYear) => fsDeleteLearner(schoolYear, learnerId);
  LPSApi.deleteLearners = (learnerIds, schoolYear) => fsDeleteLearners(schoolYear, learnerIds);
  LPSApi.deleteArchiveRecord = (archive, schoolYear, learnerId) => fsDeleteArchiveRecord(archive, schoolYear, learnerId);
}
