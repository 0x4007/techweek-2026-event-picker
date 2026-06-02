const bootstrap = window.__AUTH_BOOTSTRAP__ ?? {};
const form = document.querySelector("#auth-form");
const handleInput = document.querySelector("#handle");
const emailInput = document.querySelector("#email");
const continueButton = document.querySelector("#continue");
const registerButton = document.querySelector("#register");
const statusEl = document.querySelector("#status");
const codeResult = document.querySelector("#code-result");
const intro = document.querySelector("#intro");
const sessionPanel = document.querySelector("[data-session-panel]");
const sessionSummary = document.querySelector("[data-session-summary]");
const adminPanel = document.querySelector("[data-admin-panel]");
const adminSearch = document.querySelector("[data-admin-search]");
const adminQuery = document.querySelector("[data-admin-query]");
const adminUsers = document.querySelector("[data-admin-users]");
const adminEmpty = document.querySelector("[data-admin-empty]");
const hubTokenKey = "dua_hub_token";
const handleKey = "dua_last_handle";
const isAdminMode = bootstrap.adminMode === true;
const isAuthorizeFlow = Boolean(bootstrap.clientId && bootstrap.origin && !isAdminMode);
let currentUser = null;

if (isAdminMode) {
  document.body.dataset.page = "admin";
  intro.textContent = "Sign in with an auth hub admin passkey to configure users and roles.";
}

const setStatus = (message, state = "") => {
  statusEl.textContent = message;
  if (state) statusEl.dataset.state = state;
  else delete statusEl.dataset.state;
};

const setBusy = (busy) => {
  continueButton.disabled = busy;
  registerButton.disabled = busy;
  adminPanel.querySelectorAll("button, input").forEach((control) => {
    control.disabled = busy;
  });
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

const userFromSessionBody = (body) => {
  const user = body?.user ?? body?.claims ?? null;
  if (!user) return null;
  return {
    id: user.sub ?? user.id ?? "",
    handle: user.handle ?? "",
    email: user.email ?? "",
    displayName: user.displayName ?? user.handle ?? "",
    isAdmin: user.isAdmin === true,
    credentialCount: Number(user.credentialCount ?? 0) || 0
  };
};

const renderSession = () => {
  sessionPanel.hidden = !currentUser;
  adminPanel.hidden = !currentUser?.isAdmin;
  if (!currentUser) {
    sessionSummary.textContent = "";
    adminUsers.replaceChildren();
    adminEmpty.hidden = true;
    return;
  }
  sessionSummary.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = currentUser.handle;
  sessionSummary.append("Signed in as ", strong, currentUser.isAdmin ? " with admin access." : ".");
};

const refreshSession = async () => {
  const token = localStorage.getItem(hubTokenKey);
  if (!token) {
    currentUser = null;
    renderSession();
    return false;
  }
  const result = await requestJson("/api/auth/session/me", {
    headers: authHeaders()
  });
  if (result.response.ok) {
    currentUser = userFromSessionBody(result.body);
    renderSession();
    return Boolean(currentUser);
  }
  localStorage.removeItem(hubTokenKey);
  currentUser = null;
  renderSession();
  return false;
};

const renderAdminUsers = (items) => {
  adminUsers.replaceChildren();
  adminEmpty.hidden = items.length > 0;
  for (const user of items) {
    const row = document.createElement("article");
    row.dataset.adminUser = user.handle;

    const summary = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = user.handle;
    const detail = document.createElement("small");
    detail.textContent = [
      user.displayName || "",
      user.email || "",
      `${Number(user.credentialCount || 0)} passkey${
        Number(user.credentialCount || 0) === 1 ? "" : "s"
      }`
    ].filter(Boolean).join(" · ");
    summary.append(title, detail);

    const role = document.createElement("span");
    role.dataset.adminRole = user.isAdmin ? "admin" : "user";
    role.textContent = user.isAdmin ? "Admin" : "User";

    const action = document.createElement("button");
    action.type = "button";
    action.textContent = user.isAdmin ? "Remove admin" : "Make admin";
    action.dataset.variant = user.isAdmin ? "danger" : "secondary";
    action.disabled = user.handle === currentUser?.handle && user.isAdmin;
    action.addEventListener("click", () => {
      void setUserAdmin(user.handle, !user.isAdmin);
    });

    row.append(summary, role, action);
    adminUsers.append(row);
  }
};

const loadAdminUsers = async () => {
  if (!currentUser?.isAdmin) return;
  const query = adminQuery.value.trim();
  setStatus("Loading users...");
  const result = await requestJson(
    `/api/auth/admin/users?${new URLSearchParams({ query })}`,
    { headers: authHeaders() }
  );
  if (!result.response.ok) {
    setStatus(result.body?.error ?? "Could not load users.", "error");
    return;
  }
  renderAdminUsers(Array.isArray(result.body?.items) ? result.body.items : []);
  setStatus("Admin configuration ready.");
};

const setUserAdmin = async (handle, isAdmin) => {
  setBusy(true);
  setStatus(isAdmin ? `Promoting ${handle}...` : `Removing admin from ${handle}...`);
  try {
    const result = await requestJson(`/api/auth/admin/users/${encodeURIComponent(handle)}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({ isAdmin })
    });
    if (!result.response.ok) {
      setStatus(result.body?.error ?? "Could not update user.", "error");
      return;
    }
    await loadAdminUsers();
    setStatus(isAdmin ? `${handle} is now an admin.` : `${handle} is no longer an admin.`);
  } finally {
    setBusy(false);
  }
};

const afterAuthenticated = async () => {
  await refreshSession();
  if (isAuthorizeFlow) {
    setStatus("Signed in. Authorizing app...");
    await authorizeApp();
    return;
  }
  if (currentUser?.isAdmin) {
    await loadAdminUsers();
  } else {
    setStatus("Signed in. Admin access is required for configuration.", "error");
  }
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
    await afterAuthenticated();
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
    await afterAuthenticated();
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

adminSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadAdminUsers();
});

const cachedHandle = localStorage.getItem(handleKey);
if (cachedHandle) handleInput.value = cachedHandle;

if (isAuthorizeFlow && await refreshSession()) {
  setStatus("Signed in. Authorizing app...");
  await authorizeApp();
} else if (isAuthorizeFlow) {
  setStatus(`Authorizing ${bootstrap.clientId} with RP ID ${bootstrap.rpId}.`);
} else if (await refreshSession()) {
  if (currentUser?.isAdmin) {
    await loadAdminUsers();
  } else {
    setStatus("Signed in. Admin access is required for configuration.", "error");
  }
} else {
  setStatus("Sign in with an auth hub admin passkey to configure users.");
}
