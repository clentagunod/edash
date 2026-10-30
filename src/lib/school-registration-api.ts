export interface RegistrationReply {
  requestId?: string;
  registrationId?: string;
  duplicate?: boolean;
  status?: string;
  schoolName?: string;
  schoolId?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  division?: string;
}

/** Same-origin relay keeps Apps Script credentials out of browser bundles. */
export async function schoolRegistrationApi(
  action: 'submitSchoolRegistration' | 'getSchoolInvitation' | 'submitCompleteSchoolRegistration',
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<RegistrationReply> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 25_000);
  try {
    const response = await fetch('/api/school-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({ ...payload, action }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      throw new Error(typeof result?.error === 'string'
        ? result.error
        : 'Registration is temporarily unavailable. Please try again later.');
    }
    return result.data || {};
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
