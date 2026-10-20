// The app's theme: the operating system's, light or dark. Main keeps the choice for every window and
// applies it as Electron's native theme; envUI follows it through prefers-color-scheme.
import { useCallback, useState } from 'react';
import { IconButton, Menu, MenuRadioGroup, MenuRadioItem, useThemePreference } from '@envsemble/envui';
import { BrightnessAuto } from '@envsemble/envui/icons/BrightnessAuto';
import { DarkMode } from '@envsemble/envui/icons/DarkMode';
import { LightMode } from '@envsemble/envui/icons/LightMode';
import { themePreferences, type ThemePreference } from '../../shared/contract';
import { api } from '../api';

const labels: Record<ThemePreference, string> = { system: 'Match the system', light: 'Light', dark: 'Dark' };
const icons = { system: <BrightnessAuto />, light: <LightMode />, dark: <DarkMode /> };

/** The saved choice, read again each time a theme menu opens (another window may have changed it). */
function useThemeChoice() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  const refresh = useCallback(() => { api.theme().then(setPreference, () => setPreference('system')); }, []);
  const choose = useCallback((value: string) => {
    const next = value as ThemePreference;
    setPreference(next);
    api.setTheme(next).catch(() => setPreference(null));
  }, []);
  return { preference, refresh, choose };
}

function ThemeChoices({ preference, choose }: { preference: ThemePreference | null; choose(value: string): void }) {
  return <MenuRadioGroup value={preference ?? ''} onValueChange={choose}>
    {themePreferences.map(value => <MenuRadioItem key={value} value={value} icon={icons[value]}>{labels[value]}</MenuRadioItem>)}
  </MenuRadioGroup>;
}

/** The title bar's theme button. */
export function ThemeMenu() {
  const { theme } = useThemePreference();
  const { preference, refresh, choose } = useThemeChoice();
  return <Menu aria-label="Theme" density="compact" onOpenChange={open => { if (open) refresh(); }}
    trigger={<IconButton variant="text" icon={theme === 'dark' ? <DarkMode /> : <LightMode />} aria-label="Theme" />}>
    <ThemeChoices preference={preference} choose={choose} />
  </Menu>;
}
