import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { auth, requireSession, guildAccess, requireOwner, owner, type App } from './auth';
import { settingsSchema, snowflake } from '../shared/settings';
import { detectRules, decide, type Message, type Evaluation } from '../shared/moderation';
import { getSettings, audit, cleanExpired } from './db';
import { encrypt, decrypt } from './crypto';
import { evaluateJev, JevError } from './jev';
import { reserveAI, recordAI } from './usage';
import { discordRequest } from './discord';
import type { AppEnv } from './env';
export { DiscordGateway } from './gateway';

const app = new Hono<App>();
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/')) c.header('Cache-Control', 'no-store');
});
app.use('*', bodyLimit({ maxSize: 131072, onError: c => c.json({ error: 'Request body is too large' }, 413) }));
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: 'Invalid input', details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }, 400);
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON' }, 400);
  if (error instanceof JevError) return c.json({ error: error.message }, 502);
  // Never log request bodies, OAuth codes, tokens, provider errors, or message text.
  console.error(JSON.stringify({ event: 'request_failed', path: c.req.path, kind: error.name }));
  return c.json({ error: 'The request could not be completed. Please try again.' }, 500);
});
app.route('/auth', auth);
app.get('/api/public', c => c.json({ name: 'JevBot', version: '0.1.0', sourceUrl: c.env.SOURCE_URL,
  loginReady: !!(c.env.DISCORD_CLIENT_ID && c.env.DISCORD_CLIENT_SECRET && c.env.OWNER_DISCORD_ID) }));
app.get('/api/health', c => c.json({ ok: true, service: 'jevbot' }));

app.use('/api/me', requireSession);
app.use('/api/guilds', requireSession);
app.use('/api/guilds/*', requireSession);
app.use('/api/bot/*', requireSession);

