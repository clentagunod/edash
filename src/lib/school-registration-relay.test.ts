import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/school-registration.mjs';

const secret = 'test-only-secret-that-is-at-least-32-characters';
const request = (body: unknown = { action: 'getSchoolInvitation', token: 'private-token' }) => ({
  method: 'POST', headers: { origin: 'https://register.edash.online', 'content-type': 'application/json' }, body,
});
function response() {
  return { code: 200, body: null as any, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { status: 'Invited' } }) });
    vi.stubGlobal('fetch', fetch);
    const res = response(); await handler(request({ action: 'getSchoolInvitation', sharedSecret: 'attacker' }), res);
    expect(JSON.parse(fetch.mock.calls[0][1].body).sharedSecret).toBe(secret);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: 'Invited' } });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('handles Apps Script HTML/auth failures without revealing upstream details', async () => {
    vi.stubEnv('SCHOOL_REGISTRATION_SCRIPT_URL', 'https://script.google.com/macros/s/test/exec');
    vi.stubEnv('SCHOOL_REGISTRATION_SHARED_SECRET', secret);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('private response'); } }));
    const res = response(); await handler(request(), res);
    expect(res.code).toBe(502);
    expect(res.body.error).not.toContain('private response');
    expect(res.body.error).toContain('retry');
  });
});
