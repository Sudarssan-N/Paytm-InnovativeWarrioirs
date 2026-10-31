import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { loadAiStatus } from './engine/api.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

async function start() {
  // The RM desk is for staff, so it skips the customer sign-in.
  const desk = /^\/desk\/?$/.test(window.location.pathname);
  if (!desk) await loadAiStatus();
  const { default: Page } = desk ? await import('./journeys/ui/RmDesk.jsx') : await import('./journeys/ui/Auth.jsx');
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary><Page /></ErrorBoundary>
    </React.StrictMode>
  );
}

start();
