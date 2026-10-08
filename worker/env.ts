// Bindings and public variables come from `npm run types`.
// Secret bindings cannot be inferred from committed configuration.
export type AppEnv = Cloudflare.Env & {
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  ENCRYPTION_KEY?: string;
};
