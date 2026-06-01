import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "jsr:@simplewebauthn/server";
import {
  authConfig,
  clientAllowsAudience,
  clientAllowsOrigin,
  clientAllowsRedirectUri,
  findClient
} from "./config.ts";
import {
  base64UrlDecode,
  base64UrlEncode,
  normalizeEmail,
  normalizeHandle,
  normalizeOrigin,
  normalizeRedirectUri,
  normalizeText,
  randomBase64Url,
  utf8
} from "./encoding.ts";
import {
  errorResponse,
  htmlResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  readJson,
  textResponse,
  withCors
} from "./http.ts";
import {
  consumeChallenge,
  consumeSsoCode,
  createAgentToken,
  createCredential,
  createSsoCode,
  createUser,
  deleteAgentToken,
  getAgentTokenBySecret,
  getCredential,
  getUser,
  getUserIdByEmail,
  getUserIdByHandle,
  kv,
  listAgentTokens,
  listHasUsers,
  saveChallenge,
  saveCredential,
  touchAgentToken,
  type UserRecord
} from "./store.ts";
import {
  bearerToken,
  publicJwks,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenClaims
} from "./tokens.ts";

type RegisterStartBody = {
  handle?: unknown;
  email?: unknown;
  displayName?: unknown;
  admin?: unknown;
};

type RegisterFinishBody = {
  response?: RegistrationResponseJSON;
};

type LoginStartBody = {
  handle?: unknown;
  email?: unknown;
};

type LoginFinishBody = {
  response?: AuthenticationResponseJSON;
};

type SsoBody = {
  clientId?: unknown;
  audience?: unknown;
  origin?: unknown;
  redirectUri?: unknown;
  state?: unknown;
};

type SsoExchangeBody = SsoBody & {
  code?: unknown;
};

type AgentTokenCreateBody = {
  handle?: unknown;
  label?: unknown;
  clientId?: unknown;
  audience?: unknown;
  ttlDays?: unknown;
};

type AgentTokenExchangeBody = {
  token?: unknown;
  clientId?: unknown;
  audience?: unknown;
};

const staticFile = async (name: "index.html" | "auth.js") => {
  const fileUrl = new URL(`../public/${name}`, import.meta.url);
  return await Deno.readTextFile(fileUrl);
};

const responseUser = (user: UserRecord) => ({
  sub: user.id,
  handle: user.handle,
  email: user.email ?? "",
  displayName: user.displayName ?? user.handle,
  isAdmin: user.isAdmin,
  scopes: user.scopes,
  credentialCount: user.credentialIds.length
});

const tokenResponse = async (
  user: UserRecord,
  input: {
    audience: string;
    clientId: string;
    auth: "passkey" | "sso" | "agent-token";
    ttlMs?: number;
    agentTokenId?: string;
  }
) => {
  const signed = await signAccessToken(kv, { user, ...input });
  return jsonResponse({
    accessToken: signed.accessToken,
    tokenType: signed.tokenType,
    expiresAt: signed.expiresAt,
    claims: {
      sub: signed.claims.sub,
      handle: signed.claims.handle,
      isAdmin: signed.claims.isAdmin,
      scopes: signed.claims.scopes,
      aud: signed.claims.aud,
      clientId: signed.claims.clientId,
      auth: signed.claims.auth,
      exp: signed.claims.exp,
      iat: signed.claims.iat,
      agentTokenId: signed.claims.agentTokenId
    }
  });
};

const clientInput = (body: SsoBody, request: Request) => {
  const clientId = normalizeText(body.clientId, 120);
  const client = clientId ? findClient(clientId) : null;
  if (!client) {
    return { error: "invalid_client" as const };
  }

  const audience = normalizeText(body.audience, 160) || client.audiences[0];
  if (!clientAllowsAudience(client, audience)) {
    return { error: "invalid_audience" as const };
  }

  const origin = normalizeOrigin(body.origin) ||
    normalizeOrigin(request.headers.get("origin"));
  if (!origin || !clientAllowsOrigin(client, origin)) {
    return { error: "invalid_origin" as const };
  }

  const redirectUri = normalizeRedirectUri(body.redirectUri);
  if (redirectUri) {
    if (!clientAllowsRedirectUri(client, redirectUri)) {
      return { error: "invalid_redirect_uri" as const };
    }
    if (new URL(redirectUri).origin !== origin) {
      return { error: "redirect_origin_mismatch" as const };
    }
  }

  return {
    client,
    clientId: client.clientId,
    audience,
    origin,
    redirectUri,
    state: normalizeText(body.state, 240)
  };
};

