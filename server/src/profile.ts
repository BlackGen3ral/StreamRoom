// Small, embedded JPEG thumbnails only. No arbitrary URLs, SVG, original files or metadata stores.
export function validAvatar(value: unknown): value is string | null | undefined {
  if (value === null || value === undefined) return true;
  const prefix = 'data:image/jpeg;base64,';
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith(prefix)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(prefix.length))) return false;
  let bytes: string;
  try { bytes = atob(value.slice(prefix.length)); } catch { return false; }
  const n = (offset: number) => bytes.charCodeAt(offset);
  if (bytes.length < 4 || n(0) !== 255 || n(1) !== 216 || n(bytes.length - 2) !== 255 || n(bytes.length - 1) !== 217) return false;
  for (let offset = 2; offset + 3 < bytes.length;) {
    if (n(offset++) !== 255) return false;
    while (offset < bytes.length && n(offset) === 255) offset++;
    if (offset + 2 >= bytes.length) return false;
    const marker = n(offset++), length = n(offset) * 256 + n(offset + 1);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker === 192 || marker === 194) {
      if (length < 8) return false;
      const height = n(offset + 3) * 256 + n(offset + 4), width = n(offset + 5) * 256 + n(offset + 6);
      return width >= 1 && width <= 128 && height >= 1 && height <= 128;
    }
    if (marker === 218 || marker === 217) return false;
    offset += length;
  }
  return false;
}
export const validName = (value: unknown): value is string => typeof value === 'string'
  && value.trim().length >= 1 && value.trim().length <= 32 && !/[\u0000-\u001f\u007f]/.test(value);
