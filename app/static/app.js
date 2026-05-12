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
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_TITLES = {
  route: "Route",
  backup: "Backups",
  crm: "CRM",
};

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

function toggleChatHistory() {
  state.historyOpen = !state.historyOpen;
  chatHistoryToggle.setAttribute("aria-expanded", String(state.historyOpen));
  renderChatHistory();
}

async function loadSchedule() {
  const response = await fetch("/api/schedule");
  state.payload = await response.json();
  state.entriesByBlock = new Map([
    ...state.payload.days.flatMap((day) => day.entries),
    ...state.payload.referenceDays.flatMap((day) => day.entries),
  ].map((entry) => [entry.calendarBlockId, entry]));
  state.activeDay ||= state.payload.days[0]?.date || "";
  render();
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
  const lanes = computeCollisionLanes(entries);
  const timeline = document.createElement("section");
  timeline.dataset.timeline = "";
  timeline.style.setProperty("--slots", "96");
  timeline.append(renderTimeRail(), ...entries.map((entry) => renderTimelineEntry(entry, lanes)));
  routeList.replaceChildren(timeline);
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
  const article = document.createElement("article");
  article.dataset.entry = entry.calendarBlockId;
  article.dataset.type = entry.blockType;
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.setAttribute("aria-label", `${entry.displayTitle}, ${entry.timeRange}`);
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
  title.textContent = compact ? compactTitle(entry) : entry.displayTitle;
  const time = document.createElement("time");
  time.textContent = entry.timeRange;
  titleRow.append(title, time);

  const meta = document.createElement("section");
  meta.dataset.meta = "";
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
  document.querySelector("[data-event-type]").textContent = entry.blockType;
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
    if (!response.ok || !response.body) throw new Error(response.statusText);
    const result = await readAgentStream(response.body, pendingContent);
    pending.dataset.streaming = "false";
    pendingContent.innerHTML = renderMarkdown(result.text);
    state.messages.push({ role: "assistant", content: result.text });
    attachMessageTools(pending, result.text);
    renderProposedActions(pending, result.actions || []);
    persistMessages();
  } catch (error) {
    pending.dataset.streaming = "false";
    const message = error instanceof Error ? error.message : "The agent request failed.";
    pendingContent.innerHTML = renderMarkdown(message);
    attachMessageTools(pending, message);
  } finally {
    setBusy(false);
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

  const coordinates = await readCurrentPosition();
  if (coordinates.ok) {
    context.coordinates = coordinates.value;
    context.locationStatus = "available";
  } else {
    context.locationStatus = coordinates.reason;
  }
  return context;
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

  const scheduleRender = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      target.innerHTML = renderMarkdown(markdown);
      chatLog.scrollTop = chatLog.scrollHeight;
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
        scheduleRender();
      } else if (event.event === "done") {
        finalText = String(event.data.text || markdown);
        actions = Array.isArray(event.data.actions) ? event.data.actions : [];
      } else if (event.event === "error") {
        throw new Error(event.data.message || "Stream failed.");
      }
    }
  }

  return { text: finalText || markdown, actions };
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
  chatLog.append(item);
  chatLog.scrollTop = chatLog.scrollHeight;
  if (persist && role === "user") {
    state.messages.push({ role, content });
    persistMessages();
  }
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
});
globalThis.setInterval(refreshAutomaticLeadEvent, LEAD_EVENT_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAutomaticLeadEvent();
});
