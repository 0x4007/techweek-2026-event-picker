import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  type CredentialDeviceType,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import {
  deleteCacheValue,
  readCacheValue,
  readStateValue,
  writeCacheValue,
  writeStateValue,
} from "./postgres_store.ts";

const AUTH_USER_INDEX_KEY = "auth:users:v1";
const AUTH_CHALLENGE_NAMESPACE = "auth-challenge";
const AUTH_SESSION_NAMESPACE = "auth-session";
const AUTH_HANDOFF_NAMESPACE = "auth-handoff";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HANDOFF_TTL_MS = 2 * 60 * 1000;
const DEFAULT_COOKIE_NAME = "techweek_session";
const RP_DISPLAY_NAME = "Tech Week Event Picker";
const TEXT_DECODER = new TextDecoder();

export type AccountSessionUser = {
  id: string;
  handle: string;
  isAdmin: boolean;
  credentialCount: number;
};

export type AccountSessionState = {
  authenticated: boolean;
  auth: string;
  user?: AccountSessionUser;
  expiresAt?: string;
  setupRequired?: boolean;
  bootstrapConfigured?: boolean;
  registrationAllowed?: boolean;
};

export type AccountAuthStartRegistrationResponse = {
  publicKey: PublicKeyCredentialCreationOptionsJSON;
  handle: string;
  admin: boolean;
  firstRegistration: boolean;
  registrationExpires: string;
};

export type AccountAuthStartLoginResponse = {
  publicKey: PublicKeyCredentialRequestOptionsJSON;
};

export type AccountAuthFinishResponse = {
  user: AccountSessionUser;
  expiresAt: string;
  sessionToken: string;
  session: AccountSessionState;
};

export type AccountSessionHandoffInfo = {
  handoffToken: string;
  expiresAt: string;
};

export type AccountConsumedSessionHandoff = {
  sessionToken: string;
  session: AccountSessionState;
};

type AuthUser = {
  id: string;
  handle: string;
  isAdmin: boolean;
  credentialIds: string[];
  createdAt: string;
  updatedAt: string;
};

type StoredCredential = {
  id: Base64URLString;
  userId: string;
  webAuthnUserId: Base64URLString;
  publicKey: Base64URLString;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  deviceType?: CredentialDeviceType;
  backedUp?: boolean;
  createdAt: string;
  updatedAt: string;
};

type AuthChallenge = {
  challenge: string;
  type: "registration" | "login";
  origin: string;
  rpId: string;
  userId?: string;
  handle?: string;
  isAdmin?: boolean;
  createdAt: string;
  expiresAt: string;
};

type AuthSession = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type AuthHandoff = {
  token: string;
  sessionToken: string;
  origin: string;
  createdAt: string;
  expiresAt: string;
};

type StartRegistrationRequest = {
  handle?: unknown;
  admin?: unknown;
  client_origin?: unknown;
};

type StartLoginRequest = {
  handle?: unknown;
  client_origin?: unknown;
};

type FinishCredentialRequest = {
  response?: unknown;
};

export class AccountAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountAuthError";
    this.status = status;
  }
}

export function accountAuthErrorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof AccountAuthError) {
    return { status: error.status, message: error.message };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : "Unknown account auth error.",
  };
}

export async function accountSessionState(request: Request): Promise<AccountSessionState> {
  const session = await sessionFromRequest(request);
  if (session) return sessionState(session.user, session.session.expiresAt);

  const hasUsers = await authHasUsers();
  if (!hasUsers) {
    return {
      authenticated: false,
      auth: "setup_required",
      setupRequired: true,
      bootstrapConfigured: true,
      registrationAllowed: true,
    };
  }
  return {
    authenticated: false,
    auth: "passkey",
    bootstrapConfigured: true,
    registrationAllowed: false,
  };
}

export async function requireAccountSession(request: Request): Promise<AccountSessionState> {
  const session = await accountSessionState(request);
  if (!session.authenticated) throw new AccountAuthError(401, "Authentication required.");
  return session;
}

