import './profile-list-sorting.css';

type SortChange = (field: string, direction: string) => void;
const bindings = new WeakMap<HTMLSelectElement, { direction: HTMLSelectElement; onChange: SortChange }>();

/** Safe to call after restoring preferences or reinitializing the same markup. */
export function initProfileSortControls(prefix: string, onChange: SortChange) {
  const field = document.getElementById(`${prefix}Sort`) as HTMLSelectElement | null;
  const direction = document.getElementById(`${prefix}SortDirection`) as HTMLSelectElement | null;
  if (!field || !direction) return;
  function syncLabels() {
    const numeric = ['average', 'gradeLevel', 'learnerId'].includes(field.value);
    const asc = direction.querySelector<HTMLOptionElement>('option[value="asc"]');
    const desc = direction.querySelector<HTMLOptionElement>('option[value="desc"]');
    if (asc) asc.textContent = numeric ? 'Low to high' : 'A-Z';
    if (desc) desc.textContent = numeric ? 'High to low' : 'Z-A';
  }
  const binding = bindings.get(field);
  if (binding && binding.direction === direction) binding.onChange = onChange;
  else {
    const current = { direction, onChange };
    bindings.set(field, current);
    const changed = () => {
      syncLabels();
      current.onChange(field.value, direction.value);
    };
    field.addEventListener('change', changed);
    direction.addEventListener('change', changed);
  }
  syncLabels();
}
