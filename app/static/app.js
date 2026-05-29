const CHAT_STORAGE_KEY = "techweek-chat";
const CHAT_HISTORY_KEY = "techweek-chat-history";
const ACTIVE_CHAT_KEY = "techweek-chat-active-id";
const MODEL_CONTEXT_CACHE_KEY = "techweek-model-context";
const ACCOUNT_ANONYMOUS_STORAGE_ID = "anonymous";
const ACCOUNT_AUTH_MESSAGE_TYPE = "techweek-auth-complete";
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
const LEAD_TEXT_DRAFT_FIELDS = [
  "name",
  "company",
  "role",
  "email",
  "phone",
  "buyerType",
  "painMentioned",
  "strongQuote",
  "followUp",
  "nextStepDate",
  "notes",
];
const LEAD_SIGNAL_FIELDS = ["githubHeavy", "aiCodingAdoption"];
const PARTIFUL_AUTO_SYNC_OPEN_DELAY_MS = 1_500;
const PARTIFUL_AUTO_SYNC_STATUS_POLL_MS = 20_000;
const PARTIFUL_AUTO_SYNC_MAX_POLLS = 8;
const LIVE_ROUTE_REFRESH_TIMEOUT_MS = 150_000;
const TRANSCRIPT_MIN_HEIGHT_PX = 300;
const CHAT_EMPTY_GUIDE =
  "Ask me anything about today's Tech Week plan and I'll help you stay aligned.";
const CHAT_SHARE_EMPTY_GUIDE = "No shared messages found for this link.";
const DEV_AUTH_POPUP_POLL_MS = 500;
const DEV_AUTH_POPUP_TIMEOUT_MS = 2 * 60_000;
const TIMELINE_LAYOUT_MODE_KEY = "techweek-timeline-layout-mode";
const TIMELINE_MOBILE_LAYOUT_BREAKPOINT = "(max-width: 759px)";
const TIMELINE_COMPACT_LANE_THRESHOLD = 3;
const TIMELINE_DEFAULT_MOBILE_LAYOUT = "compact";
const MOTION_REDUCE_OK = !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const FORCE_MOTION = false;
const MOTION_CARD_STAGGER_MS = 28;
const MOTION_BUTTON_STAGGER_MS = 14;
const DEV_AGENT_SAME_SITE_ORIGIN = "https://techweek.pavlovcik.com";
const DEV_AGENT_LEGACY_HOSTNAMES = new Set(["techweek-2026-event-picker.0x4007.deno.net"]);
const DEV_AGENT_SESSION_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
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
const VIEW_HASH_SEGMENTS = {
  route: "agenda",
  backup: "events",
  crm: "crm",
  invites: "account",
  account: "account",
};
const HASH_VIEW_ALIASES = {
  agenda: "route",
  route: "route",
  events: "backup",
  event: "backup",
  backup: "backup",
  backups: "backup",
  crm: "crm",
  invites: "account",
  invite: "account",
  ref: "account",
  account: "account",
};
const INVITE_QR_IMAGE_URL = "https://api.qrserver.com/v1/create-qr-code/";
const PENDING_REFERRAL_STORAGE_KEY = "techweek-pending-referral-code";
const MARKDOWN_RENDERER = createMarkdownRenderer();
let scheduleLoadPromise = null;

const state = {
  payload: null,
  activeView: "route",
  activeDay: "",
  entriesByBlock: new Map(),
  invitePayload: null,
  inviteLoading: false,
  accountSession: null,
  accountLoading: false,
  accountError: "",
  accountAuthPopupTimer: 0,
  accountStorageId: ACCOUNT_ANONYMOUS_STORAGE_ID,
  agentTokenLoading: false,
  agentTokenStatus: "",
  agentTokenValue: "",
  messages: readJsonStorage(
    scopedStorageKey(CHAT_STORAGE_KEY, ACCOUNT_ANONYMOUS_STORAGE_ID),
    readJsonStorage(CHAT_STORAGE_KEY, []),
  ),
  sessions: readJsonStorage(
    scopedStorageKey(CHAT_HISTORY_KEY, ACCOUNT_ANONYMOUS_STORAGE_ID),
    readJsonStorage(CHAT_HISTORY_KEY, []),
  ),
  activeSessionId: localStorage.getItem(
    scopedStorageKey(ACTIVE_CHAT_KEY, ACCOUNT_ANONYMOUS_STORAGE_ID),
  ) || localStorage.getItem(ACTIVE_CHAT_KEY) || createSessionId(),
  activeSessionMeta: null,
  modelContext: readCachedModelContext(),
  historyOpen: false,
  agentBusy: false,
  agendaBusy: false,
  partifulAutoSyncRequestBusy: false,
  partifulAutoSyncRequestTimer: 0,
  partifulAutoSyncPollTimer: 0,
  partifulAutoSyncFallbackBusy: false,
  partifulAutoSyncFallbackAttempted: false,
  routeTransitionDirection: "none",
  leadEventManuallySelected: false,
  followUpEmailTouched: false,
  leadFieldsExpanded: false,
  ocrMetadata: null,
  sharedMode: false,
  sharedChatId: "",
  sharedMessages: [],
  sharedModeError: "",
  publicShareMode: false,
  sharedResourceType: "",
  sharedResourceHandle: "",
  sharedResourceId: "",
  sharedResourceHash: "",
  sharedLatestUrl: "",
  sharedImmutableUrl: "",
};
const initialNavigation = readHashNavigation();
state.activeView = initialNavigation.view || state.activeView;
state.activeDay = initialNavigation.day || state.activeDay;

const viewButtons = document.querySelectorAll("[data-view-button]");
const panels = document.querySelectorAll("[data-panel]");
const dayTabs = document.querySelector("[data-day-tabs]");
const routeList = document.querySelector("[data-route-list]");
const referenceList = document.querySelector("[data-reference-list]");
const chatLog = document.querySelector("[data-chat-log]");
const chatForm = document.querySelector("[data-chat-form]");
const chatDrawer = document.querySelector("[data-agent-drawer]");
const chatBackdrop = document.querySelector("[data-agent-backdrop]");
const chatOpenButtons = document.querySelectorAll("[data-chat-open]");
const chatCloseButton = document.querySelector("[data-chat-close]");
const chatNewButton = document.querySelector("[data-chat-new]");
const chatShareButton = document.querySelector("[data-chat-share]");
const chatShareResult = document.querySelector("[data-chat-share-result]");
const chatShareStatus = document.querySelector("[data-chat-share-status]");
const chatShareLink = document.querySelector("[data-chat-share-link]");
const chatShareCopyButton = document.querySelector("[data-chat-share-copy]");
const chatShareImmutableLink = document.querySelector("[data-chat-share-immutable-link]");
const chatShareImmutableCopyButton = document.querySelector("[data-chat-share-copy-immutable]");
const chatShareRevokeButton = document.querySelector("[data-chat-share-revoke]");
const chatHistory = document.querySelector("[data-chat-history]");
const chatHistoryToggle = document.querySelector("[data-chat-history-toggle]");
const chatSharedNotice = document.querySelector("[data-chat-shared]");
const chatSharedMessage = document.querySelector("[data-chat-shared-message]");
const chatForkButton = document.querySelector("[data-chat-fork]");
const readOnlyShareIndicator = document.querySelector("[data-share-readonly]");
const agendaShareControls = document.querySelector("[data-agenda-share-controls]");
const agendaShareButton = document.querySelector("[data-agenda-share]");
const agendaShareRevokeButton = document.querySelector("[data-agenda-share-revoke]");
const agendaShareStatus = document.querySelector("[data-agenda-share-status]");
const agendaShareLatestLink = document.querySelector("[data-agenda-share-latest-link]");
const agendaShareLatestCopyButton = document.querySelector("[data-agenda-share-copy-latest]");
const agendaShareImmutableLink = document.querySelector("[data-agenda-share-immutable-link]");
const agendaShareImmutableCopyButton = document.querySelector(
  "[data-agenda-share-copy-immutable]",
);
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
const accountStatus = document.querySelector("[data-account-status]");
const accountAction = document.querySelector("[data-account-action]");
const agentTokenPanel = document.querySelector("[data-agent-token-panel]");
const agentTokenCreateForm = document.querySelector("[data-agent-token-create]");
const agentTokenStatus = document.querySelector("[data-agent-token-status]");
const agentTokenOutput = document.querySelector("[data-agent-token-output]");
const agentTokenValue = document.querySelector("[data-agent-token-value]");
const agentTokenConfig = document.querySelector("[data-agent-token-config]");
const agentTokenCommand = document.querySelector("[data-agent-token-command]");
const agentTokenCopyButton = document.querySelector("[data-agent-token-copy]");
const agentTokenCopyConfigButton = document.querySelector("[data-agent-token-copy-config]");
const agentTokenCopyCommandButton = document.querySelector("[data-agent-token-copy-command]");
const inviteStatus = document.querySelector("[data-invite-status]");
const inviteCode = document.querySelector("[data-invite-code]");
const inviteCopyCodeButton = document.querySelector("[data-invite-copy-code]");
const inviteShareLink = document.querySelector("[data-invite-share-link]");
const inviteCopyLinkButton = document.querySelector("[data-invite-copy-link]");
const inviteQrImage = document.querySelector("[data-invite-qr]");
const inviteReferralsCount = document.querySelector("[data-invite-referrals-count]");
const inviteReferralsList = document.querySelector("[data-invite-referrals]");
const leadForm = document.querySelector("[data-lead-form]");
const leadEventSelect = document.querySelector("[data-lead-event]");
const leadsList = document.querySelector("[data-leads-list]");
const crmEventTitle = document.querySelector("[data-crm-event-title]");
const leadError = document.querySelector("[data-lead-error]");
const leadPriorityPreview = document.querySelector("[data-lead-priority-preview]");
const cardInput = document.querySelector("[data-card-input]");
const cardScanButton = document.querySelector("[data-card-scan-button]");
const cardScanStatus = document.querySelector("[data-card-scan-status]");
const cardPreview = document.querySelector("[data-card-preview]");
const transcriptInput = document.querySelector("[data-transcript-input]");
const transcriptButton = document.querySelector("[data-transcript-button]");
const transcriptStatus = document.querySelector("[data-transcript-status]");
const leadFieldsPanel = document.querySelector("[data-lead-fields-panel]");
const leadFieldsToggle = document.querySelector("[data-lead-fields-toggle]");
const followUpEmailStatus = document.querySelector("[data-follow-up-email-status]");
const followUpEmailSummary = document.querySelector("[data-follow-up-email-summary]");
const followUpEmailPreview = document.querySelector("[data-follow-up-email-preview]");
const followUpEmailTo = document.querySelector("[data-follow-up-email-to]");
const followUpEmailSubject = document.querySelector("[data-follow-up-email-subject]");
const followUpEmailBody = document.querySelector("[data-follow-up-email-body]");
const eventsCalendarDownloadLink = document.querySelector("[data-events-calendar-link]");
const agendaStatusItems = document.querySelectorAll("[data-agenda-status]");
const transcriptPlaceholderSizer = (() => {
  const sizer = document.createElement("textarea");
  sizer.setAttribute("aria-hidden", "true");
  sizer.tabIndex = -1;
  sizer.disabled = true;
  sizer.style.cssText = [
    "position: fixed",
    "top: -9999px",
    "left: -9999px",
    "visibility: hidden",
    "overflow: hidden",
    "resize: none",
    "height: auto",
    "min-height: 0",
  ].join(";");
  return sizer;
})();
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_TITLES = {
  route: "Agenda",
  backup: "Events",
  crm: "CRM",
  invites: "Account",
  account: "Account",
};
const devAgent = createDevAgentState();
const devAgentEnabled = Boolean(devAgent.config.ready);
const motionButtonsAnimated = new WeakSet();
const motionCardsAnimated = new WeakSet();
const BUTTON_MOTION_SELECTOR = "button, a[href], [role='button'], [data-motion='button']";
const BUTTON_MOTION_INITIAL = {
  opacity: "0",
  transform: "translateY(2px)",
};
const BUTTON_MOTION_VISIBLE = {
  opacity: "1",
  transform: "translateY(0px)",
};

function runMotion(target, keyframes, options = {}) {
  if (!MOTION_REDUCE_OK && !FORCE_MOTION) return;
  if (!target) return;
  const { onComplete, ...motionOptions } = options;
  if (keyframes) {
    for (const [property, values] of Object.entries(keyframes)) {
      const firstValue = Array.isArray(values) ? values[0] : values;
      if (typeof firstValue !== "undefined") target.style[property] = firstValue;
    }
  }

  const animationOptions = {
    duration: Math.round((motionOptions.duration || 0) * 1000),
    delay: motionOptions.delay || 0,
    easing: motionOptions.easing || "ease-out",
    fill: motionOptions.fill || "both",
  };
  const animation = target.animate(keyframes, animationOptions);
  if (animation?.finished && typeof animation.finished.then === "function") {
    void animation.finished.then(
      () => {
        if (typeof onComplete === "function") onComplete();
      },
      () => {
        if (typeof onComplete === "function") onComplete();
      },
    );
    return;
  }
  if (typeof onComplete !== "function") return;
  globalThis.setTimeout(
    onComplete,
    Math.round(((motionOptions.delay || 0) + (motionOptions.duration || 0)) * 1000),
  );
}

function animateButtonCluster(root) {
  if (!root) return;
  const buttons = motionButtonTargets(root);
  const eligibleButtons = buttons.filter(isMotionButtonEligible);
  for (const button of buttons) {
    if (!isMotionButtonEligible(button) && button.dataset.motionHidden === "true") {
      showMotionButton(button);
    }
  }

  if (!MOTION_REDUCE_OK && !FORCE_MOTION) {
    for (const button of buttons) {
      showMotionButton(button);
    }
    return;
  }

  eligibleButtons.forEach((button, index) => {
    if (motionButtonsAnimated.has(button)) return;
    hideMotionButton(button);
    const delay = Number.isFinite(button.dataset.motionDelay)
      ? Number(button.dataset.motionDelay)
      : (index + 1) * (MOTION_BUTTON_STAGGER_MS / 1000);
    runMotion(button, {
      opacity: [0, 1],
      transform: ["translateY(2px)", "translateY(0px)"],
    }, {
      duration: 0.22,
      easing: "ease-out",
      delay,
      fill: "both",
      onComplete: () => showMotionButton(button),
    });
    motionButtonsAnimated.add(button);
  });
}