const requireClaims = async (request: Request) => {
  const token = bearerToken(request);
  if (!token) return null;
  return await verifyAccessToken(kv, token);
};

const requireHubUser = async (request: Request) => {
  const claims = await requireClaims(request);
  if (!claims || claims.aud !== "auth-hub") return null;
  return await getUser(kv, claims.sub);
};

const optionalHubClaims = async (request: Request) => {
  const claims = await requireClaims(request);
  if (!claims || claims.aud !== "auth-hub") return null;
  return claims;
};

const parseClientDataChallenge = (encoded: string) => {
  const decoded = new TextDecoder().decode(base64UrlDecode(encoded));
  const parsed = JSON.parse(decoded) as { challenge?: unknown };
  return normalizeText(parsed.challenge, 500);
};

const handleRegisterStart = async (request: Request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await readJson<RegisterStartBody>(request);
  if (!body) return errorResponse("invalid_json", 400);

  const handle = normalizeHandle(body.handle);
  const email = normalizeEmail(body.email);
  const displayName = normalizeText(body.displayName, 120) || handle || email;
  if (!handle) return errorResponse("handle_required", 400);
  if (await getUserIdByHandle(kv, handle)) return errorResponse("handle_exists", 409);
  if (email && await getUserIdByEmail(kv, email)) {
    return errorResponse("email_exists", 409);
  }

  const hasUsers = await listHasUsers(kv);
  const existingClaims = await optionalHubClaims(request);
  const requestedAdmin = body.admin === true;
  const isAdmin = !hasUsers || (requestedAdmin && existingClaims?.isAdmin === true);
  const userId = crypto.randomUUID();
  const challenge = randomBase64Url(32);
  await saveChallenge(kv, {
    challenge,
    type: "registration",
    userId,
    handle,
    email,
    displayName,
    isAdmin
  });

  const userIdEncoded = base64UrlEncode(utf8(userId));
  return jsonResponse({
    publicKey: {
      rp: { id: authConfig.rpId, name: authConfig.rpName },
      user: {
        id: userIdEncoded,
        name: handle,
        displayName
      },
      challenge,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      timeout: authConfig.challengeTtlMs,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred"
      }
    },
    registrationExpiresAt: new Date(Date.now() + authConfig.challengeTtlMs)
      .toISOString(),
    bootstrapAdmin: isAdmin
  });
};

const handleRegisterFinish = async (request: Request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await readJson<RegisterFinishBody>(request);
  if (!body?.response?.response?.clientDataJSON) {
    return errorResponse("invalid_payload", 400);
  }

  const challenge = parseClientDataChallenge(body.response.response.clientDataJSON);
  if (!challenge) return errorResponse("invalid_payload", 400);
  const challengeRecord = await consumeChallenge(kv, challenge);
  if (!challengeRecord || challengeRecord.type !== "registration") {
    return errorResponse("invalid_challenge", 400);
  }
  if (!challengeRecord.userId || !challengeRecord.handle) {
    return errorResponse("invalid_challenge", 400);
  }
  if (await getUserIdByHandle(kv, challengeRecord.handle)) {
    return errorResponse("handle_exists", 409);
  }
  if (
    challengeRecord.email &&
    await getUserIdByEmail(kv, challengeRecord.email)
  ) {
    return errorResponse("email_exists", 409);
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: new URL(request.url).origin,
      expectedRPID: authConfig.rpId,
      requireUserVerification: false
    });
    if (!verification.verified || !verification.registrationInfo) {
      return errorResponse("invalid_attestation", 400);
    }

    const info = verification.registrationInfo;
    const credentialId = info.credential.id;
    const publicKey = base64UrlEncode(new Uint8Array(info.credential.publicKey));
    const user = await createUser(kv, {
      id: challengeRecord.userId,
      handle: challengeRecord.handle,
      email: challengeRecord.email,
      displayName: challengeRecord.displayName,
      credentialIds: [credentialId],
      isAdmin: challengeRecord.isAdmin === true
    });
    if (!user) return errorResponse("user_conflict", 409);

    const credential = await createCredential(kv, {
      credentialId,
      userId: user.id,
      publicKey,
      signCount: info.credential.counter,
      transports: info.credential.transports ?? []
    });
    if (!credential) return errorResponse("credential_conflict", 409);

    return await tokenResponse(user, {
      audience: "auth-hub",
      clientId: "auth-hub",
      auth: "passkey",
      ttlMs: authConfig.hubTokenTtlMs
    });
  } catch {
    return errorResponse("invalid_attestation", 400);
  }
};

