import { describe, expect, it } from 'vitest';
import markup from './markup/school-selection.html?raw';

describe('School selection information and privacy markup', () => {
  it('keeps the selection experience and long-form information in one scrollable page', () => {
    const document = new DOMParser().parseFromString(markup, 'text/html');
    const page = document.querySelector('.school-selection-page');

    expect(page?.querySelector('.login-shell[data-login-stage="school-selection"]')).not.toBeNull();
    expect(page?.querySelector('main.school-information #schoolStoryTitle')).not.toBeNull();
    expect(page?.querySelectorAll('.school-story-card')).toHaveLength(3);
    expect(page?.querySelectorAll('.school-faq-list details')).toHaveLength(3);
    expect(page?.querySelector('.school-selection-footer')).not.toBeNull();
    expect(page?.querySelector('.login-panel .site-footer')).toBeNull();
  });

  it('shows a separate-window Privacy Policy acknowledgment in selection and registration', () => {
    const document = new DOMParser().parseFromString(markup, 'text/html');
    const acknowledgments = [...document.querySelectorAll('.school-privacy-note')];

    expect(acknowledgments).toHaveLength(2);
    expect(acknowledgments.every((note) => note.textContent?.includes('By continuing, you acknowledge E-Dash'))).toBe(true);
    expect(acknowledgments.map((note) => {
      const link = note.querySelector('a');
      return [link?.getAttribute('href'), link?.target, link?.rel];
    })).toEqual([
      ['/privacy-policy', '_blank', 'noopener noreferrer'],
      ['/privacy-policy', '_blank', 'noopener noreferrer'],
    ]);
  });

  it('places the trademark footer after the history, information, and FAQ content', () => {
    const document = new DOMParser().parseFromString(markup, 'text/html');
    const information = document.querySelector('main.school-information');
    const footer = document.querySelector('.school-selection-footer');

    expect(information?.querySelector('#schoolStoryTitle')).not.toBeNull();
    expect(information?.querySelector('#schoolAboutTitle')).not.toBeNull();
    expect(information?.querySelector('#schoolFaqTitle')).not.toBeNull();
    expect(information?.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer?.textContent).toContain('© 2026 E-Dash');
    expect(footer?.textContent).toContain('ClentIndustries');
  });
});
