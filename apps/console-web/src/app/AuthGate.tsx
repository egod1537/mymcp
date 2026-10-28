import { Button, Callout, Card, FormGroup, InputGroup, Spinner } from '@blueprintjs/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { SessionResponse } from '@mymcp/console-contracts';

import { ApiClientError, apiRequest } from '../api/client.js';
import { AuthContextProvider } from './AuthContext.js';

type SessionPayload = SessionResponse;

export function AuthGate({ children }: PropsWithChildren): React.JSX.Element {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => apiRequest<SessionPayload>('/api/auth/session'),
    retry: false,
  });
  useEffect(() => {
    const handleUnauthorized = () => void session.refetch();
    window.addEventListener('mymcp:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('mymcp:unauthorized', handleUnauthorized);
  }, [session]);
  const login = useMutation({
    mutationFn: () =>
      apiRequest<SessionPayload>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: (data) => {
      setPassword('');
      queryClient.setQueryData(['session'], data);
    },
  });

  if (session.isPending) {
    return (
      <main className="centered-state" aria-label="Loading session">
        <Spinner size={32} />
      </main>
    );
  }

  if (
    session.isError &&
    (!(session.error instanceof ApiClientError) || session.error.status >= 500)
  ) {
    return (
      <main className="centered-state">
        <Callout intent="danger" title="Console API unavailable">
          Check that the local Console server is running. No internal stack details are exposed.
        </Callout>
      </main>
    );
  }

  if (!session.data?.authenticated) {
    return (
      <main className="login-page">
        <Card className="login-card" elevation={2}>
          <h1>mymcp Console</h1>
          <p className="bp6-text-muted">
            Authenticate to inspect and invoke allowlisted MCP servers.
          </p>
          {session.data?.setupRequired ? (
            <Callout intent="warning" title="Authentication setup required">
              Generate an Argon2id hash with <code>pnpm console:hash-password</code>, then set
              <code> CONSOLE_ADMIN_PASSWORD_HASH</code> on the server.
            </Callout>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (password) login.mutate();
            }}
          >
            <FormGroup label="Admin password" labelFor="admin-password">
              <InputGroup
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onValueChange={setPassword}
                disabled={session.data?.setupRequired || login.isPending}
              />
            </FormGroup>
            {login.isError ? (
              <Callout intent="danger" compact>
                {login.error instanceof ApiClientError
                  ? login.error.message
                  : 'Authentication failed.'}
              </Callout>
            ) : null}
            <Button
              type="submit"
              intent="primary"
              fill
              loading={login.isPending}
              disabled={!password || Boolean(session.data?.setupRequired)}
              text="Sign in"
            />
          </form>
        </Card>
      </main>
    );
  }

  return <AuthContextProvider session={session.data}>{children}</AuthContextProvider>;
}
