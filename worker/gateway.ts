import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import type { AppEnv } from './env';
import { detectRules, exempt, shouldUseAI, decide, type Message, type Evaluation } from '../shared/moderation';
import { forChannel, presetSettings, type Settings } from '../shared/settings';
import { getSettings } from './db';
import { discordRequest, DiscordError } from './discord';
import { decrypt, hash } from './crypto';
import { evaluateJev } from './jev';
import { reserveAI, recordAI } from './usage';

const payloadSchema = z.object({ id: z.string(), guild_id: z.string(), channel_id: z.string(), content: z.string(),
  author: z.object({ id: z.string(), bot: z.boolean().optional() }), member: z.object({ roles: z.array(z.string()), permissions: z.string().optional() }).optional(),
  mentions: z.array(z.object({ id: z.string() })).optional(), mention_roles: z.array(z.string()).optional(), mention_everyone: z.boolean().optional(), webhook_id: z.string().optional(),
});
type Packet = { op: number; s?: number | null; t?: string; d: Record<string, unknown> | null };
type Resume = { id: string; url: string; seq: number | null };
type GatewayStatus = { state: string; connectedAt: number | null; lastEventAt: number | null; lastAckAt: number | null; events: number; reconnects: number; dropped: number; lastError: string | null; botName: string | null };

