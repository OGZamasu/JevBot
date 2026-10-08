import { env as rawEnv, exports } from 'cloudflare:workers';
import { applyD1Migrations, reset, runInDurableObject, evictDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { AppEnv } from '../worker/env';
import { randomToken, hash, encrypt, decrypt, equal } from '../worker/crypto';
import { reserveAI, recordAI } from '../worker/usage';
import { presetSettings } from '../shared/settings';
import { detectRules, decide, exempt, shouldUseAI, type Message, type Evaluation } from '../shared/moderation';
import { evaluateJev } from '../worker/jev';

const env = rawEnv as AppEnv & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
const owner = '111111111111111111', admin = '222222222222222222', reviewer = '333333333333333333';
const guild = '444444444444444444', otherGuild = '555555555555555555';
const tokens = new Map<string, { token: string; csrf: string }>();
beforeEach(async () => {
  await reset(); tokens.clear();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  for (const id of [guild, otherGuild]) await env.DB.prepare('INSERT INTO guilds VALUES (?, ?, NULL, 1, ?)').bind(id, 'Test community', Date.now()).run();
  for (const [user, role] of [[admin, 'admin'], [reviewer, 'reviewer']]) {
    await env.DB.prepare('INSERT INTO access_grants VALUES (?, ?, ?, ?, ?)').bind(user, guild, role, owner, Date.now()).run();
  }
  for (const user of [owner, admin, reviewer]) {
    const token = randomToken(), csrf = randomToken(); tokens.set(user, { token, csrf });
    await env.DB.prepare('INSERT INTO sessions VALUES (?, ?, ?, NULL, ?, ?)').bind(await hash(token), user, 'Tester', csrf, Date.now() + 60000).run();
  }
});
afterEach(() => vi.restoreAllMocks());
function request(path: string, user?: string, method = 'GET', body?: unknown, overrides: Record<string, string> = {}) {
  const session = user ? tokens.get(user) : undefined;
  return exports.default.fetch(new Request(`${env.APP_ORIGIN}${path}`, {
    method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: `jevbot_session=${session.token}`, Origin: env.APP_ORIGIN, 'X-CSRF-Token': session.csrf } : {}), ...overrides },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}
describe('dashboard authorization', () => {
  it('denies anonymous access and isolates grants by server', async () => {
    expect((await request('/api/guilds')).status).toBe(401);
    expect((await request(`/api/guilds/${otherGuild}/settings`, admin)).status).toBe(403);
    const response = await request('/api/guilds', admin);
    expect(await response.json()).toMatchObject({ guilds: [{ id: guild, role: 'admin' }] });
  });
  it('rejects forged origin, missing CSRF, and reviewer writes', async () => {
    const path = `/api/guilds/${guild}/settings`, settings = presetSettings('balanced');
    expect((await request(path, admin, 'PUT', settings, { Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await request(path, admin, 'PUT', settings, { 'X-CSRF-Token': '' })).status).toBe(403);
    expect((await request(path, reviewer, 'PUT', settings)).status).toBe(403);
    expect((await request(path, admin, 'PUT', settings)).status).toBe(200);
  });
  it('restricts access grants to the owner and invalidates revoked sessions', async () => {
    expect((await request(`/api/guilds/${guild}/access`, admin, 'PUT', { userId: reviewer, role: 'admin' })).status).toBe(403);
    expect((await request(`/api/guilds/${guild}/access/${reviewer}`, owner, 'DELETE')).status).toBe(200);
    expect((await request('/api/me', reviewer)).status).toBe(401);
  });
  it('encrypts server keys without echoing plaintext or leaking through audit', async () => {
    const key = 'test-only-private-provider-key';
    const saved = await request(`/api/guilds/${guild}/key`, admin, 'PUT', { key });
    expect(saved.status).toBe(200); expect(await saved.text()).not.toContain(key);
    const row = await env.DB.prepare('SELECT encrypted_key FROM secrets WHERE guild_id = ?').bind(guild).first<{ encrypted_key: string }>();
    expect(row!.encrypted_key).not.toContain(key);
    expect(await decrypt(row!.encrypted_key, env.ENCRYPTION_KEY!, guild)).toBe(key);
    await expect(decrypt(row!.encrypted_key, env.ENCRYPTION_KEY!, otherGuild)).rejects.toThrow();
    expect(await (await request(`/api/guilds/${guild}/settings`, reviewer)).text()).not.toContain(key);
    expect(await (await request(`/api/guilds/${guild}/audit`, reviewer)).text()).not.toContain(key);
  });
  it('keeps preview decisions away from Discord', async () => {
    const transport = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external call'));
    const response = await request(`/api/guilds/${guild}/test`, admin, 'POST', { content: 'Repeated promotion', repetitions: 3, ai: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preview: true, decision: { action: 'observe' } });
    expect(transport).not.toHaveBeenCalled();
  });
  it('consumes OAuth state once and rejects mismatched state before contacting Discord', async () => {
    const login = await request('/auth/login'); expect(login.status).toBe(302);
    const state = new URL(login.headers.get('Location')!).searchParams.get('state')!;
    expect(login.headers.get('Set-Cookie')).toContain('HttpOnly');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const mismatch = await request(`/auth/callback?state=${state}&code=test`, undefined, 'GET', undefined, { Cookie: 'jevbot_oauth=wrong' });
    expect(mismatch.headers.get('Location')).toContain('error=oauth'); expect(fetch).not.toHaveBeenCalled();
    const headers = { Cookie: `jevbot_oauth=${state}` };
    await request(`/auth/callback?state=${state}&code=test`, undefined, 'GET', undefined, headers);
    await request(`/auth/callback?state=${state}&code=test`, undefined, 'GET', undefined, headers);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe('limits and moderation policy', () => {
  const message: Message = { id: '3', authorId: admin, guildId: guild, channelId: otherGuild, content: 'Hello community', timestamp: Date.now(), roles: [], mentions: 0, everyone: false };
  const evaluation: Evaluation = { probability: 1, confidence: 1, signals: [], source: 'rules', aiStatus: 'not_requested' };
  it('atomically caps simultaneous inference reservations', async () => {
    const settings = { ...presetSettings('balanced'), aiDailyLimit: 3, aiMinuteLimit: 60 };
    const attempts = await Promise.all(Array.from({ length: 10 }, () => reserveAI(env.DB, guild, settings)));
    expect(attempts.filter(Boolean)).toHaveLength(3);
    expect(await env.DB.prepare('SELECT requests FROM usage_daily WHERE guild_id = ?').bind(guild).first('requests')).toBe(3);
  });
  it('charges completion tokens to the day of the reservation across midnight', async () => {
    await env.DB.prepare('INSERT INTO usage_daily (guild_id, day, requests) VALUES (?, ?, 1)').bind(guild, '2026-10-06').run();
    await recordAI(env.DB, guild, '2026-10-06', { input_tokens: 20, output_tokens: 5 });
    expect(await env.DB.prepare('SELECT input_tokens FROM usage_daily WHERE guild_id = ? AND day = ?').bind(guild, '2026-10-06').first('input_tokens')).toBe(20);
  });
  it('observes by default, reviews low confidence, and escalates only after strikes', () => {
    expect(decide(evaluation, presetSettings('observe'), 99).action).toBe('observe');
    expect(decide({ ...evaluation, confidence: .4 }, presetSettings('strict'), 99).action).toBe('review');
    expect(decide(evaluation, presetSettings('strict'), 0).action).toBe('delete');
    expect(decide(evaluation, presetSettings('strict'), 2).action).toBe('timeout');
    expect(exempt(message, { ...presetSettings('strict'), exemptUsers: [admin] })).toBe(true);
  });
  it('counts normalized duplicates only within the same user, server, and window', () => {
    const recent = [{ ...message, id: '1', content: 'HELLO  community', timestamp: message.timestamp - 100 }, { ...message, id: '2', content: 'Hello\u200b community', timestamp: message.timestamp - 200 }];
    expect(detectRules(message, recent, presetSettings('balanced')).map(s => s.rule)).toContain('repeated_message');
    expect(detectRules(message, recent.map(m => ({ ...m, guildId: otherGuild })), presetSettings('balanced'))).toEqual([]);
    expect(detectRules(message, recent.map(m => ({ ...m, timestamp: message.timestamp - 120000 })), presetSettings('balanced'))).toEqual([]);
    expect(shouldUseAI({ ...message, content: 'https://good.example.evil.example' }, { ...presetSettings('balanced'), allowedDomains: ['good.example'] }, [])).toBe(true);
  });
  it('never enforces an uncertain model response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ model: 'jev-latest', answers: { spam: { type: 'choice', choice: 'uncertain', confidence: .99, probabilities: { spam: .95, legitimate: .02, uncertain: .03 } } }, usage: { input_tokens: 12, output_tokens: 3 } }));
    const result = await evaluateJev('fake-key', 'jev-latest', message);
    expect(decide(result.evaluation, presetSettings('strict'), 99).action).toBe('review');
  });
  it('preserves actual probabilities when the model requests review', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ model: 'jev-latest', answers: { spam: { type: 'choice', choice: 'uncertain', confidence: .6, probabilities: { spam: .1, legitimate: .3, uncertain: .6 } } }, usage: { input_tokens: 12, output_tokens: 3 } }));
    const result = await evaluateJev('fake-key', 'jev-latest', message);
    expect(result.evaluation.probability).toBe(.1);
    expect(decide(result.evaluation, presetSettings('strict'), 99).action).toBe('review');
  });
  it('reports malformed provider responses as provider failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'Malformed provider payload' }));
    await expect(evaluateJev('fake-key', 'jev-latest', message)).rejects.toThrow('Jev is unavailable');
  });
  it('uses fresh nonces and a constant-time comparison in the Workers runtime', async () => {
    expect(await equal('same', 'same')).toBe(true); expect(await equal('same', 'other')).toBe(false);
    expect(await encrypt('key', env.ENCRYPTION_KEY!, guild)).not.toBe(await encrypt('key', env.ENCRYPTION_KEY!, guild));
  });
});
describe('Durable Object persistence', () => {
  const payload = (id: string) => ({ id, guild_id: guild, channel_id: otherGuild, content: 'Get this repetitive promotion', author: { id: admin }, member: { roles: [] } });
  it('deduplicates replayed messages and records Observe detections without calling Discord', async () => {
    const transport = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external call'));
    const stub = env.GATEWAY.getByName('moderation-test');
    await runInDurableObject(stub, async instance => {
      for (const id of ['1', '2', '3', '3']) await instance['moderate'](payload(id), false);
    });
    const incidents = (await env.DB.prepare('SELECT action, status FROM incidents').all()).results;
    expect(incidents).toEqual([{ action: 'observe', status: 'logged' }]);
    expect(transport).not.toHaveBeenCalled();
  });
  it('cancels enforcement when an admin pauses moderation during inference', async () => {
    const settings = presetSettings('balanced');
    await env.DB.prepare('INSERT INTO settings VALUES (?, ?, ?, ?)').bind(guild, JSON.stringify(settings), Date.now(), owner).run();
    await env.DB.prepare('INSERT INTO secrets VALUES (?, ?, ?)').bind(guild, await encrypt('test-only-key', env.ENCRYPTION_KEY!, guild), Date.now()).run();
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await env.DB.prepare('UPDATE settings SET config = ? WHERE guild_id = ?').bind(JSON.stringify({ ...settings, enabled: false }), guild).run();
      return Response.json({ model: 'jev-latest', answers: { spam: { type: 'choice', choice: 'spam', confidence: .99, probabilities: { spam: .99, legitimate: .005, uncertain: .005 } } }, usage: { input_tokens: 20, output_tokens: 2 } });
    });
    await runInDurableObject(env.GATEWAY.getByName('pause-test'), instance => instance['moderate'](payload('pause'), false));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT status FROM incidents').first('status')).toBe('cancelled_settings_changed');
    expect(await env.DB.prepare('SELECT count(*) AS total FROM strikes').first('total')).toBe(0);
  });
  it('allows ordinary messages when Jev fails and records the failed check', async () => {
    await env.DB.prepare('INSERT INTO secrets VALUES (?, ?, ?)').bind(guild, await encrypt('test-only-key', env.ENCRYPTION_KEY!, guild), Date.now()).run();
    const transport = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Provider timeout'));
    await runInDurableObject(env.GATEWAY.getByName('failure-test'), instance => instance['moderate'](payload('failure'), false));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT action, ai_status FROM incidents').first()).toEqual({ action: 'allow', ai_status: 'unavailable' });
    expect(await env.DB.prepare('SELECT failures FROM usage_daily').first('failures')).toBe(1);
  });
  it('cancels an in-flight action when the owner stops the bot', async () => {
    await env.DB.prepare('INSERT INTO settings VALUES (?, ?, ?, ?)').bind(guild, JSON.stringify(presetSettings('balanced')), Date.now(), owner).run();
    await env.DB.prepare('INSERT INTO secrets VALUES (?, ?, ?)').bind(guild, await encrypt('test-only-key', env.ENCRYPTION_KEY!, guild), Date.now()).run();
    await runInDurableObject(env.GATEWAY.getByName('stop-test'), async instance => {
      instance['running'] = true;
      const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        await instance.stop();
        return Response.json({ model: 'jev-latest', answers: { spam: { type: 'choice', choice: 'spam', confidence: .99, probabilities: { spam: .99, legitimate: .005, uncertain: .005 } } }, usage: { input_tokens: 20, output_tokens: 2 } });
      });
      await instance['moderate'](payload('stop'), false);
      expect(transport).toHaveBeenCalledTimes(1);
    });
    expect(await env.DB.prepare('SELECT status FROM incidents').first('status')).toBe('cancelled_bot_stopped');
  });
  it('persists Gateway resume sequence and session data', async () => {
    const stub = env.GATEWAY.getByName('protocol-test');
    await runInDurableObject(stub, instance => {
      instance['onPacket']({ op: 0, s: 10, t: 'READY', d: { session_id: 'test-session', resume_gateway_url: 'wss://gateway.discord.gg', user: { username: 'JevBot' } } });
      instance['onPacket']({ op: 0, s: 11, t: 'RESUMED', d: {} });
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, (_instance, state) => {
      const resume = JSON.parse(state.storage.sql.exec<{value:string}>('SELECT value FROM state WHERE key = ?', 'resume').one().value);
      expect(resume).toEqual({ id: 'test-session', url: 'wss://gateway.discord.gg', seq: 11 });
    });
  });
  it('preserves stopped state across eviction and expires message context', async () => {
    const stub = env.GATEWAY.getByName('recovery-test');
    expect((await stub.getStatus()).state).toBe('not_configured');
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec('INSERT INTO recent VALUES (?, ?, ?, ?, ?, ?)', 'old', guild, admin, otherGuild, 'private old context', Date.now() - 130000);
      await state.storage.setAlarm(Date.now() + 60000);
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (instance, state) => {
      await instance.alarm();
      expect(state.storage.sql.exec('SELECT * FROM recent').toArray()).toEqual([]);
    });
    await stub.stop();
    await evictDurableObject(stub);
    await runInDurableObject(stub, (_instance, state) => {
      expect(state.storage.sql.exec<{value:string}>('SELECT value FROM state WHERE key = ?', 'running').one().value).toBe('false');
    });
  });
});
