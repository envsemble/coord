// Settings › General › Appearance: the app's theme, the operating system's, light or dark. Main keeps
// the choice for every window and applies it as Electron's native theme; envUI follows it through
// prefers-color-scheme.
import { useEffect, useState } from 'react';
import { Radio, RadioGroup } from '@envsemble/envui';
import { themePreferences, type ThemePreference } from '../../shared/contract';
import { api } from '../api';

const labels: Record<ThemePreference, string> = { system: 'Match the system', light: 'Light', dark: 'Dark' };

/** The theme to choose, read when Settings shows it (another window may have changed it). */
export function ThemeChoice() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  useEffect(() => {
    let live = true;
    api.theme().then(value => { if (live) setPreference(value); }, () => { if (live) setPreference('system'); });
    return () => { live = false; };
  }, []);
  const choose = (value: string) => {
    const next = value as ThemePreference, previous = preference;
    setPreference(next);
    api.setTheme(next).catch(() => setPreference(previous));
  };
  return <RadioGroup orientation="vertical" label="Theme" name="theme" className="settings-choice" value={preference ?? ''} onValueChange={choose}>
    {themePreferences.map(value => <Radio key={value} value={value} label={labels[value]} />)}
  </RadioGroup>;
}
