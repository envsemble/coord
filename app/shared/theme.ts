import type { ThemeDefinition } from '@envsemble/envui/theme-bootstrap';
import type { ThemeStorageOptions } from '@envsemble/envui/theme-storage';

// The renderer's theme, which ThemePreferenceProvider and the theme startup script both take. It is
// what envUI's defineTheme makes, written as plain data so the build's config reads it without
// loading envUI.
export const coordTheme: Readonly<ThemeDefinition> = Object.freeze({});
// Where the renderer keeps the chosen theme: localStorage under Coord's own key, read by the startup
// script before the first paint and kept by useStoredThemePreference after it.
export const coordThemeStorage: Readonly<ThemeStorageOptions> = Object.freeze({ storageKey: 'coord-theme' });
