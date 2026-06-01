import {
  expiresAtIso,
  isExpired,
  nowIso,
  randomBase64Url,
  sha256Base64Url
} from "./encoding.ts";
import { authConfig } from "./config.ts";

export type UserRecord = {
  id: string;
  handle: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  credentialIds: string[];
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};

export type CredentialRecord = {
  credentialId: string;
  userId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  createdAt: string;
  updatedAt: string;
};

export type ChallengeRecord = {
  challenge: string;
  type: "registration" | "authentication";
  userId?: string;
  handle?: string;
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  createdAt: string;
  expiresAt: string;
};

export type SsoCodeRecord = {
  code: string;
  userId: string;
  clientId: string;
  audience: string;
  origin: string;
  redirectUri?: string;
  state?: string;
  createdAt: string;
  expiresAt: string;
};

export type AgentTokenRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  handle: string;
  label: string;
  clientId: string;
  audience: string;
  scopes: string[];
  isAdmin: boolean;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
};

export type SigningKeyRecord = {
  kid: string;
  alg: "RS256";
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  createdAt: string;
};

export const kv = await Deno.openKv();

const authPrefix = ["auth", "v1"];
const usersPrefix = [...authPrefix, "users"];
const userKey = (userId: string) => [...usersPrefix, userId];
const handleKey = (handle: string) => [...authPrefix, "handles", handle];
const emailKey = (email: string) => [...authPrefix, "emails", email];
const credentialKey = (credentialId: string) => [
  ...authPrefix,
  "credentials",
  credentialId
];
const challengeKey = (challenge: string) => [
  ...authPrefix,
  "challenges",
  challenge
];
const ssoCodeKey = (code: string) => [...authPrefix, "sso_codes", code];
const agentTokenHashKey = (tokenHash: string) => [
  ...authPrefix,
  "agent_token_hashes",
  tokenHash
];
const userAgentTokensPrefix = (userId: string) => [
  ...authPrefix,
  "user_agent_tokens",
  userId
];
const userAgentTokenKey = (userId: string, tokenId: string) => [
  ...userAgentTokensPrefix(userId),
  tokenId
];
export const signingKeyKey = () => [...authPrefix, "signing", "current"];

export const defaultScopes = ["profile:read", "agent-token:create"];

export const listHasUsers = async (store: Deno.Kv) => {
  for await (const _entry of store.list<UserRecord>({ prefix: usersPrefix })) {
    return true;
  }
  return false;
};

export const getUser = async (store: Deno.Kv, userId: string) => {
  const result = await store.get<UserRecord>(userKey(userId));
  return result.value ?? null;
};

export const getUserIdByHandle = async (store: Deno.Kv, handle: string) => {
  const result = await store.get<string>(handleKey(handle));
  return result.value ?? null;
};

export const getUserIdByEmail = async (store: Deno.Kv, email: string) => {
  const result = await store.get<string>(emailKey(email));
  return result.value ?? null;
};

export const createUser = async (
  store: Deno.Kv,
  input: {
    id?: string;
    handle: string;
    email?: string;
    displayName?: string;
    credentialIds?: string[];
    scopes?: string[];
    isAdmin?: boolean;
  }
) => {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = nowIso();
  const user: UserRecord = {
    id,
    handle: input.handle,
    email: input.email || undefined,
    displayName: input.displayName || input.handle,
    isAdmin: input.isAdmin === true,
    credentialIds: input.credentialIds ?? [],
    scopes: input.scopes ?? [...defaultScopes],
    createdAt,
    updatedAt: createdAt
  };

  let atomic = store.atomic()
    .check({ key: userKey(id), versionstamp: null })
    .check({ key: handleKey(user.handle), versionstamp: null })
    .set(userKey(id), user)
    .set(handleKey(user.handle), id);

  if (user.email) {
    atomic = atomic
      .check({ key: emailKey(user.email), versionstamp: null })
      .set(emailKey(user.email), id);
  }

  const commit = await atomic.commit();
  if (!commit.ok) return null;
  return user;
};

export const saveUser = async (store: Deno.Kv, user: UserRecord) => {
  const existing = await store.get<UserRecord>(userKey(user.id));
  const previous = existing.value;
  let atomic = store.atomic().check(existing).set(userKey(user.id), {
    ...user,
    updatedAt: nowIso()
  });

  if (previous?.handle && previous.handle !== user.handle) {
    atomic = atomic.delete(handleKey(previous.handle));
  }
  atomic = atomic.set(handleKey(user.handle), user.id);

  if (previous?.email && previous.email !== user.email) {
    atomic = atomic.delete(emailKey(previous.email));
  }
  if (user.email) {
    atomic = atomic.set(emailKey(user.email), user.id);
  }

  const commit = await atomic.commit();
  return commit.ok;
};

export const getCredential = async (store: Deno.Kv, credentialId: string) => {
  const result = await store.get<CredentialRecord>(credentialKey(credentialId));
  return result.value ?? null;
};

export const createCredential = async (
  store: Deno.Kv,
  input: {
    credentialId: string;
    userId: string;
    publicKey: string;
    signCount?: number;
    transports?: string[];
  }
) => {
  const createdAt = nowIso();
  const credential: CredentialRecord = {
    credentialId: input.credentialId,
    userId: input.userId,
    publicKey: input.publicKey,
    signCount: input.signCount ?? 0,
    transports: input.transports ?? [],
    createdAt,
    updatedAt: createdAt
  };
  const commit = await store.atomic()
    .check({ key: credentialKey(credential.credentialId), versionstamp: null })
    .set(credentialKey(credential.credentialId), credential)
    .commit();
  if (!commit.ok) return null;
  return credential;
};

