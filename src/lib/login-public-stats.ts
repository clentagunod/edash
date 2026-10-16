type LoginPublicStats = {
  totalLearners?: number;
  programsTracked?: number;
  maleCount?: number;
  femaleCount?: number;
};

const LOGIN_PUBLIC_STAT_FIELDS = [
  ["loginLearnerCount", "totalLearners"],
  ["loginProgramCount", "programsTracked"],
  ["loginMaleCount", "maleCount"],
  ["loginFemaleCount", "femaleCount"],
] as const;

export function renderLoginPublicStats(stats: LoginPublicStats | null | undefined) {
  LOGIN_PUBLIC_STAT_FIELDS.forEach(([elementId, field]) => {
    const element = document.getElementById(elementId);
    if (element) {
      const count = Number(stats?.[field] ?? 0);
      element.textContent = (Number.isFinite(count) ? count : 0).toLocaleString();
    }
  });
}

export function clearLoginPublicStats() {
  LOGIN_PUBLIC_STAT_FIELDS.forEach(([elementId]) => {
    const element = document.getElementById(elementId);
    if (element) element.textContent = "—";
  });
}
