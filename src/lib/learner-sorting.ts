type LearnerNameRecord = {
  firstName?: unknown;
  middleName?: unknown;
  lastName?: unknown;
  suffix?: unknown;
  name?: unknown;
  learnerId?: unknown;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function learnerSurname(learner: LearnerNameRecord): string {
  const lastName = text(learner.lastName);
  if (lastName) return lastName;
  const nameParts = text(learner.name).split(/\s+/).filter(Boolean);
  return nameParts[nameParts.length - 1] ?? '';
}

export function formatLearnerName(learner: LearnerNameRecord, fallback = ''): string {
  const nameParts = [learner.firstName, learner.middleName, learner.lastName, learner.suffix]
    .map(text)
    .filter(Boolean);
  return nameParts.join(' ') || text(learner.name) || fallback;
}

/** Name convention used by profile lists and the EOSY report. */
export function formatProfileLearnerName(learner: LearnerNameRecord, fallback = ''): string {
  const firstName = text(learner.firstName);
  const lastName = text(learner.lastName);
  if (!firstName && !lastName) return text(learner.name) || fallback;
  const middleName = text(learner.middleName);
  const initials = /^(?:n\/?a|none|not applicable|-)$/i.test(middleName) ? '' : middleName
    .split(/\s+/).map(part => part.match(/\p{L}/u)?.[0]).filter(Boolean).map(initial => `${initial.toUpperCase()}.`).join(' ');
  const surname = [lastName, text(learner.suffix)].filter(Boolean).join(' ');
  const givenNames = [firstName, initials].filter(Boolean).join(' ');
  return [surname, givenNames].filter(Boolean).join(', ');
}

type ProfileSortRecord = LearnerNameRecord & {
  gradeLevel?: unknown; section?: unknown; gender?: unknown; average?: unknown; eosyStatus?: unknown;
};

function compareProfileNames(first: LearnerNameRecord, second: LearnerNameRecord) {
  const surname = (record: LearnerNameRecord) => text(record.lastName)
    || (text(record.name).includes(',') ? text(record.name).split(',')[0] : learnerSurname(record));
  const compare = (a: unknown, b: unknown) => text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
  return compare(surname(first), surname(second))
    || compare(first.firstName, second.firstName)
    || compare(first.middleName, second.middleName)
    || compare(first.name, second.name)
    || compare(first.learnerId, second.learnerId);
}

/** Sort the entire filtered cohort before pagination; missing values remain last. */
export function compareProfileLearners(first: ProfileSortRecord, second: ProfileSortRecord, field = 'name', direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1;
  if (!['learnerId', 'gradeLevel', 'section', 'gender', 'average', 'eosyStatus'].includes(field)) return compareProfileNames(first, second) * sign;
  const a = first[field], b = second[field];
  const isMissing = (value: unknown) => text(value) === '' || (field === 'average' && !Number.isFinite(Number(value)));
  const aMissing = isMissing(a), bMissing = isMissing(b);
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  let result = 0;
  if (!aMissing) {
    if (field === 'average') result = Number(a) - Number(b);
    else if (field === 'gradeLevel') {
      const gradeOrder = (value: unknown) => {
        const normalized = text(value).toLowerCase().replace(/\s+/g, '');
        if (['k', 'kg', 'kinder', 'kindergarten', '0'].includes(normalized)) return 0;
        const match = normalized.match(/^(?:grade)?(\d+)$/);
        return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
      };
      result = gradeOrder(a) - gradeOrder(b);
    } else result = text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  // A predictable surname order resolves equal grades, sections, and statuses.
  return result ? result * sign : compareProfileNames(first, second);
}

/**
 * Surname-first convention (e.g. "Dela Cruz, Juan Santos").
 * Used for archived/movement learner lists (dropout, transfer, promotion, retention).
 */
export function formatLearnerNameSurnameFirst(learner: LearnerNameRecord, fallback = ''): string {
  const firstName = text(learner.firstName);
  const middleName = text(learner.middleName);
  const lastName = text(learner.lastName);
  const suffix = text(learner.suffix);
  if (lastName || firstName) {
    const givenName = [firstName, middleName].filter(Boolean).join(' ');
    const core = givenName ? `${lastName}, ${givenName}` : lastName;
    return suffix ? `${core}, ${suffix}` : core;
  }
  return text(learner.name) || fallback;
}

export function compareLearnersBySurname(first: LearnerNameRecord, second: LearnerNameRecord): number {
  return learnerSurname(first).localeCompare(learnerSurname(second), undefined, { numeric: true, sensitivity: 'base' })
    || text(first.firstName).localeCompare(text(second.firstName), undefined, { numeric: true, sensitivity: 'base' })
    || text(first.middleName).localeCompare(text(second.middleName), undefined, { numeric: true, sensitivity: 'base' })
    || text(first.learnerId).localeCompare(text(second.learnerId), undefined, { numeric: true, sensitivity: 'base' });
}