export const saveCredential = async (
  store: Deno.Kv,
  credential: CredentialRecord
) => {
  await store.set(credentialKey(credential.credentialId), {
    ...credential,
    updatedAt: nowIso()
  });
};

export const saveChallenge = async (
  store: Deno.Kv,
  input: Omit<ChallengeRecord, "createdAt" | "expiresAt">
) => {
  const record: ChallengeRecord = {
    ...input,
    createdAt: nowIso(),
    expiresAt: expiresAtIso(authConfig.challengeTtlMs)
  };
  await store.set(challengeKey(record.challenge), record, {
    expireIn: authConfig.challengeTtlMs
  });
  return record;
};

export const consumeChallenge = async (store: Deno.Kv, challenge: string) => {
  const key = challengeKey(challenge);
  const result = await store.get<ChallengeRecord>(key);
  if (!result.value) return null;
  if (isExpired(result.value.expiresAt)) {
    await store.atomic().check(result).delete(key).commit();
    return null;
  }
  const commit = await store.atomic().check(result).delete(key).commit();
  if (!commit.ok) return null;
  return result.value;
};

export const createSsoCode = async (
  store: Deno.Kv,
  input: Omit<SsoCodeRecord, "code" | "createdAt" | "expiresAt">
) => {
  const code = randomBase64Url(32);
  const record: SsoCodeRecord = {
    ...input,
    code,
    createdAt: nowIso(),
    expiresAt: expiresAtIso(authConfig.authCodeTtlMs)
  };
  await store.set(ssoCodeKey(code), record, {
    expireIn: authConfig.authCodeTtlMs
  });
  return record;
};

export const consumeSsoCode = async (store: Deno.Kv, code: string) => {
  const key = ssoCodeKey(code);
  const result = await store.get<SsoCodeRecord>(key);
  if (!result.value) return null;
  if (isExpired(result.value.expiresAt)) {
    await store.atomic().check(result).delete(key).commit();
    return null;
  }
  const commit = await store.atomic().check(result).delete(key).commit();
  if (!commit.ok) return null;
  return result.value;
};

export const createAgentToken = async (
  store: Deno.Kv,
  input: {
    user: UserRecord;
    label?: string;
    clientId: string;
    audience: string;
    ttlMs?: number;
  }
) => {
  const token = `dua_agent_${randomBase64Url(32)}`;
  const tokenHash = await sha256Base64Url(token);
  const id = crypto.randomUUID();
  const ttlMs = Math.min(
    Math.max(input.ttlMs ?? authConfig.agentTokenDefaultTtlMs, 60_000),
    authConfig.agentTokenMaxTtlMs
  );
  const record: AgentTokenRecord = {
    id,
    tokenHash,
    userId: input.user.id,
    handle: input.user.handle,
    label: input.label || "LLM agent",
    clientId: input.clientId,
    audience: input.audience,
    scopes: input.user.scopes,
    isAdmin: input.user.isAdmin,
    createdAt: nowIso(),
    expiresAt: expiresAtIso(ttlMs)
  };

  const commit = await store.atomic()
    .check({ key: agentTokenHashKey(tokenHash), versionstamp: null })
    .set(agentTokenHashKey(tokenHash), record, { expireIn: ttlMs })
    .set(userAgentTokenKey(input.user.id, id), record, { expireIn: ttlMs })
    .commit();
  if (!commit.ok) return null;
  return { token, record };
};

export const getAgentTokenBySecret = async (store: Deno.Kv, token: string) => {
  const tokenHash = await sha256Base64Url(token);
  const result = await store.get<AgentTokenRecord>(agentTokenHashKey(tokenHash));
  if (!result.value) return null;
  if (isExpired(result.value.expiresAt)) {
    await store.atomic()
      .check(result)
      .delete(agentTokenHashKey(tokenHash))
      .delete(userAgentTokenKey(result.value.userId, result.value.id))
      .commit();
    return null;
  }
  return result.value;
};

export const touchAgentToken = async (
  store: Deno.Kv,
  record: AgentTokenRecord
) => {
  const next = { ...record, lastUsedAt: nowIso() };
  const ttlMs = Math.max(1, Date.parse(record.expiresAt) - Date.now());
  await store.atomic()
    .set(agentTokenHashKey(record.tokenHash), next, { expireIn: ttlMs })
    .set(userAgentTokenKey(record.userId, record.id), next, { expireIn: ttlMs })
    .commit();
  return next;
};

export const listAgentTokens = async (store: Deno.Kv, userId: string) => {
  const records: AgentTokenRecord[] = [];
  for await (
    const entry of store.list<AgentTokenRecord>({
      prefix: userAgentTokensPrefix(userId)
    })
  ) {
    if (entry.value && !isExpired(entry.value.expiresAt)) {
      records.push(entry.value);
    }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const deleteAgentToken = async (
  store: Deno.Kv,
  userId: string,
  tokenId: string
) => {
  const key = userAgentTokenKey(userId, tokenId);
  const result = await store.get<AgentTokenRecord>(key);
  if (!result.value) return false;
  const commit = await store.atomic()
    .check(result)
    .delete(key)
    .delete(agentTokenHashKey(result.value.tokenHash))
    .commit();
  return commit.ok;
};

export const getSigningKeyRecord = async (store: Deno.Kv) => {
  const result = await store.get<SigningKeyRecord>(signingKeyKey());
  return result.value ?? null;
};

export const saveSigningKeyRecord = async (
  store: Deno.Kv,
  record: SigningKeyRecord
) => {
  const existing = await store.get<SigningKeyRecord>(signingKeyKey());
  const commit = await store.atomic()
    .check(existing)
    .set(signingKeyKey(), record)
    .commit();
  return commit.ok;
};