export class DiscordGateway extends DurableObject<AppEnv> {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval = 41250;
  private awaitingAck = false;
  private connecting: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private resume: Resume | null = null;
  private running = false;
  private config = new Map<string, { value: Settings; until: number }>();
  private status: GatewayStatus = { state: 'stopped', connectedAt: null, lastEventAt: null, lastAckAt: null, events: 0, reconnects: 0, dropped: 0, lastError: null, botName: null };

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS processed (key TEXT PRIMARY KEY, at INTEGER NOT NULL)');
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS recent (id TEXT PRIMARY KEY, guild_id TEXT, author_id TEXT, channel_id TEXT, content TEXT, at INTEGER)');
      this.running = this.read<boolean>('running') ?? false;
      this.resume = this.read<Resume>('resume') ?? null;
      const previous = this.read<GatewayStatus>('status');
      if (previous) this.status = { ...previous, state: this.running ? 'recovering' : 'stopped' };
    });
  }
  private read<T>(key: string): T | undefined {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM state WHERE key = ?', key).toArray()[0];
    return row ? JSON.parse(row.value) as T : undefined;
  }
  private write(key: string, value: unknown) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)', key, JSON.stringify(value)); }
  private persist() { this.write('status', this.status); this.write('resume', this.resume); }
  private background(work: Promise<unknown>) { this.ctx.waitUntil(work.catch(() => { this.status.lastError = 'A background operation failed'; this.persist(); })); }

  async getStatus(): Promise<GatewayStatus> { return { ...this.status, state: !this.env.DISCORD_BOT_TOKEN ? 'not_configured' : this.status.state }; }
  async invalidate(guildId: string) { this.config.delete(guildId); }
  async start() {
    if (!this.env.DISCORD_BOT_TOKEN) throw new Error('Discord bot token is not configured');
    this.write('running', true); this.running = true;
    await this.connectGateway();
    return this.getStatus();
  }
  async stop() {
    this.write('running', false); this.running = false;
    this.clearHeartbeat();
    const socket = this.socket; this.socket = null;
    if (socket && socket.readyState < 2) socket.close(1000, 'Stopped by owner');
    this.ctx.storage.sql.exec('DELETE FROM recent');
    this.status.state = 'stopped'; this.persist();
    await this.ctx.storage.deleteAlarm();
    return this.getStatus();
  }
  async watchdog() {
    if (!this.running) return;
    if (!this.socket || this.socket.readyState !== 1 || (this.status.lastAckAt && Date.now() - this.status.lastAckAt > this.heartbeatInterval * 3)) {
      this.disconnect(); await this.connectGateway();
    }
  }
  private prune() {
    this.ctx.storage.sql.exec('DELETE FROM recent WHERE at < ?', Date.now() - 120000);
    this.ctx.storage.sql.exec('DELETE FROM processed WHERE at < ?', Date.now() - 86400000);
  }
  async alarm() {
    this.prune();
    if (!this.running) return;
    await this.watchdog();
    if (this.running) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  private clearHeartbeat() { if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null; }
  private disconnect() {
    this.clearHeartbeat();
    const socket = this.socket; this.socket = null;
    if (socket && socket.readyState < 2) socket.close(1000, 'Reconnecting');
  }
  private async connectGateway() {
    if (!this.running || this.socket?.readyState === 1) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try { await this.connecting; }
    catch { this.status.state = 'reconnecting'; this.status.lastError = 'Gateway connection failed'; this.persist(); await this.ctx.storage.setAlarm(Date.now() + 15000); }
    finally { this.connecting = null; }
  }
  private async open() {
    this.status.state = 'connecting'; this.persist();
    const endpoint = this.resume?.url ?? 'wss://gateway.discord.gg';
    const url = new URL(endpoint);
    if (url.protocol !== 'wss:' || !(url.hostname === 'gateway.discord.gg' || url.hostname.endsWith('.discord.gg'))) throw new Error('Invalid Gateway host');
    url.protocol = 'https:'; url.search = '?v=10&encoding=json';
    const response = await fetch(url, { headers: { Upgrade: 'websocket' }, signal: AbortSignal.timeout(10000) });
    const ws = response.webSocket;
    if (!ws) throw new Error('Missing Gateway websocket');
    this.socket = ws; this.awaitingAck = false; this.status.lastAckAt = null;
    ws.accept();
    ws.addEventListener('message', event => {
      if (this.socket !== ws || typeof event.data !== 'string') return;
      try { this.onPacket(JSON.parse(event.data) as Packet); }
      catch { this.status.lastError = 'Invalid Gateway packet'; this.persist(); }
    });
    ws.addEventListener('close', event => {
      if (this.socket !== ws) return;
      this.socket = null; this.clearHeartbeat();
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(event.code)) {
        this.running = false; this.write('running', false);
        this.ctx.storage.sql.exec('DELETE FROM recent');
        this.status.state = 'error'; this.status.lastError = event.code === 4014 ? 'Enable the Message Content intent in Discord' : `Discord rejected Gateway configuration (${event.code})`;
        this.background(this.ctx.storage.deleteAlarm());
      } else if (this.running) {
        if ([4007, 4009].includes(event.code)) this.resume = null;
        this.status.state = 'reconnecting'; this.status.reconnects++;
        this.background(this.ctx.storage.setAlarm(Date.now() + 10000));
      }
      this.persist();
    });
    ws.addEventListener('error', () => { if (this.socket === ws) this.background(this.reconnect()); });
    await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  private send(op: number, data: unknown) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ op, d: data })); }
  private heartbeat() {
    if (!this.running || !this.socket) return;
    if (this.awaitingAck) { this.background(this.reconnect()); return; }
    this.awaitingAck = true; this.send(1, this.resume?.seq ?? null);
    this.heartbeatTimer = setTimeout(() => this.heartbeat(), this.heartbeatInterval);
  }
  private async reconnect() { this.disconnect(); this.status.reconnects++; this.persist(); await this.connectGateway(); }
  private onPacket(packet: Packet) {
    if (packet.s !== null && packet.s !== undefined && this.resume) this.resume.seq = packet.s;
    switch (packet.op) {
      case 10: {
        this.heartbeatInterval = Number(packet.d?.heartbeat_interval) || 41250;
        this.clearHeartbeat(); this.awaitingAck = false;
        this.heartbeatTimer = setTimeout(() => this.heartbeat(), Math.random() * this.heartbeatInterval);
        if (this.resume?.id) this.send(6, { token: this.env.DISCORD_BOT_TOKEN, session_id: this.resume.id, seq: this.resume.seq });
        else this.send(2, { token: this.env.DISCORD_BOT_TOKEN, intents: 1 | 512 | 32768, properties: { os: 'linux', browser: 'jevbot', device: 'jevbot' } });
        break;
      }
      case 11: this.awaitingAck = false; this.status.lastAckAt = Date.now(); this.persist(); break;
      case 1: this.send(1, this.resume?.seq ?? null); break;
      case 7: this.background(this.reconnect()); break;
      case 9: {
        if (!packet.d) this.resume = null;
        this.disconnect(); this.status.state = 'reconnecting'; this.persist();
        this.background(this.ctx.storage.setAlarm(Date.now() + 5000)); break;
      }
      case 0: {
        this.status.lastEventAt = Date.now(); this.status.events++;
        if (packet.t === 'READY') {
          const d = packet.d as { session_id: string; resume_gateway_url: string; user?: { username: string } };
          this.resume = { id: d.session_id, url: d.resume_gateway_url, seq: packet.s ?? null };
          this.status.state = 'connected'; this.status.connectedAt = Date.now(); this.status.botName = d.user?.username ?? 'JevBot'; this.status.lastError = null;
        } else if (packet.t === 'RESUMED') { this.status.state = 'connected'; this.status.connectedAt = Date.now(); this.status.lastError = null; }
        else if (packet.t === 'GUILD_CREATE') this.enqueue(() => this.registerGuild(packet.d!));
        else if (packet.t === 'GUILD_DELETE' && !packet.d?.unavailable) this.enqueue(async () => { await this.env.DB.prepare('UPDATE guilds SET active = 0 WHERE id = ?').bind(packet.d!.id).run(); });
        else if (packet.t === 'MESSAGE_CREATE' || packet.t === 'MESSAGE_UPDATE') this.enqueue(() => this.moderate(packet.d!, packet.t === 'MESSAGE_UPDATE'));
        this.persist(); break;
      }
    }
  }
  private enqueue(job: () => Promise<void>) {
    if (this.pending >= 50) { this.status.dropped++; this.status.lastError = 'Moderation backlog full; some messages were skipped'; this.persist(); return; }
    this.pending++;
    this.queue = this.queue.then(job).catch(() => { this.status.lastError = 'A moderation operation failed'; this.persist(); }).finally(() => { this.pending--; });
    this.ctx.waitUntil(this.queue);
  }
  private async registerGuild(d: Record<string, unknown>) {
    if (d.unavailable || typeof d.id !== 'string' || typeof d.name !== 'string') return;
    await this.env.DB.batch([
      this.env.DB.prepare('INSERT INTO guilds (id, name, icon, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, active = 1').bind(d.id, d.name, typeof d.icon === 'string' ? d.icon : null, Date.now()),
      this.env.DB.prepare('INSERT OR IGNORE INTO settings (guild_id, config, updated_at, updated_by) VALUES (?, ?, ?, ?)').bind(d.id, JSON.stringify(presetSettings('observe')), Date.now(), 'system'),
    ]);
  }
  private async settings(guildId: string) {
    const cached = this.config.get(guildId);
    if (cached && cached.until > Date.now()) return cached.value;
    const value = await getSettings(this.env.DB, guildId);
    if (this.config.size > 100) this.config.clear();
    this.config.set(guildId, { value, until: Date.now() + 30000 }); return value;
  }
  private async moderate(raw: Record<string, unknown>, edited: boolean) {
    // Partial edits without content, author, or member data cannot be safely attributed.
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return;
    const d = parsed.data;
    if (d.author.bot || d.webhook_id || !d.member) return;
    const guild = await this.env.DB.prepare('SELECT id FROM guilds WHERE id = ? AND active = 1').bind(d.guild_id).first();
    if (!guild) return;
    const config = forChannel(await this.settings(d.guild_id), d.channel_id);
    const message: Message = { id: d.id, guildId: d.guild_id, channelId: d.channel_id, authorId: d.author.id, content: d.content.slice(0, 2000), roles: d.member.roles,
      mentions: (d.mentions?.length ?? 0) + (d.mention_roles?.length ?? 0), everyone: d.mention_everyone ?? false, timestamp: Date.now(), edited };
    if (exempt(message, config)) return;
    const identity = `${d.id}:${await hash(message.content)}`;
    if (this.ctx.storage.sql.exec('SELECT key FROM processed WHERE key = ?', identity).toArray().length) return;
    this.ctx.storage.sql.exec('INSERT INTO processed (key, at) VALUES (?, ?)', identity, Date.now());
    this.ctx.storage.sql.exec('DELETE FROM processed WHERE at < ?', Date.now() - 86400000);
    this.ctx.storage.sql.exec('DELETE FROM recent WHERE at < ?', Date.now() - 120000);
    const rows = this.ctx.storage.sql.exec<{ id: string; guild_id: string; author_id: string; channel_id: string; content: string; at: number }>('SELECT * FROM recent WHERE guild_id = ? AND author_id = ? ORDER BY at DESC LIMIT 50', d.guild_id, d.author.id).toArray();
    const recent: Message[] = rows.map(row => ({ id: row.id, guildId: row.guild_id, channelId: row.channel_id, authorId: row.author_id, content: row.content, timestamp: row.at, roles: [], mentions: 0, everyone: false }));
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO recent VALUES (?, ?, ?, ?, ?, ?)', message.id, message.guildId, message.authorId, message.channelId, message.content, message.timestamp);
    const signals = detectRules(message, recent, config);
    let evaluation: Evaluation = { signals, probability: signals.length ? 1 : 0, confidence: 1, source: 'rules', aiStatus: 'not_needed' };
    if (shouldUseAI(message, config, signals)) {
      const row = await this.env.DB.prepare('SELECT encrypted_key FROM secrets WHERE guild_id = ?').bind(d.guild_id).first<{ encrypted_key: string }>();
      if (!row || !this.env.ENCRYPTION_KEY) evaluation.aiStatus = 'key_missing';
      else {
        const reservation = await reserveAI(this.env.DB, d.guild_id, config);
        if (!reservation) evaluation.aiStatus = 'budget_reached';
        else {
        try {
          const result = await evaluateJev(await decrypt(row.encrypted_key, this.env.ENCRYPTION_KEY, d.guild_id), this.env.JEV_MODEL, message, recent.map(m => m.content).reverse());
          evaluation = result.evaluation; await recordAI(this.env.DB, d.guild_id, reservation, result.usage);
        } catch { evaluation.aiStatus = 'unavailable'; await recordAI(this.env.DB, d.guild_id, reservation); }
        }
      }
    }
    const strike = await this.env.DB.prepare('SELECT count FROM strikes WHERE guild_id = ? AND user_id = ? AND expires_at > ?').bind(d.guild_id, d.author.id, Date.now()).first<{ count: number }>();
    const decision = decide(evaluation, config, strike?.count ?? 0);
    if (decision.action === 'allow' && !['unavailable', 'budget_reached'].includes(evaluation.aiStatus)) return;
    let status = decision.action === 'review' ? 'pending' : 'logged';
    const incidentId = crypto.randomUUID();
    // Persist the intent first. A crash leaves an explicit pending outcome rather than an invisible action.
    await this.env.DB.prepare(`INSERT INTO incidents (id, guild_id, message_id, channel_id, author_id, excerpt, action, reason, probability, confidence, source, ai_status, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(incidentId, d.guild_id, d.id, d.channel_id, d.author.id, message.content.slice(0, 500), decision.action,
        decision.action === 'allow' ? `AI check skipped: ${evaluation.aiStatus}` : decision.reason, evaluation.probability, evaluation.confidence, evaluation.source, evaluation.aiStatus,
        ['warn', 'delete', 'timeout'].includes(decision.action) ? 'action_pending' : status, Date.now(), Date.now() + config.retentionDays * 86400000).run();
    if (['warn', 'delete', 'timeout'].includes(decision.action)) {
      // Re-read immediately before enforcement so an admin pause takes effect during an AI call.
      const current = forChannel(await getSettings(this.env.DB, d.guild_id), d.channel_id);
      if (JSON.stringify(current) !== JSON.stringify(config)) status = 'cancelled_settings_changed';
      else {
        try {
          if (decision.action === 'warn') await discordRequest(this.env.DISCORD_BOT_TOKEN!, `/channels/${d.channel_id}/messages`, { method: 'POST', body: { content: `<@${d.author.id}> Please avoid spam. A moderator can review this detection.`, allowed_mentions: { parse: [] } } });
          if (decision.action === 'delete' || decision.action === 'timeout') {
            try { await discordRequest(this.env.DISCORD_BOT_TOKEN!, `/channels/${d.channel_id}/messages/${d.id}`, { method: 'DELETE', reason: `JevBot: ${decision.reason}` }); }
            catch (error) { if (!(error instanceof DiscordError && error.status === 404)) throw error; }
          }
          if (decision.action === 'timeout') await discordRequest(this.env.DISCORD_BOT_TOKEN!, `/guilds/${d.guild_id}/members/${d.author.id}`, { method: 'PATCH', body: { communication_disabled_until: new Date(Date.now() + config.timeoutMinutes * 60000).toISOString() }, reason: `JevBot: ${decision.reason}` });
          await this.env.DB.prepare('INSERT INTO strikes VALUES (?, ?, 1, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET count = CASE WHEN expires_at > ? THEN count + 1 ELSE 1 END, expires_at = excluded.expires_at').bind(d.guild_id, d.author.id, Date.now() + config.strikeDecayHours * 3600000, Date.now()).run();
          status = 'applied';
        } catch { status = 'action_failed'; }
      }
      await this.env.DB.prepare('UPDATE incidents SET status = ? WHERE id = ?').bind(status, incidentId).run();
    }
    if (config.logChannelId) {
      try { await discordRequest(this.env.DISCORD_BOT_TOKEN!, `/channels/${config.logChannelId}/messages`, { method: 'POST', body: { content: `JevBot · ${decision.action} · ${status}\nUser ID: ${d.author.id}\n${decision.reason}\nReview in ${this.env.APP_ORIGIN}/admin`, allowed_mentions: { parse: [] } } }); }
      catch { this.status.lastError = 'Could not send to the configured moderation log channel'; this.persist(); }
    }
  }
}
