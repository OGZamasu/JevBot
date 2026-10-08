import React from 'react';
import { createRoot } from 'react-dom/client';
import { Website } from './website';
import { Admin } from './admin';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.pathname.startsWith('/admin') ? <Admin /> : <Website />}</React.StrictMode>,
);
