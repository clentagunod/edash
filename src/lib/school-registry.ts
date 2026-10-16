declare const firebase: any;

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface SchoolInfo {
  region: string;
  divisionOffice: string;
  district: string;
}

export interface RegisteredSchool {
  id: string;
  enabled: true;
  name: string;
  nickname: string;
  tagline?: string;
  logoUrl: string;
  videoUrl: string;
  schoolInfo?: SchoolInfo;
  schoolHead?: {
    name?: string;
    position?: string;
    email?: string;
    phoneNumber?: string;
    updatedAt?: unknown;
  };
  firebaseConfig: FirebaseWebConfig;
  auditLogApiUrl: string;
  feedbackApiUrl: string;
}

const env = import.meta.env as Record<string, string | undefined>;
const ACTIVE_SCHOOL_KEY = "edash.activeSchool";
const registryFirebaseConfig = readFirebaseConfig("VITE_REGISTRY_FIREBASE");

function readFirebaseConfig(prefix: string): FirebaseWebConfig {
  return {
    apiKey: env[`${prefix}_API_KEY`] || "",
    authDomain: env[`${prefix}_AUTH_DOMAIN`] || "",
    projectId: env[`${prefix}_PROJECT_ID`] || "",
    storageBucket: env[`${prefix}_STORAGE_BUCKET`] || "",
    messagingSenderId: env[`${prefix}_MESSAGING_SENDER_ID`] || "",
    appId: env[`${prefix}_APP_ID`] || "",
  };
}

function configIsUsable(config: Partial<FirebaseWebConfig> | undefined): config is FirebaseWebConfig {
  return Boolean(
    config &&
      typeof config.apiKey === "string" &&
      config.apiKey &&
      typeof config.authDomain === "string" &&
      config.authDomain &&
      typeof config.projectId === "string" &&
      config.projectId &&
      typeof config.appId === "string" &&
      config.appId,
  );
}

function isSafeAssetReference(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || (url.origin === window.location.origin && url.protocol === window.location.protocol);
  } catch {
    return false;
  }
}

function isHttpsOrEmpty(value: string): boolean {
  if (!value) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const registryBootstrapSchool: RegisteredSchool = Object.freeze({
  id: "edash-registry",
  enabled: true,
  name: "E-Dash",
  nickname: "E-Dash",
  logoUrl: "/assets/edash/edash.png",
  videoUrl: "",
  firebaseConfig: registryFirebaseConfig,
  auditLogApiUrl: "",
  feedbackApiUrl: "",
});

const REGISTRY_CACHE_TTL_MS = 30_000;
let cachedSchools: RegisteredSchool[] | null = null;
let cacheExpiresAt = 0;
let pendingRegistryRead: Promise<RegisteredSchool[]> | null = null;

export function isRegisteredSchool(value: unknown): value is RegisteredSchool {
  if (!value || typeof value !== "object") return false;
  const school = value as Partial<RegisteredSchool>;
  return (
    typeof school.id === "string" &&
    /^[a-z0-9][a-z0-9-]{1,62}$/.test(school.id) &&
    school.enabled === true &&
    typeof school.name === "string" &&
    school.name.trim().length > 0 &&
    school.name.length <= 120 &&
    typeof school.nickname === "string" &&
    school.nickname.length <= 64 &&
    (school.tagline === undefined || (typeof school.tagline === "string" && school.tagline.length <= 240)) &&
    typeof school.logoUrl === "string" &&
    isSafeAssetReference(school.logoUrl) &&
    typeof school.videoUrl === "string" &&
    (!school.videoUrl || isSafeAssetReference(school.videoUrl)) &&
    configIsUsable(school.firebaseConfig) &&
    typeof school.auditLogApiUrl === "string" &&
    isHttpsOrEmpty(school.auditLogApiUrl) &&
    typeof school.feedbackApiUrl === "string" &&
    isHttpsOrEmpty(school.feedbackApiUrl) &&
    (school.schoolInfo === undefined ||
      (!!school.schoolInfo &&
        typeof school.schoolInfo === "object" &&
        !Array.isArray(school.schoolInfo) &&
        ["region", "divisionOffice", "district"].every((field) =>
          school.schoolInfo?.[field] === undefined || typeof school.schoolInfo[field] === "string",
        ))) &&
    (school.schoolHead === undefined ||
      (!!school.schoolHead &&
        typeof school.schoolHead === "object" &&
        !Array.isArray(school.schoolHead) &&
        ["name", "position", "email", "phoneNumber"].every((field) =>
          school.schoolHead?.[field] === undefined || typeof school.schoolHead[field] === "string",
        )))
  );
}

export function sameSchoolRegistration(left: RegisteredSchool, right: RegisteredSchool): boolean {
  return (
    left.id === right.id &&
    left.enabled === right.enabled &&
    left.name === right.name &&
    left.nickname === right.nickname &&
    left.tagline === right.tagline &&
    left.logoUrl === right.logoUrl &&
    left.videoUrl === right.videoUrl &&
    left.firebaseConfig.apiKey === right.firebaseConfig.apiKey &&
    left.firebaseConfig.authDomain === right.firebaseConfig.authDomain &&
    left.firebaseConfig.projectId === right.firebaseConfig.projectId &&
    left.firebaseConfig.storageBucket === right.firebaseConfig.storageBucket &&
    left.firebaseConfig.messagingSenderId === right.firebaseConfig.messagingSenderId &&
    left.firebaseConfig.appId === right.firebaseConfig.appId &&
    left.auditLogApiUrl === right.auditLogApiUrl &&
    left.feedbackApiUrl === right.feedbackApiUrl
  );
}

export function getActiveSchool(): RegisteredSchool {
  if (!configIsUsable(registryFirebaseConfig)) {
    throw new Error("Central E-Dash registry Firebase configuration is missing. Configure VITE_REGISTRY_FIREBASE_* before starting the app.");
  }
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_SCHOOL_KEY) || "null");
    if (isRegisteredSchool(saved)) return saved;
    if (saved !== null) localStorage.removeItem(ACTIVE_SCHOOL_KEY);
  } catch {
    localStorage.removeItem(ACTIVE_SCHOOL_KEY);
  }
  return registryBootstrapSchool;
}

