import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/school-registration.mjs';

const secret = 'test-only-secret-that-is-at-least-32-characters';
const invitation = { schoolName: 'Sample School', schoolId: '001234', contactName: 'School Admin', email: 'admin@example.com', phone: '09123456789', division: 'Sample Division' };
const upstream = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => data });
const request = (body: unknown = { action: 'getSchoolInvitation', token: 'private-token' }) => ({
  method: 'POST', headers: { origin: 'https://register.edash.online', 'content-type': 'application/json' }, body,
});
function response() {
  return { code: 200, body: null as any, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
}
beforeEach(() => {
  vi.stubEnv('SCHOOL_REGISTRATION_SCRIPT_URL', 'https://script.google.com/macros/s/test/exec');
  vi.stubEnv('SCHOOL_REGISTRATION_SHARED_SECRET', secret);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('registration relay', () => {
  it('rejects foreign origins, non-POST requests, unsupported actions and oversized bodies', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const [req, code] of [
      [{ ...request(), method: 'GET' }, 405],
      [{ ...request(), headers: { origin: 'https://other.example.com' } }, 403],
      [request({ action: 'listAllRegistrations' }), 400],
      [request({ action: 'getSchoolInvitation', value: 'x'.repeat(25_000) }), 413],
    ] as const) {
      const res = response(); await handler(req, res); expect(res.code).toBe(code);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('adds only the server-side secret and relays confirmed JSON results', async () => {
    vi.stubEnv('SCHOOL_REGISTRATION_SCRIPT_URL', 'https://script.google.com/macros/s/test/exec');
    vi.stubEnv('SCHOOL_REGISTRATION_SHARED_SECRET', secret);
    const fetch = vi.fn().mockResolvedValue(upstream({ ok: true, data: invitation }));
    vi.stubGlobal('fetch', fetch);
    const res = response(); await handler(request({ action: 'getSchoolInvitation', sharedSecret: 'attacker' }), res);
    expect(JSON.parse(fetch.mock.calls[0][1].body).sharedSecret).toBe(secret);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ ok: true, data: invitation });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('handles Apps Script HTML/auth failures without revealing upstream details', async () => {
    vi.stubEnv('SCHOOL_REGISTRATION_SCRIPT_URL', 'https://script.google.com/macros/s/test/exec');
    vi.stubEnv('SCHOOL_REGISTRATION_SHARED_SECRET', secret);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('private response'); } }));
    const res = response(); await handler(request(), res);
    expect(res.code).toBe(503);
    expect(res.body.error).not.toContain('private response');
    expect(res.body.code).toBe('SCRIPT_RESPONSE_INVALID');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private response');
  });

  it('follows ContentService redirects with GET and never resends a secret or applicant payload', async () => {
    const output = 'https://script.googleusercontent.com/macros/echo?user_content_key=private-output-key';
    const fetch = vi.fn()
      .mockResolvedValueOnce({ status: 302, headers: new Headers({ Location: output }) })
      .mockResolvedValueOnce(upstream({ ok: true, data: { requestId: 'REQ-123', status: 'Received', duplicate: false } }));
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handler(request({ action: 'submitSchoolRegistration', schoolName: 'Private school' }), res);
    expect(res.code).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
    expect(fetch.mock.calls[1][0]).toBe(output);
    expect(fetch.mock.calls[1][1].method).toBe('GET');
    expect(fetch.mock.calls[1][1]).not.toHaveProperty('body');
    expect(JSON.stringify(fetch.mock.calls[1][1])).not.toContain(secret);
    expect(fetch.mock.calls[1][1].signal).toBe(fetch.mock.calls[0][1].signal);
  });

  it.each(['https://accounts.google.com/signin', 'https://example.com/collect', 'https://script.googleusercontent.com.evil.example/echo'])('rejects an unexpected redirect to %s', async (location) => {
    const fetch = vi.fn().mockResolvedValue({ status: 302, headers: new Headers({ Location: location }) });
    vi.stubGlobal('fetch', fetch);
    const res = response(); await handler(request(), res);
    expect(res.code).toBe(503);
    expect(res.body.code).toBe('SCRIPT_DEPLOYMENT_ACCESS');
    expect(fetch).toHaveBeenCalledOnce();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(location);
    expect(logged).not.toContain(secret);
  });

  it.each([{}, { service: 'different Google service' }, { status: 'Received' }])('does not confirm a submission with an incomplete reply %s', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream({ ok: true, data })));
    const res = response(); await handler(request({ action: 'submitSchoolRegistration' }), res);
    expect(res.code).toBe(503);
    expect(res.body.code).toBe('SCRIPT_PROTOCOL_MISMATCH');
  });

  it('relays storage diagnostics and successful duplicate confirmations', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(upstream({ ok: false, status: 503, code: 'REGISTRATION_SPREADSHEET_ACCESS', error: 'Registration storage is unavailable.' }))
      .mockResolvedValueOnce(upstream({ ok: true, data: { requestId: 'REQ-123', status: 'Received', duplicate: true } }));
    vi.stubGlobal('fetch', fetch);
    const first = response(); await handler(request({ action: 'submitSchoolRegistration' }), first);
    expect(first.body.code).toBe('REGISTRATION_SPREADSHEET_ACCESS');
    const retry = response(); await handler(request({ action: 'submitSchoolRegistration' }), retry);
    expect(retry.code).toBe(200);
    expect(retry.body.data.duplicate).toBe(true);
  });

  it('reports timeouts and network failures without retrying a write or leaking exception text', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('private request body'), { name: 'TimeoutError' }))
      .mockRejectedValueOnce(new Error(`private upstream ${secret}`));
    vi.stubGlobal('fetch', fetch);
    const timeout = response(); await handler(request({ action: 'submitSchoolRegistration' }), timeout);
    expect(timeout.code).toBe(504);
    expect(timeout.body.code).toBe('SCRIPT_TIMEOUT');
    const network = response(); await handler(request({ action: 'submitSchoolRegistration' }), network);
    expect(network.code).toBe(502);
    expect(network.body.code).toBe('SCRIPT_UNREACHABLE');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private');
  });
});