function motionButtonTargets(root) {
  const targets = [];
  if (root.matches?.(BUTTON_MOTION_SELECTOR)) targets.push(root);
  targets.push(...root.querySelectorAll?.(BUTTON_MOTION_SELECTOR) || []);
  return Array.from(new Set(targets));
}

function isMotionButtonEligible(button) {
  return !button.hidden && !button.disabled;
}

function hideMotionButton(button) {
  button.dataset.motion = "button";
  button.dataset.motionHidden = "true";
  button.style.opacity = BUTTON_MOTION_INITIAL.opacity;
  button.style.transform = BUTTON_MOTION_INITIAL.transform;
  return button;
}

function markMotionButton(button) {
  if (!isMotionButtonEligible(button)) return button;
  button.dataset.motion = "button";
  button.dataset.motionHidden = "true";
  return button;
}

function showMotionButton(button) {
  button.dataset.motion = "button";
  delete button.dataset.motionHidden;
  button.style.opacity = BUTTON_MOTION_VISIBLE.opacity;
  button.style.transform = BUTTON_MOTION_VISIBLE.transform;
  return button;
}

function animateCards(root) {
  if (!MOTION_REDUCE_OK && !FORCE_MOTION || !root) return;
  const entries = Array.from(root.querySelectorAll("article[data-entry]"));
  for (const [index, entry] of entries.entries()) {
    if (motionCardsAnimated.has(entry)) continue;
    runMotion(entry, {
      opacity: [0, 1],
    }, {
      duration: 0.32,
      delay: Math.min(0.42, (index + 1) * (MOTION_CARD_STAGGER_MS / 1000)),
      easing: "ease-out",
      fill: "both",
    });
    motionCardsAnimated.add(entry);
  }
}

function normalizedDays(payload = state.payload) {
  return Array.isArray(payload?.days) ? payload.days : [];
}

function normalizedReferenceDays(payload = state.payload) {
  return Array.isArray(payload?.referenceDays) ? payload.referenceDays : [];
}

function flattenDayEntries(days = []) {
  return (Array.isArray(days) ? days : []).flatMap((day) =>
    Array.isArray(day?.entries) ? day.entries : []
  );
}

document.body.dataset.view = state.activeView;
setView(state.activeView, { updateHash: false });

viewButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewButton));
});

chatOpenButtons.forEach((button) => {
  button.addEventListener("click", openChat);
});

chatCloseButton.addEventListener("click", closeChat);
chatNewButton.addEventListener("click", startNewChat);
chatShareButton?.addEventListener("click", () => {
  void createSharedChat();
});
chatShareCopyButton?.addEventListener("click", () => {
  if (chatShareLink && !chatShareLink.hidden && chatShareLink.textContent) {
    void copyText(chatShareLink.textContent || chatShareLink.href);
  }
});
chatShareImmutableCopyButton?.addEventListener("click", () => {
  if (chatShareImmutableLink && !chatShareImmutableLink.hidden && chatShareImmutableLink.href) {
    void copyText(chatShareImmutableLink.href);
  }
});
chatShareRevokeButton?.addEventListener("click", () => {
  void revokeLatestShare("chat");
});
agendaShareButton?.addEventListener("click", () => {
  void createAgendaShare();
});
agendaShareRevokeButton?.addEventListener("click", () => {
  void revokeLatestShare("agenda");
});
agendaShareLatestCopyButton?.addEventListener("click", () => {
  if (agendaShareLatestLink && !agendaShareLatestLink.hidden && agendaShareLatestLink.href) {
    void copyText(agendaShareLatestLink.href);
  }
});
agendaShareImmutableCopyButton?.addEventListener("click", () => {
  if (
    agendaShareImmutableLink && !agendaShareImmutableLink.hidden && agendaShareImmutableLink.href
  ) {
    void copyText(agendaShareImmutableLink.href);
  }
});
chatHistoryToggle.addEventListener("click", toggleChatHistory);
chatForkButton?.addEventListener("click", forkSharedChat);
chatBackdrop.addEventListener("click", closeChat);
if (devAgentEnabled) {
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
} else if (devChatOpenButton) {
  devChatOpenButton.hidden = true;
}
accountAction?.addEventListener("click", handleAccountAction);
agentTokenCreateForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createAgentToken(new FormData(agentTokenCreateForm));
});
agentTokenCopyButton?.addEventListener("click", () => {
  if (state.agentTokenValue) void copyText(state.agentTokenValue);
});
agentTokenCopyConfigButton?.addEventListener("click", () => {
  if (state.agentTokenValue) void copyText(agentTokenConfigPayload(state.agentTokenValue));
});
agentTokenCopyCommandButton?.addEventListener("click", () => {
  if (state.agentTokenValue) void copyText(agentTokenLoginCommand(state.agentTokenValue));
});
inviteCopyCodeButton?.addEventListener("click", () => {
  if (state.invitePayload?.code) {
    void copyText(state.invitePayload.code);
  }
});
inviteCopyLinkButton?.addEventListener("click", () => {
  if (state.invitePayload?.shareUrl) {
    void copyText(state.invitePayload.shareUrl);
  }
});
globalThis.addEventListener("message", handleDevAuthMessage);
globalThis.addEventListener("message", handleAccountAuthMessage);
renderDevAgent();
eventCloseButton.addEventListener("click", closeEventModal);
eventBackdrop.addEventListener("click", closeEventModal);
leadEventSelect.addEventListener("change", () => {
  state.leadEventManuallySelected = true;
  renderCRM();
});
leadForm.elements.sendFollowUpEmail.addEventListener("input", () => {
  state.followUpEmailTouched = true;
});
leadForm.elements.sendFollowUpEmail.addEventListener("change", () => {
  state.followUpEmailTouched = true;
  renderFollowUpEmailControl();
});
leadFieldsToggle?.addEventListener("click", () => {
  setLeadFieldsExpanded(!state.leadFieldsExpanded);
});
leadForm.addEventListener("input", () => {
  renderLeadPriorityPreview();
  renderFollowUpEmailControl();
});
leadForm.addEventListener("change", () => {
  renderLeadPriorityPreview();
  renderFollowUpEmailControl();
});
cardScanButton.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (cardScanButton.getAttribute("aria-disabled") === "true") return;
  event.preventDefault();
  cardInput.click();
});
transcriptButton?.addEventListener("click", () => {
  void handleLeadTranscriptParse();
});
transcriptInput?.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  void handleLeadTranscriptParse();
});
cardInput.addEventListener("change", handleCardInput);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeChat();
  if (event.key === "Escape") closeDevChat();
  if (event.key === "Escape") closeEventModal();
});
globalThis.addEventListener("resize", syncTranscriptInputMinHeight);
globalThis.addEventListener("hashchange", () => {
  const changed = applyHashNavigation();
  if (!changed || !state.payload) return;
  render();
});

hydrateChatHistory();
renderChat();
renderAccountButton();
updateAuthenticatedCtas();
syncTranscriptInputMinHeight();
capturePendingReferralFromUrl();
const initialSharePath = sharePathFromLocation();
if (initialSharePath) {
  void initializeSharedResourceFromLocation(initialSharePath);
  void loadAccountSession();
} else {
  void loadAccountSession();
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = chatForm.elements.prompt;
  const prompt = input.value.trim();
  if (state.sharedMode || !canUseAiFeatures()) return;
  if (!prompt) return;
  input.value = "";
  updateComposerState();
  askAgent(prompt);
});
chatForm.elements.prompt.addEventListener("input", updateComposerState);
chatForm.elements.prompt.addEventListener("keydown", handleChatKeydown);

leadForm.addEventListener("submit", handleLeadSubmit);
updateComposerState();

function handleChatKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (
    state.sharedMode || !canUseAiFeatures() || state.agentBusy ||
    !chatForm.elements.prompt.value.trim()
  ) {
    return;
  }
  chatForm.requestSubmit();
}

function updateComposerState() {
  const input = chatForm.elements.prompt;
  const send = chatForm.querySelector("button[type='submit']");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  const readOnly = state.sharedMode || !canUseAiFeatures();
  input.disabled = readOnly || state.agentBusy;
  send.disabled = readOnly || state.agentBusy || !input.value.trim();
  if (chatHistoryToggle) {
    chatHistoryToggle.hidden = readOnly;
    chatHistoryToggle.disabled = readOnly || state.agentBusy;
  }
  if (chatShareButton) {
    chatShareButton.disabled = readOnly || state.agentBusy || !state.messages.length;
  }
  if (chatSharedNotice) {
    chatSharedNotice.hidden = !readOnly;
  }
  if (chatSharedMessage && readOnly) {
    chatSharedMessage.textContent = state.sharedResourceType === "agenda"
      ? "You are viewing a read-only shared agenda."
      : state.sharedChatId
      ? `You are viewing shared chat ${state.sharedChatId}. Fork this chat to continue privately.`
      : "You are viewing a shared chat. Fork this chat to continue privately.";
  }
  if (chatForkButton) {
    chatForkButton.hidden = !state.sharedMode;
  }
  renderReadOnlyShareMode();
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

async function loadAccountSession() {
  state.accountLoading = true;
  state.accountError = "";
  renderAccountButton();
  const wasAuthenticated = state.accountSession?.authenticated === true;
  try {
    const response = await fetch("/api/account/session", {
      cache: "no-store",
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Could not check account session.");
    }
    applyAccountSession(body.session || null);
    if (body?.session?.authenticated) {
      if (!state.publicShareMode) {
        if (!wasAuthenticated || !state.payload) {
          await loadScheduleAfterAuthentication();
        }
        await loadInviteDataForAuthenticatedSession();
      }
    } else {
      state.invitePayload = null;
      renderInvite();
    }
  } catch (error) {
    state.accountError = error instanceof Error
      ? error.message
      : "Could not check account session.";
    applyAccountSession(null);
    state.invitePayload = null;
    renderInvite();
  } finally {
    state.accountLoading = false;
    renderAccountButton();
  }
}

function pendingReferralCode() {
  try {
    return String(localStorage.getItem(PENDING_REFERRAL_STORAGE_KEY) || "").trim().toUpperCase()
      .replace(
        /[^A-Z0-9]/g,
        "",
      );
  } catch {
    return "";
  }
}

function clearPendingReferralCode() {
  try {
    localStorage.removeItem(PENDING_REFERRAL_STORAGE_KEY);
  } catch {
    // ignore localStorage errors
  }
}

function capturePendingReferralFromUrl() {
  const target = new URL(globalThis.location.href);
  const raw = target.searchParams.get("ref");
  const cleaned = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  if (cleaned) {
    try {
      localStorage.setItem(PENDING_REFERRAL_STORAGE_KEY, cleaned);
    } catch {
      // local storage unavailable in this context
    }
  }
  target.searchParams.delete("ref");
  if (target.toString() !== globalThis.location.href) {
    history.replaceState(null, "", target.toString());
  }
}

async function loadInviteDataForAuthenticatedSession() {
  if (!state.accountSession?.authenticated) {
    state.invitePayload = null;
    renderInvite();
    return;
  }
  state.inviteLoading = true;
  renderInvite();
  const referralCode = pendingReferralCode();
  try {
    if (referralCode) {
      const claim = await fetch("/api/account/invite", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ referralCode }),
      });
      if (claim.ok) clearPendingReferralCode();
    }

    const response = await fetch("/api/account/invite", {
      cache: "no-store",
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Could not load invite data.");
    }
    state.invitePayload = body?.invite && typeof body.invite === "object" ? body.invite : null;
    renderInvite();
  } catch (error) {
    state.invitePayload = null;
    renderInvite();
    state.accountError = error instanceof Error ? error.message : "Could not load invite data.";
  } finally {
    state.inviteLoading = false;
    renderInvite();
  }
}

function applyAccountSession(session) {
  const normalized = normalizeAccountSession(session);
  const nextStorageId = normalized?.authenticated && normalized.user?.id
    ? normalized.user.id
    : ACCOUNT_ANONYMOUS_STORAGE_ID;
  const changed = nextStorageId !== state.accountStorageId;
  const preservedSharedState = state.sharedMode
    ? { id: state.sharedChatId, messages: state.sharedMessages.slice(-CHAT_MESSAGE_LIMIT) }
    : null;
  if (changed) persistMessages();

  state.accountSession = normalized;
  if (normalized.authenticated !== true && !state.sharedMode) {
    closeChat();
    closeDevChat();
  }
  if (changed) {
    loadChatStorageForAccount(nextStorageId);
    if (preservedSharedState) {
      enterSharedChatMode(preservedSharedState.id, preservedSharedState.messages);
    }
  }
  renderAccountButton();
}

function normalizeAccountSession(session) {
  if (!session || typeof session !== "object") {
    return { authenticated: false, auth: "passkey" };
  }
  const user = session.user && typeof session.user === "object"
    ? {
      id: String(session.user.id || ""),
      handle: String(session.user.handle || ""),
      isAdmin: session.user.isAdmin === true,
    }
    : null;
  return {
    authenticated: session.authenticated === true && Boolean(user?.id),
    auth: String(session.auth || "passkey"),
    user,
    expiresAt: String(session.expiresAt || ""),
    setupRequired: session.setupRequired === true,
    bootstrapConfigured: session.bootstrapConfigured === true,
    registrationAllowed: session.registrationAllowed === true,
  };
}

