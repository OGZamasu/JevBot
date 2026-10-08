import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const wrangler = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
async function command(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error('Wrangler failed. Check your Cloudflare login and Worker deployment.')),
    );
    child.stdin.end(input);
  });
}
function hidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this script in an interactive terminal.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = () => {
      process.stdin.off('data', handle);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const handle = (data) => {
      for (const char of data) {
        if (char === '\u0003') {
          done();
          reject(new Error('Cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          done();
          resolve(value.trim());
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', handle);
  });
}
try {
  const existing = JSON.parse(await command(['secret', 'list']));
  const secrets = {};
  if (!existing.some((item) => item.name === 'ENCRYPTION_KEY')) {
    secrets.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await mkdir('.local', { recursive: true, mode: 0o700 });
    await writeFile('.local/encryption-key.backup', secrets.ENCRYPTION_KEY + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  }
  if (!process.argv.includes('--encryption-only')) {
    console.log(
      'Paste credentials here. Input is hidden; nothing is written to chat or source files.',
    );
    const client = await hidden('Discord OAuth client secret (Enter to keep existing): ');
    const bot = await hidden('Discord bot token (Enter to keep existing): ');
    if (client) secrets.DISCORD_CLIENT_SECRET = client;
    if (bot) secrets.DISCORD_BOT_TOKEN = bot;
  }
  if (Object.keys(secrets).length) {
    await command(['secret', 'bulk'], JSON.stringify(secrets));
    console.log(`Configured: ${Object.keys(secrets).join(', ')}.`);
    if (secrets.ENCRYPTION_KEY)
      console.log(
        'Encryption recovery key saved in ignored .local/encryption-key.backup. Keep it private.',
      );
  } else console.log('Existing secrets kept.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
