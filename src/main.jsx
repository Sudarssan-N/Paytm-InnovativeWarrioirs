import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { loadAiStatus } from './engine/api.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

async function start() {
  await loadAiStatus();
  const { default: JourneyApp } = await import('./journeys/ui/JourneyApp.jsx');
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary><JourneyApp /></ErrorBoundary>
    </React.StrictMode>
  );
}

start();
