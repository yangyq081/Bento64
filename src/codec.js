export const MAX_FILE_SIZE = 50 * 1024 * 1024;
// Reject encoded input before allocating a much larger decoded buffer.
export const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_SIZE / 3) * 4;

let gbkEncodeMap;

function gbkMap() {
  if (gbkEncodeMap) return gbkEncodeMap;
  const decoder = new TextDecoder('gbk', { fatal: true, ignoreBOM: true });
  const map = new Map([['€', new Uint8Array([0x80])]]);
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    pair[0] = lead;
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;
      pair[1] = trail;
      try {
        const character = decoder.decode(pair);
        if ([...character].length === 1 && !map.has(character)) {
          map.set(character, new Uint8Array(pair));
        }
      } catch {
        // Unassigned GBK byte pairs are intentionally absent.
      }
    }
  }
  gbkEncodeMap = map;
  return map;
}

export function textToBytes(text, charset = 'utf-8') {
  if (charset === 'utf-8') {
    for (const character of text) {
      const point = character.codePointAt(0);
      if (point >= 0xd800 && point <= 0xdfff) {
        throw new Error('输入包含不完整的 Unicode 字符，请检查并重新输入。');
      }
    }
    return new TextEncoder().encode(text);
  }
  if (charset !== 'gbk') throw new Error('不支持的字符集。');
  const map = gbkMap();
  const result = [];
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point <= 0x7f) {
      result.push(point);
    } else {
      const bytes = map.get(character);
      if (!bytes) {
        throw new Error(`GBK 无法表示“${character}”（U+${point.toString(16).toUpperCase()}），请改用 UTF-8。`);
      }
      result.push(...bytes);
    }
  }
  return new Uint8Array(result);
}

export function bytesToText(bytes, charset = 'utf-8') {
  if (!['utf-8', 'gbk'].includes(charset)) throw new Error('不支持的字符集。');
  try {
    return new TextDecoder(charset, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`解码后的字节不是有效的 ${charset === 'utf-8' ? 'UTF-8' : 'GBK'} 文本。请尝试其他字符集，或在“文件与图片”中解码并保存文件。`);
  }
}

export function bytesToBase64(bytes, { variant = 'standard', padding = true } = {}) {
  if (bytes.length > MAX_FILE_SIZE) throw new Error('单次处理的原始数据不能超过 50 MB。');
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  let result = btoa(chunks.join(''));
  if (variant === 'url') result = result.replaceAll('+', '-').replaceAll('/', '_');
  if (!padding) result = result.replace(/=+$/, '');
  return result;
}

export function parseBase64Input(input) {
  let value = input.trim();
  let mime = '';
  if (/^data:/i.test(value)) {
    const match = /^data:([^,]*);base64,([\s\S]*)$/i.exec(value);
    if (!match) throw new Error('Data URI 格式不正确，需要包含“;base64,”。');
    mime = match[1].split(';')[0].toLowerCase();
    if (mime && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) {
      throw new Error('Data URI 的文件类型格式不正确。');
    }
    value = match[2];
  }
  value = value.replace(/\s/g, '');
  if (value.length > MAX_BASE64_LENGTH) throw new Error('Base64 内容过长，单次最多还原 50 MB 文件。');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) {
    throw new Error('Base64 包含无效字符，或“=”补位不在末尾。请检查输入内容。');
  }
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const bare = normalized.replace(/=+$/, '');
  if (bare.length % 4 === 1 || (normalized.includes('=') && normalized.length % 4 !== 0)) {
    throw new Error('Base64 长度或末尾补位不正确，内容可能被截断。');
  }
  const padded = bare.padEnd(Math.ceil(bare.length / 4) * 4, '=');
  let raw;
  try {
    raw = atob(padded);
  } catch {
    throw new Error('无法解码这段 Base64，请检查内容是否完整。');
  }
  const canonical = btoa(raw).replace(/=+$/, '');
  if (canonical !== bare) throw new Error('Base64 的末尾位不正确，请检查内容是否完整。');
  return { bytes: Uint8Array.from(raw, (character) => character.charCodeAt(0)), mime };
}

export function hexToBytes(input) {
  const hex = input.replace(/0x/gi, '').replace(/\s/g, '');
  if (!/^[0-9a-f]*$/i.test(hex)) throw new Error('十六进制只支持 0–9、A–F 和空格。');
  if (hex.length % 2) throw new Error('十六进制需要每两个字符组成一个字节，请补齐最后一位。');
  if (hex.length / 2 > MAX_FILE_SIZE) throw new Error('单次处理的数据不能超过 50 MB。');
  return Uint8Array.from(hex.match(/../g) || [], (pair) => Number.parseInt(pair, 16));
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function safeFilename(name, fallback = 'decoded.bin') {
  const filename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
  const base = filename.split('.')[0];
  if (!filename || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) return fallback;
  return filename;
}

export function decodedFilename(mime, originalName = '') {
  const original = originalName.replace(/\.(?:base64|b64|txt)$/i, '');
  if (original && original !== originalName && original.includes('.')) return safeFilename(original);
  const extensions = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
    'application/pdf': 'pdf', 'text/plain': 'txt', 'application/json': 'json',
    'application/zip': 'zip', 'application/octet-stream': 'bin',
  };
  return `decoded.${extensions[mime] || 'bin'}`;
}
