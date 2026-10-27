// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { APP_CONFIG, APP_PAGE_PREFIX, APP_USER_PROFILE, appBrandAssetUrl, canManageLearners, canViewGradesProfile, isSchoolAdmin, isVisitorSession, normalizedAppRole, setAppUserProfile, storedAppProfile, updateSchoolFavicon } from './app-config';
import { LPS_SESSION_KEY, displayNameFromEmail, handleLogout, initials } from './auth';
import { Icon } from './icons';
import { auth, db } from './firebase';
import { getStoredSchool } from './school-registry';
import { getModeSettings, subscribeModeSettings } from './mode-settings';
import { appThemeFromId, appThemeId, isAppTheme, isDarkAppTheme } from './themes';
import { mountGlobalSearch } from './global-search';
import { applyUserPreferences } from './preference-runtime';
import { setCachedProfilePhotoSource } from './profile-photo-cache';

/**
 * ============================================================================
 * SHELL.JS
 * Renders the sidebar + topbar that every authenticated page shares, so the
 * nav markup lives in exactly one place. Each page just needs:
 *   <div id="sidebarMount"></div>
 *   <div id="topbarMount"></div>
 * and a call to renderShell("dashboard", "Dashboard").
 * ============================================================================
 */

export const NAV_ITEMS = [
  { group: null, key: "dashboard", label: "Dashboard", icon: "dashboard", href: "dashboard.html" },
  { group: null, key: "masterlist", label: "Learner Masterlist", icon: "users", href: "masterlist.html" },
  { group: null, key: "enrollment-data", label: "Enrollment Data", icon: "sheet", href: "enrollment-data.html" },
  { group: null, key: "settings", label: "Settings", icon: "settings", href: "settings.html" },
  { group: "Programs", key: "4ps", label: "4Ps Beneficiaries", icon: "heart", href: "program-4ps.html" },
  { group: "Programs", key: "ip", label: "IP Learners", icon: "leaf", href: "program-ip.html" },
  { group: "Programs", key: "sned", label: "SNED Learners", icon: "accessibility", href: "program-sned.html" },
  { group: "Programs", key: "aral", label: "ARAL Tagged Learners", icon: "alertTriangle", href: "program-aral.html" },
  { group: "Programs", key: "muslim", label: "Muslim Learners", icon: "userRound", href: "program-muslim.html" },
  { group: "Nutrition", key: "nutrition", label: "Nutritional Status", icon: "activity", href: "nutritional-status.html" },
  { group: "Statistics", key: "reports", label: "Statistics", icon: "barChart", href: "reports.html" },
  { group: "Statistics", key: "eosy", label: "EOSY Status Report", icon: "clipboard", href: "eosy-report.html" },
  { group: "Profiles", key: "grades", label: "Grades Profile", icon: "graduationCap", href: "grades-profile.html" },
  { group: "Profiles", key: "reading", label: "Reading Profile", icon: "book", href: "reading-profile.html" },
  { group: "Profiles", key: "math", label: "Math Profile", icon: "math", href: "math-profile.html" },
  { group: "Movement", key: "promotion", label: "Promotion", icon: "graduationCap", href: "promotion.html" },
  { group: "Movement", key: "retention", label: "Retention", icon: "rotateCcw", href: "retention.html" },
  { group: "Movement", key: "transfer-info", label: "Transfer Info", icon: "transfer", href: "transfer-info.html" },
  { group: "Movement", key: "dropout", label: "Dropout Info", icon: "alertTriangle", href: "dropout.html" },
  { group: "Utilities", key: "data", label: "Data", icon: "download", href: "data.html" },
  { group: "Utilities", key: "grade-calculator", label: "Grade Calculator", icon: "sigma", href: "grade-calculator.html" },
  { group: "Utilities", key: "bmi-calculator", label: "BMI Calculator", icon: "calculator", href: "bmi-calculator.html" },
  { group: "Utilities", key: "eduai", label: "EduAI", icon: "sparkles", href: "eduai.html" },
  { group: "Feedback", key: "trash", label: "Trash", icon: "trash", href: "trash.html" },
  { group: "Feedback", key: "feedback", label: "Feedback", icon: "message", href: "feedback.html" },
];