const handleLoginStart = async (request: Request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await readJson<LoginStartBody>(request);
  if (!body) return errorResponse("invalid_json", 400);

  const handle = normalizeHandle(body.handle);
  const email = normalizeEmail(body.email);
  let user: UserRecord | null = null;
  if (handle) {
    const userId = await getUserIdByHandle(kv, handle);
    user = userId ? await getUser(kv, userId) : null;
  } else if (email) {
    const userId = await getUserIdByEmail(kv, email);
    user = userId ? await getUser(kv, userId) : null;
  }

  if ((handle || email) && !user) return errorResponse("not_found", 404);
  if (user && user.credentialIds.length === 0) {
    return errorResponse("no_credentials", 404);
  }

  const publicKey = await generateAuthenticationOptions({
    rpID: authConfig.rpId,
    timeout: authConfig.challengeTtlMs,
    allowCredentials: user
      ? user.credentialIds.map((id) => ({ id, type: "public-key" as const }))
      : undefined
  });

  await saveChallenge(kv, {
    challenge: publicKey.challenge,
    type: "authentication",
    userId: user?.id
  });
  return jsonResponse({ publicKey });
};

const handleLoginFinish = async (request: Request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await readJson<LoginFinishBody>(request);
  if (!body?.response?.response?.clientDataJSON) {
    return errorResponse("invalid_payload", 400);
  }

  const challenge = parseClientDataChallenge(body.response.response.clientDataJSON);
  if (!challenge) return errorResponse("invalid_payload", 400);
  const challengeRecord = await consumeChallenge(kv, challenge);
  if (!challengeRecord || challengeRecord.type !== "authentication") {
    return errorResponse("invalid_challenge", 400);
  }

  const credentialRecord = await getCredential(kv, body.response.id);
  if (!credentialRecord) return errorResponse("unknown_credential", 400);
  if (challengeRecord.userId && credentialRecord.userId !== challengeRecord.userId) {
    return errorResponse("credential_user_mismatch", 400);
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: new URL(request.url).origin,
      expectedRPID: authConfig.rpId,
      requireUserVerification: false,
      credential: {
        id: credentialRecord.credentialId,
        publicKey: base64UrlDecode(credentialRecord.publicKey),
        counter: credentialRecord.signCount,
        transports: credentialRecord.transports as AuthenticatorTransportFuture[]
      }
    });

    if (!verification.verified) return errorResponse("invalid_assertion", 400);
    await saveCredential(kv, {
      ...credentialRecord,
      signCount: verification.authenticationInfo.newCounter
    });
    const user = await getUser(kv, credentialRecord.userId);
    if (!user) return errorResponse("not_found", 404);
    return await tokenResponse(user, {
      audience: "auth-hub",
      clientId: "auth-hub",
      auth: "passkey",
      ttlMs: authConfig.hubTokenTtlMs
    });
  } catch {
    return errorResponse("invalid_assertion", 400);
  }
};

const handleSsoAuthorize = async (request: Request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const user = await requireHubUser(request);
  if (!user) return errorResponse("unauthorized", 401);
  const body = await readJson<SsoBody>(request);
  if (!body) return errorResponse("invalid_json", 400);
  const input = clientInput(body, request);
  if ("error" in input) return errorResponse(String(input.error), 400);

  const code = await createSsoCode(kv, {
    userId: user.id,
    clientId: input.clientId,
    audience: input.audience,
    origin: input.origin,
    redirectUri: input.redirectUri || undefined,
    state: input.state || undefined
  });
  return jsonResponse({
    code: code.code,
    expiresAt: code.expiresAt,
    state: code.state ?? "",
    redirectUri: code.redirectUri ?? ""
  });
};

const handleSsoExchange = async (request: Request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await readJson<SsoExchangeBody>(request);
  if (!body) return errorResponse("invalid_json", 400);
  const input = clientInput(body, request);
  if ("error" in input) return errorResponse(String(input.error), 400);

  const code = normalizeText(body.code, 500);
  if (!code) return errorResponse("code_required", 400);
  const record = await consumeSsoCode(kv, code);
  if (!record) return errorResponse("invalid_code", 400);
  if (
    record.clientId !== input.clientId ||
    record.audience !== input.audience ||
    record.origin !== input.origin ||
    (record.redirectUri ?? "") !== (input.redirectUri || "")
  ) {
    return errorResponse("invalid_code", 400);
  }

  const user = await getUser(kv, record.userId);
  if (!user) return errorResponse("not_found", 404);
  return await tokenResponse(user, {
    audience: record.audience,
    clientId: record.clientId,
    auth: "sso"
  });
};

