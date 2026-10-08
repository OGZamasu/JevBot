export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; csrf?: string } = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', method: options.method ?? 'GET',
    headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json() as { error?: string; details?: string[] };
  if (!response.ok) throw new ApiError(data.details?.join('; ') ?? data.error ?? 'Request failed', response.status);
  return data as T;
}
