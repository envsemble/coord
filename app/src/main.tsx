import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemePreferenceProvider, ToastProvider } from '@envsemble/envui';
import { coordTheme } from '../shared/theme';
import App from './App';
import './coord.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <ThemePreferenceProvider theme={coordTheme}>
    <ToastProvider><App /></ToastProvider>
  </ThemePreferenceProvider>
</React.StrictMode>);