const handleSessionMe = async (request: Request) => {
  if (request.method !== "GET") return methodNotAllowed();
  const claims = await requireClaims(request);
  if (!claims) return errorResponse("unauthorized", 401);
  const user = await getUser(kv, claims.sub);
  if (!user) return errorResponse("unauthorized", 401);
  return jsonResponse({
    authenticated: true,
    user: responseUser(user),
    claims: {
      sub: claims.sub,
      handle: claims.handle,
      isAdmin: claims.isAdmin,
      scopes: claims.scopes,
      aud: claims.aud,
      clientId: claims.clientId,
      auth: claims.auth,
      exp: claims.exp,
      iat: claims.iat,
      agentTokenId: claims.agentTokenId
    },
    expiresAt: new Date(claims.exp * 1000).toISOString()
  });
};

const agentClientInput = (
  body: AgentTokenCreateBody | AgentTokenExchangeBody,
  request: Request
) => {
  const clientId = normalizeText(body.clientId, 120) || "auth-hub";
  const audience = normalizeText(body.audience, 160) || clientId;
  if (clientId === "auth-hub" && audience === "auth-hub") {
    return { clientId, audience };
  }
  const client = findClient(clientId);
  if (!client) return { error: "invalid_client" as const };
  if (!clientAllowsAudience(client, audience)) {
    return { error: "invalid_audience" as const };
  }
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (origin && !clientAllowsOrigin(client, origin)) {
    return { error: "invalid_origin" as const };
  }
  return { clientId, audience };
};

const handleAgentTokens = async (request: Request) => {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/agent-tokens" && request.method === "GET") {
    const user = await requireHubUser(request);
    if (!user) return errorResponse("unauthorized", 401);
    const records = await listAgentTokens(kv, user.id);
    return jsonResponse({
      items: records.map((record) => ({
        id: record.id,
        label: record.label,
        clientId: record.clientId,
        audience: record.audience,
        scopes: record.scopes,
        isAdmin: record.isAdmin,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        lastUsedAt: record.lastUsedAt ?? ""
      }))
    });
  }

  if (path === "/api/auth/agent-tokens" && request.method === "POST") {
    const user = await requireHubUser(request);
    if (!user) return errorResponse("unauthorized", 401);
    const body = await readJson<AgentTokenCreateBody>(request);
    if (!body) return errorResponse("invalid_json", 400);
    const client = agentClientInput(body, request);
    if ("error" in client) return errorResponse(String(client.error), 400);
    let targetUser = user;
    const targetHandle = normalizeHandle(body.handle);
    if (targetHandle && targetHandle !== user.handle) {
      if (!user.isAdmin) return errorResponse("forbidden", 403);
      const targetUserId = await getUserIdByHandle(kv, targetHandle);
      const foundUser = targetUserId ? await getUser(kv, targetUserId) : null;
      if (!foundUser) return errorResponse("not_found", 404);
      targetUser = foundUser;
    }

    const ttlDays = Number(body.ttlDays ?? 7);
    const ttlMs = Number.isFinite(ttlDays)
      ? ttlDays * 24 * 60 * 60 * 1000
      : authConfig.agentTokenDefaultTtlMs;
    const created = await createAgentToken(kv, {
      user: targetUser,
      label: normalizeText(body.label, 120) || "LLM agent",
      clientId: client.clientId,
      audience: client.audience,
      ttlMs
    });
    if (!created) return errorResponse("token_conflict", 409);
    return jsonResponse({
      token: created.token,
      agentToken: {
        id: created.record.id,
        label: created.record.label,
        handle: created.record.handle,
        clientId: created.record.clientId,
        audience: created.record.audience,
        createdAt: created.record.createdAt,
        expiresAt: created.record.expiresAt
      }
    }, 201);
  }

  if (
    path.startsWith("/api/auth/agent-tokens/") &&
    request.method === "DELETE"
  ) {
    const user = await requireHubUser(request);
    if (!user) return errorResponse("unauthorized", 401);
    const id = path.slice("/api/auth/agent-tokens/".length);
    if (!id) return errorResponse("token_id_required", 400);
    const deleted = await deleteAgentToken(kv, user.id, id);
    if (!deleted) return errorResponse("not_found", 404);
    return new Response(null, { status: 204 });
  }

  return methodNotAllowed();
};

