/** No 0/O, 1/I/L — codes are sometimes read aloud or typed from a worn label. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const QR_PREFIX = 'CG-';

export function generateQrCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return QR_PREFIX + out;
}

/**
 * Codes are case-insensitive and stored upper-case. Firestore doc ids cannot
 * contain "/", so anything outside a safe character set is rejected.
 */
export function normalizeQrCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 64 || !/^[A-Z0-9._:-]+$/.test(code)) return null;
  if (code === '.' || code === '..' || /^__.*__$/.test(code)) return null;
  return code;
}

/**
 * Turns whatever a scanner read into a gear code. Our own labels encode
 * `<base>/q/<code>`; pre-printed tags may encode a bare code or a vendor URL,
 * in which case the last path segment or the whole text is used.
 */
export function codeFromScan(text: string): string | null {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    const q = segments.indexOf('q');
    const candidate = q >= 0 && segments[q + 1] ? segments[q + 1] : segments[segments.length - 1];
    if (candidate) return normalizeQrCode(decodeURIComponent(candidate));
    const param = url.searchParams.get('code') ?? url.searchParams.get('id');
    return param ? normalizeQrCode(param) : null;
  } catch {
    return normalizeQrCode(trimmed);
  }
}

export function qrUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/q/${encodeURIComponent(code)}`;
}
