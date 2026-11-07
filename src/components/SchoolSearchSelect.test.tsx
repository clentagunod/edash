import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredSchool } from '../lib/school-registry';
import SchoolSearchSelect from './SchoolSearchSelect';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const schools = [
  { id: 'san-roque', enabled: true, name: 'San Roque Elementary School', nickname: 'San Roque ES', schoolInfo: { id: '123456', district: 'New Bataan', divisionOffice: 'Davao de Oro' } },
  { id: 'mapaso', enabled: true, name: 'Mapaso Elementary School', nickname: 'Mapaso ES', schoolInfo: { id: '654321', district: 'New Bataan' } },
  { id: 'pena', enabled: true, name: 'Peña Elementary School', nickname: 'Peña ES', schoolInfo: { id: '111222', district: 'Northern District' } },
] as RegisteredSchool[];

describe('searchable registered-school selector', () => {
  let host: HTMLDivElement, root: Root;
  const onChange = vi.fn();
  const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const options = () => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  async function render(value = '', choices = schools, disabled = false) {
    await act(async () => root.render(<SchoolSearchSelect id="school-search" schools={choices} value={value} disabled={disabled} onChange={onChange} />));
  }
  async function type(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function key(value: string) { await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))); }
  beforeEach(() => {
    onChange.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('suggests registered schools alphabetically when focused without a query', async () => {
    await render(); await act(async () => input().focus());
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(options().map(option => option.querySelector('strong')?.textContent)).toEqual(['Mapaso Elementary School', 'Peña Elementary School', 'San Roque Elementary School']);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('3 registered schools found');
  });
  it('searches partial names, nicknames, official IDs, location, and accents', async () => {
    await render();
    for (const [query, expected] of [['ROQUE', 'San Roque Elementary School'], ['Mapaso ES', 'Mapaso Elementary School'], ['123456', 'San Roque Elementary School'], ['Davao Oro', 'San Roque Elementary School'], ['pena', 'Peña Elementary School']]) {
      await type(query);
      expect(options()).toHaveLength(1);
      expect(options()[0].textContent).toContain(expected);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
  it('only commits a registered ID on selection and invalidates it when text changes', async () => {
    await render(); await type('roque'); await act(async () => options()[0].click());
    expect(onChange).toHaveBeenLastCalledWith('san-roque');
    expect(input().value).toBe('San Roque Elementary School');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    await render('san-roque'); await type('Map');
    expect(onChange).toHaveBeenLastCalledWith('');
    await render('');
    expect(input().value).toBe('Map');
  });
  it('supports arrow navigation, Home, End, Enter, and Escape', async () => {
    await render(); await act(async () => input().focus());
    await key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await key('End'); expect(input().getAttribute('aria-activedescendant')).toBe(options()[2].id);
    await key('Home'); expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await key('ArrowUp'); expect(input().getAttribute('aria-activedescendant')).toBe(options()[2].id);
    await key('Enter'); expect(onChange).toHaveBeenLastCalledWith('san-roque');
    await key('ArrowDown'); await key('Escape');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });
  it('shows a no-match message without allowing arbitrary schools or HTML', async () => {
    await render(); await type('<img src=x onerror=alert(1)>'); await key('Enter');
    expect(options()).toHaveLength(0);
    expect(host.textContent).toContain('No registered schools match');
    expect(host.querySelector('img')).toBeNull(); expect(onChange).not.toHaveBeenCalled();
  });
  it('restores a saved school, provides all suggestions, and clears selection', async () => {
    await render('san-roque'); expect(input().value).toBe('San Roque Elementary School');
    await act(async () => input().focus()); expect(options()).toHaveLength(3);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Clear school search"]')!.click());
    expect(input().value).toBe(''); expect(onChange).toHaveBeenLastCalledWith('');
    expect(input().getAttribute('aria-expanded')).toBe('true');
  });
  it('closes outside the control and disables interaction while loading', async () => {
    await render(); await act(async () => input().focus());
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(input().getAttribute('aria-expanded')).toBe('false');
    await render('', schools, true); expect(input().disabled).toBe(true);
  });
  it('bounds suggestions while retaining search access to every registered school', async () => {
    const many = Array.from({ length: 75 }, (_, index) => ({ ...schools[0], id: `school-${index}`, name: `School ${index}` }));
    await render('', many); await act(async () => input().focus());
    expect(options()).toHaveLength(50); expect(host.textContent).toContain('Showing 50 of 75');
    await type('School 74'); expect(options()).toHaveLength(1);
    await key('Enter'); expect(onChange).toHaveBeenLastCalledWith('school-74');
  });
  it('ignores Enter while an input method is composing text', async () => {
    await render(); await type('roque');
    await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
    expect(onChange).not.toHaveBeenCalled();
  });
});
