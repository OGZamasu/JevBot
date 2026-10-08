import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  FileClock,
  KeyRound,
  LockKeyhole,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { api, ApiError } from './api';
import { Logo, Pill, Empty } from './ui';
import {
  presetSettings,
  presetNames,
  settingsSchema,
  type Settings,
  type Preset,
} from '../shared/settings';
import type { Evaluation, Decision } from '../shared/moderation';

type User = { id: string; username: string; avatar: string | null; csrf: string; owner: boolean };
type Guild = {
  id: string;
  name: string;
  icon: string | null;
  role: 'owner' | 'admin' | 'reviewer';
};
type Usage = { requests: number; input_tokens: number; output_tokens: number; failures: number };
type Config = {
  settings: Settings;
  keyConfigured: boolean;
  keyUpdatedAt: number | null;
  encryptionReady: boolean;
  role: Guild['role'];
  usage: Usage;
};
type Bot = {
  state: string;
  connectedAt: number | null;
  lastEventAt: number | null;
  lastAckAt: number | null;
  events: number;
  reconnects: number;
  dropped: number;
  lastError: string | null;
  botName: string | null;
};
type Incident = {
  id: string;
  author_id: string;
  channel_id: string;
  excerpt: string;
  action: string;
  reason: string;
  probability: number;
  confidence: number;
  status: string;
  source: string;
  created_at: number;
  ai_status: string;
  review_note: string | null;
};
type Tab = 'settings' | 'incidents' | 'tester' | 'key' | 'access' | 'audit' | 'bot';
const tabItems = [
  { id: 'settings', label: 'Moderation', icon: SlidersHorizontal },
  { id: 'incidents', label: 'Incidents', icon: ShieldCheck },
  { id: 'tester', label: 'Message tester', icon: Sparkles },
  { id: 'key', label: 'API key & usage', icon: KeyRound },
  { id: 'access', label: 'Admin access', icon: Users },
  { id: 'audit', label: 'Audit log', icon: FileClock },
  { id: 'bot', label: 'Bot status', icon: Activity },
] as const;
const titles: Record<Tab, [string, string]> = {
  settings: ['Moderation settings', 'Set the tone for your community.'],
  incidents: ['Incident history', 'Understand each detection and review the outcome.'],
  tester: ['Message tester', 'Preview a decision before it touches your server.'],
  key: ['API key & usage', 'Your key. Your request limits. Your control.'],
  access: ['Admin access', 'Choose exactly who can enter your dashboard.'],
  audit: ['Audit log', 'A record of the changes your team makes.'],
  bot: ['Bot status', 'Connect, pause, and inspect the Discord Gateway.'],
};
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const date = (value: number | null) => (value ? new Date(value).toLocaleString() : '—');