export async function requireAdminAccountSession(request: Request): Promise<AccountSessionState> {
  const session = await requireAccountSession(request);
  if (session.user?.isAdmin !== true) throw new AccountAuthError(403, "Admin access required.");
  return session;
}

export async function startAccountRegistration(
  request: Request,
): Promise<AccountAuthStartRegistrationResponse> {
  const body = await jsonBody<StartRegistrationRequest>(request);
  const handle = normalizeAccountHandle(textField(body.handle, 120));
  if (!handle) throw new AccountAuthError(400, "handle is required");

  const hasUsers = await authHasUsers();
  const currentSession = await accountSessionState(request);
  if (hasUsers) {
    if (!currentSession.authenticated) {
      throw new AccountAuthError(401, "Admin session is required.");
    }
    if (currentSession.user?.isAdmin !== true) {
      throw new AccountAuthError(403, "Admin session is required.");
    }
  }

  const existingUser = await getUserByHandle(handle);
  const now = new Date().toISOString();
  const user: AuthUser = existingUser ?? {
    id: newAccountId("user"),
    handle,
    isAdmin: !hasUsers ? true : body.admin === true,
    credentialIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const isAdmin = !hasUsers ? true : existingUser?.isAdmin ?? body.admin === true;
  const credentials = await credentialsForUser(user);
  const meta = requestMeta(request, textField(body.client_origin, 500));

  const publicKey = await generateRegistrationOptions({
    rpName: RP_DISPLAY_NAME,
    rpID: meta.rpId,
    userID: isoUint8Array.fromUTF8String(user.id),
    userName: user.handle,
    userDisplayName: user.handle,
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: isAdmin ? "required" : "preferred",
    },
    supportedAlgorithmIDs: [-7, -257],
  });
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  await writeCacheValue<AuthChallenge>(
    AUTH_CHALLENGE_NAMESPACE,
    publicKey.challenge,
    {
      challenge: publicKey.challenge,
      type: "registration",
      origin: meta.origin,
      rpId: meta.rpId,
      userId: user.id,
      handle: user.handle,
      isAdmin,
      createdAt: new Date().toISOString(),
      expiresAt,
    },
    { ttlMs: CHALLENGE_TTL_MS, metadata: { type: "registration", userId: user.id } },
  );
  return {
    publicKey,
    handle: user.handle,
    admin: isAdmin,
    firstRegistration: !hasUsers,
    registrationExpires: expiresAt,
  };
}

export async function finishAccountRegistration(
  request: Request,
): Promise<AccountAuthFinishResponse> {
  const response = await credentialResponseBody<RegistrationResponseJSON>(request);
  const challenge = await consumeChallenge(response);
  if (challenge.type !== "registration") {
    throw new AccountAuthError(400, "invalid passkey challenge");
  }
  const userId = textField(challenge.userId, 160);
  const handle = normalizeAccountHandle(challenge.handle || "");
  if (!userId || !handle) throw new AccountAuthError(400, "invalid passkey challenge");

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rpId,
    requireUserVerification: challenge.isAdmin === true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new AccountAuthError(400, "invalid passkey attestation");
  }

  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
  const now = new Date().toISOString();
  const existing = await getUser(userId);
  const user: AuthUser = {
    id: userId,
    handle,
    isAdmin: existing?.isAdmin ?? challenge.isAdmin === true,
    credentialIds: appendUnique(existing?.credentialIds ?? [], credential.id),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await saveCredential({
    id: credential.id,
    userId: user.id,
    webAuthnUserId: userIdToWebAuthnUserId(user.id),
    publicKey: bytesToBase64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    createdAt: now,
    updatedAt: now,
  });
  await saveUser(user);
  const session = await createSession(user.id);
  return finishResponse(user, session);
}

