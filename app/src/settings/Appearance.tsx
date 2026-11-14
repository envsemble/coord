// Settings › General › Appearance: the app's theme, the operating system's, light or dark, as one
// setting row with its choice at the end. Main keeps the choice for every window and applies it as
// Electron's native theme; envUI follows it through prefers-color-scheme.
import { useEffect, useId, useState } from 'react';
import { List, Select } from '@envsemble/envui';
import { themePreferences, type ThemePreference } from '../../shared/contract';
import { api } from '../api';

const labels: Record<ThemePreference, string> = { system: 'Match the system', light: 'Light', dark: 'Dark' };
const details: Record<ThemePreference, string> = {
  system: 'Coord turns light or dark with the operating system.',
  light: 'Coord stays light, whatever the operating system shows.',
  dark: 'Coord stays dark, whatever the operating system shows.',
};

/** The theme to choose, read when Settings shows it (another window may have changed it). */
export function ThemeChoice() {
  const id = useId();
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  useEffect(() => {
    let live = true;
    api.theme().then(value => { if (live) setPreference(value); }, () => { if (live) setPreference('system'); });
    return () => { live = false; };
  }, []);
  const choose = (value: string | null) => {
    if (!value) return;
    const next = value as ThemePreference, previous = preference;
    setPreference(next);
    api.setTheme(next).catch(() => setPreference(previous));
  };
  return <List.Root className="text-rows settings-rows" aria-label="Appearance">
    <List.Item className="settings-row" label={<span id={id + '-title'}>Theme</span>} description={<span id={id + '-detail'}>{details[preference ?? 'system']}</span>}
      end={<Select className="settings-row-select" aria-labelledby={id + '-title'} aria-describedby={id + '-detail'} value={preference} onValueChange={choose}
        items={themePreferences.map(value => ({ value, label: labels[value] }))} />} />
  </List.Root>;
}
