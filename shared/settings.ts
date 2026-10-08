import { z } from 'zod';

export const snowflake = z.string().regex(/^\d{17,20}$/, 'Use a Discord ID (17–20 digits)');
const ids = z.array(snowflake).max(100);
export const presetNames = ['observe', 'gentle', 'balanced', 'strict', 'custom'] as const;
export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    preset: z.enum(presetNames),
    spamThreshold: z.number().min(0.5).max(1),
    confidenceThreshold: z.number().min(0.5).max(1),
    maxMessages: z.number().int().min(3).max(50),
    windowSeconds: z.number().int().min(3).max(120),
    duplicateLimit: z.number().int().min(2).max(20),
    mentionLimit: z.number().int().min(2).max(50),
    action: z.enum(['observe', 'warn', 'delete', 'timeout']),
    timeoutMinutes: z.number().int().min(1).max(1440),
    strikeLimit: z.number().int().min(2).max(20),
    strikeDecayHours: z.number().int().min(1).max(168),
    aiEnabled: z.boolean(),
    aiDailyLimit: z.number().int().min(0).max(10000),
    aiMinuteLimit: z.number().int().min(1).max(60),
    retentionDays: z.number().int().min(1).max(30),
    exemptUsers: ids,
    exemptRoles: ids,
    exemptChannels: ids,
    allowedDomains: z
      .array(
        z
          .string()
          .max(253)
          .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i),
      )
      .max(100),
    blockedDomains: z
      .array(
        z
          .string()
          .max(253)
          .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i),
      )
      .max(100),
    logChannelId: z.union([snowflake, z.literal('')]),
    channelOverrides: z
      .array(
        z.object({
          channelId: snowflake,
          preset: z.enum(['observe', 'gentle', 'balanced', 'strict']),
        }),
      )
      .max(100),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export type Preset = Settings['preset'];

const defaults: Settings = {
  enabled: true,
  preset: 'observe',
  spamThreshold: 0.94,
  confidenceThreshold: 0.85,
  maxMessages: 7,
  windowSeconds: 10,
  duplicateLimit: 3,
  mentionLimit: 6,
  action: 'observe',
  timeoutMinutes: 10,
  strikeLimit: 3,
  strikeDecayHours: 24,
  aiEnabled: true,
  aiDailyLimit: 500,
  aiMinuteLimit: 15,
  retentionDays: 7,
  exemptUsers: [],
  exemptRoles: [],
  exemptChannels: [],
  allowedDomains: [],
  blockedDomains: [],
  logChannelId: '',
  channelOverrides: [],
};

export function presetSettings(preset: Preset): Settings {
  const values: Partial<Settings> =
    preset === 'gentle'
      ? {
          action: 'warn',
          spamThreshold: 0.97,
          confidenceThreshold: 0.9,
          maxMessages: 10,
          duplicateLimit: 4,
          mentionLimit: 10,
        }
      : preset === 'balanced'
        ? { action: 'delete', spamThreshold: 0.94, confidenceThreshold: 0.85 }
        : preset === 'strict'
          ? {
              action: 'timeout',
              spamThreshold: 0.88,
              confidenceThreshold: 0.8,
              maxMessages: 5,
              duplicateLimit: 3,
              mentionLimit: 4,
              timeoutMinutes: 30,
            }
          : {};
  return settingsSchema.parse({ ...defaults, ...values, preset });
}

export function forChannel(settings: Settings, channelId: string): Settings {
  const override = settings.channelOverrides.find((item) => item.channelId === channelId);
  if (!override) return settings;
  const p = presetSettings(override.preset);
  return {
    ...settings,
    preset: p.preset,
    action: p.action,
    spamThreshold: p.spamThreshold,
    confidenceThreshold: p.confidenceThreshold,
    maxMessages: p.maxMessages,
    duplicateLimit: p.duplicateLimit,
    mentionLimit: p.mentionLimit,
    timeoutMinutes: p.timeoutMinutes,
  };
}
