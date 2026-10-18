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

import { initAuditLog, loadAuditLog } from './audit-log';

describe('audit log loading errors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="auditSearch" />
      <div id="auditMeta"></div>
      <table><tbody id="auditTableBody"></tbody></table>
      <button id="auditPreviousPage" type="button"></button>
      <span id="auditPageStatus"></span>
      <button id="auditNextPage" type="button"></button>
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

  it('requests one page of ten audit records and navigates to the next page', async () => {
    const page = (pageNumber: number) => ({
      records: Array.from({ length: 10 }, (_, index) => ({
        timestamp: `2026-10-${String(18 - index).padStart(2, '0')}`,
        user: 'admin@example.test',
        action: 'LOGIN',
        recordId: `record-${pageNumber}-${index}`,
      })),
      page: pageNumber,
      pageSize: 10,
      total: 25,
      totalPages: 3,
    });
    getAuditLogs.mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(2));

    await initAuditLog({ renderNavigation: false });

    expect(getAuditLogs).toHaveBeenNthCalledWith(1, 1);
    expect(document.querySelectorAll('#auditTableBody tr')).toHaveLength(10);
    expect(document.getElementById('auditPageStatus')?.textContent).toBe('Page 1 of 3');
    expect(document.getElementById('auditPreviousPage')?.hasAttribute('disabled')).toBe(true);
    expect(document.getElementById('auditNextPage')?.hasAttribute('disabled')).toBe(false);
    expect(document.getElementById('auditMeta')?.textContent).toContain('Showing 1–10 of 25 entries');

    document.getElementById('auditNextPage')?.click();
    await vi.waitFor(() => expect(getAuditLogs).toHaveBeenNthCalledWith(2, 2));
    await vi.waitFor(() => expect(document.getElementById('auditPageStatus')?.textContent).toBe('Page 2 of 3'));

    expect(document.querySelector('#auditTableBody')?.textContent).toContain('record-2-0');
    expect(document.querySelector('#auditTableBody')?.textContent).not.toContain('record-1-0');
    expect(document.getElementById('auditPreviousPage')?.hasAttribute('disabled')).toBe(false);
    expect(document.getElementById('auditMeta')?.textContent).toContain('Showing 11–20 of 25 entries');
  });

  it('limits search results to the current page', async () => {
    getAuditLogs.mockResolvedValue({
      records: [
        { timestamp: '2026-10-18', user: 'admin@example.test', action: 'LOGIN' },
        { timestamp: '2026-10-17', user: 'teacher@example.test', action: 'LEARNER_UPDATE' },
      ],
      page: 1,
      pageSize: 10,
      total: 22,
      totalPages: 3,
    });

    await initAuditLog({ renderNavigation: false });
    const search = document.getElementById('auditSearch') as HTMLInputElement;
    search.value = 'teacher';
    search.dispatchEvent(new Event('input'));

    expect(document.querySelectorAll('#auditTableBody tr')).toHaveLength(1);
    expect(document.querySelector('#auditTableBody')?.textContent).toContain('teacher@example.test');
    expect(document.getElementById('auditMeta')?.textContent).toContain('1 matching entry on this page');
  });
});