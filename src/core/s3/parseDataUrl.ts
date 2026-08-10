/**
 * Parses a `data:` URL into bytes + content type.
 * Shared by uploads module (and any caller that accepts data URLs).
 */
export function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer; extensionHint: string } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('INVALID_DATA_URL');
  }

  const contentType = match[1]!.trim().toLowerCase();
  const buffer = Buffer.from(match[2]!, 'base64');
  const subtype = contentType.split('/')[1] ?? 'bin';
  const extensionHint = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/gi, '') || 'bin';

  return { contentType, buffer, extensionHint };
}