export async function startAccountLogin(request: Request): Promise<AccountAuthStartLoginResponse> {
  const body = await optionalJsonBody<StartLoginRequest>(request);
  const handle = normalizeAccountHandle(textField(body?.handle, 120));
  const meta = requestMeta(request, textField(body?.client_origin, 500));
  let user: AuthUser | null = null;
  let credentials: WebAuthnCredential[] = [];
  if (handle) {
    user = await getUserByHandle(handle);
    if (!user) throw new AccountAuthError(404, "passkey account not found");
    credentials = await credentialsForUser(user);
    if (!credentials.length) throw new AccountAuthError(404, "passkey account not found");
  }

  const allowCredentials = credentials.map((credential) => ({
    id: credential.id,
    transports: credential.transports,
  }));
  const publicKey = await generateAuthenticationOptions({
    rpID: meta.rpId,
    userVerification: user?.isAdmin ? "required" : "preferred",
    ...(allowCredentials.length ? { allowCredentials } : {}),
  });
  await writeCacheValue<AuthChallenge>(
    AUTH_CHALLENGE_NAMESPACE,
    publicKey.challenge,
    {
      challenge: publicKey.challenge,
      type: "login",
      origin: meta.origin,
      rpId: meta.rpId,
      ...(user ? { userId: user.id } : {}),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    },
    { ttlMs: CHALLENGE_TTL_MS, metadata: { type: "login", userId: user?.id ?? "" } },
  );
  return { publicKey };
}

export async function finishAccountLogin(request: Request): Promise<AccountAuthFinishResponse> {
  const response = await credentialResponseBody<AuthenticationResponseJSON>(request);
  const challenge = await consumeChallenge(response);
  if (challenge.type !== "login") throw new AccountAuthError(400, "invalid passkey challenge");

  const credentialId = textField(response.id || response.rawId, 300);
  const storedCredential = await getCredential(credentialId);
  if (!storedCredential) throw new AccountAuthError(401, "Unauthorized");
  if (challenge.userId && storedCredential.userId !== challenge.userId) {
    throw new AccountAuthError(401, "Unauthorized");
  }
  const user = await getUser(storedCredential.userId);
  if (!user) throw new AccountAuthError(401, "Unauthorized");
  const userHandle = decodeUserHandle(response.response.userHandle);
  if (userHandle && userHandle !== user.id) throw new AccountAuthError(401, "Unauthorized");

  const credential = storedCredentialToWebAuthn(storedCredential);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rpId,
    credential,
    requireUserVerification: user.isAdmin,
  });
  if (!verification.verified) throw new AccountAuthError(400, "invalid passkey assertion");

  await saveCredential({
    ...storedCredential,
    counter: verification.authenticationInfo.newCounter,
    backedUp: verification.authenticationInfo.credentialBackedUp,
    deviceType: verification.authenticationInfo.credentialDeviceType,
    updatedAt: new Date().toISOString(),
  });
  const session = await createSession(user.id);
  return finishResponse(user, session);
}

export async function createAccountSessionHandoff(
  request: Request,
  targetOrigin: string,
): Promise<AccountSessionHandoffInfo> {
  targetOrigin = parseOrigin(targetOrigin);
  if (!targetOrigin) throw new AccountAuthError(400, "target origin is required");
  if (!originAllowed(request, targetOrigin)) {
    throw new AccountAuthError(403, "target origin is not allowed");
  }
  const token = getCookieValue(request.headers.get("cookie") || "", DEFAULT_COOKIE_NAME);
  if (!token) throw new AccountAuthError(401, "Unauthorized");
  const session = await readCacheValue<AuthSession>(AUTH_SESSION_NAMESPACE, token);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    throw new AccountAuthError(401, "Unauthorized");
  }
  const handoffToken = newToken("techweek_handoff");
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
  await writeCacheValue<AuthHandoff>(
    AUTH_HANDOFF_NAMESPACE,
    handoffToken,
    {
      token: handoffToken,
      sessionToken: token,
      origin: targetOrigin,
      createdAt: new Date().toISOString(),
      expiresAt,
    },
    { ttlMs: HANDOFF_TTL_MS, metadata: { origin: targetOrigin } },
  );
  return { handoffToken, expiresAt };
}

