import { describe, expect, it, vi } from 'vitest';
import { createContext, runInContext } from 'node:vm';
import source from '../../gscripts/Auditlog.gs?raw';

function service() {
  const context = createContext({});
  runInContext(source, context);
  return context;
}

describe('tenant audit script', () => {
  it('preserves nested admin settings, false, zero and assignment changes without secrets', () => {
    const context = service();
    const input = {
      canParentAccess: false, passingThreshold: 0, password: 'secret', token: 'secret',
      gradeLevels: { grade1: { gradingType: 'letter', finalGradeMode: 'manual', letterScale: [{ letter: 'A', min: 90, max: 100 }] } },
      teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', password: 'secret' }],
    };
    const result = JSON.parse(context.auditValue_(JSON.stringify(input), 'SETTINGS_UPDATE'));
    expect(result.canParentAccess).toBe(false);
    expect(result.passingThreshold).toBe(0);
    expect(result.gradeLevels.grade1.letterScale[0]).toEqual({ letter: 'A', min: 90, max: 100 });
    expect(result.teacherAssignments[0].section).toBe('A');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('keeps learner personal and academic fields redacted', () => {
    const context = service();
    expect(JSON.parse(context.auditValue_(JSON.stringify({
      name: 'Learner', email: 'learner@example.test', birthDate: '2018-01-01', grades: [100], gradeLevel: 'Grade 1',
    }), 'LEARNER_UPDATE'))).toEqual({ gradeLevel: 'Grade 1' });
  });

  it('allows admin mutations only for admins and accepts existing learner activity types', () => {
    const context = service();
    context.authorizeAudit_ = () => ({ uid: 'teacher', role: 'Teacher', email: 'teacher@example.test' });
    context.jsonAudit_ = (value: unknown) => value;
    const append = vi.fn();
    context.appendAuditLog_ = append;
    for (const action of ['LEARNERS_IMPORT', 'SETTINGS_UPDATE', 'SECTION_ADD', 'SECTION_UPDATE', 'SECTION_DELETE', 'SCHOOL_YEAR_ADD', 'SCHOOL_YEAR_CURRENT', 'CURRICULUM_SUBJECT_ADD', 'CURRICULUM_SUBJECT_DELETE', 'CURRICULUM_UPDATE', 'DATABASE_RESTORE']) {
      const event = { postData: { contents: JSON.stringify({ auditAction: action, action: 'recordAuditEvent' }) } };
      expect(context.doPost(event).ok).toBe(false);
      expect(append).not.toHaveBeenCalled();
      context.authorizeAudit_ = () => ({ uid: 'admin', role: 'School Admin', email: 'admin@example.test' });
      expect(context.doPost(event).ok).toBe(true);
      append.mockClear();
      context.authorizeAudit_ = () => ({ uid: 'teacher', role: 'Teacher', email: 'teacher@example.test' });
    }
    for (const action of ['LEARNER_PROMOTE', 'LEARNER_RETAIN', 'LEARNER_MOVEMENT_CANCEL']) {
      expect(context.doPost({ postData: { contents: JSON.stringify({ auditAction: action, action: 'recordAuditEvent' }) } }).ok).toBe(true);
    }
  });

  it('appends identity columns without shifting the existing eight columns', () => {
    const context = service();
    const appendRow = vi.fn();
    context.auditSheetObject_ = () => ({ appendRow });
    context.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: vi.fn() }) };
    context.appendAuditLog_({ uid: 'admin', email: 'admin@example.test', photoURL: 'https://images.test/profile.jpg' }, 'SETTINGS_UPDATE', {
      sheet: 'settings', recordId: 'settings/toggles', oldValue: '{"canParentAccess":true}', newValue: '{"canParentAccess":false}', ipSession: 'session-1',
    });
    const row = appendRow.mock.calls[0][0];
    expect(row.slice(1)).toEqual(['admin@example.test', 'SETTINGS_UPDATE', 'settings', 'settings/toggles', '{"canParentAccess":true}', '{"canParentAccess":false}', 'session-1', 'admin', 'https://images.test/profile.jpg']);
    expect(context.auditPhotoURL_('javascript:alert(1)')).toBe('');
  });

  it('reads legacy rows with blank photo and identity columns', () => {
    const context = service();
    context.auditSheetObject_ = () => ({
      getLastRow: () => 2,
      getRange: () => ({ getDisplayValues: () => [['2026-10-27', 'admin@example.test', 'LOGIN', 'application', '', '', '', 'session-1']] }),
    });
    const result = context.readAuditLogs_(1);
    expect(result.total).toBe(1);
    expect(result.records[0].user).toBe('admin@example.test');
    expect(result.records[0].photoURL).toBe('');
    expect(result.records[0].userId).toBe('');
  });
});
