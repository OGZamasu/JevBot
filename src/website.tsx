import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Eye,
  Code2,
  Hash,
  KeyRound,
  LockKeyhole,
  MessageSquare,
  Minus,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { api } from './api';
import { Logo, Pill, Footer } from './ui';
import { presetSettings, type Preset } from '../shared/settings';
import { detectRules, decide, type Message } from '../shared/moderation';

type PublicConfig = { sourceUrl: string; loginReady: boolean };
const levels: { id: Preset; label: string; subtitle: string; text: string }[] = [
  {
    id: 'observe',
    label: 'Observe',
    subtitle: 'Learn your community',
    text: 'See what JevBot would flag. Review detections without warnings, deletions, or timeouts.',
  },
  {
    id: 'gentle',
    label: 'Gentle',
    subtitle: 'A friendly nudge',
    text: 'Warn about clear spam at a high detection threshold. Give members room to get it right.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    subtitle: 'Keep things moving',
    text: 'Remove clear spam and timeout repeat offenders. Keep your conversations readable.',
  },
  {
    id: 'strict',
    label: 'Strict',
    subtitle: 'Turn up protection',
    text: 'Use lower thresholds and faster escalation when your server needs stronger protection.',
  },
];

function ChatDemo({ level }: { level: Preset }) {
  const [clean, setClean] = useState(true);
  const action =
    level === 'observe'
      ? 'Flagged for review'
      : level === 'gentle'
        ? 'Warning issued'
        : 'Spam removed';
  return (
    <div className="chat-demo">
      <div className="chat-top">
        <div>
          <span className="server-symbol">c</span>
          <span>
            The Commons <small>Example community</small>
          </span>
        </div>
        <Pill tone="green">
          <span className="status-dot" />
          JevBot enabled
        </Pill>
      </div>
      <div className="chat-body">
        <div className="chat-channel">
          <Hash size={18} />
          <strong>general</strong>
          <span>A little less noise.</span>
        </div>
        <div className="chat-message">
          <span className="avatar peach">a</span>
          <div>
            <strong>
              alex <small>Today at 10:42</small>
            </strong>
            <p>Anyone up for a game tonight?</p>
          </div>
        </div>
        <div className="chat-message">
          <span className="avatar lavender">m</span>
          <div>
            <strong>
              mika <small>Today at 10:43</small>
            </strong>
            <p>Yes! Give me ten minutes 🙌</p>
          </div>
        </div>
        <div
          className={`chat-spam ${clean && ['balanced', 'strict'].includes(level) ? 'removed' : ''}`}
        >
          <div className="chat-message">
            <span className="avatar gray">?</span>
            <div>
              <strong>
                free_nitro_now <small>Today at 10:43</small>
              </strong>
              <p>FREE NITRO!!! CLAIM NOW → suspicious.example</p>
              <p>FREE NITRO!!! CLAIM NOW → suspicious.example</p>
              <p>FREE NITRO!!! CLAIM NOW → suspicious.example</p>
            </div>
          </div>
        </div>
        {clean && (
          <div className="bot-receipt">
            <span className="receipt-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>{action}</strong>
              <p>Repeated message · {levels.find((l) => l.id === level)?.label} mode</p>
            </div>
            <Check size={16} />
          </div>
        )}
        <div className="chat-message final-message">
          <span className="avatar peach">a</span>
          <div>
            <strong>
              alex <small>Today at 10:44</small>
            </strong>
            <p>Perfect. See you there.</p>
          </div>
        </div>
        <div className="chat-composer">
          <Plus size={16} />
          <span>Message #general</span>
          <MessageSquare size={16} />
        </div>
      </div>
      <div className="chat-bottom">
        <span>ILLUSTRATIVE DEMO</span>
        <button onClick={() => setClean(!clean)}>
          {clean ? 'Show original messages' : 'Show moderation'} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

export function Website() {
  const [config, setConfig] = useState<PublicConfig>({ sourceUrl: '', loginReady: false });
  const [level, setLevel] = useState<Preset>('balanced');
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    void api<PublicConfig>('/api/public')
      .then(setConfig)
      .catch(() => {});
  }, []);
  const path = window.location.pathname;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Logo />
        <nav className={menu ? 'open' : ''} aria-label="Main navigation">
          <a href="/#how-it-works">How it works</a>
          <a href="/#levels">Moderation levels</a>
          <a href="/docs">
            Docs <ArrowUpRight size={13} />
          </a>
          {config.sourceUrl && (
            <a href={config.sourceUrl} target="_blank" rel="noreferrer">
              <Code2 size={16} /> GitHub
            </a>
          )}
        </nav>
        <a className="button dark compact nav-admin" href="/admin">
          Dashboard <ArrowUpRight size={15} />
        </a>
        <button
          className="mobile-menu icon-button"
          aria-label="Toggle navigation"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <SlidersHorizontal />}
        </button>
      </header>
      {path === '/docs' ? (
        <Docs sourceUrl={config.sourceUrl} />
      ) : path === '/privacy' ? (
        <Privacy />
      ) : path === '/' ? (
        <main id="main">
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="status-dot" /> OPEN-SOURCE DISCORD MODERATION
              </div>
              <h1>
                Keep the
                <br />
                conversation.
                <br />
                <span>Clear the spam.</span>
              </h1>
              <p className="hero-description">
                A quieter server. A happier community.
                <br />
                Jev-powered spam detection, with moderation
                <br className="desktop-break" /> that plays by your rules.
              </p>
              <div className="hero-actions">
                <a className="button dark" href="/docs">
                  Get started <ArrowUpRight size={18} />
                </a>
                <a className="text-button" href="#levels">
                  Find your level <ArrowRight size={17} />
                </a>
              </div>
              <div className="hero-meta">
                <span>
                  <Check size={14} /> Bring your own API key
                </span>
                <span>
                  <Check size={14} /> Self-hostable
                </span>
              </div>
            </div>
            <div className="hero-visual">
              <div className="visual-caption">
                <span>LESS NOISE. MORE COMMUNITY.</span>
                <span>01 / 03</span>
              </div>
              <ChatDemo level={level} />
              <div className="visual-note">
                <Sparkles size={15} />
                <span>Context meets clear rules. You set the boundaries.</span>
              </div>
              <div className="orbital-mark" aria-hidden="true">
                ✳
              </div>
            </div>
          </section>
          <div className="benefit-strip">
            <span>
              POWERED BY <strong>Jev</strong>
              <ArrowUpRight size={15} />
            </span>
            <span>
              <SlidersHorizontal size={18} /> Your moderation level
            </span>
            <span>
              <KeyRound size={18} /> Your API key
            </span>
            <span>
              <Code2 size={18} /> Your source code
            </span>
            <span>
              <LockKeyhole size={18} /> Your approved admins
            </span>
          </div>
          <section className="how-section section" id="how-it-works">
            <div className="section-heading">
              <div>
                <span className="eyebrow">01 — A LITTLE CONTEXT GOES A LONG WAY</span>
                <h2>
                  Spam has patterns.
                  <br />
                  Conversations have context.
                </h2>
              </div>
              <p>
                JevBot combines straightforward spam rules with Jev’s contextual decisions. Your
                settings decide what happens next.
              </p>
            </div>
            <div className="steps">
              <article>
                <span className="step-number">01</span>
                <MessageSquare size={25} />
                <h3>Catch the obvious.</h3>
                <p>
                  Repeated messages, flooding, mass mentions, and blocked links meet rules you can
                  understand and adjust.
                </p>
                <span className="step-tag">DETERMINISTIC CHECKS</span>
              </article>
              <article>
                <span className="step-number">02</span>
                <Sparkles size={25} />
                <h3>Read the situation.</h3>
                <p>
                  Jev evaluates contextual spam and unsolicited promotion. Ambiguous detections go
                  to moderator review.
                </p>
                <span className="step-tag">JEV DECISIONS</span>
              </article>
              <article>
                <span className="step-number">03</span>
                <ShieldCheck size={25} />
                <h3>Act on your terms.</h3>
                <p>
                  Observe, warn, delete, or timeout. Every detection records its reason so your
                  moderators can review it.
                </p>
                <span className="step-tag">YOUR POLICY</span>
              </article>
            </div>
          </section>
          <section className="levels-section section" id="levels">
            <div className="section-heading">
              <div>
                <span className="eyebrow">02 — SET THE TONE</span>
                <h2>
                  Your server.
                  <br />
                  Your comfort level.
                </h2>
              </div>
              <p>
                Start by observing. Turn up protection when you’re ready. Fine-tune the details
                whenever your community changes.
              </p>
            </div>
            <div className="level-layout">
              <div className="level-options" role="group" aria-label="Example moderation level">
                {levels.map((l, i) => (
                  <button
                    key={l.id}
                    className={`level-option ${level === l.id ? 'active' : ''}`}
                    aria-pressed={level === l.id}
                    onClick={() => setLevel(l.id)}
                  >
                    <span className="level-index">0{i + 1}</span>
                    <span>
                      <strong>{l.label}</strong>
                      <small>{l.subtitle}</small>
                    </span>
                    <span className="level-bars">
                      {[0, 1, 2, 3].map((n) => (
                        <i key={n} className={n <= i ? 'filled' : ''} />
                      ))}
                    </span>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
                <a className="custom-level" href="/docs#settings">
                  <SlidersHorizontal size={18} />
                  <span>Want to get specific? Use Custom mode.</span>
                  <ArrowRight size={17} />
                </a>
              </div>
              <div className="level-detail">
                <div className="level-detail-top">
                  <Pill>PRESET PREVIEW</Pill>
                  <span>
                    <SlidersHorizontal size={17} /> CONFIGURABLE
                  </span>
                </div>
                <h3>{levels.find((l) => l.id === level)?.label}</h3>
                <p>{levels.find((l) => l.id === level)?.text}</p>
                <div className="policy-preview">
                  <span>When spam is detected</span>
                  <strong>
                    {level === 'observe'
                      ? 'Record for review'
                      : level === 'gentle'
                        ? 'Send a warning'
                        : 'Remove the message'}
                    <ArrowRight size={17} />
                  </strong>
                  <span>Repeat offenders</span>
                  <strong>
                    {['balanced', 'strict'].includes(level)
                      ? 'Apply a temporary timeout'
                      : 'Keep observing'}
                    <ArrowRight size={17} />
                  </strong>
                </div>
                <div className="safe-note">
                  <Eye size={16} />
                  <span>New servers always begin in Observe mode.</span>
                </div>
              </div>
            </div>
          </section>
          <section className="ownership section">
            <div className="ownership-copy">
              <span className="eyebrow">03 — CONTROL STAYS WITH YOU</span>
              <h2>
                Good moderation
                <br />
                needs a human
                <br />
                at the controls.
              </h2>
              <p>
                Sign in with Discord. Let approved admins tune protection, review incidents, and
                keep an eye on API usage. Give each server its own settings and key.
              </p>
              <a className="button lime" href="/admin">
                Open dashboard <ArrowUpRight size={18} />
              </a>
            </div>
            <div className="control-board">
              <div className="board-heading">
                <span>
                  <ShieldCheck size={20} /> Community controls
                </span>
                <Pill>PREVIEW</Pill>
              </div>
              <div className="control-row">
                <div>
                  <SlidersHorizontal size={19} />
                  <span>
                    Moderation level<small>Adjust the policy for your community</small>
                  </span>
                </div>
                <Pill tone="green">Observe</Pill>
              </div>
              <div className="control-row">
                <div>
                  <KeyRound size={19} />
                  <span>
                    Jev API key<small>Encrypted. Never shown after saving.</small>
                  </span>
                </div>
                <span className="key-dots">••••••••••••</span>
              </div>
              <div className="control-row">
                <div>
                  <LockKeyhole size={19} />
                  <span>
                    Admin access<small>Explicitly approved Discord accounts</small>
                  </span>
                </div>
                <CheckCheck size={19} />
              </div>
              <div className="control-row">
                <div>
                  <Eye size={19} />
                  <span>
                    Incident history<small>Review the detection and its outcome</small>
                  </span>
                </div>
                <ArrowUpRight size={19} />
              </div>
              <div className="board-foot">
                <span className="status-dot" /> Different channels. Different rules. Same control.
              </div>
            </div>
          </section>
          <section className="open-section section">
            <div className="open-symbol" aria-hidden="true">
              <Terminal size={56} strokeWidth={1} />
            </div>
            <div>
              <span className="eyebrow">OPEN SOURCE. NO BLACK BOX.</span>
              <h2>Make it your own.</h2>
              <p>
                Inspect the code. Change the rules. Host your own instance.
                <br />
                JevBot is MIT-licensed, with your Jev usage billed by your provider.
              </p>
            </div>
            <a
              className="button outline"
              href={config.sourceUrl || '/docs#self-host'}
              {...(config.sourceUrl ? { target: '_blank', rel: 'noreferrer' } : {})}
            >
              {config.sourceUrl ? 'Explore the source' : 'Explore self-hosting'}
              <ArrowUpRight size={18} />
            </a>
          </section>
          <section className="faq-section section">
            <span className="eyebrow">A FEW THINGS TO KNOW</span>
            <h2>Clear answers.</h2>
            <div className="faq-list">
              {[
                [
                  'Is JevBot free?',
                  'The source code is free under the MIT license. Hosting may fit free-tier allowances for a small deployment. Jev API usage is billed separately by TypeSafe, and your dashboard lets you cap request counts.',
                ],
                [
                  'Does AI decide who gets banned?',
                  'Jev evaluates messages. Your configured policy decides what action is allowed. This release does not automatically ban users, and uncertain detections are left for review.',
                ],
                [
                  'Who can use the dashboard?',
                  'Only the instance owner and explicitly approved Discord accounts. The owner assigns administrators and reviewers to specific servers. Signing in alone does not grant access.',
                ],
                [
                  'What happens if Jev is unavailable?',
                  'Deterministic checks continue under your configured policy. Failed or budget-limited AI checks are recorded, and messages are not punished solely because the AI service failed.',
                ],
              ].map(([q, a]) => (
                <details key={q}>
                  <summary>
                    {q}
                    <Plus size={18} />
                    <Minus size={18} />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </section>
          <section className="closing">
            <span className="eyebrow">LET YOUR COMMUNITY BE A COMMUNITY.</span>
            <h2>
              Less cleanup.
              <br />
              <em>More conversation.</em>
            </h2>
            <a className="button lime" href="/docs">
              Set up JevBot <ArrowUpRight size={18} />
            </a>
            <span className="closing-star" aria-hidden="true">
              ✳
            </span>
          </section>
        </main>
      ) : (
        <main id="main" className="docs-page">
          <h1>Page not found.</h1>
          <a className="button dark" href="/">
            Back to JevBot <ArrowRight size={18} />
          </a>
        </main>
      )}
      <Footer sourceUrl={config.sourceUrl} />
    </>
  );
}

function Docs({ sourceUrl }: { sourceUrl: string }) {
  const [content, setContent] = useState('Check out my promotion!');
  const [count, setCount] = useState(3);
  const settings = presetSettings('balanced');
  const message: Message = {
    id: 'example',
    guildId: '',
    channelId: '',
    authorId: 'example',
    content,
    roles: [],
    mentions: 0,
    everyone: false,
    timestamp: 10000,
  };
  const signals = detectRules(
    message,
    Array.from({ length: count - 1 }, (_, i) => ({
      ...message,
      id: String(i),
      timestamp: 9000 - i * 100,
    })),
    settings,
  );
  const decision = decide(
    {
      signals,
      probability: signals.length ? 1 : 0,
      confidence: 1,
      source: 'rules',
      aiStatus: 'not_requested',
    },
    settings,
    0,
  );
  return (
    <main id="main" className="docs-page">
      <span className="eyebrow">JEVBOT / DOCUMENTATION</span>
      <h1>
        A calmer server
        <br />
        starts here.
      </h1>
      <p className="docs-lead">
        Set up your bot, give your moderators access, and tune protection for your community.
      </p>
      <div className="docs-layout">
        <aside>
          <a href="#getting-started">Getting started</a>
          <a href="#settings">Moderation settings</a>
          <a href="#try-rules">Try the rules</a>
          <a href="#access">Dashboard access</a>
          <a href="#self-host">Self-hosting</a>
          <a href="/privacy">
            Data and privacy <ArrowUpRight size={14} />
          </a>
        </aside>
        <div className="docs-content">
          <section id="getting-started">
            <h2>Getting started</h2>
            <ol>
              <li>
                <strong>Create a Discord application.</strong> In the{' '}
                <a
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noreferrer"
                >
                  Discord Developer Portal
                </a>
                , create a bot and enable its Message Content intent.
              </li>
              <li>
                <strong>Deploy your instance.</strong> Configure the owner Discord ID, OAuth
                application, encryption key, and bot token. Register your origin’s{' '}
                <code>/auth/callback</code> as an OAuth redirect URI.
              </li>
              <li>
                <strong>Sign in and connect.</strong> Open the dashboard, invite your bot to a
                server, and start the Gateway connection from Bot status.
              </li>
              <li>
                <strong>Add your Jev API key.</strong> Each server has its own encrypted key. Use
                the message tester to verify the key and preview decisions.
              </li>
              <li>
                <strong>Observe before enforcing.</strong> Review real detections, configure
                exemptions, and then choose Gentle, Balanced, Strict, or Custom.
              </li>
            </ol>
          </section>
          <section id="settings">
            <h2>Moderation settings</h2>
            <p>
              The presets combine spam and confidence thresholds with flood, duplicate, and mention
              limits. Custom mode lets you change each value. Channel presets override the server’s
              detection thresholds and action.
            </p>
            <p>
              Balanced removes clear spam and escalates to a timeout after the configured number of
              strikes. Strict uses lower thresholds and faster escalation. Gentle issues warnings.
              Observe records detections without enforcement.
            </p>
            <p>
              Whitelist roles, users, and channels when they need an exemption. Messages whose links
              all use approved domains bypass AI checks; deterministic flood and duplicate checks
              still apply. Blocked domains trigger a rule.
            </p>
            <p>
              Set daily and per-minute Jev request caps. Request caps limit calls, not a guaranteed
              currency amount. Provider billing depends on token usage and current pricing.
            </p>
          </section>
          <section id="try-rules">
            <h2>Try a deterministic rule</h2>
            <p>
              This example runs locally in your browser. It uses the Balanced preset and makes no AI
              request or Discord action.
            </p>
            <div className="rule-playground">
              <label>
                Example message
                <textarea
                  value={content}
                  maxLength={2000}
                  onChange={(e) => setContent(e.target.value)}
                />
              </label>
              <label>
                Matching messages in 10 seconds{' '}
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
                <strong>{count} messages</strong>
              </label>
              <div className="playground-result">
                <Pill tone={decision.action === 'allow' ? '' : 'green'}>{decision.action}</Pill>
                <span>{decision.reason}</span>
              </div>
            </div>
          </section>
          <section id="access">
            <h2>Dashboard access</h2>
            <p>
              Discord OAuth verifies identity. It does not automatically grant access. The
              deployment owner can approve Discord user IDs for specific servers.
            </p>
            <p>
              Administrators can change settings and API keys. Reviewers can read incidents and mark
              them confirmed or dismissed. Only the owner can manage dashboard access and the bot
              connection. Revoking access invalidates that user’s sessions.
            </p>
            <p>
              Confirming or dismissing an incident records a review. It does not restore a deleted
              Discord message or automatically undo a timeout.
            </p>
          </section>
          <section id="self-host">
            <h2>Self-hosting on Cloudflare</h2>
            <p>
              JevBot uses Workers Static Assets for the website, a Worker API, D1 for server
              configuration, and a SQLite-backed Durable Object for the Discord connection.
            </p>
            <pre>
              <code>
                npm ci{`\n`}npm run types{`\n`}npm run db:local{`\n`}npm run dev
              </code>
            </pre>
            <p>
              Use your own Cloudflare account, Discord application, domain, and TypeSafe key. The
              repository includes deployment commands and secret setup instructions.
            </p>
            {sourceUrl && (
              <a className="button dark" href={sourceUrl} target="_blank" rel="noreferrer">
                Read the setup guide <Code2 size={18} />
              </a>
            )}
            <p>
              Free-tier hosting is a target for small deployments, subject to account usage and
              connection reliability. An always-active bot consumes Durable Object duration. Measure
              usage before relying on a free deployment.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function Privacy() {
  return (
    <main id="main" className="docs-page">
      <span className="eyebrow">JEVBOT / PRIVACY</span>
      <h1>
        Know what
        <br />
        your bot sees.
      </h1>
      <div className="privacy-content">
        <h2>Discord identity</h2>
        <p>
          Login requests Discord’s identify scope. JevBot stores your user ID, display name, avatar
          reference, and a session lasting up to 24 hours. OAuth access tokens are used to read your
          profile and are not stored. Dashboard access is explicitly assigned by the instance owner.
        </p>
        <h2>Message processing</h2>
        <p>
          The bot processes messages in connected Discord servers. Exempt users, roles, and channels
          skip moderation. The current message and up to three recent messages from the same user
          may be sent to TypeSafe for a Jev decision when AI checks are enabled. Message content is
          untrusted data and cannot configure the bot.
        </p>
        <p>
          Messages kept briefly for flood and duplicate checks are kept for about two minutes, then
          removed by the Gateway’s one-minute cleanup cycle. Incident records include up to 500
          characters of the detected message, Discord IDs, detection scores, and action outcomes.
          Server admins choose incident retention from 1 to 30 days; new servers default to 7 days.
          Cleanup runs every five minutes.
        </p>
        <h2>Keys and logs</h2>
        <p>
          Jev keys are encrypted with AES-GCM and bound to their server. The encryption key and
          Discord credentials are deployment secrets. Stored Jev keys are never returned by the
          dashboard API. Settings and access changes are recorded in an audit log retained for 30
          days.
        </p>
        <p>
          Application logs omit message content, API keys, bot tokens, and OAuth codes. An optional
          Discord moderation log channel receives detection reasons and action outcomes. Those
          Discord messages follow Discord’s retention and your server’s management.
        </p>
        <h2>External services</h2>
        <p>
          This instance runs on Cloudflare. Discord supplies identity and message events; TypeSafe
          processes messages sent for AI checks. Their respective service policies apply.
          Self-hosters control their own deployment and its configuration.
        </p>
        <h2>Removing data</h2>
        <p>
          Admins can remove a saved Jev key and pause moderation through the dashboard. For other
          retained data requests, contact the operator of the instance you use. Removing a key does
          not cancel a provider request already in progress. Database backups may retain earlier
          records according to the host’s backup policy.
        </p>
      </div>
    </main>
  );
}
