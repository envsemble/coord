import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemePreferenceProvider, ToastProvider } from '@envsemble/envui';
import { themeStorageKey } from '../shared/theme';
import App from './App';
import './atlas.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>
  {/* envUI's comfortable scale: Atlas's type and controls keep the size they had, also under a mouse. */}
  <ThemePreferenceProvider storageKey={themeStorageKey} scale="comfortable">
    <ToastProvider><App /></ToastProvider>
  </ThemePreferenceProvider>
</React.StrictMode>);
