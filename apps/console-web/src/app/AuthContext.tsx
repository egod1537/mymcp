import { createContext, useContext } from 'react';
import type { PropsWithChildren } from 'react';
import type { SessionResponse } from '@mymcp/console-contracts';

export type AuthenticatedSession = Extract<SessionResponse, { authenticated: true }>;

const AuthContext = createContext<AuthenticatedSession | null>(null);

export function AuthContextProvider({
  session,
  children,
}: PropsWithChildren<{ session: AuthenticatedSession }>): React.JSX.Element {
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthenticatedSession {
  const session = useContext(AuthContext);
  if (!session) throw new Error('useAuth must be used inside an authenticated session');
  return session;
}
