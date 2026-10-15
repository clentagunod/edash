import { describe, expect, it } from 'vitest';
import { APP_THEMES, appThemeFromId, appThemeId, isAppTheme, isDarkAppTheme } from './themes';

describe('app themes', () => {
  it('registers the ClentIndustries visual theme and its persistent id', () => {
    const theme = 'ClentIndustries Theme';

    expect(APP_THEMES).toContain(theme);
    expect(isAppTheme(theme)).toBe(true);
    expect(appThemeId(theme)).toBe('clentindustries-theme');
    expect(appThemeFromId('clentindustries-theme')).toBe(theme);
    expect(isDarkAppTheme(theme)).toBe(true);
  });
});
