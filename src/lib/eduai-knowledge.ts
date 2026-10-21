import type { EduAiRole } from './eduai-context';
import guideEntries from '../../functions/eduai-knowledge.json';

const STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'can', 'do', 'for', 'how', 'i', 'in', 'is', 'it',
  'me', 'my', 'of', 'on', 'or', 'the', 'to', 'use', 'what', 'where', 'with',
]);

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) || [];
}

export function buildEduAiProductGuide(question: string, role: EduAiRole): string {
  const queryTokens = new Set(tokens(question));
  const entries = guideEntries
    .filter((entry) => !entry.roles || entry.roles.includes(role))
    .map((entry) => ({
      entry,
      score: tokens(`${entry.title} ${entry.keywords.join(' ')} ${entry.guidance}`)
        .reduce((total, token) => total + (queryTokens.has(token) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ entry }) => `${entry.title}: ${entry.guidance}`);

  return entries.join('\n').slice(0, 7000);
}
