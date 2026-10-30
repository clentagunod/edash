// Vercel Node.js Function. All Google credentials stay on the server.
const ACTIONS = new Set([
  'submitSchoolRegistration', 'getSchoolInvitation', 'submitCompleteSchoolRegistration',
]);
const MAX_BYTES = 24 * 1024;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const fail = (status, error) => response.status(status).json({ ok: false, error });
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
    const upstream = await fetch(endpoint, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, sharedSecret: secret }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) throw new Error('upstream');
    const result = await upstream.json();
    if (typeof result?.ok !== 'boolean') throw new Error('protocol');
    if (!result.ok) {
      // Script errors are deliberately limited to public validation messages.
      const status = [400, 403, 409, 410, 429, 503].includes(result.status) ? result.status : 502;
      return fail(status, typeof result.error === 'string' ? result.error : 'Registration could not be saved.');
    }
    return response.status(200).json({ ok: true, data: result.data });
  } catch {
    // Do not log payloads, invitation links, secrets, or upstream response bodies.
    return fail(502, 'We could not confirm your submission. Please retry; saved submissions will not be duplicated.');
  }
}
