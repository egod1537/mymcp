export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('mymcp:unauthorized'));
    throw new ApiClientError(
      response.status,
      payload.error?.code ?? 'HTTP_ERROR',
      payload.error?.message ?? 'Request failed',
      payload.error?.requestId,
    );
  }
  return payload as T;
}
