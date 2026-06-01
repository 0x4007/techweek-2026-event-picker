import { authConfig } from "./config.ts";
import {
  base64UrlDecode,
  base64UrlEncode,
  base64UrlJson,
  parseBase64UrlJson,
  utf8
} from "./encoding.ts";
import {
  getSigningKeyRecord,
  saveSigningKeyRecord,
  type SigningKeyRecord,
  type UserRecord
} from "./store.ts";

export type TokenAuthMethod = "passkey" | "sso" | "agent-token";

export type AccessTokenClaims = {
  iss: string;
  sub: string;
  handle: string;
  isAdmin: boolean;
  scopes: string[];
  aud: string;
  clientId: string;
  auth: TokenAuthMethod;
  iat: number;
  exp: number;
  jti: string;
  agentTokenId?: string;
};

const jwtAlg = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256"
} as const;

const generateSigningKeyRecord = async (): Promise<SigningKeyRecord> => {
  const pair = await crypto.subtle.generateKey(
    {
      ...jwtAlg,
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1])
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const kid = crypto.randomUUID();
  return {
    kid,
    alg: "RS256",
    publicJwk: {
      ...publicJwk,
      kid,
      alg: "RS256",
      use: "sig"
    } as JsonWebKey,
    privateJwk: {
      ...privateJwk,
      kid,
      alg: "RS256",
      use: "sig"
    } as JsonWebKey,
    createdAt: new Date().toISOString()
  };
};

const loadSigningKeyRecord = async (store: Deno.Kv) => {
  const existing = await getSigningKeyRecord(store);
  if (existing) return existing;

  const generated = await generateSigningKeyRecord();
  if (await saveSigningKeyRecord(store, generated)) {
    return generated;
  }
  const raced = await getSigningKeyRecord(store);
  if (!raced) throw new Error("Unable to initialize signing key.");
  return raced;
};

const importPrivateKey = (jwk: JsonWebKey) =>
  crypto.subtle.importKey("jwk", jwk, jwtAlg, false, ["sign"]);

const importPublicKey = (jwk: JsonWebKey) =>
  crypto.subtle.importKey("jwk", jwk, jwtAlg, false, ["verify"]);

export const publicJwks = async (store: Deno.Kv) => {
  const record = await loadSigningKeyRecord(store);
  return { keys: [record.publicJwk] };
};

export const signAccessToken = async (
  store: Deno.Kv,
  input: {
    user: UserRecord;
    audience: string;
    clientId: string;
    auth: TokenAuthMethod;
    ttlMs?: number;
    agentTokenId?: string;
  }
) => {
  const keyRecord = await loadSigningKeyRecord(store);
  const privateKey = await importPrivateKey(keyRecord.privateJwk);
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.floor((input.ttlMs ?? authConfig.accessTokenTtlMs) / 1000);
  const claims: AccessTokenClaims = {
    iss: authConfig.issuer,
    sub: input.user.id,
    handle: input.user.handle,
    isAdmin: input.user.isAdmin,
    scopes: input.user.scopes,
    aud: input.audience,
    clientId: input.clientId,
    auth: input.auth,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID()
  };
  if (input.agentTokenId) {
    claims.agentTokenId = input.agentTokenId;
  }

  const header = base64UrlJson({
    alg: "RS256",
    typ: "JWT",
    kid: keyRecord.kid
  });
  const payload = base64UrlJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    jwtAlg,
    privateKey,
    utf8(signingInput)
  );
  const accessToken = `${signingInput}.${base64UrlEncode(signature)}`;
  return {
    accessToken,
    tokenType: "Bearer",
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    claims
  };
};

export const verifyAccessToken = async (
  store: Deno.Kv,
  token: string,
  expectedAudience?: string
) => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: { alg?: string; kid?: string };
  let claims: AccessTokenClaims;
  try {
    header = parseBase64UrlJson(encodedHeader);
    claims = parseBase64UrlJson(encodedPayload);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  if (claims.iss !== authConfig.issuer) return null;
  if (expectedAudience && claims.aud !== expectedAudience) return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;

  const keyRecord = await loadSigningKeyRecord(store);
  if (header.kid !== keyRecord.kid) return null;
  const publicKey = await importPublicKey(keyRecord.publicJwk);
  const verified = await crypto.subtle.verify(
    jwtAlg,
    publicKey,
    base64UrlDecode(encodedSignature),
    utf8(`${encodedHeader}.${encodedPayload}`)
  );
  if (!verified) return null;
  return claims;
};

export const bearerToken = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
};
