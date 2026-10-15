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

export function compareLearnersBySurname(first: LearnerNameRecord, second: LearnerNameRecord): number {
  return learnerSurname(first).localeCompare(learnerSurname(second), undefined, { numeric: true, sensitivity: 'base' })
    || text(first.firstName).localeCompare(text(second.firstName), undefined, { numeric: true, sensitivity: 'base' })
    || text(first.middleName).localeCompare(text(second.middleName), undefined, { numeric: true, sensitivity: 'base' })
    || text(first.learnerId).localeCompare(text(second.learnerId), undefined, { numeric: true, sensitivity: 'base' });
}
