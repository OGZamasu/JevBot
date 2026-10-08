import { presetSettings, settingsSchema, type Settings } from '../shared/settings';

export async function getSettings(db: D1Database, guildId: string): Promise<Settings> {
  const row = await db
    .prepare('SELECT config FROM settings WHERE guild_id = ?')
    .bind(guildId)
    .first<{ config: string }>();
  return row ? settingsSchema.parse(JSON.parse(row.config)) : presetSettings('observe');
}
export async function audit(
  db: D1Database,
  actor: string,
  guildId: string | null,
  event: string,
  detail = '',
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_log (id, actor_id, guild_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), actor, guildId, event, detail, Date.now())
    .run();
}
export async function cleanExpired(db: D1Database): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM incidents WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM strikes WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM audit_log WHERE created_at < ?').bind(now - 30 * 86400000),
    db
      .prepare('DELETE FROM usage_daily WHERE day < ?')
      .bind(new Date(now - 30 * 86400000).toISOString().slice(0, 10)),
    db.prepare('DELETE FROM usage_minute WHERE minute < ?').bind(Math.floor(now / 60000) - 60),
    db.prepare('DELETE FROM login_limits WHERE window < ?').bind(Math.floor(now / 600000) - 1),
  ]);
}