function handleAccountAction() {
  if (state.accountLoading) return;
  if (state.accountSession?.authenticated) {
    void signOutAccount();
    return;
  }
  openAccountAuth(state.accountSession?.setupRequired ? "register" : "login");
}

function renderAccountStatus() {
  if (accountStatus) {
    if (state.accountLoading) {
      accountStatus.textContent = "Checking account status...";
    } else if (state.accountSession?.authenticated) {
      const handle = state.accountSession?.user?.handle || "Account";
      accountStatus.textContent = `Signed in as ${handle}.`;
    } else if (state.accountSession?.setupRequired) {
      accountStatus.textContent = "Set up your passkey to create an account.";
    } else {
      accountStatus.textContent = "Signed out. Sign in to manage invites and features.";
    }
  }

  if (accountAction) {
    const signedIn = state.accountSession?.authenticated === true;
    const setupRequired = state.accountSession?.setupRequired === true;
    const actionLabel = signedIn ? "Sign out" : setupRequired ? "Set up" : "Sign in";
    const actionText = accountAction.querySelector("span") || accountAction;
    actionText.textContent = actionLabel;
    accountAction.disabled = state.accountLoading;
    accountAction.setAttribute(
      "aria-label",
      signedIn ? "Sign out of account." : setupRequired ? "Create passkey" : "Sign in to account",
    );
  }
}

function renderAccountButton() {
  renderAccountStatus();
  renderAgentTokenPanel();
  updateAuthenticatedCtas();
}

function renderAgentTokenPanel() {
  if (!agentTokenPanel) return;
  const isAdmin = state.accountSession?.authenticated === true &&
    state.accountSession?.user?.isAdmin === true &&
    !state.publicShareMode;
  agentTokenPanel.hidden = !isAdmin;
  if (!isAdmin) {
    state.agentTokenValue = "";
    state.agentTokenStatus = "";
    if (agentTokenOutput) agentTokenOutput.hidden = true;
    return;
  }

  if (agentTokenStatus) {
    agentTokenStatus.textContent = state.agentTokenStatus ||
      `Create a login token for ${currentAccountHandle() || "this account"}.`;
  }
  const token = state.agentTokenValue;
  if (agentTokenOutput) agentTokenOutput.hidden = !token;
  if (agentTokenValue) agentTokenValue.value = token;
  if (agentTokenConfig) agentTokenConfig.value = token ? agentTokenConfigPayload(token) : "";
  if (agentTokenCommand) agentTokenCommand.value = token ? agentTokenLoginCommand(token) : "";
  const controls = [
    agentTokenCreateForm?.querySelector("button[type='submit']"),
    agentTokenCopyButton,
    agentTokenCopyConfigButton,
    agentTokenCopyCommandButton,
  ];
  controls.forEach((control) => {
    if (!control) return;
    control.disabled = state.agentTokenLoading ||
      (control !== agentTokenCreateForm?.querySelector("button[type='submit']") && !token);
  });
  const daysInput = agentTokenCreateForm?.elements?.ttlDays;
  if (daysInput) daysInput.disabled = state.agentTokenLoading;
}

async function createAgentToken(form) {
  if (state.agentTokenLoading) return;
  state.agentTokenLoading = true;
  state.agentTokenStatus = "Creating token...";
  state.agentTokenValue = "";
  renderAgentTokenPanel();
  try {
    const ttlDays = Number(form.get("ttlDays") || 7);
    const response = await fetch("/api/account/agent-tokens", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttlDays }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Could not create agent token.");
    }
    state.agentTokenValue = String(body?.token || "");
    if (!state.agentTokenValue) {
      throw new Error("Server did not return an agent token.");
    }
    state.agentTokenStatus = `Token created for ${currentAccountHandle() || "this account"}.`;
  } catch (error) {
    state.agentTokenValue = "";
    state.agentTokenStatus = error instanceof Error ? error.message : "Could not create token.";
  } finally {
    state.agentTokenLoading = false;
    renderAgentTokenPanel();
  }
}

function agentTokenConfigPayload(token) {
  return JSON.stringify(
    {
      origin: globalThis.location.origin,
      session: "techweek-verify",
      expectedHandle: currentAccountHandle() || "",
      token,
    },
    null,
    2,
  );
}

function agentTokenLoginCommand(token) {
  return `deno task account:agent-login -- --origin ${globalThis.location.origin} --session techweek-verify --token '${
    String(token || "").replaceAll("'", "'\\''")
  }'`;
}

function updateAuthenticatedCtas() {
  const authenticated = canUseAiFeatures();
  document.body.dataset.authenticated = authenticated ? "true" : "false";
  chatOpenButtons.forEach((button) => {
    button.hidden = !authenticated;
    button.disabled = !authenticated;
  });
  if (devChatOpenButton) {
    devChatOpenButton.hidden = !authenticated || !devAgentEnabled;
    devChatOpenButton.disabled = !authenticated || !devAgentEnabled;
  }
  if (cardScanButton) {
    cardScanButton.hidden = !authenticated;
    cardScanButton.setAttribute("aria-disabled", String(!authenticated));
  }
  if (cardInput) cardInput.disabled = !authenticated;
  if (transcriptButton) {
    transcriptButton.hidden = !authenticated;
    transcriptButton.disabled = !authenticated;
  }
  if (transcriptInput) transcriptInput.disabled = !authenticated;
}

function canUseAiFeatures() {
  return state.accountSession?.authenticated === true && !state.publicShareMode;
}

async function signOutAccount() {
  state.accountLoading = true;
  state.accountError = "";
  renderAccountButton();
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || "Could not sign out.");
    }
    state.invitePayload = null;
    applyAccountSession({ authenticated: false, auth: "passkey" });
    renderInvite();
  } catch (error) {
    state.accountError = error instanceof Error ? error.message : "Could not sign out.";
    await loadAccountSession();
  } finally {
    state.accountLoading = false;
    renderAccountButton();
  }
}

function openAccountAuth(mode) {
  clearAccountAuthPopupWatcher();
  const url = accountAuthUrl("/auth.html");
  url.searchParams.set("mode", mode);
  url.searchParams.set("embedOrigin", globalThis.location.origin);
  url.searchParams.set("returnUrl", globalThis.location.href);
  state.accountError = "";
  renderAccountButton();
  const popup = globalThis.open(
    url.toString(),
    "techweek-account-auth",
    "popup,width=460,height=720",
  );
  if (!popup) {
    globalThis.location.href = url.toString();
    return;
  }
  popup.focus?.();
  const openedAt = Date.now();
  state.accountAuthPopupTimer = globalThis.setInterval(() => {
    if (popup.closed) {
      clearAccountAuthPopupWatcher();
      void loadAccountSession();
      return;
    }
    if (Date.now() - openedAt > DEV_AUTH_POPUP_TIMEOUT_MS) {
      clearAccountAuthPopupWatcher();
    }
  }, DEV_AUTH_POPUP_POLL_MS);
}

function handleAccountAuthMessage(event) {
  if (event.origin !== globalThis.location.origin) return;
  if (event.data?.type !== ACCOUNT_AUTH_MESSAGE_TYPE) return;
  clearAccountAuthPopupWatcher();
  void loadAccountSession();
}

function clearAccountAuthPopupWatcher() {
  if (!state.accountAuthPopupTimer) return;
  globalThis.clearInterval(state.accountAuthPopupTimer);
  state.accountAuthPopupTimer = 0;
}

function accountAuthUrl(path) {
  return new URL(path, globalThis.location.origin);
}

function normalizeView(view) {
  return view === "invites" ? "account" : view;
}

function setView(view, options = {}) {
  const nextView = normalizeView(view);
  const panelView = nextView === "account" ? "account" : nextView;
  const navView = nextView;
  if (!VIEW_TITLES[nextView]) return;
  state.activeView = nextView;
  document.body.dataset.view = nextView;
  pageTitle.textContent = VIEW_TITLES[nextView] || "Agenda";
  viewButtons.forEach((button) => {
    button.setAttribute("aria-current", button.dataset.viewButton === navView ? "page" : "false");
  });
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== panelView;
  });
  if (nextView === "crm") renderCRM();
  if (nextView === "account") renderInvite();
  if (options.updateHash !== false) writeHashNavigation();
}

