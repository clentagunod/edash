import { File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectGmail, createGmailRaw, GMAIL_SEND_SCOPE, parseEmailAddresses, sendGmailMessage, validateGmailMessage, type GmailMessage } from './gmail-send';

const message: GmailMessage = { to: 'records@example.edu', cc: '', bcc: 'registrar@example.edu', replyTo: '', subject: 'SF10 — Niño Cruz', body: 'Please send the learner’s permanent records.\nThank you.' };
const attachment = () => new NodeFile(['sample document'], 'SF10-Niño.pdf', { type: 'application/pdf' }) as unknown as File;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Gmail SF10 sending', () => {
  it('constructs a UTF-8 MIME attachment with recipients and URL-safe encoding', async () => {
    const raw = await createGmailRaw(message, 'sender@gmail.com', attachment());
    expect(raw).not.toMatch(/[+/=]/);
    const mime = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    expect(mime).toContain('To: records@example.edu\r\n');
    expect(mime).toContain('Bcc: registrar@example.edu\r\n');
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('Content-Disposition: attachment; filename="SF10-Ni_o.pdf"');
    expect(mime).toContain(btoa('sample document'));
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
  });
  it('rejects header injection, empty recipients, and invalid reply-to lists', async () => {
    expect(() => parseEmailAddresses('student@example.edu\r\nBcc: injected@example.edu')).toThrow('line breaks');
    expect(() => validateGmailMessage({ ...message, to: '' })).toThrow('valid email');
    expect(() => validateGmailMessage({ ...message, subject: 'SF10\nInjected: yes' })).toThrow('subject');
    expect(() => validateGmailMessage({ ...message, replyTo: 'one@example.edu,two@example.edu' })).toThrow('one Reply-to');
    expect(parseEmailAddresses('one@example.edu; one@example.edu, two@gmail.com')).toEqual(['one@example.edu', 'two@gmail.com']);
  });
  it('requests send-only Gmail access and identifies the selected sender without storing the token', async () => {
    vi.stubEnv('VITE_GMAIL_CLIENT_ID', 'sample.apps.googleusercontent.com');
    const requestAccessToken = vi.fn();
    const initTokenClient = vi.fn((config) => { queueMicrotask(() => config.callback({ access_token: 'memory-only-token', expires_in: 3600 })); return { requestAccessToken }; });
    Object.assign(window, { google: { accounts: { oauth2: { initTokenClient, hasGrantedAllScopes: () => true } } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'sender@gmail.com', email_verified: true }) }));
    const connection = await connectGmail();
    expect(initTokenClient.mock.calls[0][0].scope).toContain(GMAIL_SEND_SCOPE);
    expect(initTokenClient.mock.calls[0][0].scope).not.toContain('gmail.readonly');
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(connection.email).toBe('sender@gmail.com');
    expect(localStorage.getItem('gmailToken')).toBeNull();
    delete (window as Window & { google?: unknown }).google;
  });
  it('sends once and does not retry an uncertain network failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('network interrupted'));
    vi.stubGlobal('fetch', fetcher);
    await expect(sendGmailMessage({ token: 'token', email: 'sender@gmail.com', expiresAt: Date.now() + 10000 }, message, attachment())).rejects.toThrow('Sent folder');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  });
  it('does not send with an expired connection or oversized attachment', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(sendGmailMessage({ token: 'token', email: 'sender@gmail.com', expiresAt: 0 }, message, attachment())).rejects.toThrow('expired');
    const file = attachment(); Object.defineProperty(file, 'size', { value: 19 * 1024 * 1024 });
    await expect(createGmailRaw(message, 'sender@gmail.com', file)).rejects.toThrow('18 MB');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
