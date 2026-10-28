import { Button, Callout, Card, HTMLSelect, Spinner, Switch, Tag } from '@blueprintjs/core';
import { useMemo, useState } from 'react';
import type { CallToolResponse, ServerSummary } from '@mymcp/console-contracts';

import { ApiClientError } from '../../api/client.js';
import { useCallTool, useServers, useTools } from '../../api/hooks.js';
import { useTheme } from '../../app/ThemeProvider.js';
import { previewSearchImport } from './importPreview.js';

const samples: Record<string, Record<string, unknown>> = {
  'example:echo': { message: 'hello from mymcp console' },
  'dcinside:dc_parse_post_url': {
    url: 'https://gall.dcinside.com/board/view/?id=example&no=123',
  },
  'dcinside:dc_search_posts': {
    query: '24년생',
    source: 'authorized',
    sort: 'relevance',
    limit: 5,
  },
  'dcinside:dc_import_search_results': { format: 'csv', data: '', replace: false },
};

function statusLabel(server: ServerSummary): string {
  if (server.catalogState !== 'supported') return 'Not enabled';
  if (server.runtimeState === 'ready' && server.health === 'ok') return 'API OK';
  if (server.runtimeState === 'connecting') return 'Checking';
  if (server.runtimeState === 'degraded' || server.health === 'warning') return 'Degraded';
  if (server.runtimeState === 'error' || server.health === 'failing') return 'API failed';
  return 'Not checked';
}

function statusIntent(server: ServerSummary): 'success' | 'warning' | 'danger' | 'none' {
  const label = statusLabel(server);
  if (label === 'API OK') return 'success';
  if (label === 'Checking' || label === 'Degraded') return 'warning';
  if (label === 'API failed') return 'danger';
  return 'none';
}

function checkedAt(value: string | null): string {
  if (!value) return 'Never checked';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown check time' : date.toLocaleTimeString();
}

function defaultArguments(serverId: string, toolName: string): string {
  return JSON.stringify(samples[`${serverId}:${toolName}`] ?? {}, null, 2);
}

function responseText(response: CallToolResponse): string {
  if (response.structuredContent !== undefined) {
    return JSON.stringify(response.structuredContent, null, 2);
  }
  const text = response.content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n\n');
  return text || JSON.stringify(response, null, 2);
}

