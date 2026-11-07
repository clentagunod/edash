import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { RegisteredSchool } from '../lib/school-registry';
import SchoolLogo from './SchoolLogo';
import '../styles/components/school-search-select.css';

interface SchoolSearchSelectProps {
  id: string;
  schools: RegisteredSchool[];
  value: string;
  disabled?: boolean;
  onChange: (schoolId: string) => void;
}
const MAX_SUGGESTIONS = 50;
function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function schoolDetails(school: RegisteredSchool) {
  return [school.nickname !== school.name ? school.nickname : '', school.schoolInfo?.id, school.schoolInfo?.district]
    .filter(value => value !== undefined && value !== null && String(value).trim()).join(' · ');
}

/** Controlled registered-school combobox; free text never becomes a selected school ID. */
export default function SchoolSearchSelect({ id, schools, value, disabled = false, onChange }: SchoolSearchSelectProps) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const indexed = useMemo(() => schools.filter(school => school.enabled === true).map(school => ({
    school,
    name: normalize(school.name),
    search: normalize([school.name, school.nickname, school.id, school.schoolInfo?.id,
      school.schoolInfo?.district, school.schoolInfo?.divisionOffice, school.schoolInfo?.region].filter(value => value != null).join(' ')),
  })).sort((a, b) => a.school.name.localeCompare(b.school.name, undefined, { sensitivity: 'base', numeric: true })), [schools]);
  const selected = indexed.find(item => item.school.id === value)?.school;
  const search = selected && query === selected.name ? '' : normalize(query);
  const matches = useMemo(() => {
    const words = search.split(/\s+/).filter(Boolean);
    const filtered = indexed.filter(item => words.every(word => item.search.includes(word)));
    // Keep exact names and name prefixes ahead of secondary-field matches.
    const rank = (name: string) => name === search ? 0 : name.startsWith(search) ? 1 : 2;
    return search ? filtered.sort((a, b) => rank(a.name) - rank(b.name)) : filtered;
  }, [indexed, search]);
  const suggestions = matches.slice(0, MAX_SUGGESTIONS);
  const expanded = open && !disabled;
  const activeOption = active >= 0 && active < suggestions.length ? `${listId}-${active}` : undefined;

  useEffect(() => {
    if (selected) setQuery(selected.name);
  }, [selected?.id, selected?.name]);
  useEffect(() => { if (disabled) { setOpen(false); setActive(-1); } }, [disabled]);
  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [expanded]);
  useEffect(() => {
    if (expanded && activeOption) list.current?.querySelector<HTMLElement>(`[id="${activeOption}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOption, expanded]);

  function choose(school: RegisteredSchool) {
    setQuery(school.name); setActive(-1); onChange(school.id);
    input.current?.focus(); setOpen(false);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || disabled) return;
    if (event.key === 'Escape') { if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); } return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActive(previous => !suggestions.length ? -1 : !expanded || previous < 0
        ? direction === 1 ? 0 : suggestions.length - 1
        : (previous + direction + suggestions.length) % suggestions.length);
      return;
    }
    if (expanded && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); setActive(suggestions.length ? event.key === 'Home' ? 0 : suggestions.length - 1 : -1); return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (expanded && active >= 0 && suggestions[active]) choose(suggestions[active].school);
      else if (suggestions.length === 1) choose(suggestions[0].school);
      else { setOpen(true); setActive(suggestions.length ? 0 : -1); }
    }
  }

  return <div className="school-search-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); }
  }}>
    <div className={`school-search-control${expanded ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
      {selected ? <SchoolLogo className="school-search-selected-logo" name={selected.name} logoUrl={selected.logoUrl} /> : <svg className="school-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>}
      <input ref={input} id={id} type="text" role="combobox" autoComplete="off" spellCheck={false} disabled={disabled}
        placeholder="Search by school name or ID" value={query} aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={listId} aria-activedescendant={expanded ? activeOption : undefined} aria-describedby={`${id}-hint ${id}-status`}
        onFocus={() => { setOpen(true); setActive(-1); }} onKeyDown={onKeyDown} onChange={event => {
          setQuery(event.target.value); setOpen(true); setActive(-1);
          if (value) onChange('');
        }} />
      {query && <button className="school-search-clear" type="button" disabled={disabled} aria-label="Clear school search" onMouseDown={event => event.preventDefault()} onClick={() => {
        setQuery(''); setActive(-1); onChange(''); input.current?.focus(); setOpen(true);
      }}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg></button>}
      <button className="school-search-toggle" type="button" tabIndex={-1} disabled={disabled} aria-label="Show registered schools" onMouseDown={event => event.preventDefault()} onClick={() => {
        const wasOpen = expanded; input.current?.focus(); setActive(-1); setOpen(!wasOpen);
      }}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg></button>
    </div>
    <div className="school-search-popup" hidden={!expanded}>
      <div className="school-search-heading">{search ? 'Matching schools' : 'Registered schools'}</div>
      <ul ref={list} id={listId} role="listbox" aria-label="Registered school suggestions">
        {suggestions.map(({ school }, index) => <li role="presentation" key={school.id}><button type="button" role="option" id={`${listId}-${index}`}
          aria-selected={school.id === value} tabIndex={-1} className={`school-search-option${active === index ? ' is-active' : ''}`}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(school)}>
          <SchoolLogo name={school.name} logoUrl={school.logoUrl} active={expanded} />
          <span className="school-search-option-copy"><strong>{school.name}</strong>{schoolDetails(school) && <small>{schoolDetails(school)}</small>}</span>
          {school.id === value && <svg className="school-search-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}
        </button></li>)}
      </ul>
      {!suggestions.length && <p className="school-search-empty">No registered schools match “{query}”. Try another name or school ID.</p>}
      {matches.length > MAX_SUGGESTIONS && <p className="school-search-limit">Showing {MAX_SUGGESTIONS} of {matches.length} schools. Keep typing to narrow your search.</p>}
    </div>
    <p className="school-search-hint" id={`${id}-hint`}>Type to search, or choose from registered schools.</p>
    <span className="visually-hidden" role="status" aria-live="polite" id={`${id}-status`}>{expanded ? `${matches.length} registered school${matches.length === 1 ? '' : 's'} found${matches.length > MAX_SUGGESTIONS ? `; showing the first ${MAX_SUGGESTIONS}` : ''}.` : selected ? `${selected.name} selected.` : ''}</span>
  </div>;
}
