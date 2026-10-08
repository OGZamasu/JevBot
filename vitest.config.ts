import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          OWNER_DISCORD_ID: '111111111111111111',
          DISCORD_CLIENT_ID: '999999999999999999',
          DISCORD_CLIENT_SECRET: 'test-only-client-secret',
          ENCRYPTION_KEY: 'a'.repeat(64),
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        },
      },
    })),
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
