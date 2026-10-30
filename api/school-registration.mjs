// Vercel Node.js Function. All Google credentials stay on the server.
const ACTIONS = new Set([
  'submitSchoolRegistration', 'getSchoolInvitation', 'submitCompleteSchoolRegistration',
]);
const MAX_BYTES = 24 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function upstreamFailure(code, upstreamStatus) {
  return Object.assign(new Error(code), { code, upstreamStatus });
}

async function callRegistrationScript(endpoint, payload, secret) {
  const signal = AbortSignal.timeout(20_000);
  let upstream = await fetch(endpoint, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...payload, sharedSecret: secret }), signal,
  });
  // ContentService publishes the response at a one-time Google URL. Fetch that
  // output with GET, without resending applicant data or the server secret.
  for (let redirects = 0; REDIRECT_STATUSES.has(upstream.status); redirects++) {
    const location = upstream.headers.get('location');
    let target;
    try { target = new URL(location); } catch { throw upstreamFailure('SCRIPT_REDIRECT_INVALID', upstream.status); }
    if (redirects >= 3 || target.protocol !== 'https:' || target.hostname !== 'script.googleusercontent.com'
      || target.username || target.password || target.port) {
      throw upstreamFailure('SCRIPT_DEPLOYMENT_ACCESS', upstream.status);
    }
    upstream = await fetch(target.href, { method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' }, signal });
  }
  if (!upstream.ok) throw upstreamFailure('SCRIPT_HTTP_ERROR', upstream.status);
  let result;
  try { result = await upstream.json(); }
  catch (error) {
    if (signal.aborted) throw error;
    throw upstreamFailure('SCRIPT_RESPONSE_INVALID', upstream.status);
  }
  if (typeof result?.ok !== 'boolean') throw upstreamFailure('SCRIPT_PROTOCOL_MISMATCH', upstream.status);
  return result;
}

function confirmedReply(action, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (action === 'submitSchoolRegistration') return data.status === 'Received' && typeof data.duplicate === 'boolean';
  if (action === 'submitCompleteSchoolRegistration') return typeof data.registrationId === 'string' && data.registrationId.length > 0;
  return (typeof data.registrationId === 'string' && data.registrationId.length > 0)
    || ['schoolName', 'schoolId', 'contactName', 'email', 'phone', 'division'].every((field) => typeof data[field] === 'string' && data[field].length > 0);
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const fail = (status, error, code) => response.status(status).json({ ok: false, error, ...(code ? { code } : {}) });
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return fail(405, 'Use POST to submit a registration.');
  }
  const origins = (process.env.SCHOOL_REGISTRATION_ALLOWED_ORIGINS ||
    'https://www.edash.online,https://edash.online,https://register.edash.online')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (!request.headers.origin || !origins.includes(request.headers.origin)) {
    return fail(403, 'This registration origin is not allowed.');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    return fail(415, 'Send registration data as JSON.');
  }
  let payload;
  try {
    if (Number(request.headers['content-length']) > MAX_BYTES) return fail(413, 'The submission is too large.');
    const body = request.body;
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return fail(413, 'The submission is too large.');
    payload = typeof body === 'string' ? JSON.parse(body) : body;
    if (!payload || Array.isArray(payload) || !ACTIONS.has(payload.action)) return fail(400, 'Invalid registration action.');
  } catch {
    return fail(400, 'Invalid registration data.');
  }
  const endpoint = process.env.SCHOOL_REGISTRATION_SCRIPT_URL?.trim();
  const secret = process.env.SCHOOL_REGISTRATION_SHARED_SECRET?.trim();
  if (!endpoint || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) || !secret || secret.length < 32) {
    return fail(503, 'School registration is not available yet. Please contact the E-Dash team.');
  }
  try {
    const result = await callRegistrationScript(endpoint, payload, secret);
    if (!result.ok) {
      // Script errors are deliberately limited to public validation messages.
      const status = [400, 403, 409, 410, 429, 503].includes(result.status) ? result.status : 502;
      const code = typeof result.code === 'string' && /^REGISTRATION_[A-Z_]+$/.test(result.code) ? result.code : undefined;
      return fail(status, typeof result.error === 'string' ? result.error : 'Registration could not be saved.', code);
    }
    if (!confirmedReply(payload.action, result.data)) throw upstreamFailure('SCRIPT_PROTOCOL_MISMATCH');
    return response.status(200).json({ ok: true, data: result.data });
  } catch (error) {
    const timeout = ['AbortError', 'TimeoutError'].includes(error?.name);
    const knownCodes = new Set(['SCRIPT_REDIRECT_INVALID', 'SCRIPT_DEPLOYMENT_ACCESS', 'SCRIPT_HTTP_ERROR', 'SCRIPT_RESPONSE_INVALID', 'SCRIPT_PROTOCOL_MISMATCH']);
    const code = timeout ? 'SCRIPT_TIMEOUT' : knownCodes.has(error?.code) ? error.code : 'SCRIPT_UNREACHABLE';
    // Safe operational metadata only; never log request bodies, URLs, tokens,
    // shared secrets, raw exceptions, or Google response bodies.
    console.error('School registration upstream failure', { code, ...(Number.isInteger(error?.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}) });
    if (['SCRIPT_REDIRECT_INVALID', 'SCRIPT_DEPLOYMENT_ACCESS', 'SCRIPT_RESPONSE_INVALID', 'SCRIPT_PROTOCOL_MISMATCH'].includes(code)) {
      return fail(503, 'The registration service could not return a valid confirmation. Please contact the E-Dash team to check its Google Apps Script deployment.', code);
    }
    return fail(timeout ? 504 : 502, 'We could not confirm your submission. Please retry; saved submissions will not be duplicated.', code);
  }
}
