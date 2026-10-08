import type { Settings } from './settings';

export type Message = {
  id: string; guildId: string; channelId: string; authorId: string; content: string;
  roles: string[]; mentions: number; everyone: boolean; timestamp: number; edited?: boolean;
};
export type Signal = { rule: string; detail: string; probability: number };
export type Evaluation = { signals: Signal[]; probability: number; confidence: number; source: 'rules' | 'jev' | 'rules+jev'; aiStatus: string };
export type Decision = { action: 'allow' | 'review' | 'observe' | 'warn' | 'delete' | 'timeout'; reason: string };

export function normalize(content: string): string {
  return content.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function domains(content: string): string[] {
  const matches = content.match(/(?:https?:\/\/|www\.)[^\s<>]+/gi) ?? [];
  return matches.flatMap(value => {
    try { return [new URL(value.startsWith('www.') ? `https://${value}` : value).hostname.toLowerCase().replace(/^www\./, '')]; }
    catch { return []; }
  });
}
function domainMatches(host: string, configured: string): boolean { return host === configured || host.endsWith(`.${configured}`); }

export function exempt(message: Message, settings: Settings): boolean {
  return !settings.enabled || settings.exemptUsers.includes(message.authorId) || settings.exemptChannels.includes(message.channelId)
    || message.roles.some(role => settings.exemptRoles.includes(role));
}

export function detectRules(message: Message, recent: Message[], settings: Settings): Signal[] {
  const signals: Signal[] = [];
  const own = recent.filter(m => m.authorId === message.authorId && m.guildId === message.guildId && m.id !== message.id
    && m.timestamp >= message.timestamp - settings.windowSeconds * 1000 && m.timestamp <= message.timestamp);
  if (!message.edited && own.length + 1 >= settings.maxMessages) signals.push({ rule: 'message_flood', detail: `${own.length + 1} messages in ${settings.windowSeconds} seconds`, probability: 1 });
  const content = normalize(message.content);
  const repeated = own.filter(m => normalize(m.content) === content).length + 1;
  if (content && repeated >= settings.duplicateLimit) signals.push({ rule: 'repeated_message', detail: `${repeated} matching messages in ${settings.windowSeconds} seconds`, probability: 1 });
  if (message.mentions >= settings.mentionLimit || message.everyone) signals.push({ rule: 'mention_spam', detail: message.everyone ? 'Mass mention' : `${message.mentions} mentions`, probability: 1 });
  for (const host of domains(message.content)) {
    if (settings.blockedDomains.some(d => domainMatches(host, d.toLowerCase()))) signals.push({ rule: 'blocked_domain', detail: `Blocked domain: ${host}`, probability: 1 });
  }
  return signals;
}

export function shouldUseAI(message: Message, settings: Settings, signals: Signal[]): boolean {
  if (!settings.aiEnabled || signals.length || message.content.trim().length < 12) return false;
  const links = domains(message.content);
  // Allowed links still go through deterministic flood and duplicate checks.
  if (links.length && links.every(host => settings.allowedDomains.some(d => domainMatches(host, d.toLowerCase())))) return false;
  return true;
}

export function decide(evaluation: Evaluation, settings: Settings, previousStrikes: number): Decision {
  if (!settings.enabled) return { action: 'allow', reason: 'Moderation paused' };
  const detail = evaluation.signals.map(signal => signal.detail).join('; ');
  if (evaluation.probability < settings.spamThreshold) {
    return evaluation.probability >= 0.5 ? { action: 'review', reason: detail || 'Uncertain spam detection' } : { action: 'allow', reason: 'No spam detected' };
  }
  if (evaluation.confidence < settings.confidenceThreshold) return { action: 'review', reason: detail || 'Insufficient model confidence' };
  if (settings.preset === 'observe' || settings.action === 'observe') return { action: 'observe', reason: detail || 'Spam detected in Observe mode' };
  const action = settings.action === 'timeout' && previousStrikes + 1 < settings.strikeLimit ? 'delete'
    : settings.action === 'delete' && previousStrikes + 1 >= settings.strikeLimit ? 'timeout' : settings.action;
  return { action, reason: detail || 'Spam threshold reached' };
}