function openChat() {
  if (!state.sharedMode && !canUseAiFeatures()) return;
  closeDevChat();
  chatDrawer.hidden = false;
  chatBackdrop.hidden = false;
  document.body.dataset.chatOpen = "true";
  if (!state.publicShareMode) void getModelContext().catch(() => null);
  requestAnimationFrame(() => {
    updateComposerState();
    if (!state.sharedMode) {
      chatDrawer.querySelector("textarea").focus({ preventScroll: true });
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  });
}

function closeChat() {
  chatDrawer.hidden = true;
  chatBackdrop.hidden = true;
  document.body.dataset.chatOpen = "false";
}

function openDevChat() {
  if (!canUseAiFeatures()) return;
  closeChat();
  if (redirectDevAgentToSameSite()) return;
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
  clearDevSessionRetry();
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
  if (
    !canUseAiFeatures() || !devAgent.config.ready || devAgent.authState !== "authenticated" ||
    devAgent.sending
  ) return;
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
    if (isAuthStatus(error)) {
      markDevUnauthenticated("Your development agent session expired. Sign in again.");
      renderDevAgent();
    } else {
      devAgent.composerError = devFriendlyError(error, "Could not send prompt.");
      renderDevAgent();
    }
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
    authStatus: "",
    authPopupTimer: 0,
    sessionRetryTimer: 0,
    sessionRetryAttempt: 0,
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
  const apiBase = normalizeApiBase(dataset.agentApi || "");
  const authBase = normalizeApiBase(dataset.agentAuth || "");
  const repo = String(dataset.repo || "").trim();
  const repoId = String(dataset.repoId || "").trim();
  const repoLabel = String(dataset.repoLabel || repoName(repo) || repoId || "Development repo")
    .trim();
  return {
    apiBase,
    authBase,
    repo,
    repoId,
    repoLabel,
    deployEnabled: dataset.deploy === "true",
    ready: Boolean(apiBase && authBase && (repo || repoId)),
  };
}

async function bootstrapDevAgent(options = {}) {
  if (!devAgent.config.ready) {
    devAgent.bootstrapped = true;
    devAgent.authState = "config_error";
    devAgent.error = "Missing development API origin or repository configuration.";
    renderDevAgent();
    return;
  }
  if (!options.retrying) clearDevSessionRetry();
  if (redirectDevAgentToSameSite()) return;

  devAgent.loadingSession = true;
  devAgent.error = "";
  renderDevAgent();
  try {
    const session = await devFetchJson("/api/session");
    devAgent.session = session && typeof session === "object" ? session : {};
    devAgent.bootstrapped = true;
    devAgent.authState = devSessionState(devAgent.session);
    clearDevSessionRetry();
    if (devAgent.authState === "authenticated") {
      devAgent.authStatus = "";
      await loadDevThreads({ silent: true });
      if (devAgent.currentThreadId) {
        await openDevThread(devAgent.currentThreadId, { silent: true });
      }
    }
  } catch (error) {
    if (isAuthStatus(error)) {
      markDevUnauthenticated("Your development agent session expired. Sign in again.");
      return;
    }
    devAgent.bootstrapped = true;
    devAgent.authState = "error";
    devAgent.error = devFriendlyError(error, "Could not reach the development agent API.");
    if (scheduleDevSessionRetry()) {
      devAgent.error = `${devAgent.error} Retrying automatically.`;
    }
  } finally {
    devAgent.loadingSession = false;
    renderDevAgent();
  }
}

function redirectDevAgentToSameSite() {
  if (!shouldRedirectDevAgentToSameSite()) return false;
  const destination = new URL(globalThis.location.href);
  const sameSite = new URL(DEV_AGENT_SAME_SITE_ORIGIN);
  destination.protocol = sameSite.protocol;
  destination.host = sameSite.host;
  globalThis.location.replace(destination.toString());
  return true;
}

function shouldRedirectDevAgentToSameSite() {
  if (globalThis.location.origin === DEV_AGENT_SAME_SITE_ORIGIN) return false;
  return DEV_AGENT_LEGACY_HOSTNAMES.has(globalThis.location.hostname);
}

function scheduleDevSessionRetry() {
  if (!devAgent.open || devAgent.sessionRetryTimer) return false;
  const index = Math.min(
    devAgent.sessionRetryAttempt,
    DEV_AGENT_SESSION_RETRY_DELAYS_MS.length - 1,
  );
  const delay = DEV_AGENT_SESSION_RETRY_DELAYS_MS[index];
  devAgent.sessionRetryAttempt += 1;
  devAgent.sessionRetryTimer = globalThis.setTimeout(() => {
    devAgent.sessionRetryTimer = 0;
    void bootstrapDevAgent({ retrying: true });
  }, delay);
  return true;
}

function clearDevSessionRetry() {
  if (devAgent.sessionRetryTimer) {
    globalThis.clearTimeout(devAgent.sessionRetryTimer);
  }
  devAgent.sessionRetryTimer = 0;
  devAgent.sessionRetryAttempt = 0;
}

function markDevUnauthenticated(message) {
  clearDevSessionRetry();
  closeDevThreadStream();
  devAgent.bootstrapped = true;
  devAgent.authState = "unauthenticated";
  devAgent.session = null;
  devAgent.view = "inbox";
  devAgent.thread = null;
  devAgent.events = [];
  devAgent.currentThreadId = "";
  devAgent.error = "";
  devAgent.composerError = "";
  devAgent.authStatus = message || "Sign in on the development origin to continue.";
  localStorage.removeItem(DEV_AGENT_SELECTED_THREAD_KEY);
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
    if (isAuthStatus(error)) {
      markDevUnauthenticated("Your development agent session expired. Sign in again.");
    } else {
      devAgent.error = devFriendlyError(error, "Could not load development threads.");
    }
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
    if (isAuthStatus(error)) {
      markDevUnauthenticated("Your development agent session expired. Sign in again.");
    } else {
      devAgent.error = devFriendlyError(error, "Could not load development thread.");
    }
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
    devChatLog.append(devEmptyState("Checking development agent session."));
    return;
  }
  if (devAgent.authState === "not_configured") {
    devChatLog.dataset.empty = "true";
    devChatLog.append(devNotice(
      "development agent auth is not configured.",
      "Finish the development agent auth setup before sending development prompts.",
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
      devNotice("development agent unavailable.", devAgent.error, () => bootstrapDevAgent()),
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
    devAgent.authStatus || "Use the development agent passkey flow to continue.",
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
  return devBaseUrl(devAgent.config.apiBase, path);
}

function devAuthUrl(path) {
  return devBaseUrl(devAgent.config.authBase, path);
}

function devBaseUrl(base, path) {
  const normalizedBase = String(base || "").replace(/\/+$/, "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return new URL(normalizedPath, `${normalizedBase}/`);
}

function devFriendlyError(error, fallback) {
  if (isAuthStatus(error)) return "Sign in on the development origin to continue.";
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
  clearDevAuthPopupWatcher();
  const url = devAuthUrl("/auth.html");
  url.searchParams.set("mode", mode);
  url.searchParams.set("embedOrigin", globalThis.location.origin);
  url.searchParams.set("returnUrl", globalThis.location.href);
  devAgent.authStatus = "Waiting for passkey sign-in in the development window.";
  renderDevAgent();
  const popup = globalThis.open(url.toString(), "techweek-dev-auth", "popup,width=460,height=720");
  if (!popup) {
    devAgent.authStatus = "Opening the development passkey page in this tab.";
    renderDevAgent();
    globalThis.location.href = url.toString();
    return;
  }
  popup.focus?.();
  const openedAt = Date.now();
  devAgent.authPopupTimer = globalThis.setInterval(() => {
    if (popup.closed) {
      clearDevAuthPopupWatcher();
      void refreshDevAuthAfterWindow();
      return;
    }
    if (Date.now() - openedAt > DEV_AUTH_POPUP_TIMEOUT_MS) {
      clearDevAuthPopupWatcher();
      devAgent.authStatus = "The development sign-in window is still open.";
      renderDevAgent();
    }
  }, DEV_AUTH_POPUP_POLL_MS);
}

function handleDevAuthMessage(event) {
  if (!devAgent?.config?.authBase) return;
  if (event.origin !== new URL(devAgent.config.authBase).origin) return;
  if (event.data?.type !== "techweek-dev-auth-complete") return;
  clearDevAuthPopupWatcher();
  void refreshDevAuthAfterWindow();
}

function clearDevAuthPopupWatcher() {
  if (!devAgent.authPopupTimer) return;
  globalThis.clearInterval(devAgent.authPopupTimer);
  devAgent.authPopupTimer = 0;
}

async function refreshDevAuthAfterWindow() {
  devAgent.authStatus = "Checking development agent session after passkey sign-in.";
  renderDevAgent();
  await bootstrapDevAgent();
  if (devAgent.authState === "authenticated") return;
  if (devAgent.authState === "unauthenticated") {
    devAgent.authStatus =
      "The development sign-in window closed, but the shared app session is still missing. Sign in again to refresh it.";
    renderDevAgent();
  }
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

function readHashNavigation() {
  let hash = "";
  try {
    hash = decodeURIComponent(globalThis.location.hash.replace(/^#\/?/, "")).trim();
  } catch {
    return {};
  }
  if (!hash) return {};
  const [viewPart = "", dayPart = ""] = hash.split("/").map((part) => part.trim());
  return {
    view: HASH_VIEW_ALIASES[viewPart.toLowerCase()] || "",
    day: /^\d{4}-\d{2}-\d{2}$/.test(dayPart) ? dayPart : "",
  };
}

function applyHashNavigation() {
  const next = readHashNavigation();
  const previousView = state.activeView;
  const previousDay = state.activeDay;
  state.activeView = normalizeView(next.view || "route");
  if (next.day) state.activeDay = next.day;
  if (state.payload) normalizeActiveDay();
  state.routeTransitionDirection = routeTransitionDirection(previousDay, state.activeDay);
  setView(state.activeView, { updateHash: false });
  return previousView !== state.activeView || previousDay !== state.activeDay;
}

function writeHashNavigation(options = {}) {
  const view = VIEW_HASH_SEGMENTS[normalizeView(state.activeView)] || "agenda";
  const day = state.activeDay ? `/${state.activeDay}` : "";
  const nextHash = `#${view}${day}`;
  if (globalThis.location.hash === nextHash) return;
  const preservingSharePath = Boolean(sharePathFromLocation());
  const target = preservingSharePath
    ? `${globalThis.location.pathname}${globalThis.location.search}${nextHash}`
    : nextHash;
  if (options.replace) {
    history.replaceState(null, "", target);
  } else {
    history.pushState(null, "", target);
  }
}

function normalizeActiveDay() {
  const days = normalizedDays();
  if (!days.length) return;
  if (!days.some((day) => day.date === state.activeDay)) {
    state.activeDay = days[0]?.date || "";
  }
}

function routeTransitionDirection(previousDay, nextDay) {
  const days = normalizedDays();
  if (!previousDay || !nextDay || previousDay === nextDay || !days.length) {
    return "none";
  }
  const previousIndex = days.findIndex((day) => day.date === previousDay);
  const nextIndex = days.findIndex((day) => day.date === nextDay);
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return "none";
  return nextIndex > previousIndex ? "forward" : "backward";
}

function toggleChatHistory() {
  state.historyOpen = !state.historyOpen;
  chatHistoryToggle.setAttribute("aria-expanded", String(state.historyOpen));
  renderChatHistory();
}

async function loadSchedule() {
  const response = await fetch("/api/schedule", { cache: "no-store", credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Could not load schedule.");
  }
  state.payload = payload;
  const payloadDays = normalizedDays(payload);
  const payloadReferenceDays = normalizedReferenceDays(payload);
  state.entriesByBlock = new Map([
    ...flattenDayEntries(payloadDays),
    ...flattenDayEntries(payloadReferenceDays),
  ].map((entry) => [entry.calendarBlockId, entry]));
  state.activeDay ||= payloadDays[0]?.date || "";
  normalizeActiveDay();
  render();
  surfacePartifulAutoSyncStatus();
  writeHashNavigation({ replace: true });
}

async function loadScheduleForApp(options = {}) {
  if (state.publicShareMode) return;
  if (scheduleLoadPromise) {
    const result = await scheduleLoadPromise;
    if (options.scheduleAutoSync) scheduleServerPartifulAutoSync();
    return result;
  }
  if (options.showLoading) {
    document.querySelector("[data-next-title]").textContent = "Loading events...";
    setAgendaStatus("Loading events...");
  }
  scheduleLoadPromise = loadSchedule().then(() => {
    if (options.scheduleAutoSync) scheduleServerPartifulAutoSync();
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "Could not load schedule.";
    document.querySelector("[data-next-title]").textContent = message;
    setAgendaStatus(message);
    animateButtonCluster(document);
    throw error;
  }).finally(() => {
    scheduleLoadPromise = null;
  });
  return await scheduleLoadPromise;
}

async function loadScheduleAfterAuthentication() {
  if (state.accountSession?.authenticated !== true) return;
  try {
    await loadScheduleForApp({ showLoading: !state.payload, scheduleAutoSync: true });
  } catch {
    if (state.accountSession?.authenticated === true) {
      await loadScheduleForApp({ showLoading: true, scheduleAutoSync: true }).catch(() => {});
    }
  }
}

async function recalculateAgenda({ silent = false } = {}) {
  if (state.publicShareMode) return false;
  if (state.agendaBusy) return false;
  setAgendaBusy(true, silent ? "" : "Optimizing schedule...");
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
    if (silent) {
      setAgendaBusy(false, "");
    } else {
      const selected = body.agenda?.summary?.selectedEvents ?? countScheduleEvents();
      const dropped = body.agenda?.summary?.droppedEvents ?? 0;
      setAgendaBusy(false, `Optimized ${selected} events; ${dropped} alternatives left out.`);
    }
    return true;
  } catch (error) {
    setAgendaBusy(false, error instanceof Error ? error.message : "Could not recalculate agenda.");
    return false;
  }
}

function applySchedulePayload(payload) {
  state.payload = payload;
  const payloadDays = normalizedDays(payload);
  const payloadReferenceDays = normalizedReferenceDays(payload);
  state.entriesByBlock = new Map([
    ...flattenDayEntries(payloadDays),
    ...flattenDayEntries(payloadReferenceDays),
  ].map((entry) => [entry.calendarBlockId, entry]));
  normalizeActiveDay();
  render();
  writeHashNavigation({ replace: true });
}

function applyAgendaProposal(agenda) {
  const selectedIds = new Set(
    (agenda.selectedEvents || []).flatMap((entry) =>
      [entry.techweekId, entry.partifulId, entry.rerankId].filter(Boolean)
    ),
  );
  const previousReference = [
    ...flattenDayEntries(normalizedDays(state.payload)),
    ...flattenDayEntries(normalizedReferenceDays(state.payload)),
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
    ...flattenDayEntries(normalizedDays(state.payload)),
    ...flattenDayEntries(normalizedReferenceDays(state.payload)),
  ].map((entry) => [entry.calendarBlockId, entry]));
  normalizeActiveDay();
  render();
  writeHashNavigation({ replace: true });
}

function setAgendaBusy(busy, message) {
  state.agendaBusy = busy;
  setAgendaStatus(message || "");
}

function setAgendaStatus(message) {
  agendaStatusItems.forEach((item) => {
    item.textContent = message || "";
  });
}

function renderEventsCalendarLink() {
  if (!eventsCalendarDownloadLink) return;
  const href = state.payload?.sync?.google?.operationalIcs || "/api/ics/operational";
  eventsCalendarDownloadLink.href = href;
}

function scheduleServerPartifulAutoSync(delayMs = PARTIFUL_AUTO_SYNC_OPEN_DELAY_MS) {
  if (!canRunPartifulAutoSync()) return;
  if (state.partifulAutoSyncRequestTimer) {
    globalThis.clearTimeout(state.partifulAutoSyncRequestTimer);
  }
  state.partifulAutoSyncRequestTimer = globalThis.setTimeout(() => {
    state.partifulAutoSyncRequestTimer = 0;
    void requestServerPartifulAutoSync();
  }, delayMs);
}

async function requestServerPartifulAutoSync() {
  if (!canRunPartifulAutoSync()) return;
  if (state.partifulAutoSyncRequestBusy || document.hidden) return;
  state.partifulAutoSyncRequestBusy = true;
  try {
    const response = await fetch("/api/sync/partiful/auto", {
      method: "POST",
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        body?.error?.message || `Partiful auto-sync request failed with HTTP ${response.status}.`,
      );
    }
    if (response.status === 202 || body.action === "started" || body.action === "already_running") {
      schedulePartifulAutoSyncSchedulePoll();
    }
    if (body.action === "skipped" && !hasActiveAgenda()) {
      void requestFallbackAgendaRecalculation();
    }
    if (body.partifulAutoSync?.status === "failed" && body.partifulAutoSync?.lastError) {
      setAgendaStatus(`Partiful auto-sync failed: ${body.partifulAutoSync.lastError}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Partiful auto-sync request failed.";
    console.error(error);
    setAgendaStatus(message);
  } finally {
    state.partifulAutoSyncRequestBusy = false;
  }
}

function canRunPartifulAutoSync() {
  if (state.publicShareMode) return false;
  return state.accountSession?.authenticated === true &&
    state.accountSession?.user?.isAdmin === true;
}

function hasActiveAgenda() {
  return Boolean(state.payload?.activeAgenda?.agendaRunId);
}

async function requestFallbackAgendaRecalculation() {
  if (
    !canRunPartifulAutoSync() ||
    state.partifulAutoSyncFallbackBusy || state.partifulAutoSyncFallbackAttempted ||
    hasActiveAgenda()
  ) return;
  state.partifulAutoSyncFallbackAttempted = true;
  state.partifulAutoSyncFallbackBusy = true;
  try {
    const recalculated = await recalculateAgenda({ silent: true });
    if (recalculated && !hasActiveAgenda()) {
      setAgendaStatus(
        "Agenda is stale: automatic sync was recently skipped and no active agenda is available.",
      );
    }
  } catch (error) {
    setAgendaStatus(error instanceof Error ? error.message : "Could not recalculate agenda.");
  } finally {
    state.partifulAutoSyncFallbackBusy = false;
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
    console.error(error);
    setAgendaStatus(
      error instanceof Error ? error.message : "Could not read Partiful auto-sync status.",
    );
  }
  const autoSync = state.payload?.sync?.partifulAuto;
  if (autoSync?.status === "failed" && autoSync.lastError) {
    setAgendaStatus(`Partiful auto-sync failed: ${autoSync.lastError}`);
    return;
  }
  if (autoSync?.status === "running" && attempt < PARTIFUL_AUTO_SYNC_MAX_POLLS) {
    schedulePartifulAutoSyncSchedulePoll(PARTIFUL_AUTO_SYNC_STATUS_POLL_MS, attempt + 1);
  }
}

function surfacePartifulAutoSyncStatus() {
  const autoSync = state.payload?.sync?.partifulAuto;
  if (autoSync?.status === "failed" && autoSync.lastError) {
    setAgendaStatus(`Partiful auto-sync failed: ${autoSync.lastError}`);
    return;
  }
  setAgendaStatus("");
}

function render() {
  renderReadOnlyShareMode();
  renderNext();
  renderEventsCalendarLink();
  renderDayTabs();
  renderRouteList();
  renderReferenceList();
  renderCRM();
  renderInvite();
  animateButtonCluster(document);
  animateCards(routeList);
  animateCards(referenceList);
}

function renderInvite() {
  if (!inviteStatus) return;
  if (!state.invitePayload) {
    const isSignedIn = state.accountSession?.authenticated === true;
    const setupRequired = state.accountSession?.setupRequired === true;
    inviteStatus.textContent = state.inviteLoading
      ? "Loading invite data..."
      : state.accountError
      ? state.accountError
      : isSignedIn
      ? "Invite data is not available yet."
      : setupRequired
      ? "Create the first passkey before sharing invites."
      : "Sign in to create and share your invite.";
    inviteCode.textContent = "—";
    inviteCopyCodeButton?.setAttribute("disabled", "true");
    inviteShareLink.textContent = "—";
    inviteShareLink.removeAttribute("href");
    inviteCopyLinkButton?.setAttribute("disabled", "true");
    inviteQrImage.src = "";
    inviteQrImage.hidden = true;
    if (inviteReferralsCount) inviteReferralsCount.textContent = "";
    if (inviteReferralsList) inviteReferralsList.replaceChildren();
    return;
  }

  const payload = state.invitePayload;
  const referrals = Array.isArray(payload.referrals) ? payload.referrals : [];
  inviteStatus.textContent = `Share URL: ${
    payload.createdAt ? `created ${payload.createdAt}` : "updated"
  }`.trim();
  inviteCode.textContent = payload.code || "—";
  inviteShareLink.textContent = payload.shareUrl || "";
  inviteShareLink.href = payload.shareUrl || "#";
  inviteCopyCodeButton?.removeAttribute("disabled");
  inviteCopyLinkButton?.removeAttribute("disabled");
  if (payload.shareUrl) {
    inviteQrImage.src = `${INVITE_QR_IMAGE_URL}?size=220x220&data=${
      encodeURIComponent(payload.shareUrl)
    }`;
    inviteQrImage.hidden = false;
  } else {
    inviteQrImage.hidden = true;
  }
  if (inviteReferralsCount) {
    inviteReferralsCount.textContent = `${referrals.length} referral${
      referrals.length === 1 ? "" : "s"
    }`;
  }
  if (inviteReferralsList) {
    if (!referrals.length) {
      inviteReferralsList.replaceChildren(
        Object.assign(document.createElement("li"), { textContent: "No referrals yet." }),
      );
    } else {
      inviteReferralsList.replaceChildren(...referrals.map((referral) => {
        const item = document.createElement("li");
        item.textContent = `${referral.userHandle || "User"} (${referral.userId || "id"})`;
        return item;
      }));
    }
  }
}

function renderNext() {
  const next = state.payload?.next;
  document.querySelector("[data-next-title]").textContent = next?.displayTitle ||
    "No agenda loaded";
  document.querySelector("[data-next-time]").textContent = next
    ? `${next.weekday} ${next.timeRange}`
    : "";
  document.querySelector("[data-next-place]").replaceChildren(
    next ? renderPlaceLink(next, next.location || next.venueQuery) : "",
  );
}

function renderDayTabs() {
  dayTabs.replaceChildren();
  for (const day of normalizedDays()) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = day.weekday;
    button.title = day.date;
    button.setAttribute("aria-selected", String(day.date === state.activeDay));
    button.addEventListener("click", () => {
      const previousDay = state.activeDay;
      if (previousDay === day.date) {
        return;
      }
      state.activeDay = day.date;
      state.routeTransitionDirection = routeTransitionDirection(previousDay, state.activeDay);
      renderDayTabs();
      renderRouteList();
      animateButtonCluster(dayTabs);
      animateCards(routeList);
      writeHashNavigation();
    });
    dayTabs.append(button);
  }
}

function renderRouteList() {
  const day = normalizedDays().find((item) => item.date === state.activeDay);
  const entries = day?.entries || [];
  const optionEntries = sameDayOptionEntries(state.activeDay);
  const lanes = computeCollisionLanes(entries);
  const optionLanes = computeCollisionLanes(optionEntries);
  const hasReferenceEntries = optionEntries.length > 0;
  const timelineEntries = [...entries, ...optionEntries]
    .sort((a, b) =>
      eventStartEpochMs(a) - eventStartEpochMs(b) || eventEndEpochMs(a) - eventEndEpochMs(b)
    );
  const timelineLayout = timelineLayoutModeForEntries(timelineEntries, lanes, optionLanes);
  const timeline = document.createElement("section");
  timeline.dataset.timeline = "";
  timeline.dataset.layout = timelineLayout;
  timeline.dataset.hasReference = String(hasReferenceEntries);
  timeline.dataset.transition = state.routeTransitionDirection || "none";
  timeline.style.setProperty("--slots", "96");
  timeline.append(
    renderTimeRail(),
    ...timelineEntries.map((entry) =>
      renderTimelineEntry(
        entry,
        entry.calendar === "reference" ? optionLanes : lanes,
        timelineLayout === "compact",
      )
    ),
  );
  routeList.replaceChildren(timeline);
  state.routeTransitionDirection = "none";
}

function sameDayOptionEntries(dayKey) {
  const day = normalizedReferenceDays().find((item) => item.date === dayKey);
  return (day?.entries || [])
    .filter((entry) => entry.blockType === "event")
    .map((entry) => ({
      ...entry,
      optionLabel: optionLabel(entry),
    }));
}

function optionLabel(entry) {
  const status = entry.statusLabel || entry.status || "option";
  const label = labelize(status).replace(/\bbackup\b/gi, "").replace(/\s+/g, " ").trim();
  return entry.status === "registered" ? "Registered option" : `${label || "Event"} option`;
}

function renderReferenceList() {
  const entries = eventEntries()
    .sort((a, b) => eventStartEpochMs(a) - eventStartEpochMs(b));
  referenceList.replaceChildren(...entries.map(renderEntry));
}

function timelineLayoutModeForEntries(entries, lanes, optionLanes) {
  const requested = timelineLayoutPreference();
  if (requested !== "auto") return requested;
  const hasCompactViewport = globalThis.matchMedia?.(TIMELINE_MOBILE_LAYOUT_BREAKPOINT).matches;
  if (!hasCompactViewport) return "overlay";
  const maxLanes = maxLanesForTimeline(entries, lanes, optionLanes);
  if (maxLanes >= TIMELINE_COMPACT_LANE_THRESHOLD) return TIMELINE_DEFAULT_MOBILE_LAYOUT;
  return "overlay";
}

function timelineLayoutPreference() {
  try {
    const value = localStorage.getItem(TIMELINE_LAYOUT_MODE_KEY);
    if (value === "overlay" || value === "compact") return value;
    if (value === "auto") return "auto";
  } catch {
    // ignore storage failures
  }
  return "auto";
}

function maxLanesForTimeline(entries, lanes, optionLanes) {
  let maxLanes = 1;
  for (const entry of entries) {
    const laneMap = entry.calendar === "reference" ? optionLanes : lanes;
    const lane = laneMap.get(entry.calendarBlockId);
    if (lane?.count && lane.count > maxLanes) maxLanes = lane.count;
  }
  return maxLanes;
}

function eventEntries() {
  if (!state.payload) return [];
  const schedule = flattenDayEntries(state.payload?.days)
    .filter((entry) => entry.blockType === "event");
  const reference = flattenDayEntries(state.payload?.referenceDays)
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
      entry.calendar === "schedule" ? "Agenda" : "Event"
    } - ${entry.weekday} ${entry.timeRange} - ${entry.displayTitle}`;
    return option;
  }));
  leadEventSelect.value = selectedId;

  const selected = entries.find((entry) => entry.calendarBlockId === leadEventSelect.value);
  crmEventTitle.textContent = selected?.displayTitle || "Lead capture";
  renderLeadPriorityPreview();
  renderFollowUpEmailControl();
  renderLeadList(selected?.calendarBlockId || "");
  syncLeadFieldsPanel();
  syncTranscriptInputMinHeight();
}

function syncLeadFieldsPanel() {
  if (!leadFieldsPanel || !leadFieldsToggle) return;
  const label = leadFieldsToggle.querySelector("span") || leadFieldsToggle;
  leadFieldsPanel.hidden = !state.leadFieldsExpanded;
  leadFieldsToggle.setAttribute("aria-expanded", String(state.leadFieldsExpanded));
  label.textContent = state.leadFieldsExpanded ? "Hide lead fields" : "Show lead fields";
}

function syncTranscriptInputMinHeight() {
  if (!transcriptInput) return;
  if (!transcriptPlaceholderSizer.isConnected) {
    document.body.append(transcriptPlaceholderSizer);
  }
  const style = getComputedStyle(transcriptInput);
  const width = Math.max(1, Math.round(transcriptInput.getBoundingClientRect().width));
  transcriptPlaceholderSizer.value = transcriptInput.getAttribute("placeholder") || "";
  transcriptPlaceholderSizer.style.width = `${width}px`;
  transcriptPlaceholderSizer.style.minHeight = "0";
  transcriptPlaceholderSizer.style.padding = style.padding;
  transcriptPlaceholderSizer.style.border = style.border;
  transcriptPlaceholderSizer.style.boxSizing = style.boxSizing;
  transcriptPlaceholderSizer.style.font = style.font;
  transcriptPlaceholderSizer.style.lineHeight = style.lineHeight;
  transcriptPlaceholderSizer.style.letterSpacing = style.letterSpacing;
  transcriptPlaceholderSizer.style.wordSpacing = style.wordSpacing;
  transcriptPlaceholderSizer.style.direction = style.direction;
  transcriptPlaceholderSizer.style.textAlign = style.textAlign;
  transcriptPlaceholderSizer.style.textIndent = style.textIndent;
  transcriptPlaceholderSizer.style.textTransform = style.textTransform;
  transcriptPlaceholderSizer.style.whiteSpace = "pre-wrap";
  transcriptPlaceholderSizer.style.overflowWrap = "break-word";
  const minHeight = Math.max(TRANSCRIPT_MIN_HEIGHT_PX, transcriptPlaceholderSizer.scrollHeight);
  transcriptInput.style.minHeight = `${Math.ceil(minHeight)}px`;
}

function setLeadFieldsExpanded(expanded) {
  state.leadFieldsExpanded = Boolean(expanded);
  syncLeadFieldsPanel();
}

function renderFollowUpEmailControl() {
  const input = leadForm.elements.sendFollowUpEmail;
  const configured = Boolean(state.payload?.email?.followUpConfigured);
  input.disabled = !configured;
  if (!configured) input.checked = false;
  if (!state.followUpEmailTouched) {
    input.checked = configured;
  }
  const checked = Boolean(configured && input.checked);
  const recipient = String(leadForm.elements.email?.value || "").trim();
  const stateName = !configured
    ? "unavailable"
    : !checked
    ? "off"
    : recipient
    ? "ready"
    : "needs-email";
  followUpEmailStatus.dataset.followUpEmailStatus = stateName;
  followUpEmailStatus.textContent = {
    "unavailable": "Not configured",
    "off": "Off",
    "ready": "Ready",
    "needs-email": "Needs email",
  }[stateName];
  if (followUpEmailSummary) {
    followUpEmailSummary.textContent = checked ? "Sends on save" : "Lead saves without email";
  }
  renderFollowUpEmailPreview({ configured, checked, recipient, stateName });
}

function renderFollowUpEmailPreview({ configured, checked, recipient, stateName }) {
  if (!followUpEmailPreview || !followUpEmailTo || !followUpEmailSubject || !followUpEmailBody) {
    return;
  }
  const entry = state.entriesByBlock.get(leadForm.elements.calendarBlockId.value);
  const eventTitle = entry?.displayTitle || "";
  const followUp = String(leadForm.elements.followUp?.value || "").trim();
  followUpEmailPreview.dataset.state = stateName;
  followUpEmailTo.textContent = followUpEmailRecipientText({
    configured,
    checked,
    recipient,
  });
  followUpEmailSubject.textContent = followUpEmailSubjectText(eventTitle);
  followUpEmailBody.textContent = followUpEmailBodyText({ configured, checked, followUp });
}

function followUpEmailRecipientText({ configured, checked, recipient }) {
  if (!configured) return "Sending is unavailable on this server.";
  if (!checked) return recipient || "No email will be sent.";
  return recipient || "Add an email address before saving.";
}

function followUpEmailSubjectText(eventTitle) {
  return truncate(
    eventTitle ? `Great connecting at ${eventTitle}` : "Great connecting at NYC Tech Week",
    120,
  );
}

function followUpEmailBodyText({ configured, checked, followUp }) {
  if (!configured || !checked) return "Lead will save without email.";
  const nextStep = followUp
    ? `Next step: ${followUp}`
    : "Next step: compare notes next week or look at a short example.";
  return `Short Accolades intro. ${nextStep}`;
}

function refreshAutomaticLeadEvent() {
  if (state.activeView !== "crm" || state.leadEventManuallySelected || leadFormHasDraft()) return;
  renderCRM();
}

function leadFormHasDraft() {
  const hasText = LEAD_TEXT_DRAFT_FIELDS.some((field) =>
    field === "buyerType"
      ? String(leadForm.elements[field]?.value || "").trim().toLowerCase() !== "unknown" &&
        String(leadForm.elements[field]?.value || "").trim()
      : String(leadForm.elements[field]?.value || "").trim()
  );
  const hasBuyerType = Boolean(String(leadForm.elements.buyerType?.value || "").trim()) &&
    String(leadForm.elements.buyerType?.value || "").trim().toLowerCase() !== "unknown";
  const hasSignals = LEAD_SIGNAL_FIELDS.some((field) =>
    String(leadForm.elements[field]?.value || "unknown") !== "unknown"
  );
  return hasText || hasBuyerType || hasSignals;
}

function renderLeadPriorityPreview() {
  if (!leadPriorityPreview) return;
  const entry = state.entriesByBlock.get(leadForm.elements.calendarBlockId.value);
  if (!entry) {
    leadPriorityPreview.hidden = true;
    return;
  }
  const priority = deriveLeadPriorityForDraft(entry, leadQualificationFromForm());
  leadPriorityPreview.hidden = false;
  leadPriorityPreview.dataset.priority = priority;
  leadPriorityPreview.textContent = `Priority ${priority}`;
}

function leadQualificationFromForm() {
  return {
    role: String(leadForm.elements.role?.value || ""),
    buyerType: String(leadForm.elements.buyerType?.value || ""),
    githubHeavy: String(leadForm.elements.githubHeavy?.value || "unknown"),
    aiCodingAdoption: String(leadForm.elements.aiCodingAdoption?.value || "unknown"),
    painMentioned: String(leadForm.elements.painMentioned?.value || ""),
    strongQuote: String(leadForm.elements.strongQuote?.value || ""),
    followUp: String(leadForm.elements.followUp?.value || ""),
  };
}

function deriveLeadPriorityForDraft(entry, qualification = {}) {
  const eventPriority = deriveLeadPriorityFromEntry(entry);
  let score = eventPriority === "A" ? 2 : eventPriority === "B" ? 1 : 0;
  const buyerType = String(qualification.buyerType || "").toLowerCase();
  const role = String(qualification.role || "").toLowerCase();
  const buyerAndRole = `${buyerType} ${role}`;
  if (
    /engineering leader|cto|vp eng|head of engineering|platform|devex|oss|devrel|maintainer|founder|operator/
      .test(buyerAndRole)
  ) {
    score += 2;
  } else if (/ic builder|builder|engineer|developer/.test(buyerAndRole)) {
    score += 1;
  } else if (/investor|advisor|gtm|sales|marketing|other/.test(buyerType)) {
    score -= 1;
  }

  const githubHeavy = normalizeLeadSignalValue(qualification.githubHeavy);
  const aiCodingAdoption = normalizeLeadSignalValue(qualification.aiCodingAdoption);
  if (githubHeavy === "yes") score += 1;
  if (githubHeavy === "no") score -= 1;
  if (aiCodingAdoption === "yes") score += 1;
  if (aiCodingAdoption === "no") score -= 1;
  if (String(qualification.painMentioned || "").trim()) score += 1;
  if (String(qualification.strongQuote || "").trim()) score += 1;
  if (String(qualification.followUp || "").trim()) score += 1;

  if (score >= 4) return "A";
  if (score >= 2) return "B";
  return "C";
}

function deriveLeadPriorityFromEntry(entry) {
  const tier = String(entry?.tier || "").trim().toUpperCase();
  if (tier === "S" || tier === "A") return "A";
  if (tier === "B") return "B";
  if (tier === "C") return "C";

  const score = Number.parseFloat(String(entry?.opportunityScore || ""));
  if (Number.isFinite(score)) {
    if (score >= 60) return "A";
    if (score >= 40) return "B";
    return "C";
  }

  const rank = Number.parseInt(String(entry?.rank || ""), 10);
  if (Number.isFinite(rank)) {
    if (rank <= 40) return "A";
    if (rank <= 150) return "B";
    return "C";
  }

  return "B";
}

function normalizeLeadSignalValue(value) {
  const normalized = String(value || "unknown").trim().toLowerCase();
  if (normalized === "yes" || normalized === "no") return normalized;
  return "unknown";
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
  return flattenDayEntries(state.payload?.days)
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

  appendLeadDetail(article, "Pain", lead.painMentioned);
  appendLeadDetail(article, "Quote", lead.strongQuote ? `"${lead.strongQuote}"` : "");
  appendLeadDetail(article, "Follow-up ask", lead.followUp);
  appendLeadDetail(article, "Notes", lead.notes);

  const meta = document.createElement("section");
  meta.dataset.leadTags = "";
  const priority = addLeadMeta(meta, lead.priority ? `Priority ${lead.priority}` : "");
  if (priority && lead.priority) priority.dataset.priority = lead.priority;
  addLeadMeta(meta, lead.buyerType);
  addLeadMeta(meta, signalLeadMeta("GitHub", lead.githubHeavy));
  addLeadMeta(meta, signalLeadMeta("AI coding", lead.aiCodingAdoption));
  addLeadMeta(meta, lead.nextStepDate ? `Next ${formatLeadDate(lead.nextStepDate)}` : "");
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

function appendLeadDetail(parent, label, value) {
  if (!value) return;
  const detail = document.createElement("p");
  detail.dataset.leadDetail = "";
  const heading = document.createElement("strong");
  heading.textContent = label;
  const text = document.createElement("span");
  text.textContent = value;
  detail.append(heading, text);
  parent.append(detail);
}

function addLeadMeta(parent, text) {
  if (!text) return null;
  const item = document.createElement("span");
  item.textContent = text;
  parent.append(item);
  return item;
}

function signalLeadMeta(label, value) {
  const normalized = normalizeLeadSignalValue(value);
  if (normalized === "unknown") return "";
  return `${label}: ${normalized}`;
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

function formatLeadDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const date = new Date(`${value}T12:00:00-04:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
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
    buyerType: String(formData.get("buyerType") || ""),
    githubHeavy: String(formData.get("githubHeavy") || "unknown"),
    aiCodingAdoption: String(formData.get("aiCodingAdoption") || "unknown"),
    painMentioned: String(formData.get("painMentioned") || ""),
    strongQuote: String(formData.get("strongQuote") || ""),
    followUp: String(formData.get("followUp") || ""),
    nextStepDate: String(formData.get("nextStepDate") || ""),
    ocr: state.ocrMetadata,
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
    setLeadFieldsExpanded(false);
    state.followUpEmailTouched = false;
    renderFollowUpEmailControl();
    renderCRM();
    state.ocrMetadata = null;
    leadForm.elements.name.focus();
  } catch (error) {
    setLeadError(error instanceof Error ? error.message : "Could not save lead.");
  } finally {
    submit.disabled = false;
  }
}

async function handleLeadTranscriptParse() {
  if (!canUseAiFeatures()) {
    setTranscriptStatus("Sign in to parse transcripts.");
    return;
  }
  const transcript = String(transcriptInput?.value || "").trim();
  if (!transcript) {
    setTranscriptStatus("Paste a transcript first.");
    return;
  }
  const requestId = createDebugId("transcript");
  const selected = state.entriesByBlock.get(leadForm.elements.calendarBlockId.value);
  const eventTitle = selected?.displayTitle || "";
  setLeadError("");
  setTranscriptStatus(`Parsing transcript... ${requestId}`);
  setTranscriptBusy(true);

  await logClientEvent("transcript_request_attempt", {
    requestId,
    transcriptLength: transcript.length,
    eventTitle,
    browser: browserMetadata(),
  });

  try {
    const body = await requestLeadTranscriptDraft({ requestId, transcript, eventTitle });
    state.ocrMetadata = null;
    applyLeadDraft(body.draft || {});
    setLeadFieldsExpanded(true);
    setTranscriptStatus(`Transcript parsed. Review and save. ${requestId}`);
  } catch (error) {
    await logClientEvent("transcript_request_error", {
      requestId,
      error: errorDetails(error),
      browser: browserMetadata(),
    });
    setLeadError(error instanceof Error ? error.message : "Could not parse transcript.");
    setTranscriptStatus(`Transcript parse failed. ${requestId}`);
  } finally {
    setTranscriptBusy(false);
  }
}

async function handleCardInput() {
  if (!canUseAiFeatures()) {
    setCardScanStatus("Sign in to scan cards.");
    cardInput.value = "";
    return;
  }
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
    state.ocrMetadata = null;
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
    state.ocrMetadata = body?.ocrMetadata ?? null;
    applyLeadDraft(body.draft || {});
    setLeadFieldsExpanded(true);
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
  if (!canUseAiFeatures()) throw new Error("Sign in to scan cards.");
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
      if (leadDraftHasUsableFields(body?.draft)) {
        return {
          ...body,
          ocrMetadata: coerceLeadOcrMetadata(body?.ocrMetadata) ??
            inferOcrMetadataFromAttempt({ attemptIndex, payload }),
        };
      }
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

async function requestLeadTranscriptDraft({ requestId, transcript, eventTitle }) {
  if (!canUseAiFeatures()) throw new Error("Sign in to parse transcripts.");
  let response = null;
  try {
    response = await fetchWithTimeout("/api/leads/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        transcript,
        eventTitle,
        clientMetadata: {
          baseRequestId: requestId,
          browser: browserMetadata(),
        },
      }),
    }, OCR_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw new Error(
      `${
        error instanceof DOMException && error.name === "AbortError"
          ? "Transcript parse request timed out."
          : "Transcript parse request failed."
      } Debug: ${requestId}`,
    );
  }

  const body = await response.json().catch(() => ({
    error: { message: "Could not parse transcript response.", requestId },
  }));
  await logClientEvent("transcript_request_response", {
    requestId,
    ok: response.ok,
    status: response.status,
    responseRequestId: body?.requestId || body?.error?.requestId || requestId,
    body: response.ok ? { hasDraft: Boolean(body?.draft) } : body,
  });
  if (!response.ok) {
    throw new Error(
      `${body?.error?.message || "Could not parse transcript."} Debug: ${
        body?.error?.requestId || requestId
      }`,
    );
  }
  if (!leadDraftHasUsableFields(body?.draft)) {
    throw new Error(
      `Transcript parse did not find any lead fields. Debug: ${body?.requestId || requestId}`,
    );
  }
  return body;
}

function inferOcrMetadataFromAttempt({ attemptIndex, payload }) {
  const metadata = payload?.metadata && typeof payload.metadata === "object"
    ? payload.metadata
    : {};
  const rawOcrDataUrlCharacters = metadata.ocrDataUrlCharacters ??
    metadata.compressedDataUrlCharacters ??
    metadata.dataUrlCharacters;
  return coerceLeadOcrMetadata({
    ocrSource: typeof metadata.ocrSource === "string" ? metadata.ocrSource : "",
    attemptIndex: Number.isFinite(Number(metadata.retryIndex ?? attemptIndex))
      ? Number(metadata.retryIndex ?? attemptIndex)
      : Number(attemptIndex),
    outputWidth: Number.isFinite(Number(metadata.outputWidth))
      ? Number(metadata.outputWidth)
      : undefined,
    outputHeight: Number.isFinite(Number(metadata.outputHeight))
      ? Number(metadata.outputHeight)
      : undefined,
    dataUrlCharacters: Number.isFinite(Number(rawOcrDataUrlCharacters))
      ? Number(rawOcrDataUrlCharacters)
      : undefined,
  });
}

function coerceLeadOcrMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const raw = value;
  const ocrSource = typeof raw.ocrSource === "string" && raw.ocrSource.trim()
    ? raw.ocrSource.trim()
    : "";
  const attemptIndex = Number.isFinite(Number(raw.attemptIndex))
    ? Math.max(0, Math.round(Number(raw.attemptIndex)))
    : undefined;
  const outputWidth = Number.isFinite(Number(raw.outputWidth))
    ? Math.max(0, Math.round(Number(raw.outputWidth)))
    : undefined;
  const outputHeight = Number.isFinite(Number(raw.outputHeight))
    ? Math.max(0, Math.round(Number(raw.outputHeight)))
    : undefined;
  const dataUrlCharacters = Number.isFinite(Number(raw.dataUrlCharacters))
    ? Math.max(0, Math.round(Number(raw.dataUrlCharacters)))
    : undefined;
  const normalized = {
    ...(ocrSource ? { ocrSource } : {}),
    ...(attemptIndex !== undefined ? { attemptIndex } : {}),
    ...(outputWidth !== undefined ? { outputWidth } : {}),
    ...(outputHeight !== undefined ? { outputHeight } : {}),
    ...(dataUrlCharacters !== undefined ? { dataUrlCharacters } : {}),
    ...(raw.localOcrUsed === true || raw.localOcrUsed === "true" ? { localOcrUsed: true } : {}),
    ...(Number.isFinite(Number(raw.localOcrMeanConfidence))
      ? { localOcrMeanConfidence: Math.round(Number(raw.localOcrMeanConfidence)) }
      : {}),
  };
  if (Object.keys(normalized).length) return normalized;
  return null;
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
  for (
    const field of [
      "name",
      "company",
      "role",
      "email",
      "phone",
      "painMentioned",
      "strongQuote",
      "followUp",
      "notes",
    ]
  ) {
    if (typeof draft[field] === "string" && draft[field].trim()) {
      leadForm.elements[field].value = draft[field].trim();
    }
  }
  if (typeof leadForm.elements.nextStepDate?.value === "string") {
    leadForm.elements.nextStepDate.value = normalizeLeadDraftDate(draft?.nextStepDate);
  }
  const buyerType =
    typeof draft.buyerType === "string" && draft.buyerType.trim().toLowerCase() !== "unknown"
      ? draft.buyerType.trim()
      : "";
  if (buyerType && leadForm.elements.buyerType) {
    leadForm.elements.buyerType.value = buyerType;
  }
  leadForm.elements.githubHeavy.value = normalizeLeadSignalValue(draft.githubHeavy);
  leadForm.elements.aiCodingAdoption.value = normalizeLeadSignalValue(draft.aiCodingAdoption);
  renderLeadPriorityPreview();
}

function leadDraftHasUsableFields(draft) {
  if (!draft || typeof draft !== "object") return false;
  const hasText = LEAD_TEXT_DRAFT_FIELDS.some((field) => {
    const value = String(draft[field] || "").trim();
    if (!value) return false;
    if (field === "buyerType") return value.toLowerCase() !== "unknown";
    return true;
  });
  const hasSignals = LEAD_SIGNAL_FIELDS.some((field) =>
    normalizeLeadSignalValue(draft[field]) !== "unknown"
  );
  return hasText || hasSignals;
}

function normalizeLeadDraftDate(value) {
  const trimmed = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
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
  const disabled = busy || !canUseAiFeatures();
  cardInput.disabled = disabled;
  cardScanButton.setAttribute("aria-disabled", String(disabled));
}

function setTranscriptStatus(message) {
  if (!transcriptStatus) return;
  transcriptStatus.textContent = message;
}

function setTranscriptBusy(busy) {
  if (!transcriptButton || !transcriptInput) return;
  const disabled = busy || !canUseAiFeatures();
  transcriptInput.disabled = disabled;
  transcriptButton.disabled = disabled;
}

function renderEntry(entry) {
  return renderEntryCard(entry, false);
}

function renderTimelineEntry(entry, lanes, isCompact = false) {
  const article = renderEntryCard(entry, true);
  if (isCompact) {
    return article;
  }
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
  const localNote = state.payload?.state?.eventNotes?.[entry.calendarBlockId]?.note?.trim() || "";
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
    ? compactTitle(entry)
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
  renderEventDetail(entry);
  const actions = document.querySelector("[data-event-actions]");
  actions.replaceChildren(...eventActions(entry));
  animateButtonCluster(actions);
  eventModal.hidden = false;
  eventBackdrop.hidden = false;
  document.body.dataset.modalOpen = "true";
}

function closeEventModal() {
  eventModal.hidden = true;
  eventBackdrop.hidden = true;
  document.body.dataset.modalOpen = "false";
}

function renderEventDetail(entry) {
  const detail = document.querySelector("[data-event-detail]");
  const raw = entry.routeDetails || entry.note || firstCoachingLine(entry.salesCoaching) || "";
  const text = cleanEventDetail(raw);
  if (!text) {
    detail.replaceChildren();
    return;
  }
  detail.replaceChildren(
    ...detailParagraphs(text).map((paragraph) => {
      const node = document.createElement("p");
      node.textContent = paragraph;
      return node;
    }),
  );
}

function cleanEventDetail(text) {
  return String(text)
    .replace(/^Discovered from live Partiful account sync\.\s*/i, "")
    .replace(/^Description:\s*/i, "")
    .replace(/\s+Description:\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detailParagraphs(text) {
  const explicit = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;

  const sentences = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || [text];
  const paragraphs = [];
  let current = "";
  for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && next.length > 360) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

function eventActions(entry) {
  const actions = [];
  if (entry.eventUrl) {
    const link = document.createElement("a");
    link.href = entry.eventUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    setButtonContent(link, "external", "Partiful");
    markMotionButton(link);
    actions.push(link);
  }

  if (
    entry.blockType === "event" && !state.publicShareMode &&
    state.accountSession?.authenticated === true
  ) {
    const ask = document.createElement("button");
    ask.type = "button";
    ask.dataset.variant = "primary";
    ask.dataset.requiresAuth = "";
    setButtonContent(ask, "sparkles", "Ask");
    ask.addEventListener("click", () => {
      if (state.agentBusy) return;
      openEventCoachingChat(entry);
    });
    markMotionButton(ask);
    actions.push(ask);
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
  const destinationLabel = String(text || "").trim();
  if (!destinationLabel) return document.createTextNode("");
  const displayLabel = shortPlaceLabel(destinationLabel);
  const directions = directionsUrl(entry, destinationLabel);
  if (!directions) return document.createTextNode(displayLabel);

  const link = document.createElement("a");
  link.href = directions;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.dataset.placeLink = "";
  link.setAttribute("aria-label", `Open directions to ${destinationLabel} from current location`);
  link.addEventListener("click", (event) => event.stopPropagation());
  const span = document.createElement("span");
  span.textContent = displayLabel;
  link.append(renderIcon("map-pin"), span);
  return link;
}

function shortPlaceLabel(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const shortened = text
    .replace(
      /,\s*(?:New York|NYC|Manhattan|Brooklyn|Queens|Bronx|Staten Island)?\s*,?\s*NY(?:\s+\d{5}(?:-\d{4})?)?\s*$/i,
      "",
    )
    .replace(/,\s*New York(?:\s+\d{5}(?:-\d{4})?)?\s*$/i, "")
    .replace(/,\s*\d{5}(?:-\d{4})?\s*$/, "")
    .trim();
  return shortened || text;
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
  return String(hour);
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
  if (!canUseAiFeatures()) return;
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
      buyerType: String(lead.buyerType || ""),
      githubHeavy: String(lead.githubHeavy || ""),
      aiCodingAdoption: String(lead.aiCodingAdoption || ""),
      painMentioned: String(lead.painMentioned || ""),
      strongQuote: String(lead.strongQuote || ""),
      notes: String(lead.notes || ""),
      priority: String(lead.priority || ""),
      followUp: String(lead.followUp || ""),
      nextStepDate: String(lead.nextStepDate || ""),
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
  if (state.sharedMode || !canUseAiFeatures()) return;
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
    userFocus: currentUserFocus(),
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

function currentUserFocus() {
  const day = state.payload?.days?.find((item) => item.date === state.activeDay) || null;
  return {
    view: state.activeView,
    viewLabel: VIEW_TITLES[state.activeView] || "Agenda",
    dayKey: state.activeDay || "",
    weekday: day?.weekday || "",
    date: day?.date || state.activeDay || "",
    hash: globalThis.location.hash || "",
  };
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
  const source = String(markdown || "").replace(/\r\n/g, "\n");
  if (!source.trim()) return "<p></p>";
  if (!MARKDOWN_RENDERER) return `<p>${escapeHtml(source)}</p>`;
  return sanitizeMarkdownHtml(MARKDOWN_RENDERER.render(source)) || "<p></p>";
}

function createMarkdownRenderer() {
  const factory = globalThis.markdownit;
  if (typeof factory !== "function") return null;

  const renderer = factory({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  const defaultLinkOpen = renderer.renderer.rules.link_open ||
    ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
    return defaultLinkOpen(tokens, index, options, env, self);
  };
  return renderer;
}

function sanitizeMarkdownHtml(html) {
  const purifier = globalThis.DOMPurify;
  if (!purifier?.sanitize) return html;
  return purifier.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["script", "style"],
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function scopedStorageKey(base, scope) {
  const normalized = String(scope || ACCOUNT_ANONYMOUS_STORAGE_ID)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_") || ACCOUNT_ANONYMOUS_STORAGE_ID;
  return `${base}:${normalized}`;
}

function chatStorageKey() {
  return scopedStorageKey(CHAT_STORAGE_KEY, state.accountStorageId);
}

function chatHistoryKey() {
  return scopedStorageKey(CHAT_HISTORY_KEY, state.accountStorageId);
}

function activeChatKey() {
  return scopedStorageKey(ACTIVE_CHAT_KEY, state.accountStorageId);
}

function loadChatStorageForAccount(storageId) {
  state.accountStorageId = storageId || ACCOUNT_ANONYMOUS_STORAGE_ID;
  state.messages = readJsonStorage(chatStorageKey(), []);
  state.sessions = readJsonStorage(chatHistoryKey(), []);
  state.activeSessionId = localStorage.getItem(activeChatKey()) || createSessionId();
  state.activeSessionMeta = null;
  state.historyOpen = false;
  chatHistoryToggle.setAttribute("aria-expanded", "false");
  hydrateChatHistory();
  renderChat();
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
  if (!canUseAiFeatures()) return null;
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
  localStorage.setItem(activeChatKey(), state.activeSessionId);
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
    ...meta,
    kind: String(meta.kind || ""),
    cacheKey: String(meta.cacheKey || ""),
    contextHash: String(meta.contextHash || ""),
    version: Number.isFinite(Number(meta.version)) ? Number(meta.version) : 0,
    calendarBlockId: String(meta.calendarBlockId || ""),
    techweekId: String(meta.techweekId || ""),
    eventTitle: String(meta.eventTitle || ""),
    prompt: String(meta.prompt || ""),
    sharedResourceHandle: String(meta.sharedResourceHandle || ""),
    sharedChatIds: normalizeSharedChatIds(meta.sharedChatIds ?? meta.shareIds),
  };
}

function normalizeSharedChatIds(value) {
  const ids = new Set();
  const add = (candidate) => {
    const id = String(candidate || "").trim();
    if (id) ids.add(id);
  };
  if (Array.isArray(value)) {
    for (const item of value) add(item);
  } else if (value != null) {
    add(value);
    if (typeof value === "string") {
      for (const id of value.split(",")) add(id);
    }
  }
  return [...ids];
}

function recordSharedChatForActiveSession(sharedId, handle = "") {
  if (!sharedId) return;
  const sessionMeta = state.activeSessionMeta && typeof state.activeSessionMeta === "object"
    ? { ...state.activeSessionMeta }
    : {};
  const sharedChatIds = normalizeSharedChatIds(sessionMeta.sharedChatIds);
  const normalizedSharedId = String(sharedId || "").trim();
  if (normalizedSharedId && !sharedChatIds.includes(normalizedSharedId)) {
    sharedChatIds.push(normalizedSharedId);
  }
  sessionMeta.sharedChatIds = sharedChatIds;
  sessionMeta.sharedResourceHandle = String(handle || sessionMeta.sharedResourceHandle || "");
  state.activeSessionMeta = sessionMeta;
  upsertCurrentSession();
  renderChatHistory();
}

function deleteSharedChat(shareId, handle = "") {
  const id = String(shareId || "").trim();
  const ownerHandle = String(handle || currentAccountHandle() || "").trim();
  if (!id || !ownerHandle) return;
  void fetch(`/api/resources/${encodeURIComponent(ownerHandle)}/chat/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  }).then((response) => {
    if (!response.ok) throw new Error("Shared chat delete failed.");
  }).catch(() => {
    // Best-effort deletion: keep local state clean even when remote cleanup fails.
  });
}

function deleteSharedChatsFromMetadata(meta) {
  const shareIds = normalizeSharedChatIds(meta?.sharedChatIds ?? meta?.shareIds);
  const handle = String(meta?.sharedResourceHandle || currentAccountHandle() || "").trim();
  for (const shareId of shareIds) {
    deleteSharedChat(shareId, handle);
  }
}

function clearSharedChatMode() {
  const wasShared = state.sharedMode;
  state.sharedMode = false;
  state.sharedChatId = "";
  state.sharedMessages = [];
  state.sharedModeError = "";
  hideChatSharePanel();
  if (chatSharedNotice) chatSharedNotice.hidden = true;
  if (chatForkButton) chatForkButton.hidden = true;
  if (wasShared) updateComposerState();
}

function hideChatSharePanel() {
  if (chatShareResult) {
    chatShareResult.hidden = true;
    if (chatShareStatus) chatShareStatus.textContent = "";
  }
  if (chatShareLink) {
    chatShareLink.removeAttribute("href");
    chatShareLink.textContent = "";
    chatShareLink.hidden = true;
  }
  if (chatShareCopyButton) chatShareCopyButton.hidden = true;
}

function enterSharedChatMode(chatId, messages) {
  clearSharedChatMode();
  state.sharedMode = true;
  state.sharedModeError = "";
  state.sharedChatId = String(chatId || "");
  state.sharedMessages = sanitizeChatMessagesForShare(Array.isArray(messages) ? messages : []);
  state.messages = state.sharedMessages.slice(-CHAT_MESSAGE_LIMIT);
  state.activeSessionMeta = null;
  state.historyOpen = false;
  if (chatHistoryToggle) chatHistoryToggle.setAttribute("aria-expanded", "false");
  if (chatHistory) chatHistory.hidden = true;
  renderChat();
}

function findCachedChatSession(cacheKey) {
  const key = String(cacheKey || "");
  if (!key) return null;
  return state.sessions.find((session) => session.id === key || session.meta?.cacheKey === key) ||
    null;
}

function startNewChat(options = {}) {
  const wasShared = state.sharedMode;
  if (!wasShared) persistMessages();
  clearSharedChatMode();
  state.messages = [];
  state.activeSessionId = options.id || createSessionId();
  state.activeSessionMeta = normalizeSessionMeta(options.meta);
  state.historyOpen = false;
  localStorage.setItem(activeChatKey(), state.activeSessionId);
  localStorage.setItem(chatStorageKey(), "[]");
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
  localStorage.setItem(chatHistoryKey(), JSON.stringify(state.sessions));
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
  clearSharedChatMode();
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  state.activeSessionId = session.id;
  state.activeSessionMeta = session.meta || null;
  state.messages = session.messages.slice(-CHAT_MESSAGE_LIMIT);
  state.historyOpen = false;
  localStorage.setItem(activeChatKey(), state.activeSessionId);
  localStorage.setItem(chatStorageKey(), JSON.stringify(state.messages));
  chatHistoryToggle.setAttribute("aria-expanded", "false");
  renderChat();
  renderChatHistory();
}

function renderChatHistory() {
  if (state.sharedMode) {
    chatHistory.hidden = true;
    return;
  }
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
  const deletingSession = state.sessions.find((session) => session.id === sessionId);

  persistMessages();
  const deletingActive = sessionId === state.activeSessionId;
  state.sessions = normalizeSessions(state.sessions.filter((session) => session.id !== sessionId));
  persistSessions();
  deleteSharedChatsFromMetadata(deletingSession?.meta);

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
  clearSharedChatMode();
  state.messages = [];
  state.activeSessionId = createSessionId();
  state.activeSessionMeta = null;
  state.historyOpen = false;
  localStorage.setItem(activeChatKey(), state.activeSessionId);
  localStorage.setItem(chatStorageKey(), "[]");
  chatHistoryToggle.setAttribute("aria-expanded", "false");
  renderChat();
  renderChatHistory();
}

function renderChat() {
  chatLog.replaceChildren();
  if (!state.messages.length) {
    chatLog.dataset.empty = "true";
    const empty = appendMessage(
      "assistant",
      state.sharedMode ? state.sharedModeError || CHAT_SHARE_EMPTY_GUIDE : CHAT_EMPTY_GUIDE,
      false,
      {
        suppressTools: true,
      },
    );
    empty.dataset.emptyMessage = "";
    state.messages = [];
    updateComposerState();
    renderChatHistory();
    return;
  }
  state.sharedModeError = "";
  delete chatLog.dataset.empty;
  for (const message of state.messages.slice(-CHAT_MESSAGE_LIMIT)) {
    appendMessage(message.role, message.content, false);
  }
  updateComposerState();
  renderChatHistory();
}

function sharedChatErrorMessage(status, fallback) {
  if (status === 413) {
    return "This chat is too long to share yet. Trim the chat and try again.";
  }
  if (status === 404) {
    return "That shared chat link is no longer available.";
  }
  return fallback || "The chat share request could not be completed.";
}

function sharePathFromLocation() {
  const parts = globalThis.location.pathname.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  });
  if (parts[0] !== "share" || parts.length !== 4) return null;
  const type = parts[2] === "agenda" || parts[2] === "chat" ? parts[2] : "";
  if (!parts[1] || !type || !parts[3]) return null;
  return { handle: parts[1], type, id: parts[3] };
}

function currentAccountHandle() {
  return String(state.accountSession?.user?.handle || "").trim();
}

function ownerResourcePath(type, id) {
  const handle = currentAccountHandle();
  if (!handle) return "";
  return `/api/resources/${encodeURIComponent(handle)}/${type}/${encodeURIComponent(id)}`;
}

function normalizeShareableMessage(message) {
  const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : "";
  if (!role) return null;

  const content = String(message?.content || "").replaceAll("\u0000", "").replace(/\r\n/g, "\n")
    .trim();
  if (!content) return null;

  return { role, content };
}

function sanitizeChatMessagesForShare(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeShareableMessage)
    .filter(Boolean)
    .slice(-CHAT_MESSAGE_LIMIT);
}

function sharedChatIdFromPayload(payload = {}) {
  return String(
    payload?.contentHash || payload?.resourceId || payload?.chatId || payload?.id ||
      payload?.shareId || payload?.slug || "",
  ).trim();
}

function renderReadOnlyShareMode() {
  document.body.dataset.shareMode = state.publicShareMode ? "public" : "";
  if (readOnlyShareIndicator) {
    readOnlyShareIndicator.hidden = !state.publicShareMode;
  }
  if (agendaShareControls) agendaShareControls.hidden = state.publicShareMode;
  viewButtons.forEach((button) => {
    const view = button.dataset.viewButton;
    const hidden = state.publicShareMode && (view === "crm" || view === "account");
    button.hidden = hidden;
    button.disabled = hidden;
  });
  updateAuthenticatedCtas();
}

function renderChatSharePanel({ status = "", url = "", latestUrl = "", immutableUrl = "" } = {}) {
  if (!chatShareResult) return;
  if (!status) {
    chatShareResult.hidden = true;
    return;
  }
  chatShareResult.hidden = false;
  if (chatShareStatus) chatShareStatus.textContent = status;
  const primaryUrl = latestUrl || url;
  if (chatShareLink) {
    if (!primaryUrl) {
      chatShareLink.removeAttribute("href");
      chatShareLink.textContent = "";
      chatShareLink.hidden = true;
    } else {
      chatShareLink.href = primaryUrl;
      chatShareLink.textContent = primaryUrl;
      chatShareLink.hidden = false;
    }
  }
  if (chatShareCopyButton) {
    chatShareCopyButton.hidden = !primaryUrl;
    chatShareCopyButton.disabled = !primaryUrl;
  }
  if (chatShareImmutableLink) {
    if (!immutableUrl) {
      chatShareImmutableLink.removeAttribute("href");
      chatShareImmutableLink.textContent = "";
      chatShareImmutableLink.hidden = true;
    } else {
      chatShareImmutableLink.href = immutableUrl;
      chatShareImmutableLink.textContent = immutableUrl;
      chatShareImmutableLink.hidden = false;
    }
  }
  if (chatShareImmutableCopyButton) {
    chatShareImmutableCopyButton.hidden = !immutableUrl;
    chatShareImmutableCopyButton.disabled = !immutableUrl;
  }
  if (chatShareRevokeButton) {
    chatShareRevokeButton.hidden = !primaryUrl;
    chatShareRevokeButton.disabled = !primaryUrl;
  }
}

function renderAgendaSharePanel({ status = "", latestUrl = "", immutableUrl = "" } = {}) {
  if (!agendaShareControls || state.publicShareMode) return;
  if (agendaShareStatus) agendaShareStatus.textContent = status;
  setShareLink(agendaShareLatestLink, agendaShareLatestCopyButton, latestUrl);
  setShareLink(agendaShareImmutableLink, agendaShareImmutableCopyButton, immutableUrl);
  if (agendaShareRevokeButton) {
    agendaShareRevokeButton.disabled = !latestUrl;
  }
}

function setShareLink(link, copyButton, url) {
  if (link) {
    if (!url) {
      link.removeAttribute("href");
      link.textContent = "";
      link.hidden = true;
    } else {
      link.href = url;
      link.textContent = url;
      link.hidden = false;
    }
  }
  if (copyButton) {
    copyButton.hidden = !url;
    copyButton.disabled = !url;
  }
}

async function loadSharedChat(handle, chatId) {
  if (!handle || !chatId) return;
  clearSharedChatMode();
  state.publicShareMode = true;
  state.sharedResourceType = "chat";
  state.sharedResourceHandle = String(handle || "");
  state.sharedResourceId = String(chatId || "");
  state.sharedMode = true;
  state.sharedChatId = String(chatId || "");
  state.sharedMessages = [];
  state.messages = [];
  state.sharedModeError = "Loading shared chat...";
  renderReadOnlyShareMode();
  renderChat();
  try {
    const response = await fetch(
      `/api/share/${encodeURIComponent(handle)}/chat/${encodeURIComponent(chatId)}`,
    );
    const body = await response.json().catch(() => ({}));

    if (response.status === 404) {
      throw new Error(sharedChatErrorMessage(404, "Shared chat not found."));
    }
    if (response.status === 413) {
      throw new Error(sharedChatErrorMessage(413));
    }
    if (response.status !== 200) {
      const message = body?.error?.message || body?.message ||
        sharedChatErrorMessage(response.status, `Could not load shared chat (${response.status}).`);
      throw new Error(message);
    }

    const messages = sanitizeChatMessagesForShare(
      body?.payload?.messages || body?.messages || body?.chat?.messages || body?.data?.messages ||
        [],
    );
    state.sharedResourceHash = String(body?.contentHash || chatId || "");
    state.sharedLatestUrl = String(body?.latestUrl || "");
    state.sharedImmutableUrl = String(body?.immutableUrl || "");
    enterSharedChatMode(chatId, messages);
  } catch (error) {
    state.sharedMode = true;
    state.sharedMessages = [];
    state.sharedChatId = chatId;
    state.messages = [];
    state.sharedModeError = error instanceof Error ? error.message : "Could not load shared chat.";
    renderChat();
  }
}

async function initializeSharedResourceFromLocation(sharePath) {
  state.publicShareMode = true;
  state.sharedResourceType = sharePath.type;
  state.sharedResourceHandle = sharePath.handle;
  state.sharedResourceId = sharePath.id;
  renderReadOnlyShareMode();
  if (sharePath.type === "chat") {
    await loadSharedChat(sharePath.handle, sharePath.id);
    openChat();
    return;
  }

  setAgendaStatus("Loading shared agenda...");
  try {
    const response = await fetch(
      `/api/share/${encodeURIComponent(sharePath.handle)}/agenda/${
        encodeURIComponent(sharePath.id)
      }`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || `Could not load shared agenda (${response.status}).`);
    }
    state.sharedResourceHash = String(body?.contentHash || sharePath.id || "");
    state.sharedLatestUrl = String(body?.latestUrl || "");
    state.sharedImmutableUrl = String(body?.immutableUrl || "");
    applySchedulePayload({
      ...(body?.payload || {}),
      generatedAt: body?.updatedAt || new Date().toISOString(),
      source: `share:${sharePath.handle}/agenda/${sharePath.id}`,
    });
    setAgendaStatus("Read-only shared agenda.");
  } catch (error) {
    setAgendaStatus(error instanceof Error ? error.message : "Could not load shared agenda.");
  }
}

async function createSharedChat() {
  if (state.sharedMode || state.publicShareMode || state.agentBusy) return;
  const transcript = sanitizeChatMessagesForShare(state.messages);
  if (!transcript.length) {
    renderChatSharePanel({ status: "Add a message before sharing this chat." });
    return;
  }
  const handle = currentAccountHandle();
  if (!handle) {
    renderChatSharePanel({ status: "Sign in before sharing this chat." });
    return;
  }
  renderChatSharePanel({ status: "Creating share link..." });
  if (chatShareButton) chatShareButton.disabled = true;
  try {
    const response = await fetch(`/api/resources/${encodeURIComponent(handle)}/chat/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title: chatTitle(transcript), messages: transcript }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 413) {
      throw new Error(sharedChatErrorMessage(413));
    }
    if (response.status === 404) {
      throw new Error(sharedChatErrorMessage(404, "Sharing endpoint is unavailable."));
    }
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(
        body?.error?.message || body?.message ||
          sharedChatErrorMessage(
            response.status,
            `Could not create shared chat (${response.status}).`,
          ),
      );
    }

    const sharedId = sharedChatIdFromPayload(body);
    if (!sharedId) {
      throw new Error(body?.error?.message || "Server did not return a share id.");
    }

    recordSharedChatForActiveSession(sharedId, handle);
    renderChatSharePanel({
      status: "Share links ready:",
      latestUrl: body.latestUrl || "",
      immutableUrl: body.immutableUrl || "",
    });
  } catch (error) {
    renderChatSharePanel({
      status: error instanceof Error ? error.message : "Could not create share link.",
    });
  } finally {
    if (chatShareButton) {
      chatShareButton.disabled = state.sharedMode || state.agentBusy || !state.messages.length;
    }
  }
}

async function createAgendaShare() {
  if (state.publicShareMode) return;
  const handle = currentAccountHandle();
  if (!handle) {
    renderAgendaSharePanel({ status: "Sign in before sharing this agenda." });
    return;
  }
  renderAgendaSharePanel({ status: "Creating agenda share links..." });
  if (agendaShareButton) agendaShareButton.disabled = true;
  try {
    const response = await fetch(`/api/resources/${encodeURIComponent(handle)}/agenda/share`, {
      method: "POST",
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || `Could not share agenda (${response.status}).`);
    }
    renderAgendaSharePanel({
      status: "Agenda share links ready:",
      latestUrl: body.latestUrl || "",
      immutableUrl: body.immutableUrl || "",
    });
  } catch (error) {
    renderAgendaSharePanel({
      status: error instanceof Error ? error.message : "Could not share agenda.",
    });
  } finally {
    if (agendaShareButton) agendaShareButton.disabled = false;
  }
}

async function revokeLatestShare(type) {
  const path = ownerResourcePath(type, "latest");
  if (!path) {
    const status = "Sign in before revoking this share.";
    if (type === "chat") renderChatSharePanel({ status });
    else renderAgendaSharePanel({ status });
    return;
  }
  try {
    const response = await fetch(path, { method: "DELETE", credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Could not revoke ${type} share.`);
    }
    if (type === "chat") renderChatSharePanel({ status: "Latest chat link revoked." });
    else renderAgendaSharePanel({ status: "Latest agenda link revoked." });
  } catch (error) {
    const status = error instanceof Error ? error.message : `Could not revoke ${type} share.`;
    if (type === "chat") renderChatSharePanel({ status });
    else renderAgendaSharePanel({ status });
  }
}

function forkSharedChat() {
  if (!state.sharedMode) return;
  const messages = sanitizeChatMessagesForShare(state.sharedMessages);
  clearSharedChatMode();
  state.publicShareMode = false;
  state.sharedResourceType = "";
  state.sharedResourceHandle = "";
  state.sharedResourceId = "";
  state.sharedResourceHash = "";
  state.sharedLatestUrl = "";
  state.sharedImmutableUrl = "";
  state.messages = [];
  state.activeSessionId = createSessionId();
  state.activeSessionMeta = null;
  state.historyOpen = false;
  localStorage.setItem(activeChatKey(), state.activeSessionId);
  localStorage.setItem(chatStorageKey(), "[]");
  chatHistoryToggle.setAttribute("aria-expanded", "false");
  state.messages = messages.slice(-CHAT_MESSAGE_LIMIT);
  persistMessages();
  history.replaceState(null, "", "/");
  renderReadOnlyShareMode();
  renderChat();
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
    markMotionButton(button);
    wrap.append(button);
  }
  messageEl.after(wrap);
  animateButtonCluster(wrap);
}

