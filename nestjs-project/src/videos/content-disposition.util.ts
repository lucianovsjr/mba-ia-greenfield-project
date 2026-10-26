// Builds an `attachment` Content-Disposition (RFC 6266). `filename` carries an
// ASCII-only fallback with quotes, backslashes and control/non-ASCII characters
// replaced; `filename*` carries the exact name percent-encoded (RFC 5987).
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
