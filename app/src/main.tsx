import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemePreferenceProvider, ToastProvider } from '@envsemble/envui';
import { useStoredThemePreference } from '@envsemble/envui/theme-storage';
import { coordTheme, coordThemeStorage } from '../shared/theme';
import App from './App';
import './coord.css';

function Root() {
  const storedTheme = useStoredThemePreference(coordThemeStorage);
  return <ThemePreferenceProvider theme={coordTheme} {...storedTheme}>
    <ToastProvider><App /></ToastProvider>
  </ThemePreferenceProvider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>);
