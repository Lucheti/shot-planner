import type { ReactElement } from 'react';
import { HttpApiClient, type ApiClient } from './api/api-client.js';
import { App } from './components/App.js';
import { SessionProvider } from './state/session-context.js';
import { createSessionStore, type SessionStore } from './state/session-store.js';

export interface WebApp {
  readonly store: SessionStore;
  readonly root: ReactElement;
}

/**
 * The web app's single composition root: picks the concrete API client and id source,
 * builds the store, and returns the element tree to mount.
 */
export function composeWeb(overrides: { api?: ApiClient } = {}): WebApp {
  const api = overrides.api ?? new HttpApiClient((input, init) => fetch(input, init));
  const store = createSessionStore({ api, newId: () => crypto.randomUUID() });
  return {
    store,
    root: (
      <SessionProvider store={store}>
        <App />
      </SessionProvider>
    ),
  };
}
