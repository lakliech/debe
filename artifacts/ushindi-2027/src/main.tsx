import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';

// Register service worker for offline-first polling agent PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // Listen for messages from SW (e.g. submission synced)
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SUBMISSION_SYNCED') {
            window.dispatchEvent(new CustomEvent('sw-submission-synced', { detail: event.data }));
          }
        });
        // Trigger sync on reconnect
        window.addEventListener('online', () => {
          reg.active?.postMessage({ type: 'REQUEST_SYNC' });
        });
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
