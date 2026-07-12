import React from 'react';
import ReactDOM from 'react-dom/client';
import './devBrowserBridge';
import App from './App';
import { I18nProvider } from './i18n';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';
import './team-workbench-v3.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <I18nProvider>
      <App />
    </I18nProvider>
  </ErrorBoundary>
);
