import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setTransport } from './api/client';
import { API_MODE } from './api/config';
import './styles/themes.css';
import './styles/base.css';
import './styles/app.css';

async function start() {
  if (API_MODE === 'mock') {
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
