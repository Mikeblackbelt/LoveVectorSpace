import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom lacks these browser APIs.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
Element.prototype.scrollTo = function () {} as typeof Element.prototype.scrollTo;
window.scrollTo = (() => undefined) as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie.split(';').forEach((c) => {
    const k = c.split('=')[0].trim();
    if (k) document.cookie = `${k}=; Max-Age=0; path=/`;
  });
  vi.restoreAllMocks();
});
