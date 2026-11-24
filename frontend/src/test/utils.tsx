import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setNativeOverride, setTransport } from '../api/client';
import { setAccessToken } from '../api/tokens';
import { mockFetch, resetMockSettings } from '../mock/server';
import { ThemeProvider, useRootAttrs } from '../theme/ThemeProvider';

export function useMockApi() {
  resetMockSettings();
  setNativeOverride(false);
  setAccessToken('mock.test-token');
  setTransport(mockFetch);
}

function Root({ children }: { children: ReactElement }) {
  const attrs = useRootAttrs();
  return (
    <div className="lvs" {...attrs}>
      {children}
    </div>
  );
}

/** Render inside the real providers at a route. `path` is the route pattern. */
export function renderAt(ui: ReactElement, { route = '/', path = '*' }: { route?: string; path?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          <Root>
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          </Root>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

export function json(data: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
