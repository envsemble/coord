import type { ThemeDefinition } from '@envsemble/envui/theme-bootstrap';

// The renderer's theme, which ThemePreferenceProvider and the theme startup script both take. It is
// what envUI's defineTheme makes, written as plain data so the build's config reads it without
// loading envUI.
export const coordTheme: Readonly<ThemeDefinition> = Object.freeze({ storageKey: 'coord-theme' });
