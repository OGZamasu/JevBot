export class DiscordError extends Error {
  constructor(public status: number) {
    super(`Discord request failed (${status})`);
  }
}
export async function discordRequest<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; reason?: string } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      method: options.method ?? 'GET',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...(options.reason
          ? { 'X-Audit-Log-Reason': encodeURIComponent(options.reason.slice(0, 400)) }
          : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 429 && attempt < 2) {
      const limited = await response.json<{ retry_after?: number }>();
      const delay = Math.ceil((limited.retry_after ?? 1) * 1000);
      if (delay > 5000) throw new DiscordError(429);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DiscordError(response.status);
    }
    if (response.status === 204) return undefined as T;
    return await response.json<T>();
  }
  throw new DiscordError(429);
}
