const GRADE_LEVEL_ORDER = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];

export function compareGradeLevelLabels(first: string, second: string): number {
  const rank = (label: string) => {
    const index = GRADE_LEVEL_ORDER.findIndex((grade) => grade.toLowerCase() === label.trim().toLowerCase());
    return index < 0 ? GRADE_LEVEL_ORDER.length : index;
  };
  return rank(first) - rank(second) || first.localeCompare(second, undefined, { numeric: true });
}
