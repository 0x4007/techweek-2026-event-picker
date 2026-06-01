const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const utf8 = (value: string) => textEncoder.encode(value);

export const fromUtf8 = (value: Uint8Array) => textDecoder.decode(value);

export const base64UrlEncode = (value: Uint8Array | ArrayBuffer) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

export const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const base64UrlJson = (value: unknown) =>
  base64UrlEncode(utf8(JSON.stringify(value)));

export const parseBase64UrlJson = <T>(value: string): T => {
  return JSON.parse(fromUtf8(base64UrlDecode(value))) as T;
};

export const randomBase64Url = (byteLength = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64UrlEncode(bytes);
};

export const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", utf8(value));
  return base64UrlEncode(digest);
};

export const normalizeText = (value: unknown, maxLength = 200) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

export const normalizeHandle = (value: unknown) => {
  const text = normalizeText(value, 80).toLowerCase();
  return text.replace(/[^a-z0-9._@-]/g, "");
};

export const normalizeEmail = (value: unknown) => {
  const text = normalizeText(value, 160).toLowerCase();
  if (!text.includes("@")) return "";
  return text;
};

export const normalizeOrigin = (value: unknown) => {
  const text = normalizeText(value, 300);
  if (!text) return "";
  try {
    return new URL(text).origin;
  } catch {
    return "";
  }
};

export const normalizeRedirectUri = (value: unknown) => {
  const text = normalizeText(value, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
};

export const nowIso = () => new Date().toISOString();

export const expiresAtIso = (ttlMs: number) =>
  new Date(Date.now() + ttlMs).toISOString();

export const isExpired = (expiresAt: string) => {
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && Date.now() > timestamp;
};
