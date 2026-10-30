import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SchoolRegistrationPage from './SchoolRegistrationPage';
import { schoolRegistrationApi } from '../lib/school-registration-api';

vi.mock('../lib/school-registration-api', () => ({ schoolRegistrationApi: vi.fn() }));
const api = vi.mocked(schoolRegistrationApi);
const token = 'a'.repeat(64);
const invitation = { schoolName: 'Sample School', schoolId: '001234', contactName: 'Admin',
  email: 'admin@example.com', phone: '+639123456789', division: 'Sample Division' };
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', `/register#token=${token}`);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); api.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  window.history.replaceState({}, '', '/');
});
async function render() { await act(async () => root.render(<SchoolRegistrationPage />)); }

describe('Complete school registration page', () => {
  it('shows invitation instructions without contacting the backend when no token is present', async () => {
    window.history.replaceState({}, '', '/register'); await render();
    expect(api).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Have an invitation?');
    const privacy = container.querySelector<HTMLAnchorElement>('.enrollment-privacy a');
    expect(privacy?.href).toBe('https://www.edash.online/privacy-policy');
    expect(privacy?.target).toBe('_blank');
  });

  it('verifies the token and displays the complete profile and required Drive confirmation', async () => {
    api.mockResolvedValue(invitation); await render();
    expect(api).toHaveBeenCalledWith('getSchoolInvitation', { token }, expect.any(AbortSignal));
    expect(container.querySelector<HTMLInputElement>('[name="officialSchoolId"]')?.value).toBe('001234');
    expect(container.querySelector<HTMLInputElement>('[name="contactEmail"]')?.value).toBe(invitation.email);
    expect(container.querySelector<HTMLInputElement>('[name="driveSharingConfirmed"]')?.required).toBe(true);
    expect(container.textContent).toContain('Anyone with the link');
    expect(container.querySelector('[name="firebaseConfig"]')).toBeNull();
    expect(container.querySelector('[name="auditLogApiUrl"]')).toBeNull();
  });

  it('keeps the profile closed when the backend rejects an invitation', async () => {
    api.mockRejectedValue(new Error('This invitation has expired.')); await render();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('expired');
  });

  it('keeps entered data after a failed save and shows a receipt only after confirmed success', async () => {
    api.mockResolvedValueOnce(invitation); await render();
    const form = container.querySelector('form')!;
    const values = {
      name: 'Sample School', nickname: 'Sample ES', officialSchoolId: '001234', region: 'XI',
      divisionOffice: 'Division', district: 'District', schoolAddr: 'School Street', schoolEmail: 'school@example.com',
      contactNumber: '+639123456789', headName: 'Principal', headPosition: 'School Head', headEmail: 'head@example.com',
      headPhoneNumber: '+639123456789', contactName: 'Admin', contactRole: 'School ICT', contactEmail: 'admin@example.com',
      contactPhone: '+639123456789', driveLink: 'https://drive.google.com/drive/folders/assets',
    };
    Object.entries(values).forEach(([name, value]) => { (form.elements.namedItem(name) as HTMLInputElement).value = value; });
    (form.elements.namedItem('driveSharingConfirmed') as HTMLInputElement).checked = true;
    api.mockRejectedValueOnce(new Error('Please retry.'));
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Please retry.');
    expect(container.querySelector<HTMLInputElement>('[name="nickname"]')?.value).toBe('Sample ES');
    api.mockResolvedValueOnce({ registrationId: 'REG-example', status: 'Awaiting setup' });
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('REG-example');
    expect(container.textContent).toContain('several days');
    expect(api).toHaveBeenLastCalledWith('submitCompleteSchoolRegistration', expect.objectContaining({
      token, fields: expect.objectContaining({ nickname: 'Sample ES' }), privacyAcknowledged: true, driveSharingConfirmed: true,
    }));
  });
});
