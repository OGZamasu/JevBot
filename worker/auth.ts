import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env';
import { equal, hash, randomToken } from './crypto';
import { audit } from './db';

export type Session = {
  user_id: string;
  username: string;
  avatar: string | null;
  csrf: string;
  expires_at: number;
};
export type App = { Bindings: AppEnv; Variables: { session: Session } };
const sessionCookie = 'jevbot_session';
const stateCookie = 'jevbot_oauth';

function cookieOptions(c: Context<App>, maxAge: number) {
  return {
    httpOnly: true,
    secure: c.env.APP_ORIGIN.startsWith('https:'),
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}
export function owner(env: AppEnv, userId: string): boolean {
  return !!env.OWNER_DISCORD_ID && userId === env.OWNER_DISCORD_ID;
}
export async function sessionFor(c: Context<App>): Promise<Session | null> {
  const token = getCookie(c, sessionCookie);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await c.env.DB.prepare(
    'SELECT user_id, username, avatar, csrf, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?',
  )
    .bind(await hash(token), Date.now())
    .first<Session>();
  if (!session) return null;
  if (!owner(c.env, session.user_id)) {
    const access = await c.env.DB.prepare('SELECT 1 FROM access_grants WHERE user_id = ? LIMIT 1')
      .bind(session.user_id)
      .first();
    if (!access) return null;
  }
  return session;
}
export async function requireSession(c: Context<App>, next: () => Promise<void>): Promise<void> {
  const session = await sessionFor(c);
  if (!session)
    throw new HTTPException(401, { message: 'Sign in with an approved Discord account' });
  c.set('session', session);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (
      c.req.header('Origin') !== c.env.APP_ORIGIN ||
      !(await equal(c.req.header('X-CSRF-Token') ?? '', session.csrf))
    ) {
      throw new HTTPException(403, { message: 'Invalid request origin or security token' });
    }
  }
  await next();
}
export async function guildAccess(
  c: Context<App>,
  guildId: string,
  write = false,
): Promise<'owner' | 'admin' | 'reviewer'> {
  const guild = await c.env.DB.prepare('SELECT id FROM guilds WHERE id = ? AND active = 1')
    .bind(guildId)
    .first();
  if (!guild) throw new HTTPException(404, { message: 'Server not found' });
  const userId = c.get('session').user_id;
  if (owner(c.env, userId)) return 'owner';
  const grant = await c.env.DB.prepare(
    'SELECT role FROM access_grants WHERE user_id = ? AND guild_id = ?',
  )
    .bind(userId, guildId)
    .first<{ role: 'admin' | 'reviewer' }>();
  if (!grant || (write && grant.role !== 'admin'))
    throw new HTTPException(403, { message: 'You do not have access to this server setting' });
  return grant.role;
}
export function requireOwner(c: Context<App>): void {
  if (!owner(c.env, c.get('session').user_id))
    throw new HTTPException(403, { message: 'Only the instance owner can manage access' });
}

export const auth = new Hono<App>();
auth.get('/login', async (c) => {
  if (!c.env.DISCORD_CLIENT_ID || !c.env.DISCORD_CLIENT_SECRET || !c.env.OWNER_DISCORD_ID)
    return c.redirect('/admin?error=setup');
  const bucket = await hash(
    `${c.env.ENCRYPTION_KEY ?? c.env.DISCORD_CLIENT_SECRET}:${c.req.header('CF-Connecting-IP') ?? 'local'}`,
  );
  const slot = await c.env.DB.prepare(
    `INSERT INTO login_limits VALUES (?, ?, 1) ON CONFLICT(bucket, window)
    DO UPDATE SET requests = requests + 1 WHERE requests < 12 RETURNING requests`,
  )
    .bind(bucket, Math.floor(Date.now() / 600000))
    .first();
  if (!slot)
    throw new HTTPException(429, {
      message: 'Too many sign-in attempts. Try again in a few minutes.',
    });
  const previous = getCookie(c, stateCookie);
  if (previous)
    await c.env.DB.prepare('DELETE FROM oauth_states WHERE token_hash = ?')
      .bind(await hash(previous))
      .run();
  const state = randomToken();
  await c.env.DB.prepare('INSERT INTO oauth_states (token_hash, expires_at) VALUES (?, ?)')
    .bind(await hash(state), Date.now() + 600000)
    .run();
  setCookie(c, stateCookie, state, cookieOptions(c, 600));
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    response_type: 'code',
    scope: 'identify',
    state,
    redirect_uri: `${c.env.APP_ORIGIN}/auth/callback`,
    prompt: 'consent',
  }).toString();
  return c.redirect(url.toString());
});
auth.get('/callback', async (c) => {
  const provided = c.req.query('state') ?? '';
  const cookie = getCookie(c, stateCookie) ?? '';
  deleteCookie(c, stateCookie, cookieOptions(c, 0));
  if (!provided || !cookie || !(await equal(provided, cookie)))
    return c.redirect('/admin?error=oauth');
  const valid = await c.env.DB.prepare(
    'DELETE FROM oauth_states WHERE token_hash = ? AND expires_at > ? RETURNING token_hash',
  )
    .bind(await hash(provided), Date.now())
    .first();
  const code = c.req.query('code');
  if (!valid || !code || !c.env.DISCORD_CLIENT_SECRET) return c.redirect('/admin?error=oauth');
  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${c.env.APP_ORIGIN}/auth/callback`,
    }),
  });
  if (!tokenResponse.ok) {
    await tokenResponse.body?.cancel();
    return c.redirect('/admin?error=oauth');
  }
  const tokens = await tokenResponse.json<{ access_token: string }>();
  const profileResponse = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!profileResponse.ok) {
    await profileResponse.body?.cancel();
    return c.redirect('/admin?error=oauth');
  }
  const profile = await profileResponse.json<{
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  }>();
  const isOwner = owner(c.env, profile.id);
  const grant =
    isOwner ||
    (await c.env.DB.prepare('SELECT 1 FROM access_grants WHERE user_id = ? LIMIT 1')
      .bind(profile.id)
      .first());
  if (!grant) return c.redirect('/admin?error=access');
  const session = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(profile.id),
    c.env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, username, avatar, csrf, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      await hash(session),
      profile.id,
      profile.global_name ?? profile.username,
      profile.avatar,
      randomToken(),
      Date.now() + 86400000,
    ),
  ]);
  await audit(c.env.DB, profile.id, null, 'login');
  setCookie(c, sessionCookie, session, cookieOptions(c, 86400));
  return c.redirect('/admin');
});
auth.post('/logout', requireSession, async (c) => {
  const token = getCookie(c, sessionCookie)!;
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await hash(token))
    .run();
  deleteCookie(c, sessionCookie, cookieOptions(c, 0));
  return c.json({ ok: true });
});