export async function consumeAccountSessionHandoff(
  request: Request,
  handoffToken: string,
  targetOrigin: string,
): Promise<AccountConsumedSessionHandoff> {
  targetOrigin = parseOrigin(targetOrigin);
  if (!handoffToken) throw new AccountAuthError(400, "handoffToken is required.");
  if (!targetOrigin) throw new AccountAuthError(400, "target origin is required");
  if (!originAllowed(request, targetOrigin)) {
    throw new AccountAuthError(403, "target origin is not allowed");
  }
  const handoff = await readCacheValue<AuthHandoff>(AUTH_HANDOFF_NAMESPACE, handoffToken);
  await deleteCacheValue(AUTH_HANDOFF_NAMESPACE, handoffToken);
  if (!handoff || handoff.origin !== targetOrigin || Date.parse(handoff.expiresAt) <= Date.now()) {
    throw new AccountAuthError(401, "invalid handoff token");
  }
  const session = await readSession(handoff.sessionToken);
  if (!session) throw new AccountAuthError(401, "handoff session expired");
  return {
    sessionToken: handoff.sessionToken,
    session: sessionState(session.user, session.session.expiresAt),
  };
}

export async function logoutAccountSession(request: Request): Promise<void> {
  const token = getCookieValue(request.headers.get("cookie") || "", DEFAULT_COOKIE_NAME);
  if (token) await deleteCacheValue(AUTH_SESSION_NAMESPACE, token);
}

