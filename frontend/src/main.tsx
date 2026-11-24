import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setTransport } from './api/client';
import './styles/themes.css';
import './styles/base.css';
import './styles/app.css';

async function start() {
  // __LVS_MOCK__ is a build-time constant, so live builds drop the mock module (and its chunk) entirely
  if (__LVS_MOCK__) {
    const { mockFetch } = await import('./mock/server');
    setTransport(mockFetch);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
