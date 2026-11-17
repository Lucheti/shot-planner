import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { SessionState, SessionStore } from './session-store.js';

const SessionContext = createContext<SessionStore | null>(null);

/** Makes a session store available to the component tree. */
export function SessionProvider({ store, children }: { store: SessionStore; children: ReactNode }) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

/** Subscribes a component to a slice of the session. Selectors must return stable values. */
export function useSession<T>(selector: (state: SessionState) => T): T {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSession must be used inside a SessionProvider.');
  return useStore(store, selector);
}
