const bootstrap = window.__AUTH_BOOTSTRAP__ ?? {};
const form = document.querySelector("#auth-form");
const handleInput = document.querySelector("#handle");
const emailInput = document.querySelector("#email");
const continueButton = document.querySelector("#continue");
const registerButton = document.querySelector("#register");
const statusEl = document.querySelector("#status");
const codeResult = document.querySelector("#code-result");
const hubTokenKey = "dua_hub_token";
const handleKey = "dua_last_handle";

const setStatus = (message, state = "") => {
  statusEl.textContent = message;
  if (state) statusEl.dataset.state = state;
  else delete statusEl.dataset.state;
};

const setBusy = (busy) => {
  continueButton.disabled = busy;
  registerButton.disabled = busy;
};

const b64urlToBuf = (b64url) => {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

const bufToB64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const requestJson = async (path, init = {}) => {
  const response = await fetch(path, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
};

const authHeaders = () => {
  const token = localStorage.getItem(hubTokenKey);
  return token ? { authorization: `Bearer ${token}` } : {};
};

const toCreationOptions = (publicKey) => {
  const options = { ...publicKey };
  options.challenge = b64urlToBuf(publicKey.challenge);
  options.user = { ...publicKey.user, id: b64urlToBuf(publicKey.user.id) };
  if (Array.isArray(publicKey.excludeCredentials)) {
    options.excludeCredentials = publicKey.excludeCredentials.map((entry) => ({
      ...entry,
      id: b64urlToBuf(entry.id)
    }));
  }
  return options;
};

const toRequestOptions = (publicKey) => {
  const options = { ...publicKey };
  options.challenge = b64urlToBuf(publicKey.challenge);
  if (Array.isArray(publicKey.allowCredentials) && publicKey.allowCredentials.length > 0) {
    options.allowCredentials = publicKey.allowCredentials.map((entry) => ({
      ...entry,
      id: b64urlToBuf(entry.id)
    }));
  } else {
    delete options.allowCredentials;
  }
  return options;
};

const finishLogin = async (credential) => {
  const response = credential.response;
  return await requestJson("/api/auth/login/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      response: {
        id: credential.id,
        rawId: bufToB64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufToB64url(response.clientDataJSON),
          authenticatorData: bufToB64url(response.authenticatorData),
          signature: bufToB64url(response.signature),
          userHandle: response.userHandle ? bufToB64url(response.userHandle) : undefined
        }
      }
    })
  });
};

const finishRegister = async (credential) => {
  const response = credential.response;
  return await requestJson("/api/auth/register/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      response: {
        id: credential.id,
        rawId: bufToB64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufToB64url(response.clientDataJSON),
          attestationObject: bufToB64url(response.attestationObject),
          transports: typeof response.getTransports === "function"
            ? response.getTransports()
            : []
        }
      }
    })
  });
};

const ensureExistingHubSession = async () => {
  const token = localStorage.getItem(hubTokenKey);
  if (!token) return false;
  const result = await requestJson("/api/auth/session/me", {
    headers: authHeaders()
  });
  if (result.response.ok) return true;
  localStorage.removeItem(hubTokenKey);
  return false;
};

const authorizeApp = async () => {
  const result = await requestJson("/api/auth/sso/authorize", {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      clientId: bootstrap.clientId,
      audience: bootstrap.audience,
      origin: bootstrap.origin,
      redirectUri: bootstrap.redirectUri,
      state: bootstrap.state
    })
  });

  if (!result.response.ok || !result.body?.code) {
    setStatus(result.body?.error ?? "Unable to authorize app.", "error");
    return;
  }

  const params = new URLSearchParams();
  params.set("code", result.body.code);
  if (result.body.state) params.set("state", result.body.state);

  if (result.body.redirectUri) {
    const url = new URL(result.body.redirectUri);
    for (const [key, value] of params) url.searchParams.set(key, value);
    window.location.replace(url.toString());
    return;
  }

  if (window.opener && bootstrap.origin) {
    window.opener.postMessage({
      type: "deno-universal-auth:sso",
      code: result.body.code,
      state: result.body.state ?? "",
      issuer: window.location.origin
    }, bootstrap.origin);
    window.close();
  }

  codeResult.hidden = false;
  codeResult.innerHTML = `Authorization code: <code>${result.body.code}</code>`;
  setStatus("Return this code to the app.");
};

const login = async () => {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    setStatus("Passkeys require a secure browser context.", "error");
    return;
  }
  const handle = handleInput.value.trim();
  if (!handle) {
    setStatus("Enter your handle.", "error");
    handleInput.focus();
    return;
  }
  localStorage.setItem(handleKey, handle);
  setBusy(true);
  setStatus("Starting passkey sign in...");
  try {
    const start = await requestJson("/api/auth/login/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle })
    });
    if (!start.response.ok || !start.body?.publicKey) {
      setStatus(start.body?.error ?? "Unable to start sign in.", "error");
      return;
    }
    const credential = await navigator.credentials.get({
      publicKey: toRequestOptions(start.body.publicKey)
    });
    if (!credential) {
      setStatus("No passkey returned.", "error");
      return;
    }
    const finish = await finishLogin(credential);
    if (!finish.response.ok || !finish.body?.accessToken) {
      setStatus(finish.body?.error ?? "Sign in failed.", "error");
      return;
    }
    localStorage.setItem(hubTokenKey, finish.body.accessToken);
    setStatus("Signed in. Authorizing app...");
    await authorizeApp();
  } catch (error) {
    setStatus(error?.message ?? "Sign in cancelled.", "error");
  } finally {
    setBusy(false);
  }
};

const register = async () => {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    setStatus("Passkeys require a secure browser context.", "error");
    return;
  }
  const handle = handleInput.value.trim();
  const email = emailInput.value.trim();
  if (!handle) {
    setStatus("Enter a handle.", "error");
    handleInput.focus();
    return;
  }
  localStorage.setItem(handleKey, handle);
  setBusy(true);
  setStatus("Creating passkey...");
  try {
    const start = await requestJson("/api/auth/register/start", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({ handle, email })
    });
    if (!start.response.ok || !start.body?.publicKey) {
      setStatus(start.body?.error ?? "Unable to start registration.", "error");
      return;
    }
    const credential = await navigator.credentials.create({
      publicKey: toCreationOptions(start.body.publicKey)
    });
    if (!credential) {
      setStatus("No passkey returned.", "error");
      return;
    }
    const finish = await finishRegister(credential);
    if (!finish.response.ok || !finish.body?.accessToken) {
      setStatus(finish.body?.error ?? "Registration failed.", "error");
      return;
    }
    localStorage.setItem(hubTokenKey, finish.body.accessToken);
    setStatus("Registered. Authorizing app...");
    await authorizeApp();
  } catch (error) {
    setStatus(error?.message ?? "Registration cancelled.", "error");
  } finally {
    setBusy(false);
  }
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void login();
});

registerButton.addEventListener("click", () => {
  void register();
});

const cachedHandle = localStorage.getItem(handleKey);
if (cachedHandle) handleInput.value = cachedHandle;

if (!bootstrap.clientId || !bootstrap.origin) {
  setStatus("Open this page from a registered app.", "error");
} else if (await ensureExistingHubSession()) {
  setStatus("Signed in. Authorizing app...");
  await authorizeApp();
} else {
  setStatus(`Authorizing ${bootstrap.clientId} with RP ID ${bootstrap.rpId}.`);
}
