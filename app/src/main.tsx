import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