function updateTestModeStamp() {
  if (document.body.classList.contains("maintenance-mode-active")) {
    document.getElementById("testModeStamp")?.remove();
    return;
  }
  const enabled = getModeSettings().isTestMode;
  let testModeStamp = document.getElementById("testModeStamp");
  if (enabled && !testModeStamp) {
    testModeStamp = document.createElement("div");
    testModeStamp.id = "testModeStamp";
    testModeStamp.className = "test-mode-stamp";
    testModeStamp.textContent = "TEST MODE";
    document.body.appendChild(testModeStamp);
  } else if (!enabled) {
    testModeStamp?.remove();
  }
}

let testModeSubscriptionInitialized = false;

export function appPageHref(fileName) {
  return `${APP_PAGE_PREFIX}${fileName}${isVisitorSession() ? "?visitor=1" : ""}`;
}

export function renderProfileAvatar(element, photoURL, email) {
  if (!element) return;
  const fallback = initials(email);
  if (!photoURL) {
    element.textContent = fallback;
    element.removeAttribute("data-has-photo");
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    element.removeAttribute("aria-label");
    element.onclick = null;
    element.onkeydown = null;
    return;
  }
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  const thumbnailSize = element.classList.contains("topbar-avatar") || element.classList.contains("audit-user-avatar") ? 96 : 192;
  setCachedProfilePhotoSource(image, String(photoURL).replace(
    "/image/upload/",
    `/image/upload/c_fill,w_${thumbnailSize},h_${thumbnailSize},g_auto,q_auto,f_auto/`,
  ));
  image.addEventListener("error", () => {
    if (!element.contains(image)) return;
    element.textContent = fallback;
    element.removeAttribute("data-has-photo");
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    element.removeAttribute("aria-label");
    element.onclick = null;
    element.onkeydown = null;
  }, { once: true });
  element.replaceChildren(image);
  element.dataset.hasPhoto = "true";
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  element.setAttribute("aria-label", "View profile photo");
  element.title = "Click to view profile photo";
  element.onclick = () => openProfilePhotoViewer(photoURL, element);
  element.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openProfilePhotoViewer(photoURL, element);
  };
}

function openProfilePhotoViewer(photoURL, trigger) {
  document.querySelector(".profile-photo-viewer")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "profile-photo-viewer";
  backdrop.setAttribute("role", "presentation");

  const dialog = document.createElement("section");
  dialog.className = "profile-photo-viewer-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Profile photo");

  const closeButton = document.createElement("button");
  closeButton.className = "profile-photo-viewer-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close profile photo");
  closeButton.textContent = "×";

  const image = document.createElement("img");
  image.className = "profile-photo-viewer-image";
  image.alt = "Profile photo";
  setCachedProfilePhotoSource(image, String(photoURL).replace(
    "/image/upload/",
    "/image/upload/c_limit,w_1200,h_1200,q_auto,f_auto/",
  ));

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", handleKeyDown);
    trigger?.focus();
  };
  const handleKeyDown = (event) => {
    if (event.key === "Escape") close();
  };

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", handleKeyDown);
  dialog.append(closeButton, image);
  backdrop.append(dialog);
  document.body.append(backdrop);
  closeButton.focus();
}

if ("scrollRestoration" in history) history.scrollRestoration = "manual";
export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => fn(...args), delay); };
}

