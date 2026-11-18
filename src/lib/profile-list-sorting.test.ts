import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initProfileSortControls } from './profile-list-sorting';

beforeEach(() => {
  document.body.innerHTML = '<select id="testSort"><option value="name">Surname</option><option value="gradeLevel">Grade</option></select><select id="testSortDirection"><option value="asc">A-Z</option><option value="desc">Z-A</option></select>';
});

describe('profile sorting controls', () => {
  it('updates numeric direction labels and passes the selected values', () => {
    const onChange = vi.fn();
    initProfileSortControls('test', onChange);
    const field = document.getElementById('testSort') as HTMLSelectElement;
    const direction = document.getElementById('testSortDirection') as HTMLSelectElement;
    field.value = 'gradeLevel';
    field.dispatchEvent(new Event('change'));
    expect(direction.options[0].textContent).toBe('Low to high');
    expect(direction.options[1].textContent).toBe('High to low');
    direction.value = 'desc';
    direction.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith('gradeLevel', 'desc');
    field.value = 'name';
    field.dispatchEvent(new Event('change'));
    expect(direction.options[1].textContent).toBe('Z-A');
  });
  it('synchronizes restored values without duplicate listeners or resetting direction', () => {
    const first = vi.fn(), second = vi.fn();
    initProfileSortControls('test', first);
    const field = document.getElementById('testSort') as HTMLSelectElement;
    const direction = document.getElementById('testSortDirection') as HTMLSelectElement;
    field.value = 'gradeLevel'; direction.value = 'desc';
    initProfileSortControls('test', second);
    expect(direction.options[1].textContent).toBe('High to low');
    expect(direction.value).toBe('desc');
    direction.dispatchEvent(new Event('change'));
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  });
  it('allows pages without sorting markup', () => {
    document.body.innerHTML = '';
    expect(() => initProfileSortControls('missing', vi.fn())).not.toThrow();
  });
});
