import { describe, expect, it } from 'vitest';
import markup from './markup/manage-users.html?raw';

describe('Admin Console collapsible sections', () => {
  it('groups Card Preferences controls into three collapsed accordions', () => {
    const document = new DOMParser().parseFromString(markup, 'text/html');
    const accordions = [...document.querySelectorAll('#adminCardPreferencesPanel .admin-card-preference-accordion')];

    expect(accordions).toHaveLength(3);
    expect(accordions.every((accordion) => !accordion.open)).toBe(true);
    expect(accordions[0].querySelector('#adminCardTemplateChooser')).not.toBeNull();
    expect(accordions[1].querySelector('#adminCardGradeTemplates')).not.toBeNull();
    expect(accordions[2].querySelector('#adminCardAttendanceMonths')).not.toBeNull();
    expect(document.querySelector('#saveAdminCardPreferencesBtn')).not.toBeNull();
    expect(accordions.map((accordion) => accordion.querySelector('.admin-accordion-copy strong')?.textContent))
      .toEqual(['Choose a card template', 'Template by grade level', 'Attendance layout']);
    expect(document.querySelector('#adminCardPreferencesPanel')?.textContent).not.toMatch(/\b0[1-3]\s*[·.-]/);
  });

  it('separates access configurations from user management and keeps Add User in its section', () => {
    const document = new DOMParser().parseFromString(markup, 'text/html');
    const accessAccordions = [...document.querySelectorAll('#adminAccessPanel > .admin-access-accordion')];
    const [settingsAccordion, usersAccordion] = accessAccordions;

    expect(accessAccordions).toHaveLength(2);
    expect(settingsAccordion.querySelector('#adminParentAccessToggle')).not.toBeNull();
    expect(settingsAccordion.querySelector('#adminPromotionAccessToggle')).not.toBeNull();
    expect(settingsAccordion.querySelector('#adminTrashRetentionSelect')).not.toBeNull();
    expect(usersAccordion.querySelector('#addUserBtn')).not.toBeNull();
    expect(usersAccordion.querySelector('#searchInput')).not.toBeNull();
    expect(usersAccordion.querySelector('#usersTableBody')).not.toBeNull();
    expect(document.querySelectorAll('#addUserBtn')).toHaveLength(1);
    expect(accessAccordions.every((accordion) => !accordion.open)).toBe(true);
  });
});