export function setButtonLoading(button, label = "Working…") {
  if (!button) return;
  if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="inline-spinner" aria-hidden="true"></span><span>${label}</span>`;
}

export function clearButtonLoading(button) {
  if (!button) return;
  button.disabled = false;
  button.classList.remove("is-loading");
  button.removeAttribute("aria-busy");
  if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
}

export let activeNetworkRequests = 0;
export let networkLoadingTimer = null;
export let activeExportIndicator = null;

export function startExportIndicator(label, button, onCancel = () => {}) {
  if (activeExportIndicator) return null;
  const panel = document.createElement("div");
  panel.className = "export-indicator";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `<div class="export-indicator-head"><div class="export-indicator-title"><span class="export-indicator-icon">${Icon.download}</span><strong class="export-indicator-label"></strong></div><span class="export-indicator-percent">0%</span></div><div class="export-indicator-track"><span></span></div><div class="export-indicator-foot"><span class="export-indicator-detail"></span><button type="button" class="export-indicator-cancel">Cancel</button></div>`;
  document.body.appendChild(panel);
  const state = {
    cancelled: false,
    update(message, percent) {
      panel.querySelector(".export-indicator-label").textContent = message;
      panel.querySelector(".export-indicator-percent").textContent = `${Math.round(percent)}%`;
      panel.querySelector(".export-indicator-track span").style.width = `${Math.max(0, Math.min(100, percent))}%`;
    },
    finish(message = "Download started.") {
      state.update(message, 100);
      panel.classList.add("is-complete");
      window.setTimeout(() => state.close(), 1100);
    },
    close() {
      if (!panel.isConnected) return;
      panel.remove();
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
      if (activeExportIndicator === state) activeExportIndicator = null;
    },
    cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      onCancel();
      state.close();
    },
  };
  panel.querySelector(".export-indicator-cancel").addEventListener("click", state.cancel);
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  activeExportIndicator = state;
  state.update(label, 0);
  return state;
}

export function ensureNetworkLoader() {
  let loader = document.getElementById("networkLoader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "networkLoader";
    loader.className = "network-loader";
    loader.setAttribute("role", "progressbar");
    loader.setAttribute("aria-label", "Loading");
    loader.innerHTML = '<span class="network-loader-glow"></span><span class="network-loader-label">Updating</span>';
    document.body.appendChild(loader);
  }
  return loader;
}

export function beginNetworkLoading() {
  activeNetworkRequests += 1;
  window.clearTimeout(networkLoadingTimer);
  networkLoadingTimer = window.setTimeout(() => ensureNetworkLoader().classList.add("is-visible"), 180);
}

export function endNetworkLoading() {
  activeNetworkRequests = Math.max(0, activeNetworkRequests - 1);
  if (activeNetworkRequests > 0) return;
  window.clearTimeout(networkLoadingTimer);
  document.getElementById("networkLoader")?.classList.remove("is-visible");
}

export function applySavedTheme() {
  applyUserPreferences();
  const prefs = (APP_USER_PROFILE || storedAppProfile())?.teacherPrefs;
  const resolvedTheme = isAppTheme(prefs?.theme) ? prefs.theme : "Light";
  document.body.dataset.theme = appThemeId(resolvedTheme);
  document.documentElement.dataset.theme = appThemeId(resolvedTheme);
  document.body.classList.toggle("dark-mode", isDarkAppTheme(resolvedTheme));
  document.documentElement.classList.remove("dark-mode-preload");
}

export function renderShell(activeKey, pageTitleForMobile) {
  applySavedTheme();
  const activeSchool = getStoredSchool();
  const schoolLogoUrl = activeSchool?.logoUrl || APP_CONFIG.branding.schoolLogoUrl;
  const schoolNickname = activeSchool?.nickname || APP_CONFIG.branding.nickname;
  updateSchoolFavicon(schoolLogoUrl);
  const scrollKey = `lps_scroll_${window.location.pathname}`;
  let savedScroll = 0;
  try { savedScroll = Number(sessionStorage.getItem(scrollKey) || 0); } catch (error) { savedScroll = 0; }
  const sidebarMount = document.getElementById("sidebarMount");
  const topbarMount = document.getElementById("topbarMount");
  const mainArea = document.querySelector(".main-area");
  if (!sidebarMount || !topbarMount || !mainArea) return;
  updateTestModeStamp();
  if (!testModeSubscriptionInitialized) {
    subscribeModeSettings(updateTestModeStamp);
    testModeSubscriptionInitialized = true;
  }

  const session = JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "null");
  const email = session?.email || (auth.currentUser && auth.currentUser.email) || "";
  const visitorSession = isVisitorSession();
  const sessionName = session?.name ? String(session.name).trim() : "";
  const hasRealSessionProfile = !!(session && session.uid && session.uid !== "guest");
  const displayName = visitorSession ? "" : (APP_USER_PROFILE?.name || sessionName || (hasRealSessionProfile ? "" : displayNameFromEmail(email)));
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (isVisitorSession()) return ["dashboard", "enrollment-data"].includes(item.key);
    if (item.key === "users") return isSchoolAdmin();
    if (item.key === "promotion" || item.key === "retention") return canManageLearners();
    if (item.key === "grades") return canViewGradesProfile();
    return true;
  });
  const renderNavLink = (item, extraClass = "") => `
    <a class="nav-item ${extraClass} ${item.key === activeKey ? "is-active" : ""}" href="${appPageHref(item.href)}">
      ${Icon[item.icon]}
      <span>${item.label}</span>
    </a>`;
  const primaryItems = visibleNavItems.filter((item) => item.group === null);
  const categoryNames = ["Programs", "Nutrition", "Statistics", "Profiles", "Movement", "Utilities"];
  const categoryIcons = {
    Programs: "heart",
    Nutrition: "activity",
    Statistics: "barChart",
    Profiles: "book",
    Movement: "transfer",
    Utilities: "calculator",
  };
  const categoryHtml = categoryNames.map((group) => {
    const items = visibleNavItems.filter((item) => item.group === group);
    if (!items.length) return "";
    const categoryId = `nav-category-${group.toLowerCase()}`;
    const isActive = items.some((item) => item.key === activeKey);
    return `
      <div class="nav-category ${isActive ? "has-active-item" : ""}" data-nav-category>
        <button class="nav-category-trigger ${isActive ? "is-active" : ""}" type="button"
          aria-expanded="false" aria-controls="${categoryId}">
          ${Icon[categoryIcons[group]]}
          <span>${group}</span>
          ${Icon.chevronRight || ""}
        </button>
        <div class="nav-category-menu" id="${categoryId}">
          ${items.map((item) => renderNavLink(item, "nav-category-link")).join("")}
        </div>
      </div>`;
  }).join("");
  const feedbackItems = visibleNavItems.filter((item) => item.group === "Feedback");
  const navHtml = `
    <div class="nav-primary">${primaryItems.map((item) => renderNavLink(item)).join("")}</div>
    <div class="nav-categories" aria-label="Categories">${categoryHtml}</div>
    <div class="nav-spacer" aria-hidden="true"></div>
    <div class="nav-feedback">${feedbackItems.map((item) => renderNavLink(item)).join("")}</div>`;

  sidebarMount.innerHTML = `
    <button class="sidebar-backdrop" id="sidebarBackdrop" type="button" aria-label="Close navigation"></button>
    <aside class="sidebar" id="sidebar" aria-label="Primary navigation">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">
          <img src="${appBrandAssetUrl(schoolLogoUrl)}" alt="${escapeHtml(schoolNickname)} logo" width="26" height="26" style="border-radius:50%;object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <span style="display:none;">${Icon.book.replace("currentColor", "#fff")}</span>
        </div>
        <div class="sidebar-brand-text">
          <div class="name">${escapeHtml(schoolNickname)}</div>
          <div class="sub">${escapeHtml(APP_CONFIG.branding.dashboardName)}</div>
        </div>
      </div>
      <nav class="sidebar-nav">${navHtml}</nav>
    </aside>`;

  topbarMount.innerHTML = `
    <header class="topbar">
      <button class="topbar-menu-btn" id="menuToggle" aria-label="Toggle navigation">${Icon.menu}</button>
      <h2 style="font-size:16px; ${pageTitleForMobile ? "" : "visibility:hidden;"}">${pageTitleForMobile || ""}</h2>
      <div class="global-search" id="globalSearch">
        <div class="global-search-input-wrap">
          ${Icon.search}
          <input id="globalSearchInput" type="search" placeholder="Search pages and tools…" autocomplete="off" spellcheck="false" aria-label="Search pages and tools" role="combobox" aria-autocomplete="list" aria-controls="globalSearchPanel" aria-expanded="false" />
          <kbd>Ctrl K</kbd>
        </div>
        <div class="global-search-panel" id="globalSearchPanel" role="listbox" aria-label="Search results" hidden>
          <div class="global-search-results" id="globalSearchResults"></div>
        </div>
      </div>
      <a class="privacy-mode-indicator" href="${appPageHref("preferences.html")}" aria-label="Privacy mode is on. Open preferences.">Privacy on</a>
      <div class="topbar-user">
        <div class="topbar-avatar">${initials(email)}</div>
        <div class="topbar-user-text">
          <div class="name">${escapeHtml(displayName)}</div>
          <div class="role" id="topbarRole">Loading role…</div>
        </div>
        <button class="topbar-logout" id="logoutBtn" title="Sign out" aria-label="Sign out">${Icon.logout}</button>
      </div>
    </header>`;
  mountGlobalSearch(visibleNavItems);
  renderProfileAvatar(document.querySelector(".topbar-avatar"), session?.photoURL || APP_USER_PROFILE?.photoURL, email);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);

  const roleEl = document.getElementById("topbarRole");
  const storedProfile = JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "null");
  const storedRole = normalizedAppRole(APP_USER_PROFILE?.role || storedProfile?.role || "");

  if (roleEl && isVisitorSession()) roleEl.textContent = "Visitor";
  else if (roleEl && storedRole) roleEl.textContent = storedRole;

  const canLoadProfile = !!(storedProfile || APP_USER_PROFILE || auth.currentUser);
  if (roleEl && typeof LPSApi !== "undefined" && canLoadProfile) {
    const refreshTopbarRole = (knownUser) => {
      LPSApi.getMyProfile(knownUser || auth.currentUser)
        .then((profile) => {
          if (!profile || typeof profile !== "object") return;
          const freshRole = normalizedAppRole(profile.role || "");
          if (freshRole) {
            roleEl.textContent = freshRole;
            roleEl.title = "";
            // Persist the freshly-known role (and profile) so later page loads
            // show it instantly, even if the next profile refresh is slow or
            // briefly unavailable. A role we already resolved once must never
            // be replaced by "Role unavailable".
            setAppUserProfile({ ...APP_USER_PROFILE, ...profile, role: freshRole });
            try {
              sessionStorage.setItem(LPS_SESSION_KEY, JSON.stringify({
                ...JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "{}"),
                ...profile,
                uid: profile.userId || profile.uid || storedProfile?.uid || "",
                email: profile.email || storedProfile?.email || "",
                name: profile.name || storedProfile?.name || "",
                role: freshRole,
              }));
            } catch (error) { /* Optional cache only — the label is already correct. */ }
          }
          if (profile.name) {
            document.querySelector('.topbar-user-text .name')?.replaceChildren(document.createTextNode(profile.name));
            document.querySelector('.settings-profile-name')?.replaceChildren(document.createTextNode(profile.name));
          }
          const profileEmail = profile.email || auth.currentUser?.email;
          if (profileEmail) {
            document.querySelector('.settings-profile-email')?.replaceChildren(document.createTextNode(profileEmail));
            renderProfileAvatar(document.querySelector('.topbar-avatar'), profile.photoURL, profileEmail);
            renderProfileAvatar(document.querySelector('.settings-profile-avatar'), profile.photoURL, profileEmail);
          }
        })
        .catch((error) => {
          // Keep showing the best role we know; "Role unavailable" is the true
          // last resort (no stored role AND the fetch failed) and always
          // carries the underlying reason as a tooltip.
          roleEl.textContent = storedRole || "Role unavailable";
          roleEl.title = error.message || "Could not load your role.";
          if (!auth.currentUser) {
            // The Firebase Auth SDK may still be restoring the persisted
            // session (that restore is asynchronous and can lag a page load).
            // Instead of leaving the label stuck on "Role unavailable", wait
            // for the real sign-in to arrive and retry the profile fetch once.
            const authUnsub = typeof auth.onAuthStateChanged === "function"
              ? auth.onAuthStateChanged((nextUser) => {
                  if (!nextUser) return;
                  authUnsub?.();
                  refreshTopbarRole(nextUser);
                })
              : null;
          }
        });
    };
    refreshTopbarRole();
  }

  const menuToggle = document.getElementById("menuToggle");
  const sidebarEl = document.getElementById("sidebar");
  const isMobileNav = () => typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 860px)").matches;
  if (sidebarEl) sidebarEl.inert = isMobileNav();
  const closeSidebar = (restoreFocus = false) => {
    sidebarEl?.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    document.getElementById("sidebarBackdrop")?.classList.remove("is-visible");
    if (sidebarEl) sidebarEl.inert = isMobileNav();
    if (restoreFocus) menuToggle?.focus();
  };
  if (menuToggle) {
    menuToggle.setAttribute("aria-controls", "sidebar");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.addEventListener("click", () => {
      const isOpen = sidebarEl.classList.toggle("is-open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      document.getElementById("sidebarBackdrop")?.classList.toggle("is-visible", isOpen);
      sidebarEl.inert = isMobileNav() && !isOpen;
    });
  }
  document.getElementById("sidebarBackdrop")?.addEventListener("click", () => closeSidebar(true));
  window.addEventListener("resize", () => {
    if (isMobileNav()) {
      if (sidebarEl) sidebarEl.inert = !sidebarEl.classList.contains("is-open");
    } else {
      closeSidebar();
    }
  });
  const closeCategory = (category) => {
    category.classList.remove("is-open");
    category.querySelector(".nav-category-trigger")?.setAttribute("aria-expanded", "false");
  };
  const closeAllCategories = () => {
    document.querySelectorAll("[data-nav-category].is-open").forEach(closeCategory);
  };
  document.querySelectorAll("[data-nav-category]").forEach((category) => {
    const trigger = category.querySelector(".nav-category-trigger");
    let closeTimer;
    const openCategory = () => {
      window.clearTimeout(closeTimer);
      document.querySelectorAll("[data-nav-category].is-open").forEach((otherCategory) => {
        if (otherCategory !== category) closeCategory(otherCategory);
      });
      category.classList.add("is-open");
      trigger?.setAttribute("aria-expanded", "true");
    };
    const scheduleClose = () => {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (!category.contains(document.activeElement)) closeCategory(category);
      }, 180);
    };
    category.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") openCategory();
    });
    category.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") scheduleClose();
    });
    category.addEventListener("focusin", openCategory);
    category.addEventListener("focusout", scheduleClose);
    trigger?.addEventListener("click", (event) => {
      const supportsHover = typeof window.matchMedia === "function" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (event.detail !== 0 && supportsHover) return;
      if (category.classList.contains("is-open")) closeCategory(category);
      else openCategory();
    });
    trigger?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeCategory(category);
      trigger.focus();
    });
  });
  document.querySelectorAll(".sidebar-nav .nav-item").forEach((link) => {
    link.addEventListener("click", () => {
      closeAllCategories();
      closeSidebar();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeAllCategories();
    closeSidebar(true);
  });

  if (!mainArea.querySelector(".site-footer")) {
    const footer = document.createElement("footer");
    footer.className = "site-footer app-site-footer";
    footer.innerHTML = `<p>© ${new Date().getFullYear()} ${escapeHtml(APP_CONFIG.branding.schoolName)} · Courtesy of <a href="https://clentindustries.vercel.app/" target="_blank" rel="noopener noreferrer">ClentIndustries</a></p>`;
    mainArea.appendChild(footer);
  }

  window.requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  if (!window.__lpsScrollPersistenceBound) {
    window.__lpsScrollPersistenceBound = true;
    let scrollTimer = 0;
    window.addEventListener("scroll", () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        try { sessionStorage.setItem(`lps_scroll_${window.location.pathname}`, String(window.scrollY)); } catch (error) { /* Storage is optional. */ }
      }, 120);
    }, { passive: true });
  }

  window.setTimeout(() => {
    const loadingState = document.querySelector(".state-row")?.textContent || "";
    const extraFieldsLoading = document.querySelector(".extra-fields-loading");
    if (loadingState.includes("Loading") || extraFieldsLoading) {
      showToast(
        "This section is taking longer than expected. Refresh the tab to try loading it again.",
        "info",
        { title: "Still loading", actionLabel: "Refresh tab", onAction: () => window.location.reload(), duration: 12000 }
      );
    }
  }, 8000);
}

export function todayFormatted() {
  return formatAppDate(new Date());
}

export function formatAppDate(value, fallback = "—") {
  if (!value) return fallback;
  let date;
  if (value && typeof value.toDate === "function") date = value.toDate();
  else if (value && typeof value === "object" && Number.isFinite(Number(value.seconds ?? value._seconds))) {
    date = new Date(Number(value.seconds ?? value._seconds) * 1000);
  }
  else if (typeof value === "number" && value > 20000 && value < 100000) date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date = new Date(`${value}T00:00:00`);
  else date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function appDateInputValue(value) {
  if (!value) return "";
  let date;
  if (value && typeof value.toDate === "function") date = value.toDate();
  else if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  else date = new Date(value);
  return Number.isNaN(date?.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/* ---- Toasts --------------------------------------------------------- */

export function ensureToastStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

export function showToast(message, type = "info", options = {}) {
  const stack = ensureToastStack();
  const toastKey = `${type}:${options.title || ""}:${message}`;
  const existing = [...stack.querySelectorAll(".toast")].find((toast) => toast.dataset.toastKey === toastKey);
  if (existing) {
    const previousTimer = Number(existing.dataset.dismissTimer);
    if (previousTimer) window.clearTimeout(previousTimer);
    existing.dataset.dismissTimer = String(window.setTimeout(() => existing.remove(), options.duration || 3800));
    return existing;
  }

  const visibleToasts = [...stack.querySelectorAll(".toast")];
  while (visibleToasts.length >= 2) visibleToasts.shift()?.remove();

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.dataset.toastKey = toastKey;
  el.setAttribute("role", type === "error" ? "alert" : "status");

  const copy = document.createElement("div");
  copy.className = "toast-copy";
  if (options.title) {
    const title = document.createElement("strong");
    title.textContent = options.title;
    copy.appendChild(title);
  }
  const text = document.createElement("span");
  text.textContent = message;
  copy.appendChild(text);
  el.appendChild(copy);

  if (options.actionLabel && typeof options.onAction === "function") {
    const action = document.createElement("button");
    action.className = "toast-action";
    action.type = "button";
    action.textContent = options.actionLabel;
    action.addEventListener("click", options.onAction);
    el.appendChild(action);
  }

  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "x";
  close.addEventListener("click", () => el.remove());
  el.appendChild(close);
  stack.appendChild(el);
  el.dataset.dismissTimer = String(window.setTimeout(() => el.remove(), options.duration || 3800));
  return el;
}

/* ---- Small formatting helpers used across pages ----------------------- */

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

export function programBadges(learner) {
  const map = [
    ["is4Ps", "4Ps Beneficiary", "badge-4ps"],
    ["isIP", "IP Learner", "badge-ip"],
    ["isSNED", "SNED", "badge-sned"],
    ["isARAL", "ARAL Tagged", "badge-aral"],
    ["isMuslim", "Muslim Learner", "badge-muslim"],
  ];
  const active = map.filter(([key]) => !!learner[key]);
  if (active.length === 0) return `<span class="badge badge-neutral">Not Tagged</span>`;
  return active.map(([, label, cls]) => `<span class="badge ${cls}">${label}</span>`).join(" ");
}

export function ensureAccountModal() {
  if (document.getElementById("accountModalBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="accountModalBackdrop"><div class="modal account-modal"><div class="modal-header"><div><span class="eyebrow-label">Personal account</span><h3 id="accountModalTitle">Account settings</h3></div><button class="modal-close" type="button" id="accountModalClose" aria-label="Close">${Icon.close || "×"}</button></div><form id="accountForm"><div class="modal-body" id="accountModalBody"></div><div class="modal-footer"><button class="btn btn-secondary" type="button" id="accountModalCancel">Cancel</button><button class="btn btn-primary" type="submit" id="accountModalSave">Save changes</button></div></form></div></div>`);
  document.getElementById("accountModalClose").addEventListener("click", closeAccountModal);
  document.getElementById("accountModalCancel").addEventListener("click", closeAccountModal);
  document.getElementById("accountModalBackdrop").addEventListener("click", (event) => { if (event.target.id === "accountModalBackdrop") closeAccountModal(); });
  document.getElementById("accountForm").addEventListener("submit", submitAccountChange);
  document.getElementById("accountModalBody").addEventListener("click", (event) => {
    const action = event.target.closest("[data-account-action]")?.dataset.accountAction;
    if (action) openAccountModal(action);
  });
}

