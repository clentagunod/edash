import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), send: vi.fn(), prepare: vi.fn() }));
vi.mock('../lib/gmail-send', async (original) => ({ ...await original<typeof import('../lib/gmail-send')>(), gmailClientId: () => 'client-id', loadGoogleIdentity: async () => {}, connectGmail: mocks.connect, sendGmailMessage: mocks.send }));
import Sf10EmailDialog from './Sf10EmailDialog';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  mocks.connect.mockResolvedValue({ token: 'token', email: 'sender@gmail.com', expiresAt: Date.now() + 10000 });
  mocks.prepare.mockResolvedValue(new File(['document'], 'sf10.pdf', { type: 'application/pdf' })); mocks.send.mockResolvedValue('message-id');
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
function button(text: string) { return [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text))!; }
async function enterRecipient() {
  await act(async () => button('Connect Gmail').click());
  const to = container.querySelector<HTMLInputElement>('label input')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(to, 'records@example.edu'); to.dispatchEvent(new Event('input', { bubbles: true })); });
}
describe('SF10 Gmail composer', () => {
  it('does not send on open or connect; sends one reviewed attachment after submission', async () => {
    await act(async () => root.render(<Sf10EmailDialog open onClose={vi.fn()} prepare={mocks.prepare} count={2} learnerName="Alex Cruz" />));
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    await enterRecipient(); expect(mocks.send).not.toHaveBeenCalled();
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.prepare).toHaveBeenCalledWith('pdf'); expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][1]).toMatchObject({ to: 'records@example.edu', subject: 'Request for Permanent Records (SF10) — 2 learners' });
    expect(container.textContent).toContain('Email sent to records@example.edu'); expect(button('Email sent').disabled).toBe(true);
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('keeps the composer available after a failed send without retrying automatically', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Check Sent before trying again.'));
    await act(async () => root.render(<Sf10EmailDialog open onClose={vi.fn()} prepare={mocks.prepare} count={1} learnerName="Alex Cruz" />));
    await enterRecipient();
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Check Sent'); expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(button('Send email with attachment').disabled).toBe(false);
  });
});
