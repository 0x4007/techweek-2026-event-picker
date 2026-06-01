const params = new URLSearchParams(globalThis.location.search);
const AUTH_COMPLETE_MESSAGE = "techweek-auth-complete";
const AUTH_HUB_ORIGIN = "https://deno-universal-auth.0x4007.deno.net";
const AUTH_HUB_CLIENT_ID = "techweek-2026-event-picker";
const AUTH_HUB_AUDIENCE = "techweek-2026-event-picker";
const AUTH_STATE_PREFIX = "techweek_auth_state:";
const initialMode = params.get("mode") === "token" ? "token" : "login";
const state = {
  mode: initialMode,
  session: null,
  busy: false,
  agentToken: "",
};

const els = {
  title: document.querySelector("[data-title]"),
  summary: document.querySelector("[data-summary]"),
  login: document.querySelector("[data-login]"),
  register: document.querySelector("[data-register]"),
  tokenLogin: document.querySelector("[data-token-login]"),
  adminAgentToken: document.querySelector("[data-admin-agent-token]"),
  agentTokenCreate: document.querySelector("[data-agent-token-create]"),
  agentTokenOutput: document.querySelector("[data-agent-token-output]"),
  agentTokenTextarea: document.querySelector("[data-agent-token-output] textarea"),
  copyAgentToken: document.querySelector("[data-copy-agent-token]"),
  message: document.querySelector("[data-message]"),
  modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
};

els.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.mode === "token") {
      setMode("token");
      return;
    }
    redirectToAuthHub();
  });
});

els.login.addEventListener("submit", (event) => {
  event.preventDefault();
  redirectToAuthHub();
});

els.register.addEventListener("submit", (event) => {
  event.preventDefault();
  redirectToAuthHub();
});

els.tokenLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  await tokenSignIn(new FormData(els.tokenLogin));
});

els.agentTokenCreate.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createAgentToken(new FormData(els.agentTokenCreate));
});

els.copyAgentToken.addEventListener("click", async () => {
  if (!state.agentToken) return;
  await navigator.clipboard?.writeText(state.agentToken);
  showMessage("Token copied.");
});

boot();

async function boot() {
  if (params.get("code")) {
    await completeAuthHubCallback();
    return;
  }
  if (state.mode === "token") {
    await bootTokenMode();
    return;
  }
  redirectToAuthHub();
}

async function bootTokenMode() {
  try {
    state.session = await requestJSON("/api/account/session");
    if (state.session?.session) state.session = state.session.session;
  } catch {
    state.session = null;
  }
  setMode("token");
  render();
}

function setMode(mode) {
  state.mode = mode === "token" ? "token" : "login";
  render();
}

function render() {
  const tokenLogin = state.mode === "token";
  const admin = state.session?.authenticated === true && state.session?.user?.isAdmin === true;
  els.login.hidden = tokenLogin;
  els.register.hidden = true;
  els.tokenLogin.hidden = !tokenLogin;
  els.adminAgentToken.hidden = !admin;
  els.title.textContent = tokenLogin ? "Agent token sign in" : "Redirecting to auth hub";
  els.summary.textContent = tokenLogin
    ? "Use or mint an auth-hub agent token for this browser."
    : "Passkey identity now lives in the shared auth hub.";
  els.modeButtons.forEach((button) => {
    button.disabled = state.busy || button.dataset.mode === state.mode;
  });
  Array.from(document.querySelectorAll("button, input, textarea")).forEach((control) => {
    if (control.matches("[data-mode]")) return;
    control.disabled = state.busy;
  });
  Array.from(els.adminAgentToken.querySelectorAll("button, input, textarea")).forEach((control) => {
    control.disabled = state.busy || !admin;
  });
  els.agentTokenOutput.hidden = !state.agentToken;
  els.copyAgentToken.hidden = !state.agentToken;
  els.agentTokenTextarea.value = state.agentToken;
}

function redirectToAuthHub() {
  const authState = crypto.randomUUID();
  const embedOrigin = parseOrigin(params.get("embedOrigin"));
  const returnUrl = safeReturnUrl(
    params.get("returnUrl"),
    embedOrigin || globalThis.location.origin,
  );
  sessionStorage.setItem(
    AUTH_STATE_PREFIX + authState,
    JSON.stringify({
      embedOrigin,
      returnUrl: returnUrl ? returnUrl.toString() : "",
    }),
  );

  const redirectUri = new URL("/auth.html", globalThis.location.origin);
  const url = new URL("/authorize", AUTH_HUB_ORIGIN);
  url.searchParams.set("client_id", AUTH_HUB_CLIENT_ID);
  url.searchParams.set("audience", AUTH_HUB_AUDIENCE);
  url.searchParams.set("origin", globalThis.location.origin);
  url.searchParams.set("redirect_uri", redirectUri.toString());
  url.searchParams.set("state", authState);
  showMessage("Opening shared passkey authority.");
  globalThis.location.replace(url.toString());
}