export function openAccountSettingsModal() {
  ensureAccountModal();
  document.getElementById("accountModalTitle").textContent = "Account settings";
  document.getElementById("accountModalBody").innerHTML = `
    <div class="account-settings-options">
      <p>Manage your sign-in and profile details.</p>
      <button type="button" class="account-settings-option" data-account-action="password">
        <span class="account-settings-option-icon">${Icon.lock || Icon.userRound}</span>
        <span><strong>Change password</strong><small>Update your sign-in password</small></span>
        ${Icon.chevronRight}
      </button>
      <button type="button" class="account-settings-option" data-account-action="name">
        <span class="account-settings-option-icon">${Icon.userRound}</span>
        <span><strong>Change username</strong><small>Update your dashboard name</small></span>
        ${Icon.chevronRight}
      </button>
    </div>`;
  document.getElementById("accountForm").dataset.action = "";
  document.getElementById("accountModalCancel").textContent = "Close";
  document.getElementById("accountModalSave").style.display = "none";
  document.querySelector("#accountForm .modal-footer").style.display = "flex";
  document.getElementById("accountModalBackdrop").classList.add("is-open");
}

export function openAccountModal(action) {
  ensureAccountModal();
  const title = document.getElementById("accountModalTitle");
  const body = document.getElementById("accountModalBody");
  const isPassword = action === "password";
  title.textContent = isPassword ? "Change password" : "Change username";
  body.innerHTML = isPassword
    ? `<div class="account-modal-intro"><span class="account-modal-intro-icon">${Icon.lock || Icon.settings}</span><p>Choose a strong password for your Firebase sign-in account.</p></div><div class="field"><label for="accountCurrentPassword">Current password</label><input id="accountCurrentPassword" type="password" autocomplete="current-password" required /></div><div class="field"><label for="accountNewPassword">New password</label><input id="accountNewPassword" type="password" minlength="6" autocomplete="new-password" required /><small class="field-hint">Use at least 6 characters.</small></div><div class="field"><label for="accountConfirmPassword">Confirm new password</label><input id="accountConfirmPassword" type="password" autocomplete="new-password" required /></div>`
    : `<div class="account-modal-intro"><span class="account-modal-intro-icon">${Icon.userRound}</span><p>This name appears in your dashboard and in Manage Users. Your sign-in email will stay unchanged.</p></div><div class="field"><label for="accountNewName">Username</label><input id="accountNewName" maxlength="80" value="${escapeHtml(APP_USER_PROFILE?.name || "")}" required /><small class="field-hint">This changes your display name only, not your email address.</small></div>`;
  document.getElementById("accountForm").dataset.action = action;
  document.getElementById("accountModalCancel").textContent = "Cancel";
  document.getElementById("accountModalSave").style.display = "";
  document.querySelector("#accountForm .modal-footer").style.display = "";
  document.getElementById("accountModalBackdrop").classList.add("is-open");
  body.querySelector("input")?.focus();
}

