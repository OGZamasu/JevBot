import type { Settings } from '../shared/settings';

export async function reserveAI(
  db: D1Database,
  guildId: string,
  settings: Settings,
): Promise<string | null> {
  if (settings.aiDailyLimit === 0) return null;
  const day = new Date().toISOString().slice(0, 10);
  const minute = Math.floor(Date.now() / 60000);
  // Reserve before contacting the provider. Failed calls count toward the cap.
  const slot = await db
    .prepare(
      `INSERT INTO usage_minute (guild_id, minute, requests) VALUES (?, ?, 1)
    ON CONFLICT(guild_id, minute) DO UPDATE SET requests = requests + 1 WHERE requests < ? RETURNING requests`,
    )
    .bind(guildId, minute, settings.aiMinuteLimit)
    .first();
  if (!slot) return null;
  const daily = await db
    .prepare(
      `INSERT INTO usage_daily (guild_id, day, requests) VALUES (?, ?, 1)
    ON CONFLICT(guild_id, day) DO UPDATE SET requests = requests + 1 WHERE requests < ? RETURNING requests`,
    )
    .bind(guildId, day, settings.aiDailyLimit)
    .first();
  return daily ? day : null;
}

export async function recordAI(
  db: D1Database,
  guildId: string,
  day: string,
  usage?: { input_tokens: number; output_tokens: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE usage_daily SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, failures = failures + ? WHERE guild_id = ? AND day = ?`,
    )
    .bind(usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, usage ? 0 : 1, guildId, day)
    .run();
}
