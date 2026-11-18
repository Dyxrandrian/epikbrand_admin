import { isIP } from 'node:net';

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const bare = raw.split('%')[0]; // retire une éventuelle zone IPv6 (fe80::1%eth0)
  if (bare.toLowerCase().startsWith('::ffff:')) {
    const mapped = bare.slice(7);
    if (isIP(mapped) === 4) return mapped;
  }
  return isIP(bare) ? bare : null;
}