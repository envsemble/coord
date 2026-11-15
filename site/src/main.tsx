import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
// Inter, served with the site (OFL-1.1): the page reads the same on Windows and Linux.
import '@fontsource-variable/inter/opsz.css';
import './site.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