export function accountSessionCookie(
  token: string,
  expiresAt: string | undefined,
  request: Request,
): string {
  const parts = [
    `${DEFAULT_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (expires && Number.isFinite(expires.getTime())) {
    parts.push(`Expires=${expires.toUTCString()}`);
    parts.push(`Max-Age=${Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000))}`);
  }
  if (requestIsHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

export function clearAccountSessionCookie(request: Request): string {
  const parts = [
    `${DEFAULT_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (requestIsHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

export function normalizeAccountHandle(value: string): string {
  value = value.trim().toLowerCase();
  let output = "";
  let lastDash = false;
  for (const char of value) {
    if (/^[a-z0-9._]$/.test(char)) {
      output += char;
      lastDash = false;
    } else if (char === "-") {
      if (output && !lastDash) {
        output += "-";
        lastDash = true;
      }
    } else if (output && !lastDash) {
      output += "-";
      lastDash = true;
    }
    if (output.length >= 96) break;
  }
  return output.replace(/^-+|-+$/g, "");
}

async function sessionFromRequest(
  request: Request,
): Promise<{ session: AuthSession; user: AuthUser } | null> {
  const token = getCookieValue(request.headers.get("cookie") || "", DEFAULT_COOKIE_NAME);
  if (!token) return null;
  return await readSession(token);
}

async function readSession(
  token: string,
): Promise<{ session: AuthSession; user: AuthUser } | null> {
  const session = await readCacheValue<AuthSession>(AUTH_SESSION_NAMESPACE, token);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    if (session) await deleteCacheValue(AUTH_SESSION_NAMESPACE, token);
    return null;
  }
  const user = await getUser(session.userId);
  if (!user) return null;
  return { session, user };
}

async function createSession(userId: string): Promise<AuthSession> {
  const now = new Date();
  const session: AuthSession = {
    token: newToken("techweek_session"),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
  await writeCacheValue<AuthSession>(
    AUTH_SESSION_NAMESPACE,
    session.token,
    session,
    { ttlMs: SESSION_TTL_MS, metadata: { userId } },
  );
  return session;
}

function sessionState(user: AuthUser, expiresAt: string): AccountSessionState {
  return {
    authenticated: true,
    auth: "passkey",
    user: userInfo(user),
    expiresAt,
    bootstrapConfigured: true,
    registrationAllowed: user.isAdmin,
  };
}

function finishResponse(user: AuthUser, session: AuthSession): AccountAuthFinishResponse {
  const state = sessionState(user, session.expiresAt);
  return {
    user: userInfo(user),
    expiresAt: session.expiresAt,
    sessionToken: session.token,
    session: state,
  };
}

function userInfo(user: AuthUser): AccountSessionUser {
  return {
    id: user.id,
    handle: user.handle,
    isAdmin: user.isAdmin,
    credentialCount: user.credentialIds.length,
  };
}

async function authHasUsers(): Promise<boolean> {
  const users = await userIndex();
  return users.length > 0;
}

async function userIndex(): Promise<string[]> {
  return await readStateValue<string[]>(AUTH_USER_INDEX_KEY) ?? [];
}

async function writeUserIndex(ids: string[]): Promise<void> {
  await writeStateValue(AUTH_USER_INDEX_KEY, [...new Set(ids)].sort());
}

async function getUser(userId: string): Promise<AuthUser | null> {
  if (!userId) return null;
  return await readStateValue<AuthUser>(userKey(userId));
}

async function getUserByHandle(handle: string): Promise<AuthUser | null> {
  const userId = await readStateValue<string>(handleKey(handle));
  return userId ? await getUser(userId) : null;
}

async function saveUser(user: AuthUser): Promise<void> {
  const existing = await getUserByHandle(user.handle);
  if (existing && existing.id !== user.id) {
    throw new AccountAuthError(409, "passkey account already exists for this username");
  }
  const ids = appendUnique(await userIndex(), user.id);
  await writeStateValue(userKey(user.id), user);
  await writeStateValue(handleKey(user.handle), user.id);
  await writeUserIndex(ids);
}

async function getCredential(credentialId: string): Promise<StoredCredential | null> {
  if (!credentialId) return null;
  return await readStateValue<StoredCredential>(credentialKey(credentialId));
}

async function saveCredential(credential: StoredCredential): Promise<void> {
  const existing = await getCredential(credential.id);
  if (existing && existing.userId !== credential.userId) {
    throw new AccountAuthError(409, "passkey credential is already registered");
  }
  await writeStateValue(credentialKey(credential.id), credential);
}

async function credentialsForUser(user: AuthUser): Promise<WebAuthnCredential[]> {
  const credentials: WebAuthnCredential[] = [];
  for (const credentialId of user.credentialIds) {
    const credential = await getCredential(credentialId);
    if (credential) credentials.push(storedCredentialToWebAuthn(credential));
  }
  return credentials;
}

function storedCredentialToWebAuthn(credential: StoredCredential): WebAuthnCredential {
  return {
    id: credential.id,
    publicKey: base64urlToBytes(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
  };
}

async function consumeChallenge(
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): Promise<AuthChallenge> {
  const challengeId = clientDataChallenge(response);
  const challenge = await readCacheValue<AuthChallenge>(AUTH_CHALLENGE_NAMESPACE, challengeId);
  await deleteCacheValue(AUTH_CHALLENGE_NAMESPACE, challengeId);
  if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
    throw new AccountAuthError(400, "invalid passkey challenge");
  }
  return challenge;
}

function clientDataChallenge(
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): string {
  const clientDataJSON = response.response.clientDataJSON;
  if (!clientDataJSON) throw new AccountAuthError(400, "invalid passkey response");
  const decoded = TEXT_DECODER.decode(base64urlToBytes(clientDataJSON));
  const clientData = JSON.parse(decoded) as { challenge?: unknown };
  const challenge = textField(clientData.challenge, 300);
  if (!challenge) throw new AccountAuthError(400, "invalid passkey response");
  return challenge;
}

function decodeUserHandle(value: string | undefined): string {
  if (!value) return "";
  try {
    return TEXT_DECODER.decode(base64urlToBytes(value));
  } catch {
    return "";
  }
}

function userIdToWebAuthnUserId(userId: string): Base64URLString {
  return bytesToBase64url(new TextEncoder().encode(userId));
}

async function credentialResponseBody<T>(request: Request): Promise<T> {
  const body = await jsonBody<FinishCredentialRequest>(request);
  if (!body.response || typeof body.response !== "object") {
    throw new AccountAuthError(400, "passkey response is required");
  }
  return body.response as T;
}

async function jsonBody<T>(request: Request): Promise<T> {
  if (!isJsonRequest(request)) {
    throw new AccountAuthError(400, "content-type must be application/json");
  }
  try {
    return await request.json() as T;
  } catch {
    throw new AccountAuthError(400, "invalid JSON body");
  }
}

async function optionalJsonBody<T>(request: Request): Promise<T | null> {
  if (!request.headers.get("content-type")) return null;
  return await jsonBody<T>(request);
}

function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type") || "";
  return !contentType || contentType.toLowerCase().startsWith("application/json");
}

function requestMeta(request: Request, clientOrigin: string): { origin: string; rpId: string } {
  const candidates = [
    parseOrigin(clientOrigin),
    originFromForwarded(request),
    originFromHost(request),
    originFromUrl(request),
    parseOrigin(request.headers.get("origin") || ""),
    parseOrigin(request.headers.get("referer") || ""),
  ];
  for (const origin of candidates) {
    if (!origin || !originAllowed(request, origin)) continue;
    const parsed = new URL(origin);
    return { origin, rpId: parsed.hostname };
  }
  throw new AccountAuthError(400, "could not determine trusted passkey origin");
}

function originAllowed(request: Request, origin: string): boolean {
  const parsed = safeUrl(origin);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return false;
  if (isLoopbackHost(parsed.hostname)) return true;
  const requestHostnames = requestHosts(request);
  return requestHostnames.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase());
}