const handleAgentTokenExchange = async (request: Request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const body = await readJson<AgentTokenExchangeBody>(request);
  if (!body) return errorResponse("invalid_json", 400);
  const token = normalizeText(body.token, 500);
  if (!token) return errorResponse("token_required", 400);
  const client = agentClientInput(body, request);
  if ("error" in client) return errorResponse(String(client.error), 400);

  const record = await getAgentTokenBySecret(kv, token);
  if (!record) return errorResponse("unauthorized", 401);
  if (record.clientId !== client.clientId || record.audience !== client.audience) {
    return errorResponse("forbidden", 403);
  }
  const user = await getUser(kv, record.userId);
  if (!user) return errorResponse("unauthorized", 401);
  await touchAgentToken(kv, record);
  return await tokenResponse(user, {
    audience: record.audience,
    clientId: record.clientId,
    auth: "agent-token",
    agentTokenId: record.id
  });
};

const redirectAuthorizeRequest = async (request: Request) => {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const audience = url.searchParams.get("audience") ?? "";
  const origin = url.searchParams.get("origin") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const client = clientId ? findClient(clientId) : null;
  if (!client) return errorResponse("invalid_client", 400);
  if (audience && !clientAllowsAudience(client, audience)) {
    return errorResponse("invalid_audience", 400);
  }
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin || !clientAllowsOrigin(client, normalizedOrigin)) {
    return errorResponse("invalid_origin", 400);
  }
  if (redirectUri) {
    const normalizedRedirectUri = normalizeRedirectUri(redirectUri);
    if (
      !normalizedRedirectUri ||
      !clientAllowsRedirectUri(client, normalizedRedirectUri)
    ) {
      return errorResponse("invalid_redirect_uri", 400);
    }
  }
  const html = await staticFile("index.html");
  return htmlResponse(html.replace("%%AUTH_BOOTSTRAP%%", JSON.stringify({
    clientId,
    audience,
    origin: normalizedOrigin,
    redirectUri,
    state,
    issuer: authConfig.issuer,
    rpId: authConfig.rpId
  })));
};

const route = async (request: Request) => {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return optionsResponse(request);

  if (url.pathname === "/health" || url.pathname === "/api/health") {
    if (request.method !== "GET") return methodNotAllowed();
    return jsonResponse({
      status: "healthy",
      issuer: authConfig.issuer,
      rpId: authConfig.rpId,
      clients: authConfig.clients.map((client) => client.clientId)
    });
  }

  if (url.pathname === "/" || url.pathname === "/authorize") {
    if (request.method !== "GET") return methodNotAllowed();
    return await redirectAuthorizeRequest(request);
  }

  if (url.pathname === "/auth.js") {
    if (request.method !== "GET") return methodNotAllowed();
    return new Response(await staticFile("auth.js"), {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  if (url.pathname === "/api/auth/register/start") return await handleRegisterStart(request);
  if (url.pathname === "/api/auth/register/finish") return await handleRegisterFinish(request);
  if (url.pathname === "/api/auth/login/start") return await handleLoginStart(request);
  if (url.pathname === "/api/auth/login/finish") return await handleLoginFinish(request);
  if (url.pathname === "/api/auth/sso/authorize") return await handleSsoAuthorize(request);
  if (url.pathname === "/api/auth/sso/exchange") return await handleSsoExchange(request);
  if (url.pathname === "/api/auth/session/me") return await handleSessionMe(request);
  if (url.pathname === "/api/auth/jwks") {
    if (request.method !== "GET") return methodNotAllowed();
    return jsonResponse(await publicJwks(kv));
  }
  if (url.pathname === "/api/auth/agent-tokens/exchange") {
    return await handleAgentTokenExchange(request);
  }
  if (url.pathname.startsWith("/api/auth/agent-tokens")) {
    return await handleAgentTokens(request);
  }

  return textResponse("Not Found", 404);
};

export const handler = async (request: Request) => {
  try {
    const response = await route(request);
    return withCors(request, response);
  } catch (error) {
    console.error(error);
    return withCors(request, errorResponse("internal_error", 500));
  }
};
