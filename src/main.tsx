// Registration is independent of tenant Firebase initialization, authentication,
// stored school selection, and centralized maintenance settings.
const isRegistration = window.location.hostname === 'register.edash.online' ||
  /^\/register\/?$/.test(window.location.pathname);

if (isRegistration) {
  void import('./registration-entry');
} else {
  void import('./application-entry');
}
