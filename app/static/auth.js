const params = new URLSearchParams(globalThis.location.search);
const AUTH_COMPLETE_MESSAGE = "planner-auth-complete";
const LEGACY_AUTH_COMPLETE_MESSAGE = "techweek-auth-complete";
const state = {
  session: null,
  busy: false,
};

const els = {
  title: document.querySelector("[data-title]"),
  summary: document.querySelector("[data-summary]"),
  auth: document.querySelector("[data-auth]"),
  handle: document.querySelector("[name='handle']"),
  admin: document.querySelector("[name='admin']"),
  adminField: document.querySelector("[data-admin-field]"),
  submit: document.querySelector("[data-submit]"),
  message: document.querySelector("[data-message]"),
};

els.auth.addEventListener("submit", async (event) => {
  event.preventDefault();
  await continueWithPasskey(new FormData(els.auth));
});

boot();

async function boot() {
  try {
    const result = await requestJSON("/api/account/session");
    state.session = result?.session ?? result;
    render();
  } catch (error) {
    showMessage(error.message || "Could not load auth state.", true);
  }
}

function render() {
  const authenticated = state.session?.authenticated === true;
  const setupRequired = state.session?.setupRequired === true;
  const registrationAllowed = setupRequired || state.session?.registrationAllowed === true;
  els.title.textContent = authenticated ? "Signed in" : "Continue with passkey";
  els.summary.textContent = authenticated
    ? `Signed in as ${state.session.user?.handle || "this account"}.`
    : setupRequired
    ? "Create the first passkey for this app."
    : registrationAllowed
    ? "Use an existing passkey or create another one."
    : "Use a saved passkey for this app.";
  els.handle.required = setupRequired;
  els.handle.placeholder = setupRequired ? "Username" : "Optional";
  els.adminField.hidden = !setupRequired;
  els.admin.checked = setupRequired;
  els.submit.textContent = state.busy ? "Waiting..." : "Continue";
  Array.from(document.querySelectorAll("button, input")).forEach((control) => {
    control.disabled = state.busy || (!authenticated && setupRequired && !registrationAllowed);
  });
}

async function continueWithPasskey(form) {
  if (state.session?.authenticated) {
    complete();
    return;
  }
  const setupRequired = state.session?.setupRequired === true;
  const registrationAllowed = setupRequired || state.session?.registrationAllowed === true;
  const handle = normalizeHandle(form.get("handle"));
  if (setupRequired && !handle) {
    showMessage("Username is required for the first passkey.", true);
    return;
  }
  if (setupRequired && !canUsePasskeyCreate()) {
    showMessage(passkeyUnavailable("register"), true);
    return;
  }
  if (!setupRequired && !canUsePasskeyGet()) {
    showMessage(passkeyUnavailable("login"), true);
    return;
  }
  state.busy = true;
  render();
  showMessage("Waiting for passkey.");
  try {
    if (setupRequired) {
      state.session = (await registerPasskey(handle, true)).session ?? state.session;
      complete();
      return;
    }

    try {
      state.session = (await signInPasskey(handle)).session ?? state.session;
      complete();
      return;
    } catch (loginError) {
      if (handle && shouldTryDiscoverableLogin(loginError)) {
        try {
          state.session = (await signInPasskey("")).session ?? state.session;
          complete();
          return;
        } catch {
          if (!registrationAllowed) throw loginError;
        }
      }
      if (!registrationAllowed || !handle || !shouldTryRegistration(loginError)) {
        throw loginError;
      }
      showMessage("No existing passkey found. Creating one.");
      state.session = (await registerPasskey(handle, false)).session ?? state.session;
      complete();
    }
  } catch (error) {
    showMessage(friendlyAuthError(error), true);
  } finally {
    state.busy = false;
    render();
  }
}

async function signInPasskey(handle) {
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
  return await requestJSON("/api/auth/login/finish", {
    method: "POST",
    body: JSON.stringify({
      response: serializeAuthenticationCredential(credential),
    }),
  });
}

async function registerPasskey(handle, admin) {
  if (!canUsePasskeyCreate()) {
    throw new Error(passkeyUnavailable("register"));
  }
  const start = await requestJSON("/api/auth/register/start", {
    method: "POST",
    body: JSON.stringify({
      handle,
      admin,
      client_origin: globalThis.location.origin,
    }),
  });
  const credential = await navigator.credentials.create({
    publicKey: toCreationOptions(start.publicKey),
  });
  if (!credential) throw new Error("No passkey was returned.");
  return await requestJSON("/api/auth/register/finish", {
    method: "POST",
    body: JSON.stringify({
      response: serializeRegistrationCredential(credential),
    }),
  });
}

function shouldTryDiscoverableLogin(error) {
  return authErrorStatus(error) === 404 || authErrorMessage(error).includes("not found");
}

function shouldTryRegistration(error) {
  if (error?.name === "NotAllowedError") return false;
  const message = authErrorMessage(error);
  return authErrorStatus(error) === 404 || message.includes("not found");
}

function friendlyAuthError(error) {
  if (error?.name === "NotAllowedError") return "No passkey was selected.";
  if (authErrorStatus(error) === 404 || authErrorMessage(error).includes("not found")) {
    return "No passkey account was found for that username.";
  }
  return error?.message || "Passkey authentication failed.";
}

function authErrorStatus(error) {
  return Number.isFinite(error?.status) ? Number(error.status) : 0;
}

function authErrorMessage(error) {
  return String(error?.message || "").toLowerCase();
}

function complete() {
  showMessage("Authenticated.");
  const embedOrigin = parseOrigin(params.get("embedOrigin"));
  if (globalThis.opener && embedOrigin) {
    globalThis.opener.postMessage({ type: AUTH_COMPLETE_MESSAGE }, embedOrigin);
    globalThis.opener.postMessage({ type: LEGACY_AUTH_COMPLETE_MESSAGE }, embedOrigin);
    globalThis.setTimeout(() => globalThis.close(), 250);
    return;
  }
  const returnUrl = params.get("returnUrl");
  if (returnUrl) globalThis.location.href = returnUrl;
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
    const error = new Error(errorMessage(body) || response.statusText || "Request failed.");
    error.status = response.status;
    throw error;
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