export function closeAccountModal() { document.getElementById("accountModalBackdrop")?.classList.remove("is-open"); }

export function buildUpdatedProfile(currentProfile = {}, freshProfile = {}, updateResult = {}) {
  const preferredRole = freshProfile?.role || updateResult?.role || currentProfile.role || "School Staff";
  const preferredName = updateResult?.name || freshProfile?.name || currentProfile.name || "";
  const preferredEmail = freshProfile?.email || currentProfile.email || updateResult?.email || auth.currentUser?.email || "";
  const preferredUid = freshProfile?.userId || freshProfile?.uid || currentProfile.uid || updateResult?.uid || auth.currentUser?.uid || "";

  return {
    ...currentProfile,
    ...freshProfile,
    ...updateResult,
    name: preferredName,
    email: preferredEmail,
    uid: preferredUid,
    role: preferredRole,
  };
}

export async function submitAccountChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("accountModalSave");
  setButtonLoading(button, "Saving changes…");
  try {
    if (form.dataset.action === "password") {
      const current = document.getElementById("accountCurrentPassword").value;
      const next = document.getElementById("accountNewPassword").value;
      const confirm = document.getElementById("accountConfirmPassword").value;
      if (next !== confirm) throw new Error("The new passwords do not match.");
      const user = auth.currentUser;
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(next);
      showToast("Password changed successfully.", "success");
    } else {
      const result = await updateOwnProfileName(document.getElementById("accountNewName").value);
      const currentProfile = JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "null") || APP_USER_PROFILE || {};
      const freshProfile = typeof LPSApi !== "undefined" && LPSApi.getMyProfile ? await LPSApi.getMyProfile(auth.currentUser).catch(() => null) : null;
      const nextProfile = buildUpdatedProfile(currentProfile, freshProfile, result);
      setAppUserProfile(nextProfile);
      try {
        sessionStorage.setItem(LPS_SESSION_KEY, JSON.stringify({
          ...JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "{}"),
          ...nextProfile,
          name: nextProfile.name,
        }));
      } catch (error) { /* Ignore optional cache update. */ }
      document.querySelector(".topbar-user-text .name")?.replaceChildren(document.createTextNode(nextProfile.name));
      document.querySelector(".settings-profile-name")?.replaceChildren(document.createTextNode(nextProfile.name));
      showToast("Username updated successfully.", "success");
    }
    closeAccountModal();
  } catch (error) {
    const message = error.code === "auth/wrong-password" || error.code === "auth/invalid-credential" ? "The current password is incorrect." : error.message || "Account update failed.";
    showToast(message, "error");
  } finally { clearButtonLoading(button); }
}

export async function updateOwnProfileName(name) {
  const user = auth.currentUser;
  const value = String(name || "").trim();
  if (!user) throw new Error("Not signed in.");
  if (value.length < 2) throw new Error("Username must be at least 2 characters.");
  if (value.length > 80) throw new Error("Username must be 80 characters or fewer.");
  if (typeof LPSApi !== "undefined" && LPSApi.updateMyProfileName) return LPSApi.updateMyProfileName(value);
  await db.collection("users").doc(user.uid).update({ name: value });
  return { name: value };
}
