import guideEntries from './eduai-knowledge.json' with { type: 'json' };
import rolePolicies from './eduai-role-policies.json' with { type: 'json' };

export const PRODUCT_GUIDE_VERSION = '2.0';
export const PRODUCT_GUIDE_MAX_CHARACTERS = 14000;
const MAX_ENTRIES = 8;
const STOP_WORDS = new Set('a about an and are as at be can could do does for from have how i in is it me my of on or our please the their this to use what when where which with would you your paano saan ang ng mga ko ako ba po website page'.split(' '));
const ALIASES = {
  students: 'learner', student: 'learner', learners: 'learner', pupils: 'learner', pupil: 'learner', estudyante: 'learner',
  grades: 'grade', sections: 'section', records: 'record', settings: 'setting',
  importing: 'import', uploading: 'import', upload: 'import', magimport: 'import',
  exporting: 'export', downloading: 'export', download: 'export', backups: 'backup', restoring: 'restore',
  permissions: 'permission', accounts: 'account', users: 'user', teachers: 'teacher',
};
const tokens = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\bn\s*\/\s*a\b/g, 'notavailable').match(/[\p{L}\p{N}]+/gu)
  ?.filter(token => token.length > 1 && !STOP_WORDS.has(token)).map(token => ALIASES[token] || token) || [];
const overlap = (text, query) => [...new Set(tokens(text))].filter(token => query.has(token)).length;

/** Retrieve only curated, role-allowed documentation; history never changes authorization. */
export function selectEduAiGuideEntries(question, role, history = []) {
  if (!Object.hasOwn(rolePolicies, role)) return [];
  const current = String(question || '').slice(0, 2000);
  const query = new Set(tokens(current));
  const followUp = /\b(that|those|this|it|same|more|continue|ito|iyon|yun)\b/i.test(current) && query.size <= 5;
  const previousQuestions = Array.isArray(history) ? history.filter(message => message?.role === 'user' && typeof message.content === 'string').slice(-2) : [];
  const previous = followUp ? new Set(tokens(previousQuestions.map(message => message.content.slice(0, 2000)).join(' '))) : new Set();
  const broad = /\b(all|every|whole|complete|overview|sidebar|navigation|directory|lahat)\b/i.test(current);
  const ranked = guideEntries.filter(entry => !entry.roles || entry.roles.includes(role)).map(entry => {
    const keyText = entry.keywords.join(' ');
    const currentScore = overlap(entry.title, query) * 5 + overlap(keyText, query) * 3;
    const bodyMatches = overlap(entry.guidance, query);
    const previousScore = overlap(`${entry.title} ${keyText}`, previous);
    // Two meaningful body terms can recover a field question missing an alias,
    // while title/keyword matches remain substantially stronger.
    const bodyScore = currentScore ? bodyMatches * 0.1 : bodyMatches >= 2 ? bodyMatches * 0.4 : 0;
    return { entry, score: currentScore + previousScore + bodyScore + (entry.overview && broad && currentScore ? 12 : 0) };
  }).filter(candidate => candidate.score > 0).sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));
  const selected = [];
  let length = 0, overviews = 0;
  for (const { entry } of ranked) {
    if (entry.overview && overviews >= (broad ? 2 : 1)) continue;
    const size = entry.title.length + entry.guidance.length + 3;
    if (length + size > PRODUCT_GUIDE_MAX_CHARACTERS) continue; // Never cut a workflow in half.
    selected.push(entry); length += size;
    if (entry.overview) overviews++;
    if (selected.length === MAX_ENTRIES) break;
  }
  return selected;
}

export function buildEduAiProductGuide(question, role, history = []) {
  return selectEduAiGuideEntries(question, role, history).map(entry => `${entry.title}: ${entry.guidance}`).join('\n');
}
