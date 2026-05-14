const CHAT_STORAGE_KEY = "techweek-chat";
const CHAT_HISTORY_KEY = "techweek-chat-history";
const ACTIVE_CHAT_KEY = "techweek-chat-active-id";
const MODEL_CONTEXT_CACHE_KEY = "techweek-model-context";
const CHAT_MESSAGE_LIMIT = 24;
const CHAT_SESSION_LIMIT = 18;
const MODEL_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const EVENT_CHAT_CONTEXT_VERSION = 1;
const CARD_DB_NAME = "techweek-card-images";
const CARD_DB_VERSION = 1;
const CARD_STORE = "cards";
const CARD_IMAGE_LIMIT = 30;
const OCR_IMAGE_TARGET_CHARS = 1_800_000;
const OCR_MAX_REQUEST_ATTEMPTS = 3;
const OCR_REQUEST_TIMEOUT_MS = 45_000;
const OCR_ANALYSIS_LONGEST_EDGE = 900;
const OCR_IMAGE_ATTEMPTS = [
  { longestEdge: 1800, quality: 0.88, ocrSource: "canvas_auto_edge_crop" },
  { longestEdge: 1400, quality: 0.84, ocrSource: "canvas_auto_edge_crop" },
  { longestEdge: 1500, quality: 0.82, ocrSource: "canvas_full_frame_fallback" },
];
const OCR_ROTATION_CANDIDATES = [0, 270, 90, 180];
const LEAD_EVENT_REFRESH_MS = 60_000;
const PARTIFUL_AUTO_SYNC_OPEN_DELAY_MS = 1_500;
const PARTIFUL_AUTO_SYNC_STATUS_POLL_MS = 20_000;
const PARTIFUL_AUTO_SYNC_MAX_POLLS = 8;
const PARTIFUL_FAST_SYNC_TIMEOUT_MS = 60_000;
const LIVE_ROUTE_REFRESH_TIMEOUT_MS = 150_000;
const DEV_AGENT_SELECTED_THREAD_KEY = "techweek-dev-agent-selected-thread";
const DEV_AGENT_LAST_EVENT_KEY_PREFIX = "techweek-dev-agent-last-event:";
const DEV_AGENT_EVENT_TYPES = [
  "user.message",
  "agent.message",
  "progress.message",
  "phase.changed",
  "error",
  "result",
  "codex.session",
  "command.started",
  "command.finished",
  "files.changed",
  "git.branch.created",
  "git.integration.started",
  "git.integration.finished",
  "deploy.started",
  "deploy.finished",
  "raw.codex.event",
];
const DEV_AGENT_VISIBLE_TYPES = new Set([
  "user.message",
  "agent.message",
  "progress.message",
  "error",
  "result",
]);
const DEV_AGENT_VISIBLE_PHASES = new Set([
  "failed",
  "needs attention",
  "queued",
  "finalizing",
  "deploying",
  "succeeded",
  "cancelled",
  "canceled",
]);

const state = {
  payload: null,
  activeView: "route",
  activeDay: "",
  entriesByBlock: new Map(),
  messages: readJsonStorage(CHAT_STORAGE_KEY, []),
  sessions: readJsonStorage(CHAT_HISTORY_KEY, []),
  activeSessionId: localStorage.getItem(ACTIVE_CHAT_KEY) || createSessionId(),
  activeSessionMeta: null,
  modelContext: readCachedModelContext(),
  historyOpen: false,
  agentBusy: false,
  agendaBusy: false,
  partifulSyncBusy: false,
  liveRouteRefreshBusy: false,
  partifulAutoSyncRequestBusy: false,
  partifulAutoSyncRequestTimer: 0,
  partifulAutoSyncPollTimer: 0,
  leadEventManuallySelected: false,
  followUpEmailTouched: false,
};

const viewButtons = document.querySelectorAll("[data-view-button]");
const panels = document.querySelectorAll("[data-panel]");
const dayTabs = document.querySelector("[data-day-tabs]");
const routeList = document.querySelector("[data-route-list]");
const referenceList = document.querySelector("[data-reference-list]");
const chatLog = document.querySelector("[data-chat-log]");
const chatForm = document.querySelector("[data-chat-form]");
const promptButtons = document.querySelectorAll("[data-ask]");
const chatDrawer = document.querySelector("[data-agent-drawer]");
const chatBackdrop = document.querySelector("[data-agent-backdrop]");
const chatOpenButtons = document.querySelectorAll("[data-chat-open]");
const chatCloseButton = document.querySelector("[data-chat-close]");
const chatNewButton = document.querySelector("[data-chat-new]");
const chatHistory = document.querySelector("[data-chat-history]");
const chatHistoryToggle = document.querySelector("[data-chat-history-toggle]");
const devChatOpenButton = document.querySelector("[data-dev-chat-open]");
const devChatDrawer = document.querySelector("[data-dev-agent-drawer]");
const devChatBackdrop = document.querySelector("[data-dev-agent-backdrop]");
const devChatCloseButton = document.querySelector("[data-dev-chat-close]");
const devChatNewButton = document.querySelector("[data-dev-chat-new]");
const devChatBackButton = document.querySelector("[data-dev-chat-back]");
const devChatLog = document.querySelector("[data-dev-chat-log]");
const devChatForm = document.querySelector("[data-dev-chat-form]");
const devChatTitle = document.querySelector("[data-dev-chat-title]");
const devChatSubtitle = document.querySelector("[data-dev-chat-subtitle]");
const devDeployControl = document.querySelector("[data-dev-deploy-control]");
const devDeployCheckbox = document.querySelector("[data-dev-deploy]");
const devComposerError = document.querySelector("[data-dev-composer-error]");
const eventModal = document.querySelector("[data-event-modal]");
const eventBackdrop = document.querySelector("[data-event-backdrop]");
const eventCloseButton = document.querySelector("[data-event-close]");
const pageTitle = document.querySelector("[data-page-title]");
const leadForm = document.querySelector("[data-lead-form]");
const leadEventSelect = document.querySelector("[data-lead-event]");
const leadsList = document.querySelector("[data-leads-list]");
const crmEventTitle = document.querySelector("[data-crm-event-title]");
const leadError = document.querySelector("[data-lead-error]");
const cardInput = document.querySelector("[data-card-input]");
const cardScanButton = document.querySelector("[data-card-scan-button]");
const cardScanStatus = document.querySelector("[data-card-scan-status]");
const cardPreview = document.querySelector("[data-card-preview]");
const followUpEmailStatus = document.querySelector("[data-follow-up-email-status]");
const agendaRecalculateButton = document.querySelector("[data-agenda-recalculate]");
const partifulSyncButton = document.querySelector("[data-partiful-sync]");
const agendaStatus = document.querySelector("[data-agenda-status]");
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_TITLES = {
  route: "Route",
  backup: "Backups",
  crm: "CRM",
};
const devAgent = createDevAgentState();

viewButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewButton));
});

chatOpenButtons.forEach((button) => {
  button.addEventListener("click", openChat);
});

chatCloseButton.addEventListener("click", closeChat);
chatNewButton.addEventListener("click", startNewChat);
chatHistoryToggle.addEventListener("click", toggleChatHistory);
chatBackdrop.addEventListener("click", closeChat);
if (isDevelopmentHost()) {
  devChatOpenButton.hidden = false;
  devChatOpenButton.addEventListener("click", openDevChat);
  devChatCloseButton.addEventListener("click", closeDevChat);
  devChatNewButton.addEventListener("click", startNewDevThread);
  devChatBackButton.addEventListener("click", showDevInbox);
  devChatBackdrop.addEventListener("click", closeDevChat);
  devChatForm.addEventListener("submit", handleDevChatSubmit);
  devChatForm.elements.prompt.addEventListener("input", updateDevComposerState);
  devChatForm.elements.prompt.addEventListener("keydown", handleDevChatKeydown);
  devDeployCheckbox.addEventListener("change", () => {
    devAgent.deploy = devDeployCheckbox.checked;
    updateDevComposerState();
  });
  globalThis.addEventListener("message", handleDevAuthMessage);
  renderDevAgent();
}
eventCloseButton.addEventListener("click", closeEventModal);
eventBackdrop.addEventListener("click", closeEventModal);
leadEventSelect.addEventListener("change", () => {
  state.leadEventManuallySelected = true;
  renderCRM();
});
leadForm.elements.sendFollowUpEmail.addEventListener("change", () => {
  state.followUpEmailTouched = true;
  renderFollowUpEmailControl();
});
cardScanButton.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (cardScanButton.getAttribute("aria-disabled") === "true") return;
  event.preventDefault();
  cardInput.click();
});
cardInput.addEventListener("change", handleCardInput);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeChat();
  if (event.key === "Escape") closeDevChat();
  if (event.key === "Escape") closeEventModal();
});

hydrateChatHistory();

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openChat();
    askAgent(button.dataset.ask);
  });
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = chatForm.elements.prompt;
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = "";
  updateComposerState();
  askAgent(prompt);
});
chatForm.elements.prompt.addEventListener("input", updateComposerState);
chatForm.elements.prompt.addEventListener("keydown", handleChatKeydown);
agendaRecalculateButton.addEventListener("click", recalculateAgenda);
partifulSyncButton.addEventListener("click", syncPartifulAndRecalculate);

leadForm.addEventListener("submit", handleLeadSubmit);
updateComposerState();

function handleChatKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (state.agentBusy || !chatForm.elements.prompt.value.trim()) return;
  chatForm.requestSubmit();
}

function updateComposerState() {
  const input = chatForm.elements.prompt;
  const send = chatForm.querySelector("button[type='submit']");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  send.disabled = state.agentBusy || !input.value.trim();
}

function handleDevChatKeydown(event) {
  if (event.key !== "Enter" || event.isComposing) return;
  if (event.shiftKey) return;
  if (!event.metaKey && !event.ctrlKey && devAgent.view === "thread") return;
  event.preventDefault();
  if (!devChatForm.elements.prompt.value.trim()) return;
  devChatForm.requestSubmit();
}

function updateDevComposerState() {
  const input = devChatForm.elements.prompt;
  const send = devChatForm.querySelector("button[type='submit']");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  const canSend = devAgent.config.ready && devAgent.authState === "authenticated" &&
    !devAgent.sending && Boolean(input.value.trim());
  input.disabled = !devAgent.config.ready || devAgent.authState !== "authenticated" ||
    devAgent.sending;
  send.disabled = !canSend;
  devDeployControl.hidden = !devAgent.config.deployEnabled ||
    devAgent.authState !== "authenticated";
  devDeployCheckbox.checked = devAgent.deploy;
  devDeployCheckbox.disabled = devAgent.sending;
  devComposerError.hidden = !devAgent.composerError;
  devComposerError.textContent = devAgent.composerError;
}

function setView(view) {
  state.activeView = view;
  pageTitle.textContent = VIEW_TITLES[view] || "Route";
  viewButtons.forEach((button) => {
    button.setAttribute("aria-current", button.dataset.viewButton === view ? "page" : "false");
  });
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== view;
  });
  if (view === "crm") renderCRM();
}

function openChat() {
  closeDevChat();
  chatDrawer.hidden = false;
  chatBackdrop.hidden = false;
  document.body.dataset.chatOpen = "true";
  void getModelContext().catch(() => null);
  requestAnimationFrame(() => {
    updateComposerState();
    chatDrawer.querySelector("textarea").focus({ preventScroll: true });
    chatLog.scrollTop = chatLog.scrollHeight;
  });
}

function closeChat() {
  chatDrawer.hidden = true;
  chatBackdrop.hidden = true;
  document.body.dataset.chatOpen = "false";
}

function openDevChat() {
  if (!isDevelopmentHost()) return;
  closeChat();
  devChatDrawer.hidden = false;
  devChatBackdrop.hidden = false;
  document.body.dataset.devChatOpen = "true";
  devAgent.open = true;
  renderDevAgent();
  if (!devAgent.bootstrapped && !devAgent.loadingSession) {
    void bootstrapDevAgent();
  } else if (devAgent.authState === "authenticated" && devAgent.view === "inbox") {
    void loadDevThreads({ silent: true });
  }
  requestAnimationFrame(() => {
    updateDevComposerState();
    devChatDrawer.querySelector("textarea").focus({ preventScroll: true });
    devChatLog.scrollTop = devChatLog.scrollHeight;
  });
}

function closeDevChat() {
  devChatDrawer.hidden = true;
  devChatBackdrop.hidden = true;
  document.body.dataset.devChatOpen = "false";
  devAgent.open = false;
}

function startNewDevThread() {
  closeDevThreadStream();
  devAgent.view = "inbox";
  devAgent.thread = null;
  devAgent.events = [];
  devAgent.currentThreadId = "";
  devAgent.lastEventId = 0;
  devAgent.composerError = "";
  devChatForm.elements.prompt.value = "";
  localStorage.removeItem(DEV_AGENT_SELECTED_THREAD_KEY);
  renderDevAgent();
  requestAnimationFrame(() => devChatForm.elements.prompt.focus({ preventScroll: true }));
}

function showDevInbox() {
  closeDevThreadStream();
  devAgent.view = "inbox";
  devAgent.thread = null;
  devAgent.events = [];
  devAgent.currentThreadId = "";
  devAgent.lastEventId = 0;
  devAgent.error = "";
  localStorage.removeItem(DEV_AGENT_SELECTED_THREAD_KEY);
  renderDevAgent();
  if (devAgent.authState === "authenticated") {
    void loadDevThreads({ silent: true });
  }
}