export function Admin() {
  const [user, setUser] = useState<User | null | undefined>();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [tab, setTab] = useState<Tab>('settings');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginReady, setLoginReady] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const guild = guilds.find((g) => g.id === guildId);
  const canWrite = !!guild && guild.role !== 'reviewer';
  useEffect(() => {
    let active = true;
    void api<{ loginReady: boolean }>('/api/public')
      .then((data) => {
        if (active) setLoginReady(data.loginReady);
      })
      .catch(() => {});
    void api<User>('/api/me')
      .then(async (me) => {
        const result = await api<{ guilds: Guild[] }>('/api/guilds');
        if (active) {
          setUser(me);
          setGuilds(result.guilds);
          setGuildId((id) => id || result.guilds[0]?.id || '');
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setUser(null);
          if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    setConfig(null);
    if (!guildId) return;
    let active = true;
    void api<Config>(`/api/guilds/${guildId}/settings`)
      .then((data) => {
        if (active) setConfig(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [guildId, refresh]);
  async function run(work: () => Promise<void>, success?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (success) setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  async function mutate<T>(path: string, method: string, body?: unknown) {
    return api<T>(path, { method, body, csrf: user?.csrf });
  }
  if (user === undefined)
    return (
      <div className="login-page">
        <Logo />
        <div className="login-card">
          <span className="spinner" />
          <p>Opening your dashboard…</p>
        </div>
      </div>
    );
  if (!user) {
    const code = new URLSearchParams(window.location.search).get('error');
    const messages: Record<string, string> = {
      setup: 'Discord login is awaiting application setup.',
      access: 'This Discord account has not been approved. Ask the instance owner for access.',
      oauth: 'Discord sign-in could not be verified. Please try again.',
    };
    return (
      <div className="login-page">
        <div className="login-top">
          <Logo />
          <a href="/">
            <ArrowLeft size={15} /> Back to website
          </a>
        </div>
        <div className="login-card">
          <span className="login-shield">
            <ShieldCheck size={34} strokeWidth={1.4} />
          </span>
          <Pill>COMMUNITY CONTROL ROOM</Pill>
          <h1>
            A calmer server
            <br />
            starts with you.
          </h1>
          <p>Sign in with an approved Discord account to manage your community’s moderation.</p>
          {(error || messages[code ?? '']) && (
            <div className="alert error" role="alert">
              {error || messages[code ?? '']}
            </div>
          )}
          {loginReady ? (
            <a className="button dark" href="/auth/login">
              Continue with Discord <ArrowUpRight size={18} />
            </a>
          ) : (
            <div className="setup-notice">
              <CircleHelp size={19} />
              <div>
                <strong>Discord setup in progress</strong>
                <p>
                  The website is ready. The instance owner still needs to configure the Discord
                  application before sign-in is available.
                </p>
                <a href="/docs">
                  Read the setup guide <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          )}
          <div className="login-foot">
            <LockKeyhole size={14} /> Signing in does not automatically grant access.
          </div>
        </div>
        <span className="login-bottom">Your rules. Your key. Your community.</span>
      </div>
    );
  }
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main">
        Skip to dashboard
      </a>
      <aside className="admin-sidebar">
        <Logo small />
        <div className="workspace-label">YOUR COMMUNITY</div>
        <label className="guild-select-label">
          Server
          <select
            aria-label="Select server"
            value={guildId}
            onChange={(e) => {
              setGuildId(e.target.value);
              setError('');
              setNotice('');
            }}
          >
            <option value="" disabled>
              {guilds.length ? 'Choose a server' : 'No connected servers'}
            </option>
            {guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Dashboard navigation">
          {tabItems
            .filter((t) => user.owner || !['access', 'bot'].includes(t.id))
            .map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? 'selected' : ''}
                aria-pressed={tab === item.id}
                onClick={() => {
                  setTab(item.id);
                  setError('');
                  setNotice('');
                }}
              >
                <item.icon size={18} />
                {item.label}
                {tab === item.id && <ChevronRight size={14} />}
              </button>
            ))}
        </nav>
        <div className="sidebar-help">
          <Eye size={21} />
          <strong>Start with Observe.</strong>
          <p>Learn what gets flagged before enabling enforcement.</p>
          <a href="/docs">
            Read the docs <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="admin-user">
          <span className="avatar lime-avatar">{user.username[0]?.toUpperCase()}</span>
          <span>
            <strong>{user.username}</strong>
            <small>{user.owner ? 'Instance owner' : (guild?.role ?? 'Approved user')}</small>
          </span>
          <button
            className="icon-button"
            aria-label="Sign out"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mutate('/auth/logout', 'POST');
                setUser(null);
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main id="admin-main" className="admin-main">
        <header className="admin-top">
          <span>
            Dashboard <ChevronRight size={13} /> {guild?.name ?? 'Your instance'}
          </span>
          <div>
            <Pill>{guild?.role === 'reviewer' ? 'REVIEW ACCESS' : 'ADMIN PANEL'}</Pill>
            <button
              className="icon-button"
              aria-label="Refresh dashboard"
              onClick={() => setRefresh((n) => n + 1)}
            >
              <RefreshCw size={16} />
            </button>
            <a href="/" aria-label="Open website">
              <ArrowUpRight size={18} />
            </a>
          </div>
        </header>
        <div className="admin-content">
          <div className="admin-page-heading">
            <div>
              <span className="eyebrow">JEVBOT / {tab.toUpperCase()}</span>
              <h1>{titles[tab][0]}</h1>
              <p>{titles[tab][1]}</p>
            </div>
            {config && (
              <Pill tone={config.settings.enabled ? 'green' : 'muted'}>
                <span className="status-dot" />
                {config.settings.enabled ? label(config.settings.preset) : 'Paused'}
              </Pill>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          {tab === 'bot' && user.owner ? (
            <BotPanel
              busy={busy}
              run={run}
              mutate={mutate}
              onRefresh={() => setRefresh((n) => n + 1)}
            />
          ) : !guild ? (
            <Empty title="Connect your first server">
              {user.owner ? (
                <>
                  Open{' '}
                  <button className="inline-button" onClick={() => setTab('bot')}>
                    Bot status
                  </button>{' '}
                  to invite JevBot and start its connection. New servers appear here in Observe
                  mode.
                </>
              ) : (
                'The bot needs to be connected to a server you are approved to review.'
              )}
            </Empty>
          ) : !config ? (
            <div className="loading-state">
              <span className="spinner" /> Loading server settings…
            </div>
          ) : (
            <>
              {tab === 'settings' && (
                <SettingsPanel
                  key={`${guildId}-${refresh}`}
                  settings={config.settings}
                  canWrite={canWrite}
                  busy={busy}
                  save={(value) =>
                    void run(async () => {
                      await mutate(`/api/guilds/${guildId}/settings`, 'PUT', value);
                      setConfig({ ...config, settings: value });
                    }, 'Moderation settings saved.')
                  }
                />
              )}
              {tab === 'key' && (
                <KeyPanel
                  key={guildId}
                  config={config}
                  canWrite={canWrite}
                  busy={busy}
                  run={run}
                  mutate={mutate}
                  guildId={guildId}
                  refresh={() => setRefresh((n) => n + 1)}
                />
              )}
              {tab === 'tester' && (
                <Tester
                  key={guildId}
                  config={config}
                  canWrite={canWrite}
                  busy={busy}
                  run={run}
                  mutate={mutate}
                  guildId={guildId}
                />
              )}
              {tab === 'incidents' && (
                <Incidents key={guildId} guildId={guildId} run={run} mutate={mutate} busy={busy} />
              )}
              {tab === 'access' && user.owner && (
                <Access key={guildId} guildId={guildId} run={run} mutate={mutate} busy={busy} />
              )}
              {tab === 'audit' && <Audit key={`${guildId}-${refresh}`} guildId={guildId} />}
            </>
          )}
        </div>
        <div className="admin-bottom">
          JevBot v0.1.0 <span>Open-source moderation, configured by you.</span>
        </div>
      </main>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {aside}
      </div>
      <div className="panel-content">{children}</div>
    </section>
  );
}
function SettingsPanel({
  settings,
  canWrite,
  busy,
  save,
}: {
  settings: Settings;
  canWrite: boolean;
  busy: boolean;
  save: (s: Settings) => void;
}) {
  const [value, setValue] = useState(settings);
  const [validation, setValidation] = useState('');
  function update<K extends keyof Settings>(key: K, next: Settings[K]) {
    setValue((prev) => ({
      ...prev,
      [key]: next,
      ...([
        'enabled',
        'exemptUsers',
        'exemptRoles',
        'exemptChannels',
        'allowedDomains',
        'blockedDomains',
        'logChannelId',
        'channelOverrides',
        'aiEnabled',
        'aiDailyLimit',
        'aiMinuteLimit',
        'retentionDays',
      ].includes(key)
        ? {}
        : { preset: 'custom' as const }),
    }));
  }
  function preset(p: Preset) {
    const s = presetSettings(p);
    setValue((prev) => ({
      ...prev,
      preset: p,
      action: s.action,
      spamThreshold: s.spamThreshold,
      confidenceThreshold: s.confidenceThreshold,
      maxMessages: s.maxMessages,
      windowSeconds: s.windowSeconds,
      duplicateLimit: s.duplicateLimit,
      mentionLimit: s.mentionLimit,
      timeoutMinutes: s.timeoutMinutes,
      strikeLimit: s.strikeLimit,
    }));
  }
  const numeric = (
    key: keyof Settings,
    title: string,
    min: number,
    max: number,
    step = 1,
    hint = '',
  ) => (
    <label>
      {title}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value[key] as number}
        onChange={(e) => update(key, Number(e.target.value) as never)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    setValidation('');
    const parsed = settingsSchema.safeParse(value);
    if (!parsed.success)
      setValidation(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    else save(parsed.data);
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!canWrite || busy} className="settings-fieldset">
        <Panel
          title="Protection level"
          description="Choose a starting point. Adjusting detection values switches to Custom."
          aside={
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(e) => update('enabled', e.target.checked)}
              />
              <span>{value.enabled ? 'Enabled' : 'Paused'}</span>
            </label>
          }
        >
          <div className="preset-grid">
            {presetNames.map((p, i) => (
              <button
                className={`preset-card ${value.preset === p ? 'active' : ''}`}
                type="button"
                key={p}
                onClick={() => preset(p)}
                aria-pressed={value.preset === p}
              >
                <span>{p === 'observe' ? <Eye size={20} /> : <SlidersHorizontal size={20} />}</span>
                <strong>{label(p)}</strong>
                <small>
                  {
                    [
                      'Record only',
                      'Warn clearly',
                      'Remove & escalate',
                      'Stronger thresholds',
                      'Your exact rules',
                    ][i]
                  }
                </small>
              </button>
            ))}
          </div>
          {value.preset === 'observe' && (
            <div className="hint">
              <Eye size={16} /> Observe records detections without enforcement.
            </div>
          )}
        </Panel>
        <Panel
          title="Detection & actions"
          description="Jev scores must pass both thresholds before enforcement. Deterministic rules do not depend on AI."
        >
          <div className="form-grid">
            {numeric('spamThreshold', 'Spam probability threshold', 0.5, 1, 0.01)}
            {numeric('confidenceThreshold', 'Minimum Jev confidence', 0.5, 1, 0.01)}
            {numeric('maxMessages', 'Messages before flood detection', 3, 50)}
            {numeric('windowSeconds', 'Detection window (seconds)', 3, 120)}
            {numeric('duplicateLimit', 'Matching messages before detection', 2, 20)}
            {numeric('mentionLimit', 'Mentions before detection', 2, 50)}
            <label>
              Initial action
              <select
                value={value.action}
                onChange={(e) => update('action', e.target.value as Settings['action'])}
              >
                <option value="observe">Observe</option>
                <option value="warn">Warn</option>
                <option value="delete">Delete, then timeout repeat offenders</option>
                <option value="timeout">Delete, then timeout at strike limit</option>
              </select>
            </label>
            {numeric('strikeLimit', 'Strikes before timeout', 2, 20)}
            {numeric('timeoutMinutes', 'Timeout duration (minutes)', 1, 1440)}
            {numeric('strikeDecayHours', 'Strike decay (hours)', 1, 168)}
          </div>
        </Panel>
        <Panel
          title="AI checks & retention"
          description="Limit provider calls and how long incident evidence stays in the dashboard."
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.aiEnabled}
              onChange={(e) => update('aiEnabled', e.target.checked)}
            />{' '}
            Enable contextual Jev checks
          </label>
          <div className="form-grid">
            {numeric(
              'aiDailyLimit',
              'Maximum AI requests per day',
              0,
              10000,
              1,
              '0 stops AI calls. Uses UTC calendar days.',
            )}
            {numeric('aiMinuteLimit', 'Maximum AI requests per minute', 1, 60)}
            {numeric('retentionDays', 'Incident retention (days)', 1, 30)}
          </div>
        </Panel>
        <Panel
          title="Exemptions & links"
          description="Enter Discord IDs or domains separated by commas. Exempt users, roles, and channels skip moderation."
        >
          <div className="form-grid">
            {(
              [
                'exemptUsers',
                'exemptRoles',
                'exemptChannels',
                'allowedDomains',
                'blockedDomains',
              ] as const
            ).map((key) => (
              <label key={key}>
                {
                  {
                    exemptUsers: 'Exempt user IDs',
                    exemptRoles: 'Exempt role IDs',
                    exemptChannels: 'Exempt channel IDs',
                    allowedDomains: 'Allowed domains',
                    blockedDomains: 'Blocked domains',
                  }[key]
                }
                <ListInput value={value[key]} onChange={(items) => update(key, items)} />
              </label>
            ))}
            <label>
              Moderation log channel ID
              <input
                value={value.logChannelId}
                placeholder="Optional Discord channel ID"
                onChange={(e) => update('logChannelId', e.target.value.trim())}
              />
              <small>Use a text channel in this server.</small>
            </label>
          </div>
        </Panel>
        <Panel
          title="Channel presets"
          description="Override detection thresholds and actions for selected channels."
        >
          <div className="override-list">
            {value.channelOverrides.map((item, i) => (
              <div className="override-row" key={i}>
                <label>
                  Channel ID
                  <input
                    value={item.channelId}
                    onChange={(e) =>
                      update(
                        'channelOverrides',
                        value.channelOverrides.map((v, n) =>
                          n === i ? { ...v, channelId: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Preset
                  <select
                    value={item.preset}
                    onChange={(e) =>
                      update(
                        'channelOverrides',
                        value.channelOverrides.map((v, n) =>
                          n === i ? { ...v, preset: e.target.value as typeof item.preset } : v,
                        ),
                      )
                    }
                  >
                    {presetNames
                      .filter((p) => p !== 'custom')
                      .map((p) => (
                        <option value={p} key={p}>
                          {label(p)}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove channel override ${i + 1}`}
                  onClick={() =>
                    update(
                      'channelOverrides',
                      value.channelOverrides.filter((_, n) => n !== i),
                    )
                  }
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button outline compact"
            onClick={() =>
              update('channelOverrides', [
                ...value.channelOverrides,
                { channelId: '', preset: 'observe' },
              ])
            }
          >
            <Plus size={16} /> Add channel override
          </button>
        </Panel>
      </fieldset>
      {validation && (
        <div className="alert error" role="alert">
          {validation}
        </div>
      )}
      <div className="save-bar">
        <span>
          {canWrite
            ? 'Changes apply after saving.'
            : 'You have review access. Settings are read-only.'}
        </span>
        {canWrite && (
          <button disabled={busy} className="button dark" type="submit">
            <Save size={16} />
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </div>
    </form>
  );
}
function ListInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <textarea
      rows={2}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(/[,\n]/)
            .map((v) => v.trim())
            .filter(Boolean),
        );
      }}
      placeholder="Separate entries with commas"
    />
  );
}

type ActionProps = {
  busy: boolean;
  run: (work: () => Promise<void>, success?: string) => Promise<void>;
  mutate: <T>(path: string, method: string, body?: unknown) => Promise<T>;
};
function KeyPanel({
  config,
  canWrite,
  busy,
  run,
  mutate,
  guildId,
  refresh,
}: ActionProps & { config: Config; canWrite: boolean; guildId: string; refresh: () => void }) {
  const [key, setKey] = useState('');
  const [remove, setRemove] = useState(false);
  return (
    <>
      <div className="metric-grid">
        <div>
          <span>Requests today</span>
          <strong>
            {config.usage.requests}
            <small> / {config.settings.aiDailyLimit}</small>
          </strong>
        </div>
        <div>
          <span>Input tokens</span>
          <strong>{config.usage.input_tokens.toLocaleString()}</strong>
        </div>
        <div>
          <span>Output tokens</span>
          <strong>{config.usage.output_tokens.toLocaleString()}</strong>
        </div>
        <div>
          <span>Failed requests</span>
          <strong>{config.usage.failures}</strong>
        </div>
      </div>
      <Panel
        title="Jev API key"
        description="Stored encrypted for this server. The saved key is never returned to your browser."
        aside={
          <Pill tone={config.keyConfigured ? 'green' : ''}>
            {config.keyConfigured ? 'KEY SAVED' : 'NO KEY'}
          </Pill>
        }
      >
        <p className="body-muted">
          Get your key from the{' '}
          <a href="https://console.typesafe.ai/" target="_blank" rel="noreferrer">
            TypeSafe console <ArrowUpRight size={13} />
          </a>
          . API usage is billed by your provider.
        </p>
        {!config.encryptionReady && (
          <div className="alert error">
            The owner must configure the deployment encryption key before API keys can be saved.
          </div>
        )}
        {canWrite && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await mutate(`/api/guilds/${guildId}/key`, 'PUT', { key });
                setKey('');
                refresh();
              }, 'API key saved. Use the message tester to verify it.');
            }}
          >
            <label>
              New API key
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                minLength={10}
                maxLength={512}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste your TypeSafe API key"
                required
              />
            </label>
            <div className="form-actions">
              <button className="button dark compact" disabled={busy || !config.encryptionReady}>
                Save key <KeyRound size={15} />
              </button>
              {config.keyConfigured && (
                <button
                  type="button"
                  className="button outline compact"
                  disabled={busy}
                  onClick={() => setRemove(true)}
                >
                  Remove key <Trash2 size={15} />
                </button>
              )}
            </div>
          </form>
        )}
        {config.keyUpdatedAt && (
          <small className="body-muted">Last saved {date(config.keyUpdatedAt)}</small>
        )}
        {remove && (
          <div className="confirm-inline">
            <p>Remove this server’s stored key? New AI checks will stop until a key is added.</p>
            <button
              disabled={busy}
              className="button danger compact"
              onClick={() =>
                void run(async () => {
                  await mutate(`/api/guilds/${guildId}/key`, 'DELETE');
                  setRemove(false);
                  refresh();
                }, 'Stored key removed.')
              }
            >
              Remove stored key
            </button>
            <button className="text-button" onClick={() => setRemove(false)}>
              Cancel
            </button>
          </div>
        )}
      </Panel>
      <div className="hint">
        <LockKeyhole size={17} /> Request caps include failed calls and test evaluations. Counts
        reset at midnight UTC.
      </div>
    </>
  );
}
function Tester({
  config,
  canWrite,
  busy,
  run,
  mutate,
  guildId,
}: ActionProps & { config: Config; canWrite: boolean; guildId: string }) {
  const [content, setContent] = useState('');
  const [ai, setAi] = useState(false);
  const [repetitions, setRepetitions] = useState(1);
  const [result, setResult] = useState<{ evaluation: Evaluation; decision: Decision } | null>(null);
  return (
    <>
      <Panel
        title="Try a message"
        description="Preview only. This never sends, deletes, or times out anyone on Discord."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setResult(
                await mutate(`/api/guilds/${guildId}/test`, 'POST', { content, ai, repetitions }),
              );
            });
          }}
        >
          <label>
            Message
            <textarea
              rows={5}
              maxLength={2000}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste a message to see how your policy handles it"
            />
          </label>
          <div className="form-grid">
            <label>
              Matching messages in the detection window
              <input
                type="number"
                min={1}
                max={20}
                value={repetitions}
                onChange={(e) => setRepetitions(Number(e.target.value))}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={ai}
                onChange={(e) => setAi(e.target.checked)}
                disabled={!config.keyConfigured}
              />{' '}
              Include a Jev check (uses your API quota)
            </label>
          </div>
          <button className="button dark" disabled={busy || !canWrite}>
            {busy ? 'Evaluating…' : 'Preview decision'}
            <Sparkles size={16} />
          </button>
          {!canWrite && <p className="body-muted">Only administrators can run evaluations.</p>}
        </form>
      </Panel>
      {result && (
        <Panel
          title="Preview result"
          aside={<Pill tone="green">{label(result.decision.action)}</Pill>}
        >
          <div className="metric-grid">
            <div>
              <span>Spam probability</span>
              <strong>{Math.round(result.evaluation.probability * 100)}%</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{Math.round(result.evaluation.confidence * 100)}%</strong>
            </div>
            <div>
              <span>Source</span>
              <strong className="metric-text">{result.evaluation.source}</strong>
            </div>
          </div>
          <p>{result.decision.reason}</p>
          <small className="body-muted">
            AI status: {label(result.evaluation.aiStatus)} · Current server preset:{' '}
            {label(config.settings.preset)}
          </small>
        </Panel>
      )}
    </>
  );
}
function Incidents({ guildId, run, mutate, busy }: ActionProps & { guildId: string }) {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const load = async (before?: number) => {
    const data = await api<{ incidents: Incident[]; nextBefore: number | null }>(
      `/api/guilds/${guildId}/incidents${before ? `?before=${before}` : ''}`,
    );
    setItems((prev) => (before ? [...(prev ?? []), ...data.incidents] : data.incidents));
    setNext(data.nextBefore);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [guildId]);
  return (
    <>
      <div className="incident-toolbar">
        <label>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All outcomes</option>
            <option value="pending">Needs review</option>
            <option value="action_failed">Failed actions</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <button className="button outline compact" onClick={() => void run(() => load())}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!items ? (
        <p>Loading incidents…</p>
      ) : !items.length ? (
        <Empty title="A clean slate">
          Detections will appear here when the bot processes messages. Observe mode is a good place
          to start.
        </Empty>
      ) : (
        <div className="incident-list">
          {items
            .filter((i) => filter === 'all' || i.status === filter)
            .map((item) => (
              <article className="incident" key={item.id}>
                <div className="incident-top">
                  <Pill
                    tone={
                      item.status === 'action_failed'
                        ? 'red'
                        : item.action === 'review'
                          ? ''
                          : 'green'
                    }
                  >
                    {label(item.action)}
                  </Pill>
                  <span>{date(item.created_at)}</span>
                  <Pill>{label(item.status)}</Pill>
                </div>
                <p className="incident-excerpt">{item.excerpt || '(No text content)'}</p>
                <p className="incident-reason">{item.reason}</p>
                <div className="incident-meta">
                  <span>User {item.author_id}</span>
                  <span>
                    {item.source} · {Math.round(item.probability * 100)}% spam ·{' '}
                    {Math.round(item.confidence * 100)}% confidence
                  </span>
                  <span>AI: {label(item.ai_status)}</span>
                </div>
                <div className="incident-actions">
                  <button
                    disabled={busy}
                    className="text-button"
                    onClick={() =>
                      void run(async () => {
                        await mutate(`/api/guilds/${guildId}/incidents/${item.id}`, 'PATCH', {
                          status: 'confirmed',
                        });
                        await load();
                      }, 'Detection confirmed.')
                    }
                  >
                    <Check size={15} /> Confirm detection
                  </button>
                  <button
                    disabled={busy}
                    className="text-button"
                    onClick={() =>
                      void run(async () => {
                        await mutate(`/api/guilds/${guildId}/incidents/${item.id}`, 'PATCH', {
                          status: 'dismissed',
                        });
                        await load();
                      }, 'Detection dismissed.')
                    }
                  >
                    <Eye size={15} /> Dismiss detection
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
      {next && (
        <button
          className="button outline"
          disabled={busy}
          onClick={() => void run(() => load(next))}
        >
          Load older incidents
        </button>
      )}
      <div className="hint">
        <CircleHelp size={16} /> Review labels do not restore messages or automatically remove
        timeouts.
      </div>
    </>
  );
}
function Access({ guildId, run, mutate, busy }: ActionProps & { guildId: string }) {
  type Grant = { user_id: string; role: string; created_at: number };
  const [grants, setGrants] = useState<Grant[]>([]);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('reviewer');
  const [error, setError] = useState('');
  const load = async () =>
    setGrants((await api<{ grants: Grant[] }>(`/api/guilds/${guildId}/access`)).grants);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [guildId]);
  return (
    <>
      <Panel
        title="Approve a Discord account"
        description="Only you can manage access. Each approval applies to this server."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await mutate(`/api/guilds/${guildId}/access`, 'PUT', { userId, role });
              setUserId('');
              await load();
            }, 'Dashboard access updated.');
          }}
        >
          <div className="form-grid">
            <label>
              Discord user ID
              <input
                value={userId}
                required
                pattern="[0-9]{17,20}"
                placeholder="17–20 digit user ID"
                onChange={(e) => setUserId(e.target.value.trim())}
              />
            </label>
            <label>
              Permission
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="reviewer">Reviewer — incidents and reviews</option>
                <option value="admin">Administrator — settings and API key</option>
              </select>
            </label>
          </div>
          <button disabled={busy} className="button dark compact">
            <Plus size={16} /> Approve account
          </button>
        </form>
      </Panel>
      {error && <div className="alert error">{error}</div>}
      <Panel
        title="Approved accounts"
        description="Revocation also signs this person out of existing dashboard sessions."
      >
        {!grants.length ? (
          <p className="body-muted">
            No additional accounts approved. The instance owner has access.
          </p>
        ) : (
          grants.map((g) => (
            <div className="access-row" key={g.user_id}>
              <span className="avatar gray">
                <Users size={18} />
              </span>
              <div>
                <strong>{g.user_id}</strong>
                <small>Approved {date(g.created_at)}</small>
              </div>
              <Pill>{label(g.role)}</Pill>
              <button
                className="button outline compact"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await mutate(`/api/guilds/${guildId}/access/${g.user_id}`, 'DELETE');
                    await load();
                  }, 'Access revoked and sessions invalidated.')
                }
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
function Audit({ guildId }: { guildId: string }) {
  type Event = { actor_id: string; event: string; detail: string; created_at: number };
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ events: Event[] }>(`/api/guilds/${guildId}/audit`)
      .then((d) => {
        if (active) setEvents(d.events);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [guildId]);
  return (
    <Panel title="Recent changes" description="Latest 50 server events. Retained for 30 days.">
      {error ? (
        <div className="alert error">{error}</div>
      ) : !events ? (
        <p>Loading changes…</p>
      ) : !events.length ? (
        <p className="body-muted">No changes recorded yet.</p>
      ) : (
        events.map((e, i) => (
          <div className="audit-row" key={i}>
            <FileClock size={18} />
            <div>
              <strong>{label(e.event)}</strong>
              <p>{e.detail}</p>
              <small>By {e.actor_id}</small>
            </div>
            <time>{date(e.created_at)}</time>
          </div>
        ))
      )}
    </Panel>
  );
}
function BotPanel({ busy, run, mutate, onRefresh }: ActionProps & { onRefresh: () => void }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState('');
  const load = async () => {
    setBot(await api<Bot>('/api/bot/status'));
    const result = await api<{ url: string }>('/api/bot/invite');
    setInvite(result.url);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <Panel
        title="Discord connection"
        description="One Gateway connection serves this instance’s connected servers."
        aside={
          <Pill tone={bot?.state === 'connected' ? 'green' : ''}>
            {label(bot?.state ?? 'Loading')}
          </Pill>
        }
      >
        {error && <div className="alert error">{error}</div>}
        {bot?.lastError && <div className="alert error">{bot.lastError}</div>}
        <div className="form-actions">
          <button
            className="button dark compact"
            disabled={busy || bot?.state === 'not_configured'}
            onClick={() =>
              void run(async () => {
                setBot(await mutate('/api/bot/start', 'POST'));
                onRefresh();
              }, 'Bot connection requested. Refresh to check its status.')
            }
          >
            <Play size={15} /> Start bot
          </button>
          <button
            className="button outline compact"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setBot(await mutate('/api/bot/stop', 'POST'));
              }, 'Bot connection stopped.')
            }
          >
            <Pause size={15} /> Stop bot
          </button>
          <button
            className="button outline compact"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await load();
                onRefresh();
              })
            }
          >
            <RefreshCw size={15} /> Refresh
          </button>
          {invite && (
            <a className="button outline compact" href={invite} target="_blank" rel="noreferrer">
              Invite to a server <ArrowUpRight size={15} />
            </a>
          )}
        </div>
        {bot?.state === 'not_configured' && (
          <p className="body-muted">
            Add DISCORD_BOT_TOKEN as a Cloudflare Worker secret to connect the bot.
          </p>
        )}
      </Panel>
      {bot && (
        <>
          <div className="metric-grid">
            <div>
              <span>Gateway events</span>
              <strong>{bot.events.toLocaleString()}</strong>
            </div>
            <div>
              <span>Reconnects</span>
              <strong>{bot.reconnects}</strong>
            </div>
            <div>
              <span>Skipped at capacity</span>
              <strong>{bot.dropped}</strong>
            </div>
          </div>
          <Panel title="Connection diagnostics">
            <dl className="diagnostics">
              <dt>Bot name</dt>
              <dd>{bot.botName ?? '—'}</dd>
              <dt>Connected since</dt>
              <dd>{date(bot.connectedAt)}</dd>
              <dt>Last Gateway event</dt>
              <dd>{date(bot.lastEventAt)}</dd>
              <dt>Last heartbeat acknowledgement</dt>
              <dd>{date(bot.lastAckAt)}</dd>
            </dl>
          </Panel>
        </>
      )}
      <div className="hint">
        <ShieldCheck size={17} /> Enable Message Content intent in Discord. Invites request message
        moderation permissions, without Administrator access.
      </div>
    </>
  );
}