function actionLabel(action) {
  if (action.type === "event_note") return "Save note";
  return "Apply";
}

function actionIcon(action) {
  if (action.type === "event_note") return "sparkles";
  return "check";
}

async function applyAction(action) {
  if (state.publicShareMode) return;
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
  if (state.sharedMode) {
    return;
  }
  state.messages = state.messages.slice(-CHAT_MESSAGE_LIMIT);
  localStorage.setItem(chatStorageKey(), JSON.stringify(state.messages));
  localStorage.setItem(activeChatKey(), state.activeSessionId);
  upsertCurrentSession();
}

function setBusy(busy) {
  state.agentBusy = busy;
  const readOnly = state.sharedMode || !canUseAiFeatures();
  chatNewButton.disabled = readOnly || busy;
  if (chatHistoryToggle) chatHistoryToggle.disabled = readOnly || busy;
  if (chatShareButton) {
    chatShareButton.disabled = readOnly || busy || !state.messages.length;
  }
  updateComposerState();
}

if (!initialSharePath) {
  loadScheduleForApp({ scheduleAutoSync: true }).catch(() => {});
}
globalThis.setInterval(refreshAutomaticLeadEvent, LEAD_EVENT_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (state.publicShareMode) return;
  if (document.hidden) return;
  refreshAutomaticLeadEvent();
  void loadScheduleForApp({ scheduleAutoSync: true }).catch((error) => {
    console.warn(error);
  });
});
