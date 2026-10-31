export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_SCOPES = `${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`;
interface TokenResponse { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
interface GoogleIdentity { accounts: { oauth2: { initTokenClient(config: { client_id: string; scope: string; include_granted_scopes: boolean; callback(response: TokenResponse): void; error_callback(error: { type: string }): void }): { requestAccessToken(options: { prompt: string }): void }; hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean } } }
type GoogleWindow = Window & { google?: GoogleIdentity };
export interface GmailConnection { token: string; email: string; expiresAt: number }
export interface GmailMessage { to: string; cc: string; bcc: string; replyTo: string; subject: string; body: string }
let loading: Promise<void> | null = null;
export function gmailClientId(): string { return String(import.meta.env.VITE_GMAIL_CLIENT_ID || '').trim(); }
export function loadGoogleIdentity(): Promise<void> {
  if ((window as GoogleWindow).google?.accounts.oauth2) return Promise.resolve();
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timeout = window.setTimeout(() => { script.remove(); loading = null; reject(new Error('Google sign-in took too long. Check your connection and try again.')); }, 15000);
    script.onload = () => { window.clearTimeout(timeout); if ((window as GoogleWindow).google?.accounts.oauth2) resolve(); else { loading = null; reject(new Error('Google sign-in could not initialize.')); } };
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); loading = null; reject(new Error('Google sign-in could not load. Check your connection.')); };
    document.head.append(script);
  });
  return loading;
}
/** Called synchronously from a click after the library loads, preserving popup activation. Tokens stay in memory. */
export function connectGmail(): Promise<GmailConnection> {
  const clientId = gmailClientId(), oauth = (window as GoogleWindow).google?.accounts.oauth2;
  if (!clientId || !oauth) return Promise.reject(new Error('Gmail is not configured or Google sign-in is still loading.'));
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({ client_id: clientId, scope: GMAIL_SCOPES, include_granted_scopes: false,
      callback(response) {
        if (response.error || !response.access_token || !oauth.hasGrantedAllScopes(response, GMAIL_SEND_SCOPE, 'https://www.googleapis.com/auth/userinfo.email')) { reject(new Error('Google did not grant permission to send email. Connect again and allow the requested permissions.')); return; }
        const token = response.access_token;
        void fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }).then(async (result) => {
          if (!result.ok) throw new Error('Could not verify the sending Gmail account. Connect again.');
          const profile = await result.json() as { email?: string; email_verified?: boolean };
          if (!profile.email || !profile.email_verified) throw new Error('Choose a Google account with a verified email address.');
          resolve({ token, email: profile.email, expiresAt: Date.now() + Math.max(0, Number(response.expires_in || 3600) - 60) * 1000 });
        }).catch(reject);
      }, error_callback(error) { reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was closed. No email was sent.' : 'Google sign-in could not open. Allow the popup and try again.')); },
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}
export function parseEmailAddresses(value: string, required = false): string[] {
  if (/[\r\n]/.test(value)) throw new Error('Email addresses cannot contain line breaks.');
  const addresses = value.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean);
  if ((required && !addresses.length) || addresses.some((email) => email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email))) throw new Error('Enter valid email addresses, separated by commas.');
  return [...new Set(addresses)];
}
export function validateGmailMessage(message: GmailMessage): void {
  const recipients = [parseEmailAddresses(message.to, true), parseEmailAddresses(message.cc), parseEmailAddresses(message.bcc)].flat();
  if (recipients.length > 50) throw new Error('Send to no more than 50 recipients at a time.');
  if (parseEmailAddresses(message.replyTo).length > 1) throw new Error('Use one Reply-to address.');
  if (!message.subject.trim() || message.subject.length > 200 || /[\r\n]/.test(message.subject)) throw new Error('Enter a subject up to 200 characters without line breaks.');
  if (!message.body.trim() || message.body.length > 20_000) throw new Error('Enter a message up to 20,000 characters.');
}
function base64(bytes: Uint8Array): string {
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
const utf8base64 = (value: string) => base64(new TextEncoder().encode(value));
const wrap = (value: string) => value.match(/.{1,76}/g)?.join('\r\n') || '';
function encodedSubject(value: string): string {
  const words: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (new TextEncoder().encode(chunk + character).length > 42) { words.push(`=?UTF-8?B?${utf8base64(chunk)}?=`); chunk = ''; }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${utf8base64(chunk)}?=`);
  return words.join('\r\n ');
}
export async function createGmailRaw(message: GmailMessage, sender: string, file: File): Promise<string> {
  validateGmailMessage(message);
  if (parseEmailAddresses(sender, true).length !== 1) throw new Error('Connect one sending Google account.');
  if (file.size > 18 * 1024 * 1024) throw new Error('The attachment exceeds 18 MB. Select fewer learners or use PDF.');
  const boundary = `edash_${crypto.randomUUID().replace(/-/g, '')}`;
  const safeName = file.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 160) || 'sf10-request.pdf';
  const headers = [`From: ${sender}`, `To: ${parseEmailAddresses(message.to).join(',\r\n ')}`];
  for (const [name, value] of [['Cc', message.cc], ['Bcc', message.bcc], ['Reply-To', message.replyTo]]) if (value.trim()) headers.push(`${name}: ${parseEmailAddresses(value).join(',\r\n ')}`);
  headers.push(`Subject: ${encodedSubject(message.subject.trim())}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`);
  const raw = [...headers, '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(utf8base64(message.body)), `--${boundary}`, `Content-Type: ${file.type || 'application/octet-stream'}; name="${safeName}"`, `Content-Disposition: attachment; filename="${safeName}"`, 'Content-Transfer-Encoding: base64', '', wrap(base64(new Uint8Array(await file.arrayBuffer()))), `--${boundary}--`, ''].join('\r\n');
  return utf8base64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sendGmailMessage(connection: GmailConnection, message: GmailMessage, file: File): Promise<string> {
  if (Date.now() >= connection.expiresAt) throw new Error('The Gmail connection expired. Connect the sending account again.');
  const raw = await createGmailRaw(message, connection.email, file);
  let response: Response;
  try { response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(60000) }); }
  catch { throw new Error('Gmail did not confirm delivery. Check the sending account’s Sent folder before trying again.'); }
  if (!response.ok) {
    if (response.status === 401) throw new Error('The Gmail connection expired. Connect the account again.');
    if (response.status === 403) throw new Error('Gmail denied sending. Check the Gmail API configuration and account permissions.');
    if (response.status === 429) throw new Error('Gmail’s sending limit was reached. Try again later.');
    throw new Error('Gmail could not confirm sending. Check Sent before trying again.');
  }
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error('Gmail did not confirm the message. Check Sent before trying again.');
  return result.id;
}
