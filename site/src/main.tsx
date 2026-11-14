import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemePreferenceProvider } from '@envsemble/envui';
import { App } from './App.tsx';
import { themeStorageKey } from './theme.ts';
import './site.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <ThemePreferenceProvider storageKey={themeStorageKey}>
    <App />
  </ThemePreferenceProvider>
</React.StrictMode>);
