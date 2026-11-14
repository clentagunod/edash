import { useEffect, useMemo, useState } from 'react';
import { requireAuth } from '../lib/auth';
import { appDocumentTitle, canManageLearners, isRegistrar, isSchoolAdmin } from '../lib/app-config';
import { fsSubscribeLearners } from '../lib/firestore-api';
import { initYearSwitcher, schoolYearsLiveUnsubscribe } from '../lib/school-year';
import { renderShell, showToast } from '../lib/shell';
import { currentUserPreferences } from '../lib/preference-runtime';
import { buildParentList, parentGradeOptions, parentLearnerName, parentText, sortParentList, type ParentExportFormat, type ParentLearner, type ParentSort } from '../lib/parent-list';
import { downloadParentList } from '../lib/parent-list-export';
import '../styles/pages/parent-list.css';

export default function ParentListPage() {
  const [learners, setLearners] = useState<ParentLearner[]>([]);
  const [schoolYear, setSchoolYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [canFilter, setCanFilter] = useState(false);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [sort, setSort] = useState<ParentSort>('name-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [format, setFormat] = useState<ParentExportFormat>('xlsx');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeYears: (() => void) | undefined;
    let generation = 0;
    document.title = appDocumentTitle('List of Parents');
    setLoading(true);
    setError('');
    setLearners([]);
    const initialize = async () => {
      await requireAuth();
      if (disposed) return;
      renderShell('parent-list', 'List of Parents');
      if (!canManageLearners()) {
        setError('This directory is available to school staff only.');
        setLoading(false);
        return;
      }
      setCanFilter(isSchoolAdmin() || isRegistrar());
      setPageSize(currentUserPreferences().tablePageSize);
      await initYearSwitcher((year: string) => {
        if (disposed) return;
        const currentGeneration = ++generation;
        unsubscribe?.();
        unsubscribe = undefined;
        setSchoolYear(year);
        setLearners([]);
        setGrade('');
        setSection('');
        setSearch('');
        setPage(1);
        setError('');
        setLoading(Boolean(year));
        if (!year) {
          setError('No school year is available. Check the school year settings or try again.');
          return;
        }
        unsubscribe = fsSubscribeLearners(year, (records: ParentLearner[]) => {
          if (disposed || generation !== currentGeneration) return;
          setLearners(records);
          setError('');
          setLoading(false);
        }, () => {
          if (disposed || generation !== currentGeneration) return;
          setLearners([]);
          setError('Unable to load parent records. Check your connection and try again.');
          setLoading(false);
        });
      });
      unsubscribeYears = schoolYearsLiveUnsubscribe;
      if (disposed) unsubscribeYears?.();
    };
    void initialize().catch(() => {
      if (disposed) return;
      setError('Unable to open the parent directory. Please try again.');
      setLoading(false);
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      unsubscribeYears?.();
    };
  }, [retry]);

  const grades = useMemo(() => parentGradeOptions(learners), [learners]);
  const activeGrade = grades.includes(grade) ? grade : '';
  const sections = useMemo(() => [...new Set(learners
    .filter(child => !activeGrade || parentText(child.gradeLevel) === activeGrade)
    .map(child => parentText(child.section)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })), [learners, activeGrade]);
  const activeSection = sections.includes(section) ? section : '';
  const parents = useMemo(() => {
    const entries = buildParentList(learners, canFilter ? { grade: activeGrade, section: activeSection } : {});
    const query = canFilter ? parentText(search).toLowerCase() : '';
    return sortParentList(entries.filter(parent => !query || parent.name.toLowerCase().includes(query)
      || parent.children.some(child => parentLearnerName(child).toLowerCase().includes(query) || child.learnerId.includes(query))), sort);
  }, [learners, canFilter, activeGrade, activeSection, search, sort]);
  const pageCount = Math.max(1, Math.ceil(parents.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => { setPage(value => Math.min(value, pageCount)); }, [pageCount]);
  const start = (currentPage - 1) * pageSize;
  const visible = parents.slice(start, start + pageSize);
  const pages = [...new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1])]
    .filter(value => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  const childCount = parents.reduce((total, parent) => total + parent.children.length, 0);

  async function exportParents() {
    if (loading || error || exporting || !parents.length) return;
    setExporting(true);
    try {
      await downloadParentList(parents, schoolYear, format);
      showToast(`${parents.length.toLocaleString()} parents / guardians exported.`, 'success');
    } catch {
      showToast('Unable to export the parent list. Please try again.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <div id="sidebarMount" />
      <div className="main-area">
        <div id="topbarMount" />
        <main className="page parent-list-page">
          <div className="page-header">
            <div><h1>List of Parents</h1><p className="desc">Parents and guardians linked to learners in your school records</p></div>
            <div className="parent-export-controls">
              <select className="select-filter" aria-label="Export format" value={format} onChange={event => setFormat(event.target.value as ParentExportFormat)}>
                <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option><option value="tsv">Tab-separated (.tsv)</option>
              </select>
              <button className="btn btn-primary" type="button" disabled={loading || Boolean(error) || !parents.length || exporting} onClick={exportParents}>
                {exporting ? 'Exporting…' : 'Export list'}
              </button>
            </div>
          </div>
          <div id="yearSwitcherMount" />
          <section className="panel" aria-label="Parent directory">
            <div className="panel-body parent-directory-toolbar">
              <div className="toolbar learner-list-toolbar">
                <div className="learner-toolbar-heading">
                  <div><span className="learner-toolbar-eyebrow">PARENT DIRECTORY</span><h2>Parents / guardians</h2></div>
                  <p role="status">{loading ? 'Loading parents…' : error ? 'Records unavailable' : `${parents.length.toLocaleString()} parents / guardians · ${childCount.toLocaleString()} learners`}</p>
                </div>
                <div className="learner-filter-controls parent-filter-controls">
                  {canFilter && <>
                    <div className="search-box">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                      <input type="search" aria-label="Search parents or learners" placeholder="Search parent, learner or LRN…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
                    </div>
                    <select className="select-filter" aria-label="Filter by grade level" value={activeGrade} onChange={event => { setGrade(event.target.value); setSection(''); setPage(1); }}>
                      <option value="">All Grade Levels</option>{grades.map(value => <option key={value}>{value}</option>)}
                    </select>
                    <select className="select-filter" aria-label="Filter by section" value={activeSection} onChange={event => { setSection(event.target.value); setPage(1); }}>
                      <option value="">All Sections</option>{sections.map(value => <option key={value}>{value}</option>)}
                    </select>
                  </>}
                  <select className="select-filter" aria-label="Sort parents" value={sort} onChange={event => { setSort(event.target.value as ParentSort); setPage(1); }}>
                    <option value="name-asc">Parent name (A–Z)</option><option value="name-desc">Parent name (Z–A)</option>
                    <option value="children-desc">Most linked learners</option><option value="children-asc">Fewest linked learners</option>
                  </select>
                </div>
              </div>
              <p className="parent-directory-note">Grouped by recorded guardian name, ignoring capitalization and extra spaces. Blank and N/A names are excluded. Only learners in the selected school year{canFilter ? ' and filters' : ' assigned to you'} are shown. Exports include all matching pages, with one row per learner.</p>
            </div>
            <div className="parent-table-scroll">
              <table className="data-table parent-table" aria-busy={loading}>
                <thead><tr><th scope="col">Parent / guardian</th><th scope="col">Children / learners</th><th scope="col">Linked learners</th></tr></thead>
                <tbody>
                  {loading ? <tr><td colSpan={3} className="state-row">Loading parents / guardians…</td></tr>
                    : error ? <tr><td colSpan={3} className="state-row"><div role="alert">{error}</div><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></td></tr>
                    : !visible.length ? <tr><td colSpan={3} className="state-row">{search || activeGrade || activeSection ? 'No parents / guardians match these filters.' : 'No named parents / guardians are linked to learners in this scope.'}</td></tr>
                    : visible.map(parent => <tr key={parent.key}>
                      <td><strong className="parent-record-name">{parent.name}</strong></td>
                      <td><ul className="parent-children">{parent.children.map(child => <li key={child.learnerId}>
                        <span className="parent-child-name">{parentLearnerName(child)}</span>
                        <small>{[parentText(child.gradeLevel), parentText(child.section), child.learnerId].filter(Boolean).join(' · ')}</small>
                      </li>)}</ul></td>
                      <td>{parent.children.length}</td>
                    </tr>)}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span aria-live="polite">{loading || error ? '—' : parents.length ? `Showing ${start + 1}–${Math.min(start + pageSize, parents.length)} of ${parents.length.toLocaleString()} parents / guardians` : '0 parents / guardians'}</span>
              <label className="parent-page-size">Rows per page<select className="select-filter" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
                {[8, 10, 25, 50].map(value => <option key={value} value={value}>{value}</option>)}
              </select></label>
              <nav className="pager-btns" aria-label="Parent list pagination">
                <button type="button" aria-label="Previous page" disabled={loading || Boolean(error) || currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button>
                {pages.map((number, index) => <span className="parent-page-number" key={number}>
                  {index > 0 && number - pages[index - 1] > 1 && <span className="pager-ellipsis" aria-hidden="true">…</span>}
                  <button type="button" aria-label={`Page ${number}`} aria-current={number === currentPage ? 'page' : undefined} className={number === currentPage ? 'is-active' : ''} disabled={loading || Boolean(error)} onClick={() => setPage(number)}>{number}</button>
                </span>)}
                <button type="button" aria-label="Next page" disabled={loading || Boolean(error) || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>›</button>
              </nav>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
