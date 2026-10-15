export const APP_THEMES = ['Light', 'Dark', 'Dracula', 'Monokai', 'Beach', 'Nord', 'Forest', 'ClentIndustries Theme'] as const;

export type AppTheme = typeof APP_THEMES[number];

export function isAppTheme(theme: unknown): theme is AppTheme {
  return typeof theme === 'string' && (APP_THEMES as readonly string[]).includes(theme);
}

export function isDarkAppTheme(theme: AppTheme): boolean {
  return theme === 'Dark' || theme === 'Dracula' || theme === 'Monokai' || theme === 'Nord' || theme === 'Forest' || theme === 'ClentIndustries Theme';
}

export function appThemeId(theme: AppTheme): string {
  return theme.toLowerCase().replace(/\s+/g, '-');
}

export function appThemeFromId(themeId: string): AppTheme | undefined {
  return APP_THEMES.find((theme) => appThemeId(theme) === themeId);
}
