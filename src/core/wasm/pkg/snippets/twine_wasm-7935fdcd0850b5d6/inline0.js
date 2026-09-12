
export function boundedSemanticOccurrences(value) {
 try {
  if (!Array.isArray(value) || value.length > 2114) return false;
  let bytes = 2;
  for (let n = 0; n < value.length; n++) {
    const item = value[n];
    if (item === null || typeof item !== 'object' || typeof item.target !== 'string') return false;
    if (!Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || item.start < 0 || item.end < 0) return false;
    bytes += 29 + String(item.start).length + String(item.end).length + (n ? 1 : 0);
    for (let i = 0; i < item.target.length && bytes <= 65536; i++) {
      const c = item.target.charCodeAt(i);
      if (c === 34 || c === 92 || (c === 8 || c === 9 || c === 10 || c === 12 || c === 13)) bytes += 2;
      else if (c < 32) bytes += 6;
      else if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < item.target.length && item.target.charCodeAt(i+1) >= 0xdc00 && item.target.charCodeAt(i+1) <= 0xdfff) { bytes += 4; i++; }
      else if (c >= 0xd800 && c <= 0xdfff) bytes += 6;
      else bytes += 3;
    }
    if (bytes > 65536) return false;
  }
  return true;
 } catch (_) { return false; }
}