app.get('/api/me', c => {
  const session = c.get('session');
  return c.json({ id: session.user_id, username: session.username, avatar: session.avatar, csrf: session.csrf, owner: owner(c.env, session.user_id) });
});
app.get('/api/guilds', async c => {
  const userId = c.get('session').user_id;
  const sql = owner(c.env, userId) ? "SELECT id, name, icon, 'owner' AS role FROM guilds WHERE active = 1 ORDER BY name"
    : 'SELECT g.id, g.name, g.icon, a.role FROM guilds g JOIN access_grants a ON g.id = a.guild_id WHERE g.active = 1 AND a.user_id = ? ORDER BY g.name';
  const statement = c.env.DB.prepare(sql);
  return c.json({ guilds: (await (owner(c.env, userId) ? statement : statement.bind(userId)).all()).results });
});
app.get('/api/guilds/:id/settings', async c => {
  const id = snowflake.parse(c.req.param('id'));
  const role = await guildAccess(c, id);
  const key = await c.env.DB.prepare('SELECT updated_at FROM secrets WHERE guild_id = ?').bind(id).first();
  const usage = await c.env.DB.prepare('SELECT * FROM usage_daily WHERE guild_id = ? AND day = ?').bind(id, new Date().toISOString().slice(0, 10)).first();
  return c.json({ settings: await getSettings(c.env.DB, id), keyConfigured: !!key, keyUpdatedAt: key?.updated_at ?? null,
    encryptionReady: !!c.env.ENCRYPTION_KEY, role, usage: usage ?? { requests: 0, input_tokens: 0, output_tokens: 0, failures: 0 } });
});
app.put('/api/guilds/:id/settings', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id, true);
  const settings = settingsSchema.parse(await c.req.json());
  if (settings.logChannelId) {
    if (!c.env.DISCORD_BOT_TOKEN) throw new HTTPException(409, { message: 'The bot is not connected yet' });
    const channel = await discordRequest<{ guild_id?: string; type: number }>(c.env.DISCORD_BOT_TOKEN, `/channels/${settings.logChannelId}`);
    if (channel.guild_id !== id || ![0, 5].includes(channel.type)) throw new HTTPException(400, { message: 'Choose a text channel in this server for moderation logs' });
  }
  const actor = c.get('session').user_id;
  await c.env.DB.prepare('INSERT INTO settings (guild_id, config, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .bind(id, JSON.stringify(settings), Date.now(), actor).run();
  await audit(c.env.DB, actor, id, 'settings_updated', `${settings.preset}; ${settings.enabled ? 'enabled' : 'paused'}; ${settings.action}`);
  await c.env.GATEWAY.getByName('bot:0').invalidate(id);
  return c.json({ ok: true, settings });
});
app.get('/api/guilds/:id/resources', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id);
  if (!c.env.DISCORD_BOT_TOKEN) return c.json({ channels: [], roles: [] });
  const [channels, roles] = await Promise.all([
    discordRequest<{ id: string; name: string; type: number }[]>(c.env.DISCORD_BOT_TOKEN, `/guilds/${id}/channels`),
    discordRequest<{ id: string; name: string }[]>(c.env.DISCORD_BOT_TOKEN, `/guilds/${id}/roles`),
  ]);
  return c.json({ channels: channels.filter(channel => [0, 5].includes(channel.type)).map(({ id, name }) => ({ id, name })), roles: roles.map(({ id, name }) => ({ id, name })) });
});
app.put('/api/guilds/:id/key', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id, true);
  if (!c.env.ENCRYPTION_KEY) throw new HTTPException(503, { message: 'The instance owner must configure encryption first' });
  const input = z.object({ key: z.string().trim().min(10).max(512) }).strict().parse(await c.req.json());
  // Validation does not spend inference credits; the tester validates by making an explicitly requested evaluation.
  await c.env.DB.prepare('INSERT INTO secrets VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, updated_at = excluded.updated_at')
    .bind(id, await encrypt(input.key, c.env.ENCRYPTION_KEY, id), Date.now()).run();
  await audit(c.env.DB, c.get('session').user_id, id, 'api_key_saved');
  return c.json({ ok: true });
});
app.delete('/api/guilds/:id/key', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id, true);
  await c.env.DB.prepare('DELETE FROM secrets WHERE guild_id = ?').bind(id).run();
  await audit(c.env.DB, c.get('session').user_id, id, 'api_key_removed'); return c.json({ ok: true });
});
app.post('/api/guilds/:id/test', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id, true);
  const input = z.object({ content: z.string().min(1).max(2000), ai: z.boolean(), repetitions: z.number().int().min(1).max(20).default(1) }).strict().parse(await c.req.json());
  const settings = await getSettings(c.env.DB, id);
  const message: Message = { id: 'preview', guildId: id, channelId: '', authorId: 'preview', content: input.content, roles: [], mentions: (input.content.match(/<@!?\d+>|<@&\d+>/g) ?? []).length, everyone: /@everyone|@here/.test(input.content), timestamp: Date.now() };
  const recent = Array.from({ length: input.repetitions - 1 }, (_, i) => ({ ...message, id: `preview-${i}`, timestamp: message.timestamp - (i + 1) * 100 }));
  const signals = detectRules(message, recent, settings);
  let evaluation: Evaluation = { signals, probability: signals.length ? 1 : 0, confidence: 1, source: 'rules', aiStatus: 'not_requested' };
  if (input.ai) {
    const key = await c.env.DB.prepare('SELECT encrypted_key FROM secrets WHERE guild_id = ?').bind(id).first<{ encrypted_key: string }>();
    if (!key || !c.env.ENCRYPTION_KEY) throw new HTTPException(409, { message: 'Save a Jev API key first' });
    const reservation = await reserveAI(c.env.DB, id, settings);
    if (!reservation) throw new HTTPException(429, { message: 'Your configured API request limit has been reached' });
    try {
      const result = await evaluateJev(await decrypt(key.encrypted_key, c.env.ENCRYPTION_KEY, id), c.env.JEV_MODEL, message);
      evaluation = signals.length ? { ...evaluation, aiStatus: 'evaluated', source: 'rules+jev' } : result.evaluation;
      await recordAI(c.env.DB, id, reservation, result.usage);
    } catch (error) { await recordAI(c.env.DB, id, reservation); throw error; }
  }
  return c.json({ evaluation, decision: decide(evaluation, settings, 0), preview: true });
});
app.get('/api/guilds/:id/incidents', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id);
  const before = z.coerce.number().int().positive().parse(c.req.query('before') ?? Date.now() + 1);
  const results = (await c.env.DB.prepare('SELECT * FROM incidents WHERE guild_id = ? AND created_at < ? AND expires_at > ? ORDER BY created_at DESC LIMIT 50').bind(id, before, Date.now()).all()).results;
  return c.json({ incidents: results, nextBefore: results.length === 50 ? results[49].created_at : null });
});
app.patch('/api/guilds/:id/incidents/:incident', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id);
  const input = z.object({ status: z.enum(['confirmed', 'dismissed']), note: z.string().max(500).default('') }).strict().parse(await c.req.json());
  const result = await c.env.DB.prepare('UPDATE incidents SET status = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND guild_id = ? AND expires_at > ? RETURNING id')
    .bind(input.status, c.get('session').user_id, input.note, c.req.param('incident'), id, Date.now()).first();
  if (!result) throw new HTTPException(404, { message: 'Incident not found' });
  await audit(c.env.DB, c.get('session').user_id, id, 'incident_reviewed', `${c.req.param('incident')}: ${input.status}`);
  return c.json({ ok: true });
});
app.get('/api/guilds/:id/access', async c => {
  const id = snowflake.parse(c.req.param('id')); requireOwner(c); await guildAccess(c, id);
  return c.json({ grants: (await c.env.DB.prepare('SELECT user_id, role, created_at FROM access_grants WHERE guild_id = ?').bind(id).all()).results });
});
app.put('/api/guilds/:id/access', async c => {
  const id = snowflake.parse(c.req.param('id')); requireOwner(c); await guildAccess(c, id);
  const input = z.object({ userId: snowflake, role: z.enum(['admin', 'reviewer']) }).strict().parse(await c.req.json());
  if (input.userId === c.env.OWNER_DISCORD_ID) throw new HTTPException(400, { message: 'The owner already has access' });
  await c.env.DB.prepare('INSERT INTO access_grants VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, guild_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by')
    .bind(input.userId, id, input.role, c.get('session').user_id, Date.now()).run();
  await audit(c.env.DB, c.get('session').user_id, id, 'access_granted', `${input.userId}: ${input.role}`);
  return c.json({ ok: true });
});
app.delete('/api/guilds/:id/access/:user', async c => {
  const id = snowflake.parse(c.req.param('id')); requireOwner(c); await guildAccess(c, id);
  const user = snowflake.parse(c.req.param('user'));
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM access_grants WHERE guild_id = ? AND user_id = ?').bind(id, user), c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user)]);
  await audit(c.env.DB, c.get('session').user_id, id, 'access_revoked', user);
  return c.json({ ok: true });
});
app.get('/api/guilds/:id/audit', async c => {
  const id = snowflake.parse(c.req.param('id')); await guildAccess(c, id);
  return c.json({ events: (await c.env.DB.prepare('SELECT actor_id, event, detail, created_at FROM audit_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50').bind(id).all()).results });
});
app.get('/api/bot/status', async c => { requireOwner(c); return c.json(await c.env.GATEWAY.getByName('bot:0').getStatus()); });
app.post('/api/bot/start', async c => { requireOwner(c); if (!c.env.DISCORD_BOT_TOKEN) throw new HTTPException(409, { message: 'Configure the Discord bot token first' });
  await audit(c.env.DB, c.get('session').user_id, null, 'bot_started'); return c.json(await c.env.GATEWAY.getByName('bot:0').start()); });
app.post('/api/bot/stop', async c => { requireOwner(c); await audit(c.env.DB, c.get('session').user_id, null, 'bot_stopped'); return c.json(await c.env.GATEWAY.getByName('bot:0').stop()); });
app.get('/api/bot/invite', c => {
  requireOwner(c);
  if (!c.env.DISCORD_CLIENT_ID) throw new HTTPException(409, { message: 'Discord application is not configured' });
  // View channels, send messages, manage messages, read history, moderate members. Never Administrator.
  const permissions = (1024n | 2048n | 8192n | 65536n | 1099511627776n).toString();
  return c.json({ url: `https://discord.com/oauth2/authorize?client_id=${c.env.DISCORD_CLIENT_ID}&scope=bot&permissions=${permissions}` });
});
app.all('/api/*', c => c.json({ error: 'Not found' }, 404));
app.all('/auth/*', c => c.json({ error: 'Not found' }, 404));
app.get('*', c => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([cleanExpired(env.DB), env.GATEWAY.getByName('bot:0').watchdog()]).catch(() => {
      console.error(JSON.stringify({ event: 'maintenance_failed' }));
    }));
  },
} satisfies ExportedHandler<AppEnv>;
