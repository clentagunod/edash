import { beforeEach, describe, expect, it, vi } from 'vitest';
import manageUsersMarkup from '../pages/markup/manage-users.html?raw';

const { mockGetSections } = vi.hoisted(() => ({ mockGetSections: vi.fn() }));

vi.mock('./shell', () => ({
  appPageHref: vi.fn(),
  clearButtonLoading: vi.fn(),
  escapeHtml: (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character])),
  renderShell: vi.fn(),
  setButtonLoading: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('./sheets-api', () => ({ LPSApi: { getSections: mockGetSections } }));
vi.mock('./app-config', () => ({
  confirmDiscardChanges: vi.fn(),
  formSnapshot: vi.fn(),
  isSchoolAdmin: vi.fn(),
  normalizeTeacherAssignmentsForStorage: vi.fn((assignments) => assignments),
}));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./demo-data', () => ({ DEMO_USERS: [], isSheetsApiConfigured: vi.fn() }));
vi.mock('./icons', () => ({ Icon: vi.fn() }));
vi.mock('./firestore-api', () => ({ fsGetUsers: vi.fn(), fsSubscribeUsers: vi.fn() }));

import {
  filterTeacherAssignmentSections,
  initAdminSectionTabs,
  loadTeacherAssignmentSections,
  updateTeacherAssignmentSummary,
} from './manage-users';

describe('Manage Users account roles', () => {
  it('offers only roles managed by account administration', () => {
    const document = new DOMParser().parseFromString(manageUsersMarkup, 'text/html');
    const roles = [...document.querySelectorAll<HTMLSelectElement>('#u_role option')]
      .map((option) => option.value);

    expect(roles).toEqual(['School Admin', 'Registrar', 'Teacher']);
    expect(roles).not.toContain('Visitor');
  });
});

describe('Admin Console section navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div role="tablist">
        <button id="adminStructureTab" role="tab" aria-selected="true" aria-controls="adminStructurePanel"></button>
        <button id="adminAccessTab" role="tab" aria-selected="false" aria-controls="adminAccessPanel"></button>
        <button id="adminBackupTab" role="tab" aria-selected="false" aria-controls="adminBackupPanel"></button>
        <button id="adminAuditTab" role="tab" aria-selected="false" aria-controls="adminAuditPanel"></button>
      </div>
      <section id="adminStructurePanel"></section>
      <section id="adminAccessPanel" hidden></section>
      <section id="adminBackupPanel" hidden></section>
      <section id="adminAuditPanel" hidden></section>
    `;
  });

  it('navigates between the remaining sections without a Database usage tab', () => {
    initAdminSectionTabs();
    const backupTab = document.getElementById('adminBackupTab') as HTMLButtonElement;
    backupTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(document.getElementById('adminUsageTab')).toBeNull();
    expect(document.getElementById('adminUsagePanel')).toBeNull();
    expect(document.getElementById('adminAuditTab')?.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('adminAuditPanel')?.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('adminBackupPanel')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('teacher assignment selector', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="u_teacher_year"><option value="2026-2027">2026-2027</option></select>
      <input id="teacherAssignmentSearch" type="search" />
      <button id="teacherAssignmentSelectAll" type="button"></button>
      <span id="teacherAssignmentSummary"></span>
      <div id="u_teacher_section"></div>
    `;
    mockGetSections.mockReset().mockResolvedValue([
      { gradeLevel: 'Grade 2', section: 'B' },
      { gradeLevel: 'Grade 1', section: 'Gold' },
      { gradeLevel: 'Grade 2', section: 'A' },
    ]);
  });

  it('groups sections by grade and preserves selected assignment checkboxes', async () => {
    await loadTeacherAssignmentSections([{ gradeLevel: '1', section: 'Gold' }]);

    const groups = [...document.querySelectorAll('.teacher-assignment-grade-group')];
    expect(groups.map((group) => group.querySelector('.teacher-assignment-grade-heading > span')?.textContent))
      .toEqual(['Grade 1', 'Grade 2']);
    expect(document.querySelector<HTMLInputElement>('.teacher-assignment-option input')?.checked).toBe(true);
    expect(document.getElementById('teacherAssignmentSummary')?.textContent).toBe('1 section selected · 1 grade');
  });

  it('filters the list without changing checked assignments and updates selection counts', async () => {
    await loadTeacherAssignmentSections([{ gradeLevel: 'Grade 2', section: 'B' }]);
    const search = document.getElementById('teacherAssignmentSearch') as HTMLInputElement;
    search.value = 'gold';
    filterTeacherAssignmentSections();

    expect(document.querySelectorAll('.teacher-assignment-option:not([hidden])')).toHaveLength(1);
    expect(document.querySelector('.teacher-assignment-grade-group[hidden]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('.teacher-assignment-option input:checked')?.dataset.grade).toBe('Grade 2');

    const boxes = document.querySelectorAll<HTMLInputElement>('#u_teacher_section input[type="checkbox"]');
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('teacherAssignmentSummary')?.textContent).toBe('2 sections selected · 2 grades');
  });
});