async function completeAuthHubCallback() {
  state.busy = true;
  render();
  showMessage("Completing sign in.");
  const authState = params.get("state") || "";
  const saved = readSavedState(authState);
  try {
    const result = await requestJSON("/api/auth/sso/exchange", {
      method: "POST",
      body: JSON.stringify({ code: params.get("code") || "" }),
    });
    state.session = result.session || null;
    complete(saved.returnUrl, saved.embedOrigin);
  } catch (error) {
    showMessage(error.message || "Could not complete auth-hub sign in.", true);
  } finally {
    if (authState) sessionStorage.removeItem(AUTH_STATE_PREFIX + authState);
    state.busy = false;
    render();
  }
}

function readSavedState(authState) {
  if (!authState) return { returnUrl: null, embedOrigin: "" };
  try {
    const raw = JSON.parse(sessionStorage.getItem(AUTH_STATE_PREFIX + authState) || "{}");
    const embedOrigin = parseOrigin(raw.embedOrigin);
    const returnUrl = safeReturnUrl(raw.returnUrl, embedOrigin || globalThis.location.origin);
    return { embedOrigin, returnUrl };
  } catch {
    return { returnUrl: null, embedOrigin: "" };
  }
}

async function tokenSignIn(form) {
  state.busy = true;
  render();
  showMessage("Signing in.");
  try {
    const result = await requestJSON("/api/auth/agent-token/login", {
      method: "POST",
      body: JSON.stringify({
        token: String(form.get("token") || "").trim(),
      }),
    });
    state.session = result.session || state.session;
    complete(null, parseOrigin(params.get("embedOrigin")));
  } catch (error) {
    showMessage(error.message || "Token sign in failed.", true);
  } finally {
    state.busy = false;
    render();
  }
}

async function createAgentToken(form) {
  state.busy = true;
  state.agentToken = "";
  render();
  showMessage("Creating token.");
  try {
    const handle = normalizeHandle(form.get("handle"));
    const ttlDays = Number(form.get("ttlDays") || 7);
    const body = { ttlDays };
    if (handle) body.handle = handle;
    const result = await requestJSON("/api/account/agent-tokens", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.agentToken = result.token || "";
    showMessage("Token created.");
  } catch (error) {
    showMessage(error.message || "Could not create token.", true);
  } finally {
    state.busy = false;
    render();
  }
}

function complete(returnUrl, embedOrigin) {
  showMessage("Authenticated.");
  const payload = { type: AUTH_COMPLETE_MESSAGE };
  if (returnUrl) payload.returnUrl = returnUrl.toString();
  if (globalThis.opener && embedOrigin) {
    globalThis.opener.postMessage(payload, embedOrigin);
    globalThis.setTimeout(() => {
      if (!returnUrl) {
        globalThis.close();
        return;
      }
      try {
        if (!globalThis.opener?.closed) {
          globalThis.opener.location.assign(returnUrl.toString());
        }
      } catch {
        // Ignore opener navigation failures.
      } finally {
        globalThis.close();
      }
    }, 250);
    return;
  }
  if (returnUrl) {
    globalThis.location.assign(returnUrl.toString());
    return;
  }
  globalThis.location.assign(`${globalThis.location.origin}/`);
}

async function requestJSON(path, init = {}) {
  const headers = {
    Accept: "application/json",
    ...(init.headers || {}),
  };
  if (init.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(errorMessage(body) || response.statusText || "Request failed.");
  }
  return body;
}

function showMessage(message, error = false) {
  els.message.textContent = message || "";
  els.message.dataset.message = error ? "error" : "";
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 96);
}

function parseOrigin(value) {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

function errorMessage(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body.error && typeof body.error.message === "string") return body.error.message;
  if (typeof body.error === "string") return body.error;
  if (typeof body.message === "string") return body.message;
  return "";
}

function safeReturnUrl(value, expectedOrigin) {
  const target = parseRedirectUrl(value);
  if (!target) return null;
  if (target.origin !== expectedOrigin) return null;
  if (!/^https?:$/.test(target.protocol)) return null;
  return target;
}

function parseRedirectUrl(value) {
  try {
    return value ? new URL(value, globalThis.location.href) : null;
  } catch {
    return null;
  }
}
