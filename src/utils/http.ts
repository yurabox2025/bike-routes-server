function toAsciiFilenameFallback(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .replace(/[;=]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return ascii || 'download';
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

export function buildAttachmentContentDisposition(filename: string): string {
  const fallback = toAsciiFilenameFallback(filename);
  const encoded = encodeRfc5987Value(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