export function getStoredSchool(): RegisteredSchool | null {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_SCHOOL_KEY) || "null");
    if (isRegisteredSchool(saved)) return saved;
    if (saved !== null) localStorage.removeItem(ACTIVE_SCHOOL_KEY);
    return null;
  } catch {
    localStorage.removeItem(ACTIVE_SCHOOL_KEY);
    return null;
  }
}

export function storeActiveSchool(school: RegisteredSchool): void {
  if (!isRegisteredSchool(school)) throw new Error("The selected school has invalid registration settings.");
  localStorage.setItem(ACTIVE_SCHOOL_KEY, JSON.stringify(school));
}

export function clearStoredSchool(): void {
  localStorage.removeItem(ACTIVE_SCHOOL_KEY);
}

export async function getRegisteredSchools(): Promise<RegisteredSchool[]> {
  if (!configIsUsable(registryFirebaseConfig)) {
    throw new Error("Central E-Dash registry Firebase configuration is missing. Configure VITE_REGISTRY_FIREBASE_* before starting the app.");
  }
  if (cachedSchools && cacheExpiresAt > Date.now()) return cachedSchools;
  if (pendingRegistryRead) return pendingRegistryRead;

  pendingRegistryRead = (async () => {
    const registryApp =
      firebase.apps.find((app: any) => app.name === "edash-school-registry") ||
      firebase.initializeApp(registryFirebaseConfig, "edash-school-registry");
    const snapshot = await registryApp
      .firestore()
      .collection("schools")
      .where("enabled", "==", true)
      .get();

    const schools = snapshot.docs.map((doc: any) => ({ ...doc.data(), id: doc.id }));
    if (schools.some((school: unknown) => !isRegisteredSchool(school))) {
      throw new Error("The central school directory contains an incomplete or invalid school registration.");
    }
    cachedSchools = schools as RegisteredSchool[];
    cacheExpiresAt = Date.now() + REGISTRY_CACHE_TTL_MS;
    return cachedSchools;
  })();
  try {
    return await pendingRegistryRead;
  } finally {
    pendingRegistryRead = null;
  }
}