export function ConsolePage(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const servers = useServers();
  const rows = useMemo(() => servers.data?.servers ?? [], [servers.data?.servers]);
  const readyServers = useMemo(
    () =>
      rows.filter(
        ({ catalogState, runtimeState, health }) =>
          catalogState === 'supported' && runtimeState === 'ready' && health === 'ok',
      ),
    [rows],
  );
  const [selectedServerId, setSelectedServerId] = useState('');
  const serverId = readyServers.some(({ id }) => id === selectedServerId)
    ? selectedServerId
    : (readyServers[0]?.id ?? '');
  const [selectedToolName, setSelectedToolName] = useState('');
  const [argumentsDraft, setArgumentsDraft] = useState({ key: '', text: '{}' });
  const [inputError, setInputError] = useState<string | null>(null);
  const [response, setResponse] = useState<CallToolResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const tools = useTools(serverId, Boolean(serverId));
  const toolRows = useMemo(() => tools.data?.tools ?? [], [tools.data?.tools]);
  const toolName = toolRows.some(({ name }) => name === selectedToolName)
    ? selectedToolName
    : (toolRows[0]?.name ?? '');
  const argumentKey = `${serverId}:${toolName}`;
  const argumentsText =
    argumentsDraft.key === argumentKey ? argumentsDraft.text : defaultArguments(serverId, toolName);

  const tool = toolRows.find(({ name }) => name === toolName);
  const call = useCallTool(serverId, toolName);
  const writeRisk = tool?.annotations?.readOnlyHint === false;

  function selectServer(id: string): void {
    setSelectedServerId(id);
    setSelectedToolName('');
    setInputError(null);
    setResponse(null);
    setSelectedFile(null);
    call.reset();
  }

  function selectTool(name: string): void {
    setSelectedToolName(name);
    setInputError(null);
    setResponse(null);
    setSelectedFile(null);
    call.reset();
  }

  function runTool(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argumentsText) as unknown;
    } catch {
      setInputError('Arguments must be valid JSON.');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setInputError('Arguments must be a JSON object.');
      return;
    }
    if (writeRisk && !window.confirm(`${toolName} may change local data. Run this tool?`)) {
      return;
    }
    setInputError(null);
    call.mutate(
      {
        arguments: parsed as Record<string, unknown>,
        ...(writeRisk ? { confirmWrite: true } : {}),
      },
      { onSuccess: setResponse },
    );
  }

  return (
    <div className="compact-console">
      <header className="compact-header">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="30" height="30" />
          <div>
            <strong>mymcp Console</strong>
            <span>Live MCP check and tool runner</span>
          </div>
        </div>
        <Switch
          checked={theme === 'light'}
          label="Light"
          aria-label="Use light theme"
          onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
      </header>

      <main className="compact-main">
        <section className="section-block" aria-labelledby="mcp-status-title">
          <div className="section-heading">
            <div>
              <h1 id="mcp-status-title">MCP status</h1>
              <p>
                Each refresh verifies the live MCP API with <code>tools/list</code>.
              </p>
            </div>
            <Button
              small
              icon="refresh"
              text="Check now"
              loading={servers.isFetching}
              onClick={() => void servers.refetch()}
            />
          </div>

          {servers.isPending ? (
            <div className="checking-state">
              <Spinner size={22} /> Checking MCP APIs…
            </div>
          ) : null}
          {servers.isError ? (
            <Callout intent="danger" title="Status check failed">
              The Console API could not check the registered MCP servers.
            </Callout>
          ) : null}

          <div className="server-grid">
            {rows.map((server) => {
              const selectable = statusLabel(server) === 'API OK';
              return (
                <button
                  type="button"
                  key={server.id}
                  className={`server-tile ${server.id === serverId ? 'is-selected' : ''}`}
                  disabled={!selectable}
                  onClick={() => selectServer(server.id)}
                >
                  <span className="server-tile-top">
                    <strong>{server.displayName}</strong>
                    <Tag intent={statusIntent(server)}>{statusLabel(server)}</Tag>
                  </span>
                  <span className="server-tile-meta">
                    {server.toolCount === undefined ? 'No live tools' : `${server.toolCount} tools`}
                    {' · '}
                    {checkedAt(server.lastCheckedAt)}
                  </span>
                  {server.lastErrorCode ? (
                    <span className="server-error">{server.lastErrorCode}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="section-block" aria-labelledby="tool-runner-title">
          <div className="section-heading">
            <div>
              <h2 id="tool-runner-title">Run a tool</h2>
              <p>Select one healthy MCP and invoke one discovered tool.</p>
            </div>
          </div>

          {readyServers.length === 0 && !servers.isPending ? (
            <Callout intent="warning">No MCP API is ready.</Callout>
          ) : (
            <div className="runner-grid">
              <Card className="runner-input" compact>
                <label>
                  MCP
                  <HTMLSelect
                    fill
                    value={serverId}
                    onChange={(event) => selectServer(event.currentTarget.value)}
                  >
                    {readyServers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.displayName}
                      </option>
                    ))}
                  </HTMLSelect>
                </label>
                <label>
                  Tool
                  <HTMLSelect
                    fill
                    value={toolName}
                    disabled={!serverId || tools.isPending}
                    onChange={(event) => selectTool(event.currentTarget.value)}
                  >
                    {toolRows.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </HTMLSelect>
                </label>
                {tool ? (
                  <p className="tool-description">
                    {tool.description ?? 'No description provided.'}
                    {writeRisk ? <Tag intent="warning">May write</Tag> : null}
                  </p>
                ) : null}
                {serverId === 'dcinside' && toolName === 'dc_import_search_results' ? (
                  <label>
                    CSV or JSON file
                    <input
                      aria-label="Search results file"
                      type="file"
                      accept=".csv,.json,text/csv,application/json"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (!file) return;
                        if (file.size > 1_048_576) {
                          setInputError('File must be 1 MiB or smaller.');
                          return;
                        }
                        void file.text().then((data) => {
                          const format = file.name.toLocaleLowerCase().endsWith('.json')
                            ? 'json'
                            : 'csv';
                          const preview = previewSearchImport(format, data);
                          if (preview.error) {
                            setInputError(preview.error);
                            setSelectedFile(`${file.name} · preview failed`);
                            return;
                          }
                          setArgumentsDraft({
                            key: argumentKey,
                            text: JSON.stringify({ format, data, replace: false }, null, 2),
                          });
                          setSelectedFile(
                            `${file.name} · ${preview.total} rows · ${preview.accepted} valid · ${preview.duplicates} duplicate · ${preview.rejected} rejected · ${preview.galleries.join(', ') || 'no gallery'}`,
                          );
                          setInputError(null);
                        });
                      }}
                    />
                    {selectedFile ? <small>{selectedFile}</small> : null}
                  </label>
                ) : null}
                <label>
                  Arguments
                  <textarea
                    aria-label="Tool arguments"
                    rows={9}
                    spellCheck={false}
                    value={argumentsText}
                    onChange={(event) =>
                      setArgumentsDraft({ key: argumentKey, text: event.currentTarget.value })
                    }
                  />
                </label>
                {inputError ? <Callout intent="danger">{inputError}</Callout> : null}
                <Button
                  intent="primary"
                  icon="play"
                  text="Run"
                  disabled={!tool}
                  loading={call.isPending}
                  onClick={runTool}
                />
              </Card>

              <Card className="runner-output" compact>
                <div className="output-heading">
                  <strong>Result</strong>
                  {response ? (
                    <Tag intent={response.outcome === 'success' ? 'success' : 'danger'}>
                      {response.outcome === 'success' ? `${response.durationMs} ms` : 'Tool error'}
                    </Tag>
                  ) : null}
                </div>
                {call.error ? (
                  <Callout intent="danger" title="Call failed">
                    {call.error instanceof ApiClientError
                      ? `${call.error.code}: ${call.error.message}`
                      : 'The tool call failed.'}
                  </Callout>
                ) : response ? (
                  <pre className="result-output">{responseText(response)}</pre>
                ) : (
                  <p className="empty-result">Run a tool to see its result.</p>
                )}
              </Card>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
