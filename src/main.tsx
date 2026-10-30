// Registration is independent of tenant Firebase initialization, authentication,
// stored school selection, and centralized maintenance settings.
const isRegistration = window.location.hostname === 'register.edash.online' ||
  /^\/register\/?$/.test(window.location.pathname);

// Keep separate async boundaries. Combining the imports into a conditional
// expression lets production optimization merge Vite's CSS preload metadata,
// which can attach the application stylesheet to the registration entry.
async function mountRegistration() {
  await import('./registration-entry');
}

async function mountApplication() {
  await import('./application-entry');
}

if (isRegistration) void mountRegistration();
else void mountApplication();