function originFromForwarded(request: Request): string {
  const host = firstHeaderValue(request.headers.get("x-forwarded-host") || "");
  if (!host) return "";
  const proto = firstHeaderValue(request.headers.get("x-forwarded-proto") || "") || "https";
  return parseOrigin(`${proto}://${host}`);
}

function originFromHost(request: Request): string {
  const host = firstHeaderValue(request.headers.get("host") || new URL(request.url).host);
  if (!host) return "";
  return parseOrigin(`${requestIsHttps(request) ? "https" : "http"}://${host}`);
}

function originFromUrl(request: Request): string {
  return parseOrigin(request.url);
}

function requestHosts(request: Request): string[] {
  const url = new URL(request.url);
  return [
    firstHeaderValue(request.headers.get("x-forwarded-host") || ""),
    firstHeaderValue(request.headers.get("host") || ""),
    url.host,
  ].map(hostname).filter(Boolean);
}

function requestIsHttps(request: Request): boolean {
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto") || "");
  return forwardedProto === "https" || new URL(request.url).protocol === "https:";
}

function parseOrigin(value: string): string {
  const parsed = safeUrl(value);
  if (!parsed || !parsed.protocol || !parsed.host) return "";
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function safeUrl(value: string): URL | null {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string): string {
  return value.split(",")[0]?.trim() || "";
}

function hostname(value: string): string {
  value = value.trim();
  if (!value) return "";
  if (value.startsWith("[") && value.includes("]")) return value.slice(1, value.indexOf("]"));
  const parsed = safeUrl(`http://${value}`);
  return parsed?.hostname || "";
}

function isLoopbackHost(host: string): boolean {
  host = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function userKey(userId: string): string {
  return `auth:user:${safeSegment(userId)}`;
}

function handleKey(handle: string): string {
  return `auth:handle:${safeSegment(handle)}`;
}

function credentialKey(credentialId: string): string {
  return `auth:credential:${safeSegment(credentialId)}`;
}

function safeSegment(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return safe && safe !== "." && safe !== ".." ? safe : "_";
}

function newAccountId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function newToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToBase64url(bytes)}`;
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function getCookieValue(cookieHeader: string, cookieName: string): string {
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...rest] = cookie.trim().split("=");
    if (name === cookieName) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function textField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function bytesToBase64url(bytes: Uint8Array): Base64URLString {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/g,
    "",
  ) as Base64URLString;
}

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
