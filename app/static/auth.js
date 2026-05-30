const params = new URLSearchParams(globalThis.location.search);
const AUTH_COMPLETE_MESSAGE = "techweek-auth-complete";
const initialMode = params.get("mode");
const state = {
  mode: initialMode === "register" ? "register" : initialMode === "token" ? "token" : "login",
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
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
els.login.addEventListener("submit", async (event) => {
  event.preventDefault();
  await signIn(new FormData(els.login));
});
els.register.addEventListener("submit", async (event) => {
  event.preventDefault();
  await register(new FormData(els.register));
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
  try {
    state.session = await requestJSON("/api/account/session");
    if (state.session?.session) state.session = state.session.session;
    if (state.session?.setupRequired) {
      setMode("register");
    } else {
      setMode(state.mode);
    }
    render();
  } catch (error) {
    showMessage(error.message || "Could not load auth state.", true);
  }
}

function setMode(mode) {
  state.mode = mode === "register" ? "register" : mode === "token" ? "token" : "login";
  render();
}

function render() {
  const registering = state.mode === "register";
  const tokenLogin = state.mode === "token";
  const setupRequired = state.session?.setupRequired === true;
  const registrationAllowed = setupRequired || state.session?.registrationAllowed === true;
  const admin = state.session?.authenticated === true && state.session?.user?.isAdmin === true;
  els.login.hidden = registering || tokenLogin;
  els.register.hidden = !registering;
  els.tokenLogin.hidden = !tokenLogin;
  els.adminAgentToken.hidden = !admin;
  els.title.textContent = registering
    ? "Register passkey"
    : tokenLogin
    ? "Token sign in"
    : "Passkey sign in";
  els.summary.textContent = registering
    ? setupRequired
      ? "Create the first admin passkey for this app."
      : "Register another passkey from an admin session."
    : tokenLogin
    ? "Use an admin-minted agent token for this browser."
    : "Use a saved passkey for this app.";
  els.modeButtons.forEach((button) => {
    button.disabled = state.busy || button.dataset.mode === state.mode ||
      (button.dataset.mode === "register" && !registrationAllowed);
  });
  Array.from(document.querySelectorAll("button, input, textarea")).forEach((control) => {
    if (control.matches("[data-mode]")) return;
    control.disabled = state.busy;
  });
  Array.from(els.register.querySelectorAll("button, input")).forEach((control) => {
    control.disabled = state.busy || !registrationAllowed;
  });
  Array.from(els.adminAgentToken.querySelectorAll("button, input, textarea")).forEach((control) => {
    control.disabled = state.busy || !admin;
  });
  const adminCheckbox = els.register.elements.admin;
  adminCheckbox.checked = setupRequired ? true : adminCheckbox.checked;
  adminCheckbox.disabled = state.busy || setupRequired || !registrationAllowed;
  els.agentTokenOutput.hidden = !state.agentToken;
  els.copyAgentToken.hidden = !state.agentToken;
  els.agentTokenTextarea.value = state.agentToken;
}

async function signIn(form) {
  if (!canUsePasskeyGet()) {
    showMessage(passkeyUnavailable("login"), true);
    return;
  }
  state.busy = true;
  render();
  showMessage("Waiting for passkey.");
  try {
    const handle = normalizeHandle(form.get("handle"));
    const start = await requestJSON("/api/auth/login/start", {
      method: "POST",
      body: JSON.stringify({
        handle,
        client_origin: globalThis.location.origin,
      }),
    });
    const credential = await navigator.credentials.get({
      publicKey: toRequestOptions(start.publicKey),
    });
    if (!credential) throw new Error("No passkey was returned.");
    const result = await requestJSON("/api/auth/login/finish", {
      method: "POST",
      body: JSON.stringify({
        response: serializeAuthenticationCredential(credential),
      }),
    });
    state.session = result.session || state.session;
    complete();
  } catch (error) {
    showMessage(error.message || "Passkey sign in failed.", true);
  } finally {
    state.busy = false;
    render();
  }
}

async function register(form) {
  if (!canUsePasskeyCreate()) {
    showMessage(passkeyUnavailable("register"), true);
    return;
  }
  state.busy = true;
  render();
  showMessage("Waiting for passkey.");
  try {
    const start = await requestJSON("/api/auth/register/start", {
      method: "POST",
      body: JSON.stringify({
        handle: normalizeHandle(form.get("handle")),
        admin: Boolean(form.get("admin")),
        client_origin: globalThis.location.origin,
      }),
    });
    const credential = await navigator.credentials.create({
      publicKey: toCreationOptions(start.publicKey),
    });
    if (!credential) throw new Error("No passkey was returned.");
    const result = await requestJSON("/api/auth/register/finish", {
      method: "POST",
      body: JSON.stringify({
        response: serializeRegistrationCredential(credential),
      }),
    });
    state.session = result.session || state.session;
    complete();
  } catch (error) {
    showMessage(error.message || "Passkey registration failed.", true);
  } finally {
    state.busy = false;
    render();
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
    complete();
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

function complete() {
  showMessage("Authenticated.");
  const embedOrigin = parseOrigin(params.get("embedOrigin"));
  const returnUrl = safeReturnUrl(params.get("returnUrl"), embedOrigin || globalThis.location.origin);
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

function canUsePasskeyGet() {
  return Boolean(globalThis.PublicKeyCredential && navigator.credentials?.get);
}

function canUsePasskeyCreate() {
  return Boolean(globalThis.PublicKeyCredential && navigator.credentials?.create);
}

function passkeyUnavailable(action) {
  if (!globalThis.isSecureContext) return "Passkeys require HTTPS or localhost.";
  return action === "register"
    ? "Passkey registration is not available."
    : "Passkey sign in is not available.";
}

function base64urlToBuffer(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toCreationOptions(publicKey) {
  const options = { ...publicKey };
  options.challenge = base64urlToBuffer(publicKey.challenge);
  options.user = {
    ...publicKey.user,
    id: base64urlToBuffer(publicKey.user.id),
  };
  if (Array.isArray(publicKey.excludeCredentials)) {
    options.excludeCredentials = publicKey.excludeCredentials.map((entry) => ({
      ...entry,
      id: base64urlToBuffer(entry.id),
    }));
  }
  return options;
}

function toRequestOptions(publicKey) {
  const options = { ...publicKey };
  options.challenge = base64urlToBuffer(publicKey.challenge);
  if (Array.isArray(publicKey.allowCredentials) && publicKey.allowCredentials.length > 0) {
    options.allowCredentials = publicKey.allowCredentials.map((entry) => ({
      ...entry,
      id: base64urlToBuffer(entry.id),
    }));
  } else {
    delete options.allowCredentials;
  }
  return options;
}

function serializeRegistrationCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

function serializeAuthenticationCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
    },
  };
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
