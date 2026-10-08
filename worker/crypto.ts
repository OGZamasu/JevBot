const encoder = new TextEncoder();
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
export async function hash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
export async function equal(a: string, b: string): Promise<boolean> {
  // Fixed-size hashes; comparison runs in the Workers Web Crypto implementation.
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return (
    crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }
  ).timingSafeEqual(left, right);
}
async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Encryption is not configured');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, (h) => parseInt(h, 16)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encrypt(value: string, secret: string, guildId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(guildId) },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `v1.${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`;
}
export async function decrypt(value: string, secret: string, guildId: string): Promise<string> {
  const [version, iv, payload] = value.split('.');
  if (version !== 'v1' || !iv || !payload) throw new Error('Invalid encrypted key');
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: Uint8Array.from(atob(iv), (c) => c.charCodeAt(0)),
      additionalData: encoder.encode(guildId),
    },
    await encryptionKey(secret),
    Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
  );
  return new TextDecoder().decode(plain);
}
