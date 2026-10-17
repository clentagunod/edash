import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuditLogs } = vi.hoisted(() => ({
  getAuditLogs: vi.fn(),
}));

vi.mock('./sheets-api', () => ({ LPSApi: { getAuditLogs } }));
vi.mock('./app-config', () => ({
  APP_CONFIG: { auditLogApiUrl: 'https://example.test/audit' },
  isSchoolAdmin: () => true,
}));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./shell', () => ({
  appPageHref: (path: string) => path,
  escapeHtml: (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  renderShell: vi.fn(),
}));

import { loadAuditLog } from './audit-log';

describe('audit log loading errors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="auditSearch" />
      <div id="auditMeta"></div>
      <table><tbody id="auditTableBody"></tbody></table>
    `;
    getAuditLogs.mockReset();
  });

  it('explains how to fix the generic Firebase auth error from older deployments', async () => {
    getAuditLogs.mockRejectedValue(new Error('Firebase authentication failed.'));

    await loadAuditLog();

    const message = document.querySelector('#auditTableBody')?.textContent || '';
    expect(message).toContain('Redeploy the latest apps-script/AuditLog.gs');
    expect(message).toContain('FIREBASE_WEB_API_KEY');
    expect(message).toContain('FIRESTORE_PROJECT_ID');
    expect(document.getElementById('auditMeta')?.textContent).toBe('Audit log unavailable');
  });

  it('preserves detailed Firebase auth diagnostics from current deployments', async () => {
    getAuditLogs.mockRejectedValue(
      new Error('Firebase authentication failed (API_KEY_SERVICE_BLOCKED, HTTP 403). Check the API key.'),
    );

    await loadAuditLog();

    expect(document.querySelector('#auditTableBody')?.textContent)
      .toBe('Firebase authentication failed (API_KEY_SERVICE_BLOCKED, HTTP 403). Check the API key.');
  });
});