async function handleDevChatSubmit(event) {
  event.preventDefault();
  if (!devAgent.config.ready || devAgent.authState !== "authenticated" || devAgent.sending) return;
  const input = devChatForm.elements.prompt;
  const prompt = input.value.trim();
  if (!prompt) return;

  devAgent.sending = true;
  devAgent.composerError = "";
  updateDevComposerState();

  const inThread = devAgent.view === "thread" && devAgent.thread?.threadId;
  const body = {
    prompt,
    deploy: devAgent.config.deployEnabled ? devAgent.deploy : false,
  };
  if (devAgent.config.repo) body.repo = devAgent.config.repo;
  if (devAgent.config.repoId) body.repoId = devAgent.config.repoId;
  if (!inThread) body.title = devTitleFromPrompt(prompt);

  const endpoint = inThread
    ? `/api/threads/${encodeURIComponent(devAgent.thread.threadId)}/runs`
    : "/api/runs";

  try {
    const created = await devFetchJson(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
    input.value = "";
    resizeDevPrompt();
    await loadDevThreads({ silent: true });
    if (created?.threadId) {
      await openDevThread(created.threadId);
    } else if (inThread) {
      await openDevThread(devAgent.thread.threadId);
    } else {
      renderDevAgent();
    }
  } catch (error) {
    devAgent.composerError = devFriendlyError(error, "Could not send prompt.");
    renderDevAgent();
  } finally {
    devAgent.sending = false;
    updateDevComposerState();
  }
}

function resizeDevPrompt() {
  const input = devChatForm.elements.prompt;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function createDevAgentState() {
  const config = readDevAgentConfig();
  return {
    config,
    open: false,
    bootstrapped: false,
    authState: "booting",
    session: null,
    view: "inbox",
    threads: [],
    thread: null,
    events: [],
    loadingSession: false,
    loadingThreads: false,
    loadingThread: false,
    sending: false,
    error: "",
    composerError: "",
    stream: null,
    streamState: "idle",
    repoFilterResolved: Boolean(config.repoId || !config.repo),
    repoFilterId: config.repoId,
    derivedRepoId: config.repo ? slugFromPath(config.repo) : "",
    currentThreadId: localStorage.getItem(DEV_AGENT_SELECTED_THREAD_KEY) || "",
    lastEventId: 0,
    deploy: config.deployEnabled,
  };
}

function readDevAgentConfig() {
  const dataset = devChatDrawer?.dataset || {};
  const apiBase = normalizeApiBase(dataset.agentApi || "http://localhost:18080");
  const repo = String(dataset.repo || "").trim();
  const repoId = String(dataset.repoId || "").trim();
  const repoLabel = String(dataset.repoLabel || repoName(repo) || repoId || "Development repo")
    .trim();
  return {
    apiBase,
    repo,
    repoId,
    repoLabel,
    deployEnabled: dataset.deploy === "true",
    ready: Boolean(apiBase && (repo || repoId)),
  };
}

async function bootstrapDevAgent() {
  if (!devAgent.config.ready) {
    devAgent.bootstrapped = true;
    devAgent.authState = "config_error";
    devAgent.error = "Missing Pi API origin or repository configuration.";
    renderDevAgent();
    return;
  }

  devAgent.loadingSession = true;
  devAgent.error = "";
  renderDevAgent();
  try {
    const session = await devFetchJson("/api/session");
    devAgent.session = session && typeof session === "object" ? session : {};
    devAgent.bootstrapped = true;
    devAgent.authState = devSessionState(devAgent.session);
    if (devAgent.authState === "authenticated") {
      await loadDevThreads({ silent: true });
      if (devAgent.currentThreadId) {
        await openDevThread(devAgent.currentThreadId, { silent: true });
      }
    }
  } catch (error) {
    devAgent.bootstrapped = true;
    devAgent.authState = "error";
    devAgent.error = devFriendlyError(error, "Could not reach the Pi agent API.");
  } finally {
    devAgent.loadingSession = false;
    renderDevAgent();
  }
}

function devSessionState(session) {
  if (session?.authenticated === true) return "authenticated";
  if (session?.auth === "not_configured" || session?.authConfigured === false) {
    return "not_configured";
  }
  return "unauthenticated";
}

async function loadDevThreads(options = {}) {
  if (!devAgent.config.ready || devAgent.loadingThreads) return;
  devAgent.loadingThreads = !options.silent;
  devAgent.error = "";
  renderDevAgent();
  try {
    await resolveDevRepoFilter();
    const threads = await devFetchJson("/api/threads");
    devAgent.threads = Array.isArray(threads)
      ? threads.map(normalizeDevThread).sort((a, b) =>
        dateValue(b.updatedAt) - dateValue(a.updatedAt)
      )
      : [];
  } catch (error) {
    devAgent.error = devFriendlyError(error, "Could not load development threads.");
    if (isAuthStatus(error)) devAgent.authState = "unauthenticated";
  } finally {
    devAgent.loadingThreads = false;
    renderDevAgent();
  }
}

async function resolveDevRepoFilter() {
  if (devAgent.repoFilterResolved || devAgent.repoFilterId || !devAgent.config.repo) {
    devAgent.repoFilterResolved = true;
    return;
  }

  devAgent.repoFilterResolved = true;
  try {
    const repos = await devFetchJson("/api/repos");
    const normalizedRepo = normalizePath(devAgent.config.repo);
    const match = Array.isArray(repos)
      ? repos.find((repo) => normalizePath(repo?.path) === normalizedRepo)
      : null;
    if (match?.repoId) {
      devAgent.repoFilterId = String(match.repoId);
    }
  } catch {
    devAgent.repoFilterId = "";
  }
}

async function openDevThread(threadId, options = {}) {
  const id = String(threadId || "");
  if (!id) return;

  closeDevThreadStream();
  devAgent.view = "thread";
  devAgent.currentThreadId = id;
  devAgent.thread = null;
  devAgent.events = [];
  devAgent.lastEventId = 0;
  devAgent.loadingThread = !options.silent;
  devAgent.error = "";
  devAgent.composerError = "";
  localStorage.setItem(DEV_AGENT_SELECTED_THREAD_KEY, id);
  renderDevAgent();

  try {
    const detail = await devFetchJson(`/api/threads/${encodeURIComponent(id)}`);
    devAgent.thread = normalizeDevThread(detail);
    devAgent.events = normalizeDevEvents(detail?.messages);
    devAgent.lastEventId = maxDevEventId(devAgent.events);
    storeDevLastEventId(id, devAgent.lastEventId);
    upsertDevThread(devAgent.thread);
    startDevThreadStream(id);
  } catch (error) {
    devAgent.error = devFriendlyError(error, "Could not load development thread.");
    if (isAuthStatus(error)) devAgent.authState = "unauthenticated";
  } finally {
    devAgent.loadingThread = false;
    renderDevAgent();
  }
}

function startDevThreadStream(threadId) {
  if (!globalThis.EventSource || !devAgent.config.ready) {
    devAgent.streamState = "unsupported";
    renderDevAgent();
    return;
  }

  const url = devApiUrl(`/api/threads/${encodeURIComponent(threadId)}/events`);
  const after = Math.max(devAgent.lastEventId, readDevLastEventId(threadId));
  if (after > 0) url.searchParams.set("after", String(after));

  const source = new EventSource(url.toString(), { withCredentials: true });
  devAgent.stream = source;
  devAgent.streamState = "connecting";
  DEV_AGENT_EVENT_TYPES.forEach((type) => {
    source.addEventListener(type, handleDevStreamEvent);
  });
  source.onmessage = handleDevStreamEvent;
  source.onopen = () => {
    devAgent.streamState = "open";
    renderDevAgent();
  };
  source.onerror = () => {
    devAgent.streamState = "reconnecting";
    renderDevAgent();
  };
  renderDevAgent();
}

function closeDevThreadStream() {
  if (devAgent.stream) {
    devAgent.stream.close();
  }
  devAgent.stream = null;
  devAgent.streamState = "idle";
}

function handleDevStreamEvent(message) {
  let event;
  try {
    event = JSON.parse(message.data);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;
  addDevEvent({ ...event, type: event.type || message.type });
}

function addDevEvent(event) {
  if (event.threadId && devAgent.currentThreadId && event.threadId !== devAgent.currentThreadId) {
    return;
  }
  const previousLength = devAgent.events.length;
  devAgent.events = normalizeDevEvents(devAgent.events.concat(event));
  if (devAgent.events.length === previousLength && event.id) return;

  devAgent.lastEventId = Math.max(devAgent.lastEventId, Number(event.id) || 0);
  if (devAgent.currentThreadId) {
    storeDevLastEventId(devAgent.currentThreadId, devAgent.lastEventId);
  }
  if (devAgent.thread) {
    const text = devMeaningfulText(event);
    if (text) devAgent.thread.latestText = text;
    if (event.phase) devAgent.thread.phase = event.phase;
    devAgent.thread.updatedAt = event.createdAt || new Date().toISOString();
    upsertDevThread(devAgent.thread);
  }
  renderDevAgent();
}

function renderDevAgent() {
  devChatBackButton.hidden = devAgent.view !== "thread";
  devChatNewButton.disabled = devAgent.sending;
  devChatLog.replaceChildren();
  delete devChatLog.dataset.empty;

  if (devAgent.view === "thread") {
    renderDevThread();
  } else {
    renderDevInbox();
  }
  updateDevComposerState();
}

function renderDevInbox() {
  devChatTitle.textContent = "Threads";
  const threads = visibleDevThreads();
  devChatSubtitle.textContent = devAgent.config.repoLabel
    ? `${devAgent.config.repoLabel} - ${threads.length} ${
      threads.length === 1 ? "thread" : "threads"
    }`
    : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`;

  if (!devAgent.config.ready) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devNotice("Setup needed", devAgent.error, null));
    return;
  }
  if (devAgent.loadingSession || !devAgent.bootstrapped) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devEmptyState("Checking Pi agent session."));
    return;
  }
  if (devAgent.authState === "not_configured") {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devNotice(
      "Pi agent auth is not configured.",
      "Finish the Pi daemon auth setup before sending development prompts.",
      () => bootstrapDevAgent(),
    ));
    return;
  }
  if (devAgent.authState === "unauthenticated") {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devAuthNotice());
    return;
  }
  if (devAgent.authState === "error") {
    devChatLog.dataset.empty = "true";
    devChatLog.append(
      devNotice("Pi agent unavailable.", devAgent.error, () => bootstrapDevAgent()),
    );
    return;
  }
  if (devAgent.loadingThreads && !devAgent.threads.length) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devEmptyState("Loading threads."));
    return;
  }
  if (devAgent.error) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devNotice("Threads unavailable.", devAgent.error, () => loadDevThreads()));
    return;
  }
  if (!threads.length) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devEmptyState("No threads yet."));
    return;
  }

  const list = document.createElement("section");
  list.dataset.devThreadList = "";
  threads.forEach((thread) => list.append(devThreadRow(thread)));
  devChatLog.append(list);
}

function renderDevThread() {
  const thread = devAgent.thread;
  devChatTitle.textContent = thread?.title || "Thread";
  const phase = thread ? formatPhase(thread.phase) : devAgent.loadingThread ? "Loading" : "Thread";
  const time = thread?.updatedAt ? formatRelative(thread.updatedAt) : "";
  const stream = devAgent.streamState === "reconnecting" ? " - reconnecting" : "";
  devChatSubtitle.textContent = [phase, time].filter(Boolean).join(" - ") + stream;

  if (devAgent.loadingThread) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devEmptyState("Loading thread."));
    return;
  }
  if (devAgent.error) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devNotice(
      "Thread unavailable.",
      devAgent.error,
      () => openDevThread(devAgent.currentThreadId),
    ));
    return;
  }

  const visible = devAgent.events.filter(isVisibleDevEvent);
  const technical = devAgent.events.filter((event) => !isVisibleDevEvent(event));
  if (!visible.length) {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devEmptyState("No messages yet."));
  } else {
    visible.forEach((event) => renderDevEvent(event));
  }

  if (technical.length) {
    devChatLog.append(devTechnicalDetails(technical));
  }
  requestAnimationFrame(() => {
    devChatLog.scrollTop = devChatLog.scrollHeight;
  });
}

function devThreadRow(thread) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.devThreadRow = "";
  if (thread.unread) button.dataset.unread = "true";
  button.addEventListener("click", () => openDevThread(thread.threadId));

  const head = document.createElement("span");
  head.dataset.devThreadHead = "";
  const title = document.createElement("strong");
  title.textContent = thread.title || "New request";
  const time = document.createElement("time");
  time.dateTime = thread.updatedAt || "";
  time.textContent = formatRelative(thread.updatedAt);
  head.append(title, time);

  const latest = document.createElement("span");
  latest.dataset.devThreadLatest = "";
  latest.textContent = thread.latestText || "No updates yet.";

  const phase = document.createElement("small");
  phase.textContent = formatPhase(thread.phase);
  button.append(head, latest, phase);
  return button;
}

function renderDevEvent(event) {
  const text = devMeaningfulText(event) || devEventLabel(event);
  const role = event.type === "user.message" ? "user" : "assistant";
  const item = appendChatMessage(devChatLog, role, text, { suppressTools: true });
  item.dataset.devEventType = devEventKind(event);
  const meta = document.createElement("small");
  meta.dataset.devEventMeta = "";
  meta.textContent = `${devEventLabel(event)}${
    event.createdAt ? ` - ${formatRelative(event.createdAt)}` : ""
  }`;
  item.prepend(meta);

  if (event.type === "result" && event.data && typeof event.data === "object") {
    const body = item.querySelector("[data-message-content]");
    const details = devResultData(event.data);
    if (details) body.append(details);
  }
}

function devResultData(data) {
  const entries = Object.entries(data)
    .filter(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    )
    .slice(0, 6);
  if (!entries.length) return null;
  const list = document.createElement("dl");
  list.dataset.devResultData = "";
  for (const [key, value] of entries) {
    const term = document.createElement("dt");
    term.textContent = labelize(key);
    const description = document.createElement("dd");
    description.textContent = String(value);
    list.append(term, description);
  }
  return list;
}

function devTechnicalDetails(events) {
  const details = document.createElement("details");
  details.dataset.devTechnical = "";
  const summary = document.createElement("summary");
  summary.textContent = `Technical details (${events.length})`;
  const list = document.createElement("ol");
  for (const event of events) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${event.type || "event"}${
      event.createdAt ? ` - ${formatRelative(event.createdAt)}` : ""
    }`;
    item.append(title);
    const text = devMeaningfulText(event);
    if (text) {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      item.append(paragraph);
    }
    if (event.data && typeof event.data === "object" && Object.keys(event.data).length) {
      const pre = document.createElement("pre");
      pre.textContent = truncate(JSON.stringify(event.data, null, 2), 3000);
      item.append(pre);
    }
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

function devNotice(title, message, retry) {
  const wrapper = document.createElement("section");
  wrapper.dataset.devNotice = "";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = message || "";
  wrapper.append(heading, paragraph);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    wrapper.append(button);
  }
  return wrapper;
}

function devAuthNotice() {
  const wrapper = devNotice(
    "Sign in required.",
    "Use the Pi agent passkey flow to continue.",
    null,
  );
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Sign in";
  button.addEventListener("click", () => openDevAuth("login"));
  wrapper.append(button);
  return wrapper;
}

function devEmptyState(text) {
  const wrapper = document.createElement("section");
  wrapper.dataset.devNotice = "";
  wrapper.textContent = text;
  return wrapper;
}

function visibleDevThreads() {
  const all = devAgent.threads.slice().sort((a, b) =>
    dateValue(b.updatedAt) - dateValue(a.updatedAt)
  );
  if (devAgent.repoFilterId) {
    return all.filter((thread) => thread.repoId === devAgent.repoFilterId);
  }
  if (devAgent.derivedRepoId) {
    const matching = all.filter((thread) => thread.repoId === devAgent.derivedRepoId);
    if (matching.length || all.length === 0) return matching;
  }
  return all;
}

function upsertDevThread(thread) {
  if (!thread?.threadId) return;
  const index = devAgent.threads.findIndex((item) => item.threadId === thread.threadId);
  if (index >= 0) {
    devAgent.threads[index] = { ...devAgent.threads[index], ...thread };
  } else {
    devAgent.threads.unshift(thread);
  }
  devAgent.threads.sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt));
}

function normalizeDevThread(thread) {
  return {
    threadId: String(thread?.threadId || ""),
    repoId: String(thread?.repoId || ""),
    title: String(thread?.title || ""),
    latestText: String(thread?.latestText || ""),
    phase: String(thread?.phase || ""),
    unread: Boolean(thread?.unread),
    activeRunIds: Array.isArray(thread?.activeRunIds) ? thread.activeRunIds.map(String) : [],
    createdAt: String(thread?.createdAt || ""),
    updatedAt: String(thread?.updatedAt || ""),
  };
}

function normalizeDevEvents(events) {
  const byId = new Map();
  const withoutId = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;
    const id = Number(event.id);
    const normalized = { ...event, id: Number.isFinite(id) && id > 0 ? id : event.id };
    if (Number.isFinite(id) && id > 0) {
      byId.set(id, normalized);
    } else {
      withoutId.push(normalized);
    }
  }
  return [...byId.values(), ...withoutId].sort((a, b) => {
    const left = Number(a.id) || Number.MAX_SAFE_INTEGER;
    const right = Number(b.id) || Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

function maxDevEventId(events) {
  return events.reduce((max, event) => Math.max(max, Number(event.id) || 0), 0);
}

function isVisibleDevEvent(event) {
  if (DEV_AGENT_VISIBLE_TYPES.has(event.type)) return true;
  if (event.type !== "phase.changed") return false;
  if (devMeaningfulText(event)) return true;
  return DEV_AGENT_VISIBLE_PHASES.has(normalizePhaseKey(event.phase));
}

function devEventKind(event) {
  if (event.type === "user.message") return "user";
  if (event.type === "error") return "error";
  if (event.type === "result") return "result";
  if (event.type === "progress.message" || event.type === "phase.changed") return "progress";
  return "agent";
}

function devEventLabel(event) {
  switch (event.type) {
    case "user.message":
      return "You";
    case "agent.message":
      return "Agent";
    case "progress.message":
      return "Progress";
    case "phase.changed":
      return formatPhase(event.phase || "Progress");
    case "error":
      return "Error";
    case "result":
      return "Result";
    default:
      return event.type || "Event";
  }
}

function devMeaningfulText(event) {
  if (!event) return "";
  if (typeof event.text === "string" && event.text.trim()) return event.text.trim();
  const data = event.data && typeof event.data === "object" ? event.data : {};
  for (const key of ["message", "summary", "title", "error", "content"]) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key].trim();
  }
  return "";
}

async function devFetchJson(path, options = {}) {
  const init = {
    credentials: "include",
    headers: { Accept: "application/json" },
    ...options,
  };
  if (init.body) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  const response = await fetch(devApiUrl(path).toString(), init);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error(devErrorMessage(payload) || response.statusText || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function devApiUrl(path) {
  return new URL(path, `${devAgent.config.apiBase}/`);
}

function devFriendlyError(error, fallback) {
  if (isAuthStatus(error)) return "Sign in on the Pi origin to continue.";
  return error?.message || fallback;
}

function devErrorMessage(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.message === "string") return payload.message;
  return "";
}

function isAuthStatus(error) {
  return error?.status === 401 || error?.status === 403;
}

function openDevAuth(mode) {
  const url = devApiUrl("/auth.html");
  url.searchParams.set("mode", mode);
  url.searchParams.set("embedOrigin", globalThis.location.origin);
  url.searchParams.set("returnUrl", globalThis.location.href);
  const popup = globalThis.open(url.toString(), "pi-codex-auth", "popup,width=460,height=720");
  if (!popup) {
    globalThis.location.href = url.toString();
  }
}

function handleDevAuthMessage(event) {
  if (!devAgent?.config?.apiBase) return;
  if (event.origin !== new URL(devAgent.config.apiBase).origin) return;
  if (event.data?.type !== "pi-codex-auth-complete") return;
  void bootstrapDevAgent();
}

function readDevLastEventId(threadId) {
  return Number(localStorage.getItem(`${DEV_AGENT_LAST_EVENT_KEY_PREFIX}${threadId}`) || "0") || 0;
}

function storeDevLastEventId(threadId, eventId) {
  if (!threadId || !eventId) return;
  localStorage.setItem(`${DEV_AGENT_LAST_EVENT_KEY_PREFIX}${threadId}`, String(eventId));
}

function normalizeApiBase(value) {
  try {
    return new URL(value, document.baseURI).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizePath(value) {
  return String(value || "").replace(/\/+$/, "");
}

function repoName(repo) {
  const clean = normalizePath(repo);
  if (!clean) return "";
  return clean.split("/").filter(Boolean).pop() || clean;
}

function slugFromPath(path) {
  return repoName(path).toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, "")
    .replace(/[\/\s._]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePhaseKey(phase) {
  return String(phase || "").replace(/[_-]+/g, " ").trim().toLowerCase();
}

function formatPhase(phase) {
  const value = normalizePhaseKey(phase || "idle");
  if (!value) return "Idle";
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRelative(value) {
  const time = dateValue(value);
  if (!time) return "";
  const diff = Date.now() - time;
  if (diff < -45_000) return "soon";
  const seconds = Math.max(0, Math.round(diff / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function labelize(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function devTitleFromPrompt(prompt) {
  const firstLine = String(prompt || "").split(/\r?\n/).find((line) => line.trim()) ||
    "New request";
  return truncate(firstLine.trim().replace(/\s+/g, " "), 80);
}

function toggleChatHistory() {
  state.historyOpen = !state.historyOpen;
  chatHistoryToggle.setAttribute("aria-expanded", String(state.historyOpen));
  renderChatHistory();
}

async function loadSchedule() {
  const response = await fetch("/api/schedule", { cache: "no-store" });
  state.payload = await response.json();
  state.entriesByBlock = new Map([
    ...state.payload.days.flatMap((day) => day.entries),
    ...state.payload.referenceDays.flatMap((day) => day.entries),
  ].map((entry) => [entry.calendarBlockId, entry]));
  state.activeDay ||= state.payload.days[0]?.date || "";
  render();
}

async function recalculateAgenda() {
  if (state.agendaBusy || state.partifulSyncBusy || state.liveRouteRefreshBusy) return;
  setAgendaBusy(true, "Recalculating agenda...");
  try {
    const response = await fetchWithTimeout(
      "/api/agenda/recalculate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liveRouting: true, activate: true }),
      },
      LIVE_ROUTE_REFRESH_TIMEOUT_MS,
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Could not recalculate agenda.");
    }
    if (body.schedule) {
      applySchedulePayload(body.schedule);
    } else if (body.agenda) {
      applyAgendaProposal(body.agenda);
    }
    const selected = body.agenda?.summary?.selectedEvents ?? countScheduleEvents();
    const dropped = body.agenda?.summary?.droppedEvents ?? 0;
    setAgendaBusy(false, `Recalculated ${selected} events; ${dropped} alternatives left out.`);
  } catch (error) {
    setAgendaBusy(false, error instanceof Error ? error.message : "Could not recalculate agenda.");
  }
}

async function syncPartifulAndRecalculate() {
  await syncPartifulAndRecalculateInTwoPhases({ background: false });
}

async function syncPartifulAndRecalculateInTwoPhases({ background = false } = {}) {
  if (state.agendaBusy || state.partifulSyncBusy || state.liveRouteRefreshBusy) {
    if (!background) agendaStatus.textContent = "Agenda refresh is already running.";
    return false;
  }

  state.partifulSyncBusy = true;
  updateAgendaControls();
  if (!background) {
    agendaStatus.textContent =
      "Syncing Partiful approvals... live routes will refine in the background.";
  }

  try {
    const response = await fetchWithTimeout(
      "/api/sync/partiful/headless",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liveRouting: false, recalculate: true, activate: true }),
      },
      PARTIFUL_FAST_SYNC_TIMEOUT_MS,
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Could not sync Partiful.");
    }
    if (body.schedule) applySchedulePayload(body.schedule);
    const selected = body.agenda?.summary?.selectedEvents ?? countScheduleEvents();
    const discovered = body.headless?.targetCount ?? body.ingestion?.snapshotCount ?? 0;
    const failed = body.headless?.failureCount ?? 0;
    if (!background) {
      agendaStatus.textContent =
        `Synced ${discovered} Partiful events; agenda now has ${selected} selected.${
          failed ? ` ${failed} fetches failed.` : ""
        } Refining live routes in the background.`;
    }
    void refreshLiveRoutesInBackground({ silent: background });
    return true;
  } catch (error) {
    if (background) {
      console.warn(error);
    } else {
      agendaStatus.textContent = error instanceof Error
        ? error.message
        : "Could not sync Partiful.";
    }
    return false;
  } finally {
    state.partifulSyncBusy = false;
    updateAgendaControls();
  }
}

async function refreshLiveRoutesInBackground({ silent = true } = {}) {
  if (state.liveRouteRefreshBusy) return false;
  state.liveRouteRefreshBusy = true;
  updateAgendaControls();
  if (!silent) agendaStatus.textContent = "Refreshing live routes in the background...";

  try {
    const response = await fetchWithTimeout(
      "/api/agenda/recalculate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liveRouting: true, activate: true }),
      },
      LIVE_ROUTE_REFRESH_TIMEOUT_MS,
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Could not refresh live routes.");
    }
    if (body.schedule) {
      applySchedulePayload(body.schedule);
    } else if (body.agenda) {
      applyAgendaProposal(body.agenda);
    }
    if (!silent) {
      const selected = body.agenda?.summary?.selectedEvents ?? countScheduleEvents();
      agendaStatus.textContent = `Live routes refreshed; agenda has ${selected} selected events.`;
    }
    return true;
  } catch (error) {
    if (silent) {
      console.warn(error);
    } else {
      const message = error instanceof Error ? error.message : "Could not refresh live routes.";
      agendaStatus.textContent = `Partiful sync completed; ${message}`;
    }
    return false;
  } finally {
    state.liveRouteRefreshBusy = false;
    updateAgendaControls();
  }
}

function applySchedulePayload(payload) {
  state.payload = payload;
  state.entriesByBlock = new Map([
    ...state.payload.days.flatMap((day) => day.entries),
    ...state.payload.referenceDays.flatMap((day) => day.entries),
  ].map((entry) => [entry.calendarBlockId, entry]));
  if (!state.payload.days.some((day) => day.date === state.activeDay)) {
    state.activeDay = state.payload.days[0]?.date || "";
  }
  render();
}

function applyAgendaProposal(agenda) {
  const selectedIds = new Set(
    (agenda.selectedEvents || []).flatMap((entry) =>
      [entry.techweekId, entry.partifulId, entry.rerankId].filter(Boolean)
    ),
  );
  const previousReference = [
    ...(state.payload?.days || []).flatMap((day) => day.entries),
    ...(state.payload?.referenceDays || []).flatMap((day) => day.entries),
  ].filter((entry) => entry.blockType === "event" && !entryMatchesAnyId(entry, selectedIds));
  const scheduleEntries = (agenda.selectedBlocks || []).map(agendaBlockToEntry);
  state.payload = {
    ...state.payload,
    generatedAt: agenda.generatedAt,
    source: `agenda:${agenda.agendaRunId}`,
    next: currentSchedulePointerFromEntries(scheduleEntries),
    counts: scheduleCounts(scheduleEntries, previousReference),
    days: groupEntriesByDay(scheduleEntries),
    referenceDays: groupEntriesByDay(previousReference.map(referenceEntryFromEvent)),
  };
  state.entriesByBlock = new Map([
    ...state.payload.days.flatMap((day) => day.entries),
    ...state.payload.referenceDays.flatMap((day) => day.entries),
  ].map((entry) => [entry.calendarBlockId, entry]));
  if (!state.payload.days.some((day) => day.date === state.activeDay)) {
    state.activeDay = state.payload.days[0]?.date || "";
  }
  render();
}

function setAgendaBusy(busy, message) {
  state.agendaBusy = busy;
  updateAgendaControls();
  agendaStatus.textContent = message || "";
}

function updateAgendaControls() {
  const busy = state.agendaBusy || state.partifulSyncBusy || state.liveRouteRefreshBusy;
  agendaRecalculateButton.disabled = busy;
  partifulSyncButton.disabled = busy;
}

function scheduleServerPartifulAutoSync(delayMs = PARTIFUL_AUTO_SYNC_OPEN_DELAY_MS) {
  if (state.partifulAutoSyncRequestTimer) {
    globalThis.clearTimeout(state.partifulAutoSyncRequestTimer);
  }
  state.partifulAutoSyncRequestTimer = globalThis.setTimeout(() => {
    state.partifulAutoSyncRequestTimer = 0;
    void requestServerPartifulAutoSync();
  }, delayMs);
}

async function requestServerPartifulAutoSync() {
  if (state.partifulAutoSyncRequestBusy || document.hidden) return;
  state.partifulAutoSyncRequestBusy = true;
  try {
    const response = await fetch("/api/sync/partiful/auto", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.status === 202 || body.action === "started" || body.action === "already_running") {
      schedulePartifulAutoSyncSchedulePoll();
    }
  } catch (error) {
    console.warn(error);
  } finally {
    state.partifulAutoSyncRequestBusy = false;
  }
}

function schedulePartifulAutoSyncSchedulePoll(
  delayMs = PARTIFUL_AUTO_SYNC_STATUS_POLL_MS,
  attempt = 0,
) {
  if (state.partifulAutoSyncPollTimer) {
    globalThis.clearTimeout(state.partifulAutoSyncPollTimer);
  }
  state.partifulAutoSyncPollTimer = globalThis.setTimeout(() => {
    state.partifulAutoSyncPollTimer = 0;
    void pollPartifulAutoSyncSchedule(attempt);
  }, delayMs);
}

async function pollPartifulAutoSyncSchedule(attempt = 0) {
  if (document.hidden) return;
  try {
    await loadSchedule();
  } catch (error) {
    console.warn(error);
  }
  const autoSync = state.payload?.sync?.partifulAuto;
  if (autoSync?.status === "running" && attempt < PARTIFUL_AUTO_SYNC_MAX_POLLS) {
    schedulePartifulAutoSyncSchedulePoll(PARTIFUL_AUTO_SYNC_STATUS_POLL_MS, attempt + 1);
  }
}

function render() {
  renderNext();
  renderDayTabs();
  renderRouteList();
  renderReferenceList();
  renderCRM();
  renderChat();
}

function renderNext() {
  const next = state.payload?.next;
  document.querySelector("[data-next-title]").textContent = next?.displayTitle || "No route loaded";
  document.querySelector("[data-next-time]").textContent = next
    ? `${next.weekday} ${next.timeRange}`
    : "";
  document.querySelector("[data-next-place]").replaceChildren(
    next ? renderPlaceLink(next, next.location || next.venueQuery) : "",
  );
}

function renderDayTabs() {
  dayTabs.replaceChildren();
  for (const day of state.payload.days) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = day.weekday;
    button.title = day.date;
    button.setAttribute("aria-selected", String(day.date === state.activeDay));
    button.addEventListener("click", () => {
      state.activeDay = day.date;
      renderDayTabs();
      renderRouteList();
    });
    dayTabs.append(button);
  }
}

function renderRouteList() {
  const day = state.payload.days.find((item) => item.date === state.activeDay);
  const entries = day?.entries || [];
  const optionEntries = sameDayOptionEntries(state.activeDay);
  const lanes = computeCollisionLanes(entries);
  const optionLanes = computeCollisionLanes(optionEntries);
  const timeline = document.createElement("section");
  timeline.dataset.timeline = "";
  timeline.style.setProperty("--slots", "96");
  timeline.append(
    renderTimeRail(),
    ...entries.map((entry) => renderTimelineEntry(entry, lanes)),
    ...optionEntries.map((entry) => renderTimelineEntry(entry, optionLanes)),
  );
  routeList.replaceChildren(timeline);
}

function sameDayOptionEntries(dayKey) {
  return (state.payload.referenceDays.find((day) => day.date === dayKey)?.entries || [])
    .filter((entry) => entry.blockType === "event")
    .map((entry) => ({
      ...entry,
      optionLabel: optionLabel(entry),
    }));
}

function optionLabel(entry) {
  const status = entry.statusLabel || entry.status || "option";
  return status === "registered" ? "Registered option" : `${labelize(status)} option`;
}

function renderReferenceList() {
  const entries = state.payload.referenceDays.flatMap((day) => day.entries)
    .filter((entry) => entry.blockType === "event");
  referenceList.replaceChildren(...entries.map(renderEntry));
}

function eventEntries() {
  if (!state.payload) return [];
  const schedule = state.payload.days.flatMap((day) => day.entries)
    .filter((entry) => entry.blockType === "event");
  const reference = state.payload.referenceDays.flatMap((day) => day.entries)
    .filter((entry) => entry.blockType === "event");
  return [...schedule, ...reference];
}

function defaultLeadEventId(entries = eventEntries()) {
  const now = Date.now();
  const schedule = entries
    .filter((entry) => entry.calendar === "schedule" && entry.blockType === "event")
    .sort((a, b) => eventStartEpochMs(a) - eventStartEpochMs(b));
  const current = schedule.find((entry) =>
    eventStartEpochMs(entry) <= now && now < eventEndEpochMs(entry)
  );
  const previous = [...schedule].reverse().find((entry) => eventStartEpochMs(entry) <= now);
  const firstUpcoming = schedule.find((entry) => eventStartEpochMs(entry) > now);

  return current?.calendarBlockId ||
    previous?.calendarBlockId ||
    firstUpcoming?.calendarBlockId ||
    entries[0]?.calendarBlockId ||
    "";
}

function renderCRM() {
  if (!state.payload) return;
  const entries = eventEntries();
  const previous = leadEventSelect.value;
  const selectedId = state.leadEventManuallySelected &&
      entries.some((entry) => entry.calendarBlockId === previous)
    ? previous
    : defaultLeadEventId(entries);

  leadEventSelect.replaceChildren(...entries.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.calendarBlockId;
    option.textContent = `${
      entry.calendar === "schedule" ? "Route" : "Backup"
    } - ${entry.weekday} ${entry.timeRange} - ${entry.displayTitle}`;
    return option;
  }));
  leadEventSelect.value = selectedId;

  const selected = entries.find((entry) => entry.calendarBlockId === leadEventSelect.value);
  crmEventTitle.textContent = selected?.displayTitle || "Lead capture";
  renderFollowUpEmailControl();
  renderLeadList(selected?.calendarBlockId || "");
}

function renderFollowUpEmailControl() {
  const input = leadForm.elements.sendFollowUpEmail;
  const configured = Boolean(state.payload?.email?.followUpConfigured);
  input.disabled = !configured;
  if (!configured) input.checked = false;
  if (!state.followUpEmailTouched && !leadFormHasDraft()) {
    input.checked = configured;
  }
  followUpEmailStatus.textContent = configured
    ? (input.checked ? "Resend ready" : "Email off")
    : "Resend not configured";
}

function refreshAutomaticLeadEvent() {
  if (state.activeView !== "crm" || state.leadEventManuallySelected || leadFormHasDraft()) return;
  renderCRM();
}

function leadFormHasDraft() {
  return ["name", "company", "role", "email", "phone", "followUp", "notes"].some((field) =>
    String(leadForm.elements[field]?.value || "").trim()
  );
}

function eventStartEpochMs(entry) {
  return Number(entry.actualStartEpochMs || entry.startEpochMs || 0);
}

function eventEndEpochMs(entry) {
  return Number(entry.actualEndEpochMs || entry.endEpochMs || eventStartEpochMs(entry));
}

function agendaBlockToEntry(block) {
  const start = block.start || "";
  const end = block.end || "";
  const actualStart = block.actualStart || start;
  const actualEnd = block.actualEnd || end;
  const dayKey = block.dayKey || start.slice(0, 10);
  const title = block.title || "";
  return {
    calendar: block.calendar || "schedule",
    techweekId: block.techweekId || "",
    calendarBlockId: block.calendarBlockId || block.agendaBlockId || "",
    partifulId: block.partifulId || "",
    rerankId: block.rerankId || "",
    entryType: block.entryType || block.blockType || "",
    blockType: block.blockType || "other",
    status: block.status || "",
    category: block.category || "",
    start,
    end,
    actualStart,
    actualEnd,
    startEpochMs: epochFromLocal(start),
    endEpochMs: epochFromLocal(end),
    actualStartEpochMs: epochFromLocal(actualStart),
    actualEndEpochMs: epochFromLocal(actualEnd),
    dayKey,
    weekday: weekdayForDay(dayKey),
    timeRange: timeRange(start, end),
    title,
    displayTitle: title.replace(/^\[[^\]]+\]\s*/, ""),
    statusLabel: statusLabelFromTitle(title),
    location: block.location || "",
    venueQuery: block.venueQuery || "",
    venuePrecision: block.venuePrecision || "",
    routeMode: block.routeMode || "",
    travelMinutes: block.travelMinutes ?? "",
    routeDetails: block.routeDetails || "",
    transitRisk: block.transitRisk || "",
    note: block.note || block.generatedReason || "",
    salesCoaching: "",
    rank: block.rank || "",
    tier: block.tier || "",
    opportunityScore: block.opportunityScore || "",
    eventUrl: block.eventUrl || "",
    googleMapsUrl: block.googleMapsUrl || "",
  };
}

function referenceEntryFromEvent(entry) {
  const techweekId = entry.techweekId || (entry.rerankId ? `TW-${entry.rerankId}` : "");
  return {
    ...entry,
    calendar: "reference",
    calendarBlockId: techweekId ? `${techweekId}-REFERENCE` : entry.calendarBlockId,
  };
}

function currentSchedulePointerFromEntries(entries) {
  const now = Date.now();
  const operational = entries.filter((entry) =>
    entry.calendar === "schedule" && ["event", "travel", "eating"].includes(entry.blockType)
  );
  return operational.find((entry) => eventEndEpochMs(entry) > now) ??
    operational.find((entry) => entry.blockType === "event") ??
    entries.find((entry) => entry.calendar === "schedule") ??
    null;
}

function scheduleCounts(scheduleEntries, referenceEntries) {
  return {
    scheduleBlocks: scheduleEntries.length,
    scheduleEvents: scheduleEntries.filter((entry) => entry.blockType === "event").length,
    referenceEvents: referenceEntries.filter((entry) => entry.blockType === "event").length,
    eventBlocks: scheduleEntries.filter((entry) => entry.blockType === "event").length,
    travelBlocks: scheduleEntries.filter((entry) => entry.blockType === "travel").length,
    eatingBlocks: scheduleEntries.filter((entry) => entry.blockType === "eating").length,
    sleepingBlocks: scheduleEntries.filter((entry) => entry.blockType === "sleeping").length,
    mealBlocks: scheduleEntries.filter((entry) => entry.blockType === "eating").length,
  };
}

function groupEntriesByDay(entries) {
  const days = new Map();
  for (const entry of entries) {
    const current = days.get(entry.dayKey) || [];
    current.push(entry);
    days.set(entry.dayKey, current);
  }
  return [...days.entries()].map(([date, dayEntries]) => ({
    date,
    weekday: weekdayForDay(date),
    entries: dayEntries.sort((a, b) => eventStartEpochMs(a) - eventStartEpochMs(b)),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function entryMatchesAnyId(entry, ids) {
  return ids.has(entry.techweekId) || ids.has(entry.partifulId) || ids.has(entry.rerankId);
}

function countScheduleEvents() {
  return state.payload?.days?.flatMap((day) => day.entries)
    .filter((entry) => entry.blockType === "event").length ?? 0;
}

function epochFromLocal(value) {
  if (!value) return 0;
  return Date.parse(`${String(value).trim().replace(" ", "T")}:00-04:00`);
}

function weekdayForDay(dayKey) {
  const date = new Date(`${dayKey}T12:00:00-04:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" })
    .format(date);
}

function timeRange(start, end) {
  return `${String(start || "").slice(11, 16)}-${String(end || "").slice(11, 16)}`;
}

function statusLabelFromTitle(title) {
  return title.match(/^\[([^\]]+)\]/)?.[1] || "";
}

function renderLeadList(calendarBlockId) {
  const leads = state.payload?.state?.leads || [];
  const current = leads.filter((lead) => lead.calendarBlockId === calendarBlockId);
  const recent = leads.filter((lead) => lead.calendarBlockId !== calendarBlockId).slice(0, 20);
  leadsList.replaceChildren(
    renderLeadGroup("This event", current, "No leads for this event yet.", false),
    renderLeadGroup("Recent", recent, "No saved leads yet.", true),
  );
}

function renderLeadGroup(title, leads, emptyText, showEvent) {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading);
  if (!leads.length) {
    const empty = document.createElement("p");
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }
  section.append(...leads.map((lead) => renderLead(lead, showEvent)));
  return section;
}

function renderLead(lead, showEvent) {
  const article = document.createElement("article");
  article.dataset.lead = lead.id;

  const header = document.createElement("header");
  const summary = document.createElement("section");
  const title = document.createElement("h3");
  title.textContent = lead.name || lead.company || lead.email || lead.phone || "Lead";
  const subtitle = document.createElement("p");
  subtitle.textContent = [lead.company, lead.role].filter(Boolean).join(" / ");
  summary.append(title);
  if (subtitle.textContent) summary.append(subtitle);
  if (showEvent && lead.eventTitle) {
    const event = document.createElement("p");
    event.textContent = lead.eventTitle;
    summary.append(event);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.iconOnly = "";
  remove.setAttribute("aria-label", `Delete ${title.textContent}`);
  remove.append(renderIcon("trash"));
  remove.addEventListener("click", () => applyAction({ type: "lead_delete", id: lead.id }));
  header.append(summary, remove);
  article.append(header);

  if (lead.notes) {
    const notes = document.createElement("p");
    notes.textContent = lead.notes;
    article.append(notes);
  }

  const meta = document.createElement("section");
  meta.dataset.leadTags = "";
  addLeadMeta(meta, `Priority ${lead.priority}`);
  addLeadMeta(meta, lead.followUp);
  const emailStatus = addLeadMeta(meta, followUpEmailLabel(lead.followUpEmail));
  if (emailStatus && lead.followUpEmail?.status) {
    emailStatus.dataset.emailStatus = lead.followUpEmail.status;
    emailStatus.title = followUpEmailTitle(lead.followUpEmail);
  }
  addLeadMeta(meta, formatLeadTime(lead.createdAt));
  if (lead.email) {
    const email = document.createElement("a");
    email.href = `mailto:${lead.email}`;
    email.textContent = lead.email;
    email.dataset.contactLink = "";
    meta.append(email);
  }
  if (lead.phone) {
    const phone = document.createElement("a");
    phone.href = `tel:${lead.phone.replace(/[^\d+]/g, "")}`;
    phone.textContent = lead.phone;
    phone.dataset.contactLink = "";
    meta.append(phone);
  }
  article.append(meta);
  return article;
}

function addLeadMeta(parent, text) {
  if (!text) return null;
  const item = document.createElement("span");
  item.textContent = text;
  parent.append(item);
  return item;
}

function followUpEmailLabel(email) {
  if (!email?.status) return "";
  if (email.status === "sent") return "Email sent";
  if (email.status === "failed") return "Email failed";
  if (email.status === "skipped") return "Email skipped";
  return "";
}

function followUpEmailTitle(email) {
  if (!email) return "";
  return [email.to, email.subject, email.error].filter(Boolean).join(" / ");
}

function formatLeadTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function handleLeadSubmit(event) {
  event.preventDefault();
  setLeadError("");
  const formData = new FormData(leadForm);
  const action = {
    type: "lead_create",
    calendarBlockId: String(formData.get("calendarBlockId") || ""),
    name: String(formData.get("name") || ""),
    company: String(formData.get("company") || ""),
    role: String(formData.get("role") || ""),
    email: String(formData.get("email") || ""),
    phone: String(formData.get("phone") || ""),
    priority: String(formData.get("priority") || "B"),
    followUp: String(formData.get("followUp") || ""),
    notes: String(formData.get("notes") || ""),
    sendFollowUpEmail: Boolean(
      leadForm.elements.sendFollowUpEmail.checked &&
        !leadForm.elements.sendFollowUpEmail.disabled,
    ),
  };

  if (
    !action.name.trim() && !action.company.trim() && !action.email.trim() && !action.phone.trim()
  ) {
    setLeadError("Add at least a name, company, email, or phone.");
    leadForm.elements.name.focus();
    return;
  }

  const submit = leadForm.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || "Could not save lead.");
    state.payload.state = body.state;
    const selectedId = action.calendarBlockId;
    leadForm.reset();
    leadForm.elements.calendarBlockId.value = selectedId;
    leadForm.elements.priority.value = "B";
    state.followUpEmailTouched = false;
    renderFollowUpEmailControl();
    renderCRM();
    leadForm.elements.name.focus();
  } catch (error) {
    setLeadError(error instanceof Error ? error.message : "Could not save lead.");
  } finally {
    submit.disabled = false;
  }
}

async function handleCardInput() {
  const file = cardInput.files?.[0];
  if (!file) return;
  const requestId = createDebugId("ocr");
  const selected = state.entriesByBlock.get(leadForm.elements.calendarBlockId.value);
  const eventTitle = selected?.displayTitle || "";
  setLeadError("");
  setCardScanStatus(`Reading card... ${requestId}`);
  setCardScanBusy(true);
  await logClientEvent("ocr_file_selected", {
    requestId,
    file: fileMetadata(file),
    eventTitle,
    browser: browserMetadata(),
  });

  try {
    const image = await imageFileToDataUrl(file);
    await logClientEvent("ocr_image_prepared", {
      requestId,
      file: fileMetadata(file),
      image: image.metadata,
      browser: browserMetadata(),
    });

    try {
      await saveCardImageRecord({
        id: requestId,
        createdAt: new Date().toISOString(),
        eventTitle,
        fileName: file.name || "business-card",
        fileType: file.type || "unknown",
        fileSize: file.size,
        original: file,
        compressed: dataUrlToBlob(image.compressedDataUrl || image.dataUrl),
        metadata: image.metadata,
      });
      await logClientEvent("ocr_image_stored", {
        requestId,
        stored: true,
        image: image.metadata,
      });
    } catch (storageError) {
      await logClientEvent("ocr_image_store_failed", {
        requestId,
        error: errorDetails(storageError),
      });
    }

    cardPreview.src = image.previewDataUrl || image.dataUrl;
    cardPreview.hidden = false;
    setCardScanStatus(`Extracting with AI... ${requestId}`);

    const body = await requestOcrDraft({ requestId, file, image, eventTitle });
    applyLeadDraft(body.draft || {});
    setCardScanStatus(`Card scanned. Review and save. ${requestId}`);
  } catch (error) {
    await logClientEvent("ocr_client_error", {
      requestId,
      error: errorDetails(error),
      file: fileMetadata(file),
      browser: browserMetadata(),
    });
    setCardScanStatus(`Scan failed. ${requestId}`);
    setLeadError(error instanceof Error ? error.message : "Could not scan card.");
  } finally {
    setCardScanBusy(false);
    cardInput.value = "";
  }
}

async function requestOcrDraft({ requestId, file, image, eventTitle }) {
  const payloads = Array.isArray(image.ocrPayloads) && image.ocrPayloads.length
    ? image.ocrPayloads
    : [{ dataUrl: image.dataUrl, metadata: image.metadata }];
  const requestPayloads = payloads.slice(0, OCR_MAX_REQUEST_ATTEMPTS);
  let lastBody = null;

  for (const [attemptIndex, payload] of requestPayloads.entries()) {
    const attemptRequestId = attemptIndex === 0 ? requestId : `${requestId}_r${attemptIndex}`;
    if (attemptIndex > 0) {
      setCardScanStatus(`Retrying OCR image... ${requestId}`);
    }
    await logClientEvent("ocr_request_attempt", {
      requestId,
      attemptRequestId,
      attemptIndex,
      image: payload.metadata,
      browser: browserMetadata(),
    });

    let response = null;
    try {
      response = await fetchWithTimeout("/api/leads/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: attemptRequestId,
          imageDataUrl: payload.dataUrl,
          eventTitle,
          clientMetadata: {
            baseRequestId: requestId,
            attemptIndex,
            file: fileMetadata(file),
            image: payload.metadata,
            browser: browserMetadata(),
            localImageStore: {
              db: CARD_DB_NAME,
              store: CARD_STORE,
              key: requestId,
            },
          },
        }),
      }, OCR_REQUEST_TIMEOUT_MS);
    } catch (error) {
      lastBody = {
        error: {
          message: error instanceof DOMException && error.name === "AbortError"
            ? "Business card OCR timed out."
            : "Business card OCR request failed.",
          requestId: attemptRequestId,
          detail: errorDetails(error),
        },
      };
      await logClientEvent("ocr_request_error", {
        requestId,
        attemptRequestId,
        attemptIndex,
        error: errorDetails(error),
      });
      const canRetry = attemptIndex < requestPayloads.length - 1;
      if (!canRetry) break;
      await logClientEvent("ocr_retry_after_failure", {
        requestId,
        failedAttemptRequestId: attemptRequestId,
        failedStatus: 0,
        nextAttemptIndex: attemptIndex + 1,
        nextImage: requestPayloads[attemptIndex + 1]?.metadata,
      });
      continue;
    }
    const body = await response.json().catch(() => ({
      error: { message: "Could not parse OCR response.", requestId: attemptRequestId },
    }));
    lastBody = body;
    await logClientEvent("ocr_response", {
      requestId,
      attemptRequestId,
      attemptIndex,
      ok: response.ok,
      status: response.status,
      responseRequestId: body?.requestId || body?.error?.requestId || "",
      headers: {
        techweekRequestId: response.headers.get("x-techweek-request-id") || "",
        uosRequestId: response.headers.get("x-uos-request-id") || "",
        denoTraceId: response.headers.get("x-deno-trace-id") || "",
        uosWarning: response.headers.get("x-uos-warning") || "",
        upstream: response.headers.get("x-ubq-upstream") || "",
      },
      body: response.ok ? { hasDraft: Boolean(body?.draft) } : body,
    });

    if (response.ok) {
      if (leadDraftHasUsableFields(body?.draft)) return body;
      lastBody = {
        error: {
          message: "Business card OCR did not find any lead fields.",
          requestId: body?.requestId || attemptRequestId,
        },
      };
    }
    const canRetry = (response.status >= 500 || response.status === 422 || response.ok) &&
      attemptIndex < requestPayloads.length - 1;
    if (!canRetry) break;

    await logClientEvent("ocr_retry_after_failure", {
      requestId,
      failedAttemptRequestId: attemptRequestId,
      failedStatus: response.status,
      nextAttemptIndex: attemptIndex + 1,
      nextImage: requestPayloads[attemptIndex + 1]?.metadata,
    });
  }

  const debugId = lastBody?.error?.requestId || requestId;
  throw new Error(`${lastBody?.error?.message || "Could not scan card."} Debug: ${debugId}`);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function applyLeadDraft(draft) {
  for (const field of ["name", "company", "role", "email", "phone", "followUp", "notes"]) {
    if (typeof draft[field] === "string" && draft[field].trim()) {
      leadForm.elements[field].value = draft[field].trim();
    }
  }
  if (["A", "B", "C"].includes(draft.priority)) {
    leadForm.elements.priority.value = draft.priority;
  }
}

function leadDraftHasUsableFields(draft) {
  if (!draft || typeof draft !== "object") return false;
  return ["name", "company", "email", "phone"].some((field) => String(draft[field] || "").trim());
}

async function imageFileToDataUrl(file) {
  const sourceOrientation = await readImageOrientation(file);
  const preferredRotation = rotationForOrientation(sourceOrientation);
  const original = await fileToDataUrl(file);
  try {
    const image = await loadImage(original);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (!longest) {
      return {
        dataUrl: original,
        metadata: {
          conversion: "original_no_dimensions",
          originalDataUrlCharacters: original.length,
        },
      };
    }
    const originalMimeType = file.type || dataUrlMimeType(original) || "";
    const crop = detectBusinessCardCrop(image, preferredRotation);
    const fullFrameCrop = {
      ...crop,
      method: "full_frame_retry",
      confidence: 0,
      xRatio: 0,
      yRatio: 0,
      widthRatio: 1,
      heightRatio: 1,
      areaRatio: 1,
    };
    const renderedAttempts = OCR_IMAGE_ATTEMPTS.map((attempt) =>
      renderDetectedCardImage(
        image,
        attempt.ocrSource === "canvas_full_frame_fallback" ? fullFrameCrop : crop,
        attempt,
      )
    );
    const usableAttempts = renderedAttempts.filter((attempt) =>
      attempt.dataUrl.length <= OCR_IMAGE_TARGET_CHARS
    );
    const selectedAttempts =
      (usableAttempts.length ? usableAttempts : [renderedAttempts[renderedAttempts.length - 1]])
        .slice(0, OCR_MAX_REQUEST_ATTEMPTS);
    const attemptMetadata = renderedAttempts.map((attempt) => ocrAttemptDebug(attempt));
    const metadataForPayload = (attempt, retryIndex) => ({
      conversion: "canvas_auto_edge_crop",
      ocrSource: attempt.ocrSource,
      originalMimeType,
      sourceExifOrientation: sourceOrientation,
      preferredRotationDegrees: preferredRotation,
      ocrDataUrlCharacters: attempt.dataUrl.length,
      ocrApproxBytes: dataUrlApproxBytes(attempt.dataUrl),
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      outputWidth: attempt.outputWidth,
      outputHeight: attempt.outputHeight,
      scale: attempt.scale,
      quality: attempt.quality,
      longestEdge: attempt.longestEdge,
      rotationDegrees: attempt.rotationDegrees || 0,
      targetDataUrlCharacters: OCR_IMAGE_TARGET_CHARS,
      originalDataUrlCharacters: original.length,
      compressedDataUrlCharacters: attempt.dataUrl.length,
      compressedApproxBytes: dataUrlApproxBytes(attempt.dataUrl),
      crop: cropDebug(attempt.crop),
      attempts: attemptMetadata,
      retryIndex,
    });
    const ocrPayloads = selectedAttempts.map((attempt, retryIndex) => ({
      dataUrl: attempt.dataUrl,
      metadata: metadataForPayload(attempt, retryIndex),
    }));
    const primaryPayload = ocrPayloads[0];
    const preview = renderDetectedCardImage(image, crop, {
      longestEdge: 900,
      quality: 0.74,
      ocrSource: "canvas_auto_edge_crop_preview",
    });
    return {
      dataUrl: primaryPayload.dataUrl,
      previewDataUrl: preview.dataUrl,
      compressedDataUrl: primaryPayload.dataUrl,
      metadata: primaryPayload.metadata,
      ocrPayloads,
    };
  } catch (error) {
    return {
      dataUrl: original,
      metadata: {
        conversion: "original_decode_failed",
        sourceExifOrientation: sourceOrientation,
        preferredRotationDegrees: preferredRotation,
        originalDataUrlCharacters: original.length,
        error: errorDetails(error),
      },
    };
  }
}

function dataUrlMimeType(dataUrl) {
  return dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?,/)?.[1] || "";
}

function prioritizedRotations(preferredRotation) {
  const rotations = [preferredRotation, ...OCR_ROTATION_CANDIDATES];
  const seen = new Set();
  return rotations.filter((rotation) => {
    const normalized = Number(rotation) || 0;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function detectBusinessCardCrop(image, preferredRotation) {
  let best = null;
  for (const rotationDegrees of prioritizedRotations(preferredRotation)) {
    const rendered = renderOrientedImageCanvas(image, OCR_ANALYSIS_LONGEST_EDGE, rotationDegrees);
    const detected = detectCropBounds(rendered.canvas);
    const candidate = {
      ...detected,
      rotationDegrees,
      analysisWidth: rendered.canvas.width,
      analysisHeight: rendered.canvas.height,
    };
    if (!best || candidate.confidence > best.confidence) best = candidate;
  }

  if (best && best.confidence >= 0.28) return best;
  return {
    method: "full_frame_fallback",
    confidence: best?.confidence || 0,
    rotationDegrees: best?.rotationDegrees || Number(preferredRotation) || 0,
    xRatio: 0,
    yRatio: 0,
    widthRatio: 1,
    heightRatio: 1,
    areaRatio: 1,
    edgeWeight: best?.edgeWeight || 0,
    analysisWidth: best?.analysisWidth || 0,
    analysisHeight: best?.analysisHeight || 0,
  };
}

function detectCropBounds(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const width = canvas.width;
  const height = canvas.height;
  const imageData = context.getImageData(0, 0, width, height);
  const border = sampleBorderColor(imageData.data, width, height);
  const cols = new Float32Array(width);
  const rows = new Float32Array(height);
  const stride = Math.max(1, Math.round(Math.max(width, height) / 420));
  let edgeWeight = 0;

  for (let y = stride; y < height - stride; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const index = (y * width + x) * 4;
      const rightIndex = (y * width + Math.min(width - 1, x + stride)) * 4;
      const downIndex = (Math.min(height - 1, y + stride) * width + x) * 4;
      const r = imageData.data[index];
      const g = imageData.data[index + 1];
      const b = imageData.data[index + 2];
      const luma = pixelLuma(r, g, b);
      const rightLuma = pixelLuma(
        imageData.data[rightIndex],
        imageData.data[rightIndex + 1],
        imageData.data[rightIndex + 2],
      );
      const downLuma = pixelLuma(
        imageData.data[downIndex],
        imageData.data[downIndex + 1],
        imageData.data[downIndex + 2],
      );
      const edge = Math.abs(luma - rightLuma) + Math.abs(luma - downLuma);
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      const contrast = Math.abs(r - border.r) + Math.abs(g - border.g) +
        Math.abs(b - border.b);
      let weight = 0;
      if (edge > 30) weight += 2;
      if (contrast > 42 && (luma > 120 || saturation < 92)) weight += 1;
      if (luma > 185 && saturation < 82 && contrast > 16) weight += 1;
      if (!weight) continue;
      cols[x] += weight;
      rows[y] += weight;
      edgeWeight += weight;
    }
  }

  const xRange = weightedBounds(cols);
  const yRange = weightedBounds(rows);
  if (!xRange || !yRange) {
    return {
      method: "edge_detect_empty",
      confidence: 0,
      xRatio: 0,
      yRatio: 0,
      widthRatio: 1,
      heightRatio: 1,
      areaRatio: 1,
      edgeWeight,
    };
  }

  const padX = Math.max(width * 0.025, (xRange.end - xRange.start) * 0.09);
  const padY = Math.max(height * 0.025, (yRange.end - yRange.start) * 0.12);
  const x = clampNumber(xRange.start - padX, 0, width - 1);
  const y = clampNumber(yRange.start - padY, 0, height - 1);
  const right = clampNumber(xRange.end + padX, x + 1, width);
  const bottom = clampNumber(yRange.end + padY, y + 1, height);
  const cropWidth = right - x;
  const cropHeight = bottom - y;
  const areaRatio = (cropWidth * cropHeight) / (width * height);
  const aspect = cropWidth / Math.max(1, cropHeight);
  const aspectScore = aspect > 0.42 && aspect < 2.85 ? 0.22 : 0.06;
  const areaScore = areaRatio > 0.06 && areaRatio < 0.94 ? 0.32 : 0.08;
  const edgeScore = Math.min(0.34, edgeWeight / (width * height) * 18);
  const marginScore = x > width * 0.01 || y > height * 0.01 ||
      right < width * 0.99 || bottom < height * 0.99
    ? 0.12
    : 0.02;

  return {
    method: "auto_edge_detect",
    confidence: Math.min(1, areaScore + aspectScore + edgeScore + marginScore),
    xRatio: x / width,
    yRatio: y / height,
    widthRatio: cropWidth / width,
    heightRatio: cropHeight / height,
    areaRatio,
    edgeWeight,
  };
}

function weightedBounds(weights) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const lowTarget = total * 0.015;
  const highTarget = total * 0.985;
  let start = 0;
  let end = weights.length - 1;
  let seen = 0;
  for (let index = 0; index < weights.length; index += 1) {
    seen += weights[index];
    if (seen >= lowTarget) {
      start = index;
      break;
    }
  }
  seen = 0;
  for (let index = 0; index < weights.length; index += 1) {
    seen += weights[index];
    if (seen >= highTarget) {
      end = index;
      break;
    }
  }
  return { start, end: Math.max(start + 1, end) };
}

function sampleBorderColor(data, width, height) {
  const step = Math.max(1, Math.round(Math.max(width, height) / 64));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const add = (x, y) => {
    const index = (y * width + x) * 4;
    r += data[index];
    g += data[index + 1];
    b += data[index + 2];
    count += 1;
  };
  for (let x = 0; x < width; x += step) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    add(0, y);
    add(width - 1, y);
  }
  return {
    r: r / Math.max(1, count),
    g: g / Math.max(1, count),
    b: b / Math.max(1, count),
  };
}

function pixelLuma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function renderDetectedCardImage(image, crop, attempt) {
  const rendered = renderOrientedImageCanvas(image, attempt.longestEdge, crop.rotationDegrees);
  const sourceRect = cropRectForCanvas(crop, rendered.canvas.width, rendered.canvas.height);
  const canvas = document.createElement("canvas");
  canvas.width = sourceRect.width;
  canvas.height = sourceRect.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    rendered.canvas,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return {
    ...attempt,
    crop,
    rotationDegrees: crop.rotationDegrees || 0,
    scale: rendered.scale,
    outputWidth: canvas.width,
    outputHeight: canvas.height,
    dataUrl: canvas.toDataURL("image/jpeg", attempt.quality),
  };
}

function renderOrientedImageCanvas(image, longestEdge, rotationDegrees = 0) {
  const sourceLongest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, longestEdge / sourceLongest);
  const outputWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const outputHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const rotated = rotationDegrees === 90 || rotationDegrees === 270;
  const canvas = document.createElement("canvas");
  canvas.width = rotated ? outputHeight : outputWidth;
  canvas.height = rotated ? outputWidth : outputHeight;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (rotationDegrees === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
  } else if (rotationDegrees === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
  } else if (rotationDegrees === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
  } else {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  return { canvas, scale };
}

function cropRectForCanvas(crop, canvasWidth, canvasHeight) {
  const x = Math.round(clampNumber(crop.xRatio || 0, 0, 1) * canvasWidth);
  const y = Math.round(clampNumber(crop.yRatio || 0, 0, 1) * canvasHeight);
  const width = Math.round(clampNumber(crop.widthRatio || 1, 0.02, 1) * canvasWidth);
  const height = Math.round(clampNumber(crop.heightRatio || 1, 0.02, 1) * canvasHeight);
  return {
    x: clampNumber(x, 0, Math.max(0, canvasWidth - 1)),
    y: clampNumber(y, 0, Math.max(0, canvasHeight - 1)),
    width: Math.max(1, Math.min(width, canvasWidth - x)),
    height: Math.max(1, Math.min(height, canvasHeight - y)),
  };
}

function ocrAttemptDebug(attempt) {
  return {
    ocrSource: attempt.ocrSource,
    longestEdge: attempt.longestEdge,
    quality: attempt.quality,
    rotationDegrees: attempt.rotationDegrees || 0,
    outputWidth: attempt.outputWidth,
    outputHeight: attempt.outputHeight,
    scale: attempt.scale,
    dataUrlCharacters: attempt.dataUrl.length,
    approxBytes: dataUrlApproxBytes(attempt.dataUrl),
    crop: cropDebug(attempt.crop),
  };
}

function cropDebug(crop) {
  return {
    method: crop?.method || "unknown",
    confidence: Number((crop?.confidence || 0).toFixed(3)),
    rotationDegrees: crop?.rotationDegrees || 0,
    xRatio: Number((crop?.xRatio || 0).toFixed(4)),
    yRatio: Number((crop?.yRatio || 0).toFixed(4)),
    widthRatio: Number((crop?.widthRatio || 1).toFixed(4)),
    heightRatio: Number((crop?.heightRatio || 1).toFixed(4)),
    areaRatio: Number((crop?.areaRatio || 1).toFixed(4)),
    edgeWeight: Math.round(crop?.edgeWeight || 0),
    analysisWidth: crop?.analysisWidth || 0,
    analysisHeight: crop?.analysisHeight || 0,
  };
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function dataUrlApproxBytes(dataUrl) {
  return Math.round((dataUrl.split(",", 2)[1]?.length || 0) * 0.75);
}

async function readImageOrientation(file) {
  if (!file || !/jpe?g/i.test(`${file.type} ${file.name || ""}`)) return 1;
  try {
    const buffer = await file.slice(0, 256 * 1024).arrayBuffer();
    return readJpegExifOrientation(new DataView(buffer)) || 1;
  } catch {
    return 1;
  }
}

function readJpegExifOrientation(view) {
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 0;
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > view.byteLength) break;
    const size = view.getUint16(offset, false);
    if (size < 2 || offset + size > view.byteLength) break;
    if (marker === 0xe1) {
      const exifStart = offset + 2;
      if (readAscii(view, exifStart, 6) === "Exif\0\0") {
        return readTiffOrientation(view, exifStart + 6);
      }
    }
    offset += size;
  }
  return 0;
}

function readTiffOrientation(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return 0;
  const endian = view.getUint16(tiffStart, false);
  const littleEndian = endian === 0x4949;
  if (!littleEndian && endian !== 0x4d4d) return 0;
  const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
  const ifdStart = tiffStart + firstIfdOffset;
  if (ifdStart + 2 > view.byteLength) return 0;
  const entries = view.getUint16(ifdStart, littleEndian);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdStart + 2 + index * 12;
    if (entry + 12 > view.byteLength) break;
    if (view.getUint16(entry, littleEndian) === 0x0112) {
      return view.getUint16(entry + 8, littleEndian);
    }
  }
  return 0;
}

function readAscii(view, offset, length) {
  if (offset + length > view.byteLength) return "";
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function rotationForOrientation(orientation) {
  if (orientation === 3) return 180;
  if (orientation === 6) return 270;
  if (orientation === 8) return 90;
  return 0;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener(
      "error",
      () => reject(reader.error || new Error("Could not read image.")),
    );
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not decode image.")));
    image.src = src;
  });
}

function createDebugId(prefix) {
  return `${prefix}_${(crypto.randomUUID?.() || `${Date.now()}_${Math.random()}`).slice(0, 8)}`;
}

function fileMetadata(file) {
  return {
    name: file.name || "",
    type: file.type || "",
    size: file.size,
    lastModified: file.lastModified || 0,
  };
}

function browserMetadata() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
    },
    online: navigator.onLine,
  };
}

function errorDetails(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 4).join("\n") || "",
    };
  }
  return { message: String(error) };
}

async function logClientEvent(event, payload) {
  try {
    await fetch("/api/client-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        requestId: payload?.requestId || "",
        event,
        page: location.href,
        payload,
      }),
    });
  } catch {
    // Logging must never block the mobile flow.
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, data = ""] = String(dataUrl).split(",", 2);
  const mime = header.match(/^data:([^;,]+)/)?.[1] || "application/octet-stream";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function openCardImageDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(CARD_DB_NAME, CARD_DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CARD_STORE)) {
        const store = database.createObjectStore(CARD_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener(
      "error",
      () => reject(request.error || new Error("Could not open card image database.")),
    );
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener(
      "error",
      () => reject(request.error || new Error("IndexedDB failed.")),
    );
  });
}

function idbTransactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error || new Error("IndexedDB transaction aborted.")),
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error || new Error("IndexedDB transaction failed.")),
    );
  });
}

async function saveCardImageRecord(record) {
  const database = await openCardImageDb();
  try {
    const transaction = database.transaction(CARD_STORE, "readwrite");
    const done = idbTransactionDone(transaction);
    transaction.objectStore(CARD_STORE).put(record);
    await done;
    await pruneCardImageRecords(database);
  } finally {
    database.close();
  }
}

async function pruneCardImageRecords(database) {
  const readTransaction = database.transaction(CARD_STORE, "readonly");
  const readDone = idbTransactionDone(readTransaction);
  const records = await idbRequest(readTransaction.objectStore(CARD_STORE).getAll());
  await readDone;
  const sorted = Array.isArray(records)
    ? records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    : [];
  const stale = sorted.slice(CARD_IMAGE_LIMIT).filter((record) => record?.id);
  if (!stale.length) return;
  const transaction = database.transaction(CARD_STORE, "readwrite");
  const done = idbTransactionDone(transaction);
  const store = transaction.objectStore(CARD_STORE);
  for (const record of stale) {
    store.delete(record.id);
  }
  await done;
}

function setLeadError(message) {
  leadError.textContent = message;
  leadError.hidden = !message;
}

function setCardScanStatus(message) {
  cardScanStatus.textContent = message;
}

function setCardScanBusy(busy) {
  cardInput.disabled = busy;
  cardScanButton.setAttribute("aria-disabled", String(busy));
}

function renderEntry(entry) {
  return renderEntryCard(entry, false);
}

function renderTimelineEntry(entry, lanes) {
  const article = renderEntryCard(entry, true);
  const start = minuteOfDay(entry.start);
  const end = Math.max(minuteOfDay(entry.end), start + 15);
  const lane = lanes.get(entry.calendarBlockId) || { index: 0, count: 1 };
  article.style.gridRow = `${Math.floor(start / 15) + 1} / span ${
    Math.max(1, Math.ceil((end - start) / 15))
  }`;
  article.style.width = `calc(${100 / lane.count}% - ${lane.count === 1 ? 0 : 3}px)`;
  article.style.marginLeft = lane.index === 0
    ? "0"
    : `calc(${lane.index * 100 / lane.count}% + ${lane.index * 3}px)`;
  return article;
}

function renderEntryCard(entry, compact) {
  const localNote = state.payload.state.eventNotes[entry.calendarBlockId]?.note?.trim() || "";
  const isOption = entry.calendar === "reference";
  const article = document.createElement("article");
  article.dataset.entry = entry.calendarBlockId;
  article.dataset.type = entry.blockType;
  article.dataset.calendar = entry.calendar || "";
  if (isOption) article.dataset.option = "true";
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.setAttribute(
    "aria-label",
    `${isOption ? "Option: " : ""}${entry.displayTitle}, ${entry.timeRange}`,
  );
  article.addEventListener("click", () => openEventModal(entry));
  article.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openEventModal(entry);
    }
  });

  const header = document.createElement("header");
  const titleRow = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = compact && isOption
    ? `Option: ${entry.displayTitle}`
    : compact
    ? compactTitle(entry)
    : entry.displayTitle;
  const time = document.createElement("time");
  time.textContent = entry.timeRange;
  titleRow.append(title, time);

  const meta = document.createElement("section");
  meta.dataset.meta = "";
  if (isOption) addPill(meta, entry.optionLabel || optionLabel(entry));
  if (entry.blockType === "event") addPill(meta, entry.statusLabel || entry.status, entry.status);
  if (entry.blockType === "event" && entry.tier) addPill(meta, entry.tier);
  if (entry.blockType === "travel" && entry.travelMinutes) {
    addPill(meta, `${entry.travelMinutes} min`);
  }
  header.append(titleRow, meta);

  const location = document.createElement("p");
  const locationText = entry.location || entry.venueQuery || "";
  if (locationText) location.append(renderPlaceLink(entry, locationText));

  const detail = document.createElement("p");
  detail.textContent = entry.routeDetails || entry.note || firstCoachingLine(entry.salesCoaching);

  article.append(header);
  if (location.textContent && !compact) article.append(location);
  if (localNote) {
    const note = document.createElement("p");
    note.textContent = `Note: ${localNote}`;
    article.append(note);
  }
  return article;
}

function computeCollisionLanes(entries) {
  const sorted = entries
    .map((entry) => ({
      entry,
      start: minuteOfDay(entry.start),
      end: Math.max(minuteOfDay(entry.end), minuteOfDay(entry.start) + 15),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const groups = [];
  let current = [];
  let currentEnd = -1;

  for (const item of sorted) {
    if (!current.length || item.start < currentEnd) {
      current.push(item);
      currentEnd = Math.max(currentEnd, item.end);
    } else {
      groups.push(current);
      current = [item];
      currentEnd = item.end;
    }
  }
  if (current.length) groups.push(current);

  const result = new Map();
  for (const group of groups) {
    const laneEnds = [];
    const assignments = [];
    for (const item of group) {
      let laneIndex = laneEnds.findIndex((end) => end <= item.start);
      if (laneIndex === -1) {
        laneIndex = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[laneIndex] = item.end;
      }
      assignments.push({ id: item.entry.calendarBlockId, index: laneIndex });
    }
    const count = Math.max(1, laneEnds.length);
    for (const assignment of assignments) {
      result.set(assignment.id, { index: assignment.index, count });
    }
  }
  return result;
}

function openEventModal(entry) {
  document.querySelector("[data-event-type]").textContent = entry.calendar === "reference"
    ? "option"
    : entry.blockType;
  document.querySelector("[data-event-title]").textContent = entry.displayTitle;
  document.querySelector("[data-event-time]").textContent = `${entry.weekday} ${entry.timeRange}`;
  document.querySelector("[data-event-place]").replaceChildren(
    renderPlaceLink(entry, entry.location || entry.venueQuery),
  );
  document.querySelector("[data-event-detail]").textContent = entry.routeDetails || entry.note ||
    firstCoachingLine(entry.salesCoaching) || "";
  const actions = document.querySelector("[data-event-actions]");
  actions.replaceChildren(...eventActions(entry));
  eventModal.hidden = false;
  eventBackdrop.hidden = false;
  document.body.dataset.modalOpen = "true";
}

function closeEventModal() {
  eventModal.hidden = true;
  eventBackdrop.hidden = true;
  document.body.dataset.modalOpen = "false";
}

function eventActions(entry) {
  const actions = [];
  if (entry.blockType === "event") {
    const ask = document.createElement("button");
    ask.type = "button";
    setButtonContent(ask, "sparkles", "Ask");
    ask.addEventListener("click", () => {
      if (state.agentBusy) return;
      openEventCoachingChat(entry);
    });
    actions.push(ask);
  }

  if (entry.googleMapsUrl) {
    const directions = document.createElement("a");
    directions.href = directionsUrl(entry, entry.location || entry.venueQuery);
    directions.target = "_blank";
    directions.rel = "noreferrer";
    directions.dataset.variant = "primary";
    setButtonContent(directions, "map-pin", "Maps");
    actions.push(directions);
  }

  if (entry.eventUrl) {
    const link = document.createElement("a");
    link.href = entry.eventUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    setButtonContent(link, "external", "Open");
    actions.push(link);
  }

  return actions;
}

function renderIcon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  const use = document.createElementNS(SVG_NS, "use");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function setButtonContent(element, iconName, label) {
  const span = document.createElement("span");
  span.textContent = label;
  element.replaceChildren(renderIcon(iconName), span);
}

function renderPlaceLink(entry, text) {
  const label = String(text || "").trim();
  if (!label) return document.createTextNode("");
  const directions = directionsUrl(entry, label);
  if (!directions) return document.createTextNode(label);

  const link = document.createElement("a");
  link.href = directions;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.dataset.placeLink = "";
  link.setAttribute("aria-label", `Open directions to ${label} from current location`);
  link.addEventListener("click", (event) => event.stopPropagation());
  const span = document.createElement("span");
  span.textContent = label;
  link.append(renderIcon("map-pin"), span);
  return link;
}

function directionsUrl(entry, label) {
  const destination = mapsDestination(entry.googleMapsUrl) || String(label || "").trim();
  if (!destination) return "";

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", destination);
  url.searchParams.set("dir_action", "navigate");

  const travelmode = travelMode(entry);
  if (travelmode) url.searchParams.set("travelmode", travelmode);
  return url.toString();
}

function mapsDestination(value) {
  try {
    const url = new URL(value || "");
    return url.searchParams.get("destination") || url.searchParams.get("query") || "";
  } catch {
    return "";
  }
}

function travelMode(entry) {
  const route = `${entry.routeMode || ""} ${entry.routeDetails || ""}`.toLowerCase();
  if (route.includes("subway") || route.includes("transit")) return "transit";
  if (route.includes("walk")) return "walking";
  return "";
}

function renderTimeRail() {
  const rail = document.createElement("section");
  rail.dataset.timeRail = "";
  for (let hour = 0; hour < 24; hour += 2) {
    const tick = document.createElement("time");
    tick.textContent = hourLabel(hour);
    tick.style.gridRow = `${hour * 4 + 1} / span 1`;
    rail.append(tick);
  }
  return rail;
}

function minuteOfDay(value) {
  const match = String(value || "").match(/\s(\d{2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function hourLabel(hour) {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

function compactTitle(entry) {
  if (entry.blockType === "travel") return "Travel";
  if (entry.blockType === "eating") return "Food";
  if (entry.blockType === "sleeping") return "Sleep";
  if (entry.entryType === "morning" || entry.category === "morning") return "Morning";
  if (entry.entryType === "buffer" || entry.category === "buffer") return "Buffer";
  return entry.displayTitle;
}

function addPill(parent, text, status = "") {
  if (!text) return;
  const pill = document.createElement("span");
  pill.textContent = text;
  if (status) pill.dataset.status = status;
  parent.append(pill);
}

function firstCoachingLine(value) {
  return (value || "").split("\n").map((line) => line.trim()).find(Boolean) || "";
}

async function openEventCoachingChat(entry) {
  const prompt = eventCoachingPrompt(entry);
  const meta = await eventChatMeta(entry, prompt);
  const existing = findCachedChatSession(meta.cacheKey);

  closeEventModal();
  openChat();

  if (existing) {
    loadChatSession(existing.id);
    return;
  }

  startNewChat({ id: meta.cacheKey, meta });
  askAgent(prompt);
}

function eventCoachingPrompt(entry) {
  return `Give me event-specific coaching for "${entry.displayTitle}". Include room read, opening line, questions, who to meet, and follow-up.`;
}

async function eventChatMeta(entry, prompt) {
  const fingerprint = {
    version: EVENT_CHAT_CONTEXT_VERSION,
    kind: "event_coaching",
    prompt,
    event: eventChatFingerprint(entry),
    crm: crmChatFingerprint(),
  };
  const hash = await stableHash(JSON.stringify(fingerprint));
  return {
    kind: "event_coaching",
    cacheKey: `event-chat-${hash.slice(0, 40)}`,
    contextHash: hash,
    version: EVENT_CHAT_CONTEXT_VERSION,
    calendarBlockId: entry.calendarBlockId,
    techweekId: entry.techweekId,
    eventTitle: entry.displayTitle,
    prompt,
  };
}

function eventChatFingerprint(entry) {
  const keys = [
    "calendar",
    "techweekId",
    "calendarBlockId",
    "partifulId",
    "rerankId",
    "status",
    "category",
    "start",
    "end",
    "actualStart",
    "actualEnd",
    "weekday",
    "timeRange",
    "displayTitle",
    "location",
    "venueQuery",
    "venuePrecision",
    "note",
    "salesCoaching",
    "rank",
    "tier",
    "opportunityScore",
    "eventUrl",
    "googleMapsUrl",
  ];
  return Object.fromEntries(keys.map((key) => [key, String(entry[key] || "")]));
}

function crmChatFingerprint() {
  const appState = state.payload?.state || {};
  const leads = Array.isArray(appState.leads) ? appState.leads : [];
  const eventNotes = appState.eventNotes && typeof appState.eventNotes === "object"
    ? appState.eventNotes
    : {};
  return {
    updatedAt: String(appState.updatedAt || ""),
    eventNotes,
    leads: leads.map((lead) => ({
      calendarBlockId: String(lead.calendarBlockId || ""),
      techweekId: String(lead.techweekId || ""),
      eventTitle: String(lead.eventTitle || ""),
      name: String(lead.name || ""),
      company: String(lead.company || ""),
      role: String(lead.role || ""),
      email: String(lead.email || ""),
      phone: String(lead.phone || ""),
      notes: String(lead.notes || ""),
      priority: String(lead.priority || ""),
      followUp: String(lead.followUp || ""),
      createdAt: String(lead.createdAt || ""),
      updatedAt: String(lead.updatedAt || ""),
    })),
  };
}

async function stableHash(value) {
  const bytes = new TextEncoder().encode(value);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function askAgent(prompt) {
  const history = state.messages.slice(-6);
  if (!history.length) {
    chatLog.replaceChildren();
    delete chatLog.dataset.empty;
  }
  appendMessage("user", prompt);
  const pending = appendMessage("assistant", "Thinking", false, { suppressTools: true });
  const pendingContent = pending.querySelector("[data-message-content]");
  pending.dataset.streaming = "true";
  setBusy(true);
  try {
    const clientContext = await readClientContext();
    const response = await fetch("/api/agent/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        messages: history,
        clientContext,
      }),
    });
    if (!response.ok) throw new Error(await agentResponseErrorMessage(response));
    if (!response.body) throw new Error("The agent response did not include a stream.");
    const result = await readAgentStream(response.body, pendingContent);
    pending.dataset.streaming = "false";
    delete pendingContent.dataset.streamingRows;
    if (!result.rendered) {
      pendingContent.innerHTML = renderMarkdown(result.text);
    }
    state.messages.push({ role: "assistant", content: result.text });
    attachMessageTools(pending, result.text);
    renderProposedActions(pending, result.actions || []);
    persistMessages();
  } catch (error) {
    pending.dataset.streaming = "false";
    delete pendingContent.dataset.streamingRows;
    const message = error instanceof Error ? error.message : "The agent request failed.";
    pendingContent.innerHTML = renderMarkdown(message);
    attachMessageTools(pending, message);
  } finally {
    setBusy(false);
  }
}

async function agentResponseErrorMessage(response) {
  const fallback = response.statusText || `Agent request failed with HTTP ${response.status}.`;
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || fallback;
  } catch {
    return fallback;
  }
}

async function readClientContext() {
  const context = {
    localIso: new Date().toISOString(),
    localText: new Date().toLocaleString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isSecureContext: globalThis.isSecureContext,
    locationStatus: "not_requested",
    viewport: {
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
      devicePixelRatio: globalThis.devicePixelRatio,
    },
  };

  const coordinates = await readCurrentPositionIfPermissionGranted();
  if (coordinates.ok) {
    context.coordinates = coordinates.value;
    context.locationStatus = "available";
  } else {
    context.locationStatus = coordinates.reason;
  }
  return context;
}

async function readCurrentPositionIfPermissionGranted() {
  if (!("geolocation" in navigator)) {
    return { ok: false, reason: "unavailable" };
  }
  if (!globalThis.isSecureContext) {
    return { ok: false, reason: "insecure_context_requires_https" };
  }

  const permissionState = await geolocationPermissionState();
  if (permissionState === "granted") {
    return await readCurrentPosition();
  }
  if (permissionState === "denied") {
    return { ok: false, reason: "permission_denied" };
  }
  if (permissionState === "prompt") {
    return { ok: false, reason: "permission_prompt_not_requested" };
  }
  return { ok: false, reason: "permission_state_unavailable_not_requested" };
}

async function geolocationPermissionState() {
  if (!navigator.permissions?.query) {
    return "unavailable";
  }

  try {
    const status = await Promise.race([
      navigator.permissions.query({ name: "geolocation" }),
      new Promise((resolve) => globalThis.setTimeout(() => resolve(null), 300)),
    ]);
    const state = status?.state;
    return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

function readCurrentPosition() {
  if (!("geolocation" in navigator)) {
    return Promise.resolve({ ok: false, reason: "unavailable" });
  }
  if (!globalThis.isSecureContext) {
    return Promise.resolve({ ok: false, reason: "insecure_context_requires_https" });
  }

  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => {
      resolve({ ok: false, reason: "timeout" });
    }, 2600);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        globalThis.clearTimeout(timeout);
        resolve({
          ok: true,
          value: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
          },
        });
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        resolve({ ok: false, reason: `error_${error.code}` });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 2400,
      },
    );
  });
}

async function readAgentStream(body, target) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let markdown = "";
  let finalText = "";
  let actions = [];
  let scheduled = false;
  let streamRenderer = null;

  const scheduleRender = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      streamRenderer?.update(markdown);
      scheduled = false;
    });
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    const events = raw.split(/\r?\n\r?\n/);
    raw = events.pop() || "";
    for (const eventBlock of events) {
      const event = parseSseEvent(eventBlock);
      if (!event) continue;
      if (event.event === "meta") {
        logAgentStreamMeta(event.data);
      } else if (event.event === "delta") {
        markdown += String(event.data.text || "");
        streamRenderer ??= createStreamingRenderer(target);
        scheduleRender();
      } else if (event.event === "done") {
        finalText = String(event.data.text || markdown);
        actions = Array.isArray(event.data.actions) ? event.data.actions : [];
      } else if (event.event === "error") {
        throw new Error(event.data.message || "Stream failed.");
      }
    }
  }

  if (scheduled) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  const text = finalText || markdown;
  const rendered = streamRenderer ? await streamRenderer.finish(text) : false;
  return { text, actions, rendered };
}

function createStreamingRenderer(target) {
  let visibleMarkdown = "";
  let queuedMarkdown = "";
  const revealQueue = [];
  let revealTimer = 0;
  let idleResolvers = [];
  let lastCompletionMs = 0;
  let averageCompletionMs = 120;
  let nextRevealMs = 0;

  return {
    update(markdown) {
      const nextMarkdown = completedStreamingMarkdown(markdown);
      enqueueStreamingMarkdown(nextMarkdown);
    },
    async finish(markdown) {
      const finalMarkdown = normalizeStreamingMarkdown(markdown);
      if (!finalMarkdown.trim()) return false;
      enqueueStreamingMarkdown(finalMarkdown, { force: true });
      await waitForStreamingRendererIdle();
      return true;
    },
  };

  function enqueueStreamingMarkdown(markdown, options = {}) {
    const nextMarkdown = normalizeStreamingMarkdown(markdown);
    const force = Boolean(options.force);
    if (!nextMarkdown.trim() || nextMarkdown === queuedMarkdown) return;

    const snapshots = streamingMarkdownSnapshots(queuedMarkdown, nextMarkdown, force);
    if (!snapshots.length) return;

    const now = performance.now();
    if (lastCompletionMs) {
      const observed = Math.max(16, (now - lastCompletionMs) / snapshots.length);
      averageCompletionMs = averageCompletionMs * 0.72 + observed * 0.28;
    }
    lastCompletionMs = now;

    for (const snapshot of snapshots) {
      if (snapshot !== queuedMarkdown) {
        revealQueue.push(snapshot);
        queuedMarkdown = snapshot;
      }
    }
    scheduleStreamingReveal();
  }

  function scheduleStreamingReveal() {
    if (revealTimer || !revealQueue.length) return;
    const delay = Math.max(0, nextRevealMs - performance.now());
    revealTimer = globalThis.setTimeout(runStreamingReveal, delay);
  }

  function runStreamingReveal() {
    revealTimer = 0;
    if (!revealQueue.length) {
      resolveStreamingRendererIdle();
      return;
    }

    visibleMarkdown = revealQueue.shift();
    renderStreamingMarkdown(target, visibleMarkdown);
    nextRevealMs = performance.now() + smoothedStreamingRevealDelay(revealQueue.length);

    if (revealQueue.length) {
      scheduleStreamingReveal();
    } else {
      resolveStreamingRendererIdle();
    }
  }

  function waitForStreamingRendererIdle() {
    if (!revealQueue.length && !revealTimer) return Promise.resolve();
    return new Promise((resolve) => idleResolvers.push(resolve));
  }

  function resolveStreamingRendererIdle() {
    if (revealQueue.length || revealTimer) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  function smoothedStreamingRevealDelay(queueDepth) {
    const base = clampNumber(averageCompletionMs * 0.78, 72, 180);
    const catchUp = queueDepth > 6 ? 1 + (queueDepth - 6) * 0.16 : 1;
    return Math.max(36, base / catchUp);
  }
}

function completedStreamingMarkdown(markdown) {
  const value = normalizeStreamingMarkdown(markdown);
  const lastBreak = value.lastIndexOf("\n");
  return lastBreak >= 0 ? value.slice(0, lastBreak + 1) : "";
}

function normalizeStreamingMarkdown(markdown) {
  return String(markdown || "").replace(/\r\n/g, "\n");
}

function streamingMarkdownSnapshots(fromMarkdown, toMarkdown, includePartial = false) {
  const from = normalizeStreamingMarkdown(fromMarkdown);
  const to = normalizeStreamingMarkdown(toMarkdown);
  const baseline = to.startsWith(from) ? from : "";
  const tail = to.slice(baseline.length);
  const snapshots = [];
  let lineStart = 0;

  for (let index = 0; index < tail.length; index += 1) {
    if (tail[index] !== "\n") continue;
    const line = tail.slice(lineStart, index);
    if (line.trim()) {
      snapshots.push(`${baseline}${tail.slice(0, index + 1)}`);
    }
    lineStart = index + 1;
  }

  if (includePartial && to.trim() && snapshots.at(-1) !== to) {
    snapshots.push(to);
  }

  return snapshots;
}

function renderStreamingMarkdown(target, markdown) {
  const template = document.createElement("template");
  template.innerHTML = renderMarkdown(markdown);
  const incoming = Array.from(template.content.children);
  if (!incoming.length) return;

  if (target.dataset.streamingRows !== "true") {
    target.replaceChildren();
    target.dataset.streamingRows = "true";
  }

  reconcileStreamingMarkdown(target, incoming);
}

function reconcileStreamingMarkdown(target, incoming) {
  for (let index = 0; index < incoming.length; index += 1) {
    const next = incoming[index];
    const current = target.children[index];
    if (!current) {
      markStreamingRows(next);
      target.append(next);
      continue;
    }

    if (streamComparableHtml(current) === streamComparableHtml(next)) continue;

    if (current.tagName === next.tagName) {
      syncRenderedElement(current, next);
    } else {
      markStreamingRows(next);
      current.replaceWith(next);
    }
  }

  while (target.children.length > incoming.length) {
    target.lastElementChild?.remove();
  }
}

function markStreamingRow(element) {
  element.dataset.streamRow = "";
}

function markStreamingRows(element) {
  if (isStreamingList(element)) {
    element.querySelectorAll(":scope > li").forEach(markStreamingRow);
  } else {
    markStreamingRow(element);
  }
}

function syncRenderedElement(current, next) {
  if (isStreamingList(current) && isStreamingList(next)) {
    syncRenderedList(current, next);
    return;
  }

  syncRenderedAttributes(current, next);
  current.replaceChildren(...Array.from(next.childNodes));
}

function syncRenderedList(current, next) {
  syncRenderedAttributes(current, next);
  const nextItems = Array.from(next.children);
  for (let index = 0; index < nextItems.length; index += 1) {
    const nextItem = nextItems[index];
    const currentItem = current.children[index];
    if (!currentItem) {
      markStreamingRow(nextItem);
      current.append(nextItem);
      continue;
    }

    if (streamComparableHtml(currentItem) === streamComparableHtml(nextItem)) continue;

    if (currentItem.tagName === nextItem.tagName) {
      syncRenderedElement(currentItem, nextItem);
    } else {
      markStreamingRow(nextItem);
      currentItem.replaceWith(nextItem);
    }
  }

  while (current.children.length > nextItems.length) {
    current.lastElementChild?.remove();
  }
}

function syncRenderedAttributes(current, next) {
  for (const attribute of Array.from(current.attributes)) {
    if (attribute.name === "data-stream-row") continue;
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(next.attributes)) {
    current.setAttribute(attribute.name, attribute.value);
  }
}

function isStreamingList(element) {
  return element.tagName === "UL" || element.tagName === "OL";
}

function streamComparableHtml(element) {
  const clone = element.cloneNode(true);
  if (clone.nodeType === Node.ELEMENT_NODE) {
    clone.removeAttribute("data-stream-row");
    clone.querySelectorAll("[data-stream-row]").forEach((row) =>
      row.removeAttribute("data-stream-row")
    );
  }
  return clone.outerHTML;
}

function logAgentStreamMeta(data) {
  if (data?.type !== "agent_prompt_debug") {
    return;
  }

  if (data.modelContext) {
    cacheModelContext({ model: data.model, modelContext: data.modelContext });
  }

  const utilization = data.utilization || {};
  const percent = typeof utilization.percentOfEffectiveContextWindow === "number"
    ? ` (${utilization.percentOfEffectiveContextWindow.toFixed(2)}% of effective)`
    : "";
  const effectiveLimit = utilization.effectiveContextWindowTokens ||
    utilization.contextWindowTokens;
  const rawContext =
    utilization.contextWindowTokens && effectiveLimit !== utilization.contextWindowTokens
      ? `; raw ${utilization.contextWindowTokens}`
      : "";
  const context = effectiveLimit
    ? `${utilization.estimatedInputTokens}/${effectiveLimit} tokens${percent}${rawContext}`
    : `${utilization.estimatedInputTokens} input tokens; context window unknown`;
  console.log(`[agent] utilization: ${context}`);
  console.log(
    `===== AGENT PROMPT SENT TO ${data.model || "MODEL"} =====\n${data.promptText || ""}`,
  );
}

function parseSseEvent(block) {
  const eventLine = block.split(/\r?\n/).find((line) => line.startsWith("event:"));
  const dataLine = block.split(/\r?\n/).find((line) => line.startsWith("data:"));
  if (!eventLine || !dataLine) return null;
  try {
    return {
      event: eventLine.slice(6).trim(),
      data: JSON.parse(dataLine.slice(5).trim()),
    };
  } catch {
    return null;
  }
}

function appendMessage(role, content, persist = true, options = {}) {
  const item = appendChatMessage(chatLog, role, content, options);
  if (persist && role === "user") {
    state.messages.push({ role, content });
    persistMessages();
  }
  return item;
}

function appendChatMessage(log, role, content, options = {}) {
  const item = document.createElement("section");
  item.dataset.message = role;
  const body = document.createElement("div");
  body.dataset.messageContent = "";
  if (role === "assistant") {
    body.innerHTML = renderMarkdown(content);
  } else {
    body.textContent = content;
  }
  item.append(body);
  if (role === "assistant" && !options.suppressTools) {
    attachMessageTools(item, content);
  }
  log.append(item);
  log.scrollTop = log.scrollHeight;
  return item;
}

function attachMessageTools(message, content) {
  if (message.dataset.message !== "assistant") return;
  message.querySelector("[data-message-tools]")?.remove();

  const tools = document.createElement("menu");
  tools.dataset.messageTools = "";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.dataset.iconOnly = "";
  copy.setAttribute("aria-label", "Copy response");
  copy.append(renderIcon("copy"));
  copy.addEventListener("click", async () => {
    await copyText(content);
    copy.dataset.copied = "true";
    copy.setAttribute("aria-label", "Copied");
    globalThis.setTimeout(() => {
      copy.dataset.copied = "false";
      copy.setAttribute("aria-label", "Copy response");
    }, 1200);
  });
  tools.append(copy);
  message.append(tools);
}

async function copyText(value) {
  const text = String(value || "");
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function renderMarkdown(markdown) {
  const parts = String(markdown || "").replace(/\r\n/g, "\n").split(/```([\w-]*)\n([\s\S]*?)```/g);
  let html = "";
  for (let index = 0; index < parts.length; index += 3) {
    html += renderMarkdownBlocks(parts[index] || "");
    if (index + 2 < parts.length) {
      const language = parts[index + 1] ? ` data-language="${escapeHtml(parts[index + 1])}"` : "";
      html += `<pre${language}><code>${escapeHtml(parts[index + 2] || "")}</code></pre>`;
    }
  }
  return html || "<p></p>";
}

function renderMarkdownBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(
      `<${list.tag}>${
        list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")
      }</${list.tag}>`,
    );
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 2, 4);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const tag = ordered ? "ol" : "ul";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((unordered || ordered)[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function inlineMarkdown(text) {
  const code = [];
  let value = escapeHtml(text).replace(/`([^`]+)`/g, (_, body) => {
    const token = `@@CODE${code.length}@@`;
    code.push(`<code>${body}</code>`);
    return token;
  });

  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    const safeUrl = escapeAttribute(url);
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return code.reduce((current, item, index) => current.replace(`@@CODE${index}@@`, item), value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function isDevelopmentHost() {
  const hostname = globalThis.location?.hostname || "";
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ||
    hostname.endsWith(".local");
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readCachedModelContext() {
  const cached = readJsonStorage(MODEL_CONTEXT_CACHE_KEY, null);
  if (!cached || typeof cached !== "object") return null;
  if (typeof cached.expiresAt !== "number" || cached.expiresAt <= Date.now()) return null;
  return cached;
}

function cacheModelContext(payload, ttlMs = MODEL_CONTEXT_CACHE_TTL_MS) {
  const modelContext = payload?.modelContext;
  if (!modelContext || typeof modelContext !== "object") return null;

  const now = Date.now();
  const cached = {
    model: payload.model || modelContext.model || "",
    modelContext,
    cachedAt: now,
    expiresAt: now + ttlMs,
  };
  state.modelContext = cached;
  try {
    localStorage.setItem(MODEL_CONTEXT_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Keep the in-memory copy if localStorage is unavailable.
  }
  return cached;
}

async function getModelContext() {
  const cached = readCachedModelContext();
  if (cached) {
    state.modelContext = cached;
    return cached;
  }

  const response = await fetch("/api/model-context");
  if (!response.ok) return null;
  const payload = await response.json();
  return cacheModelContext(payload, Number(payload.cacheTtlMs) || MODEL_CONTEXT_CACHE_TTL_MS);
}

function createSessionId() {
  return globalThis.crypto?.randomUUID?.() ||
    `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hydrateChatHistory() {
  state.sessions = normalizeSessions(state.sessions);
  state.activeSessionMeta =
    state.sessions.find((session) => session.id === state.activeSessionId)?.meta ??
      null;
  if (
    state.messages.length && !state.sessions.some((session) => session.id === state.activeSessionId)
  ) {
    upsertCurrentSession();
  } else {
    persistSessions();
  }
  localStorage.setItem(ACTIVE_CHAT_KEY, state.activeSessionId);
}

function normalizeSessions(sessions) {
  return Array.isArray(sessions)
    ? sessions
      .filter((session) => session?.id && Array.isArray(session.messages))
      .map((session) => ({
        id: String(session.id),
        title: String(session.title || chatTitle(session.messages)),
        createdAt: String(session.createdAt || session.updatedAt || new Date().toISOString()),
        updatedAt: String(session.updatedAt || session.createdAt || new Date().toISOString()),
        meta: normalizeSessionMeta(session.meta),
        messages: session.messages
          .filter((message) => message?.role === "user" || message?.role === "assistant")
          .map((message) => ({
            role: message.role,
            content: String(message.content || ""),
          }))
          .slice(-CHAT_MESSAGE_LIMIT),
      }))
      .filter((session) => session.messages.length)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, CHAT_SESSION_LIMIT)
    : [];
}

function normalizeSessionMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  return {
    kind: String(meta.kind || ""),
    cacheKey: String(meta.cacheKey || ""),
    contextHash: String(meta.contextHash || ""),
    version: Number.isFinite(Number(meta.version)) ? Number(meta.version) : 0,
    calendarBlockId: String(meta.calendarBlockId || ""),
    techweekId: String(meta.techweekId || ""),
    eventTitle: String(meta.eventTitle || ""),
    prompt: String(meta.prompt || ""),
  };
}

function findCachedChatSession(cacheKey) {
  const key = String(cacheKey || "");
  if (!key) return null;
  return state.sessions.find((session) => session.id === key || session.meta?.cacheKey === key) ||
    null;
}

function startNewChat(options = {}) {
  persistMessages();
  state.messages = [];
  state.activeSessionId = options.id || createSessionId();
  state.activeSessionMeta = normalizeSessionMeta(options.meta);
  state.historyOpen = false;
  localStorage.setItem(ACTIVE_CHAT_KEY, state.activeSessionId);
  localStorage.setItem(CHAT_STORAGE_KEY, "[]");
  chatHistoryToggle.setAttribute("aria-expanded", "false");
  renderChat();
  renderChatHistory();
}

function upsertCurrentSession() {
  const messages = state.messages.slice(-CHAT_MESSAGE_LIMIT);
  if (!messages.length) return;

  const now = new Date().toISOString();
  const existing = state.sessions.find((session) => session.id === state.activeSessionId);
  const session = {
    id: state.activeSessionId,
    title: chatTitle(messages),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    meta: state.activeSessionMeta || existing?.meta || null,
    messages,
  };

  state.sessions = [session, ...state.sessions.filter((item) => item.id !== session.id)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, CHAT_SESSION_LIMIT);
  persistSessions();
}

function persistSessions() {
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(state.sessions));
}

function chatTitle(messages) {
  const firstUser = messages.find((message) => message.role === "user")?.content;
  const firstAssistant = messages.find((message) => message.role === "assistant")?.content;
  const title = String(firstUser || firstAssistant || "New chat").replace(/\s+/g, " ").trim();
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

function chatSessionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function loadChatSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  state.activeSessionId = session.id;
  state.activeSessionMeta = session.meta || null;
  state.messages = session.messages.slice(-CHAT_MESSAGE_LIMIT);
  state.historyOpen = false;
  localStorage.setItem(ACTIVE_CHAT_KEY, state.activeSessionId);
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state.messages));
  chatHistoryToggle.setAttribute("aria-expanded", "false");
  renderChat();
  renderChatHistory();
}

function renderChatHistory() {
  chatHistory.hidden = !state.historyOpen;
  if (chatHistory.hidden) return;

  chatHistory.replaceChildren();
  const sessions = normalizeSessions(state.sessions);
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.textContent = "No chat history yet.";
    chatHistory.append(empty);
    return;
  }

  for (const session of sessions) {
    const item = document.createElement("article");
    item.dataset.chatHistoryItem = "";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.chatHistoryOpen = "";
    button.setAttribute("aria-current", String(session.id === state.activeSessionId));
    button.addEventListener("click", () => loadChatSession(session.id));

    const label = document.createElement("span");
    label.textContent = session.title;
    const time = document.createElement("time");
    time.textContent = chatSessionTime(session.updatedAt);
    button.append(renderIcon("message"), label, time);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.chatHistoryDelete = "";
    remove.dataset.iconOnly = "";
    remove.setAttribute("aria-label", `Delete chat: ${session.title}`);
    remove.append(renderIcon("trash"));
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChatSession(session.id);
    });

    item.append(button, remove);
    chatHistory.append(item);
  }
}

function deleteChatSession(id) {
  const sessionId = String(id || "");
  if (!sessionId) return;

  persistMessages();
  const deletingActive = sessionId === state.activeSessionId;
  state.sessions = normalizeSessions(state.sessions.filter((session) => session.id !== sessionId));
  persistSessions();

  if (deletingActive) {
    const next = state.sessions[0];
    if (next) {
      loadChatSession(next.id);
    } else {
      resetEmptyChat();
    }
    return;
  }

  renderChatHistory();
}

function resetEmptyChat() {
  state.messages = [];
  state.activeSessionId = createSessionId();
  state.activeSessionMeta = null;
  state.historyOpen = false;
  localStorage.setItem(ACTIVE_CHAT_KEY, state.activeSessionId);
  localStorage.setItem(CHAT_STORAGE_KEY, "[]");
  chatHistoryToggle.setAttribute("aria-expanded", "false");
  renderChat();
  renderChatHistory();
}

function renderChat() {
  chatLog.replaceChildren();
  if (!state.messages.length) {
    chatLog.dataset.empty = "true";
    const empty = appendMessage("assistant", "What do you need next?", false, {
      suppressTools: true,
    });
    empty.dataset.emptyMessage = "";
    state.messages = [];
    renderChatHistory();
    return;
  }
  delete chatLog.dataset.empty;
  for (const message of state.messages.slice(-CHAT_MESSAGE_LIMIT)) {
    appendMessage(message.role, message.content, false);
  }
  renderChatHistory();
}

function renderProposedActions(messageEl, actions) {
  if (!actions.length) return;
  const wrap = document.createElement("section");
  wrap.dataset.actions = "";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    setButtonContent(button, actionIcon(action), actionLabel(action));
    button.addEventListener("click", () => applyAction(action));
    wrap.append(button);
  }
  messageEl.after(wrap);
}

function actionLabel(action) {
  if (action.type === "event_note") return "Save note";
  if (action.type === "google_sync_request") return "Check sync";
  return "Apply";
}

function actionIcon(action) {
  if (action.type === "event_note") return "sparkles";
  if (action.type === "google_sync_request") return "calendar";
  return "check";
}

async function applyAction(action) {
  if (action.type === "google_sync_request") {
    const response = await fetch("/api/sync/google", { method: "POST" });
    const body = await response.json();
    appendMessage("assistant", body.message || "Google sync setup required.");
    return;
  }

  const response = await fetch("/api/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const body = await response.json();
  if (!response.ok) {
    appendMessage("assistant", body?.error?.message || "Could not apply action.");
    return;
  }
  state.payload.state = body.state;
  render();
}

function persistMessages() {
  state.messages = state.messages.slice(-CHAT_MESSAGE_LIMIT);
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state.messages));
  localStorage.setItem(ACTIVE_CHAT_KEY, state.activeSessionId);
  upsertCurrentSession();
}

function setBusy(busy) {
  state.agentBusy = busy;
  chatNewButton.disabled = busy;
  chatHistoryToggle.disabled = busy;
  promptButtons.forEach((button) => {
    button.disabled = busy;
  });
  updateComposerState();
}

loadSchedule().catch((error) => {
  document.querySelector("[data-next-title]").textContent = error.message;
}).finally(() => {
  scheduleServerPartifulAutoSync();
});
globalThis.setInterval(refreshAutomaticLeadEvent, LEAD_EVENT_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAutomaticLeadEvent();
  if (!document.hidden) scheduleServerPartifulAutoSync();
});
