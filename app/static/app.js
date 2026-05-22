const AUTH_COMPLETE_MESSAGE = "planner-auth-complete";
const PROFILE_SAVE_DELAY_MS = 650;
const AGENDA_NAME_SAVE_DELAY_MS = 550;
const TIMELINE_SLOT_MINUTES = 15;
const EMPTY_SLOT_MINUTES = 30;
const FULL_DAY_START_MINUTES = 0;
const FULL_DAY_END_MINUTES = 24 * 60;
const DEFAULT_NEW_EVENT_START_MINUTES = 9 * 60;

const state = {
  session: null,
  planner: null,
  activePanel: "calendar",
  busy: false,
  agentCollapsed: false,
  profileTimer: 0,
  agendaNameTimer: 0,
  authPollTimer: 0,
  authPopup: null,
  messages: [
    {
      role: "assistant",
      content:
        "Bring me events, priorities, and constraints. I will turn them into a calendar with sleep, meals, and transportation.",
    },
  ],
};

const els = {
  accountButton: document.querySelector("[data-account-button]"),
  accountLabel: document.querySelector("[data-account-label]"),
  authGate: document.querySelector("[data-auth-gate]"),
  shell: document.querySelector("[data-shell]"),
  panelButtons: Array.from(document.querySelectorAll("[data-panel-button]")),
  panels: Array.from(document.querySelectorAll("[data-panel]")),
  chatLog: document.querySelector("[data-chat-log]"),
  chatForm: document.querySelector("[data-chat-form]"),
  agendaList: document.querySelector("[data-agenda-list]"),
  agendaName: document.querySelector("[data-agenda-name]"),
  agendaStatus: document.querySelector("[data-agenda-status]"),
  agentPopover: document.querySelector("[data-agent-popover]"),
  agentToggleButtons: Array.from(document.querySelectorAll("[data-agent-toggle]")),
  countEvents: document.querySelector("[data-count-events]"),
  countSelected: document.querySelector("[data-count-selected]"),
  countLogistics: document.querySelector("[data-count-logistics]"),
  calendar: document.querySelector("[data-calendar]"),
  eventEditor: document.querySelector("[data-event-editor]"),
  eventEditorBackdrop: document.querySelector("[data-event-editor-backdrop]"),
  eventEditorTitle: document.querySelector("[data-event-editor-title]"),
  eventForm: document.querySelector("[data-event-form]"),
  eventSubmitLabel: document.querySelector("[data-event-submit-label]"),
  importForm: document.querySelector("[data-import-form]"),
  importList: document.querySelector("[data-import-list]"),
  profileForm: document.querySelector("[data-profile-form]"),
  profileStatus: document.querySelector("[data-profile-status]"),
};

els.panelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activePanel = button.dataset.panelButton || "calendar";
    render();
  });
});

els.agentToggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.agentCollapsed = !state.agentCollapsed;
    render();
  });
});

document.querySelectorAll("[data-auth-open]").forEach((button) => {
  button.addEventListener("click", () => openAuth());
});

els.accountButton.addEventListener("click", async () => {
  if (state.session?.authenticated) {
    await requestJson("/api/auth/logout", { method: "POST" }, { empty: true });
    state.session = null;
    state.planner = null;
    await loadAccount();
    return;
  }
  openAuth();
});

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = els.chatForm.elements.prompt;
  const prompt = input.value.trim();
  if (!prompt || state.busy) return;
  input.value = "";
  await sendChat(prompt);
});

els.agendaList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-agenda-id]");
  if (!button || state.busy) return;
  await activateAgenda(button.dataset.agendaId || "");
});

els.agendaName.addEventListener("input", () => {
  if (state.busy) return;
  clearTimeout(state.agendaNameTimer);
  els.agendaStatus.textContent = "Saving...";
  state.agendaNameTimer = globalThis.setTimeout(renameActiveAgenda, AGENDA_NAME_SAVE_DELAY_MS);
});

els.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const form = new FormData(els.importForm);
  const sourceText = String(form.get("sourceText") || "").trim();
  if (!sourceText) return;
  setBusy(true);
  try {
    const body = await requestJson("/api/planner/imports", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        sourceType: form.get("sourceType"),
        sourceText,
      }),
    });
    state.planner = body.planner;
    els.importForm.elements.sourceText.value = "";
    appendMessage("assistant", `Imported ${body.import.events.length} events.`);
  } catch (error) {
    appendMessage("assistant", errorMessage(error));
  } finally {
    setBusy(false);
    render();
  }
});

els.importForm.elements.file.addEventListener("change", async () => {
  const file = els.importForm.elements.file.files?.[0];
  if (!file) return;
  els.importForm.elements.name.value ||= file.name.replace(/\.[^.]+$/, "");
  els.importForm.elements.sourceType.value = file.name.toLowerCase().endsWith(".csv")
    ? "csv"
    : "text";
  els.importForm.elements.sourceText.value = await file.text();
});

els.importList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-delete-import]");
  if (!button || state.busy) return;
  setBusy(true);
  try {
    const body = await requestJson(
      `/api/planner/imports/${encodeURIComponent(button.dataset.deleteImport)}`,
      {
        method: "DELETE",
      },
    );
    state.planner = body.planner;
  } catch (error) {
    appendMessage("assistant", errorMessage(error));
  } finally {
    setBusy(false);
    render();
  }
});

els.calendar.addEventListener("click", (event) => handleCalendarClick(event));
els.calendar.addEventListener("keydown", (event) => handleCalendarKeydown(event));

els.eventForm.addEventListener("submit", (event) => saveEventFromEditor(event));
document.querySelectorAll("[data-event-editor-close]").forEach((button) => {
  button.addEventListener("click", () => closeEventEditor());
});
els.eventEditorBackdrop.addEventListener("click", () => closeEventEditor());
globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.eventEditor.hidden) closeEventEditor();
});

els.profileForm.addEventListener("input", () => {
  els.profileStatus.textContent = "Saving...";
  clearTimeout(state.profileTimer);
  state.profileTimer = setTimeout(saveProfile, PROFILE_SAVE_DELAY_MS);
});

globalThis.addEventListener("message", async (event) => {
  if (event.origin !== globalThis.location.origin) return;
  if (event.data?.type !== AUTH_COMPLETE_MESSAGE) return;
  stopAuthRefreshPoll();
  await loadAccount();
  render();
});

boot();

async function boot() {
  await loadAccount();
  render();
}

async function loadAccount(options = {}) {
  try {
    const body = await requestJson("/api/account/session", { method: "GET" });
    state.session = body.session;
    if (state.session?.authenticated) {
      await loadPlanner();
    }
  } catch (error) {
    if (!options.quiet) appendMessage("assistant", errorMessage(error));
  }
}

async function loadPlanner() {
  const body = await requestJson("/api/planner", { method: "GET" });
  state.planner = body.planner;
  populateProfile();
}

async function saveProfile() {
  if (!state.session?.authenticated || state.busy) return;
  const form = new FormData(els.profileForm);
  try {
    const body = await requestJson("/api/planner/profile", {
      method: "PUT",
      body: JSON.stringify({
        displayName: form.get("displayName"),
        homeBase: form.get("homeBase"),
        timeZone: form.get("timeZone"),
        defaultTravelMinutes: Number(form.get("defaultTravelMinutes")),
        preferencePrompt: form.get("preferencePrompt"),
        priorityPrompt: form.get("priorityPrompt"),
        logisticsPrompt: form.get("logisticsPrompt"),
      }),
    });
    state.planner = body.planner;
    els.profileStatus.textContent = "Saved";
    renderCounts();
  } catch (error) {
    els.profileStatus.textContent = errorMessage(error);
  }
}

async function activateAgenda(planId) {
  if (!planId || state.busy) return;
  setBusy(true);
  try {
    const body = await requestJson(`/api/planner/plans/${encodeURIComponent(planId)}`, {
      method: "PUT",
      body: JSON.stringify({ active: true }),
    });
    state.planner = body.planner;
    state.activePanel = "calendar";
  } catch (error) {
    appendMessage("assistant", errorMessage(error));
  } finally {
    setBusy(false);
    render();
  }
}

async function renameActiveAgenda() {
  const plan = activePlan();
  if (!plan) {
    els.agendaStatus.textContent = "";
    return;
  }
  try {
    const body = await requestJson(`/api/planner/plans/${encodeURIComponent(plan.id)}`, {
      method: "PUT",
      body: JSON.stringify({ name: els.agendaName.value }),
    });
    state.planner = body.planner;
    renderAgendaHistory();
    els.agendaStatus.textContent = "Saved";
  } catch (error) {
    els.agendaStatus.textContent = errorMessage(error);
  }
}

async function sendChat(prompt) {
  if (!prompt) return;
  appendMessage("user", prompt);
  setBusy(true);
  try {
    const body = await requestJson("/api/planner/chat", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    state.planner = body.planner;
    if (
      body.calendarUpdated ||
      body.toolCalls?.some((call) => call?.name === "render_calendar")
    ) {
      state.activePanel = "calendar";
    }
    appendMessage("assistant", body.message || "Done.");
  } catch (error) {
    appendMessage("assistant", errorMessage(error));
  } finally {
    setBusy(false);
    render();
  }
}

function openAuth() {
  const url = new URL("/auth.html", globalThis.location.origin);
  url.searchParams.set("embedOrigin", globalThis.location.origin);
  state.authPopup = globalThis.open(
    url,
    "planner-account-auth",
    "width=460,height=640,popup=yes",
  );
  startAuthRefreshPoll();
}

function startAuthRefreshPoll() {
  stopAuthRefreshPoll();
  let attempts = 0;
  state.authPollTimer = globalThis.setInterval(async () => {
    attempts += 1;
    const popupClosed = state.authPopup?.closed === true;
    try {
      await loadAccount({ quiet: true });
      if (state.session?.authenticated) {
        stopAuthRefreshPoll();
        render();
        return;
      }
    } catch {
      // The popup may still be mid-auth; keep polling until the short window expires.
    }
    if (popupClosed || attempts >= 150) stopAuthRefreshPoll();
  }, 800);
}

function stopAuthRefreshPoll() {
  if (!state.authPollTimer) return;
  globalThis.clearInterval(state.authPollTimer);
  state.authPollTimer = 0;
}

function render() {
  const authenticated = state.session?.authenticated === true;
  els.authGate.hidden = authenticated;
  els.shell.hidden = !authenticated;
  els.accountLabel.textContent = authenticated
    ? state.session.user?.handle || "Account"
    : "Sign in";
  els.shell.dataset.agentCollapsed = state.agentCollapsed ? "true" : "false";
  els.agentPopover.dataset.collapsed = state.agentCollapsed ? "true" : "false";
  els.agentToggleButtons.forEach((button) => {
    button.setAttribute("aria-expanded", state.agentCollapsed ? "false" : "true");
  });
  els.panelButtons.forEach((button) => {
    button.setAttribute(
      "aria-current",
      button.dataset.panelButton === state.activePanel ? "page" : "false",
    );
  });
  els.panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== state.activePanel;
  });
  renderCounts();
  renderAgendaHistory();
  renderChat();
  renderCalendar();
  renderImports();
}

function renderCounts() {
  const planner = state.planner;
  const plan = activePlan();
  const eventCount = planner?.imports?.reduce((count, item) => count + item.events.length, 0) ?? 0;
  els.countEvents.textContent = String(eventCount);
  els.countSelected.textContent = String(plan?.summary?.selectedEvents ?? 0);
  els.countLogistics.textContent = String(plan?.summary?.generatedLogisticsBlocks ?? 0);
}

function renderAgendaHistory() {
  const plans = sortedPlansByStartDate(state.planner?.plans ?? []);
  const active = activePlan();
  els.agendaList.replaceChildren();
  els.agendaName.disabled = !active || state.busy;
  if (document.activeElement !== els.agendaName) {
    els.agendaName.value = active ? planDisplayName(active) : "";
  }
  if (!plans.length) {
    els.agendaList.append(emptyState("No generated agendas yet."));
    els.agendaStatus.textContent = "";
    return;
  }

  for (const plan of plans) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.agendaId = plan.id;
    button.setAttribute("aria-current", plan.id === state.planner?.activePlanId ? "page" : "false");

    const title = document.createElement("h4");
    title.textContent = planDisplayName(plan);
    const meta = document.createElement("p");
    meta.textContent = [
      planDateRange(plan),
      `${plan.blocks?.length ?? 0} blocks`,
      plan.generatedAt ? `saved ${shortDateTime(plan.generatedAt)}` : "",
    ].filter(Boolean).join(" · ");
    button.append(title, meta);
    els.agendaList.append(button);
  }
}

function sortedPlansByStartDate(plans) {
  return [...plans].sort((a, b) =>
    planStartValue(a) - planStartValue(b) ||
    dateTimeValue(b.generatedAt) - dateTimeValue(a.generatedAt)
  );
}

function planStartValue(plan) {
  const values = (plan.blocks ?? []).map((block) => dateTimeValue(block.start)).filter(Boolean);
  return values.length ? Math.min(...values) : dateTimeValue(plan.generatedAt) || Number.MAX_VALUE;
}

function planDisplayName(plan) {
  return plan?.name || `${planDateRange(plan) || "Saved"} agenda`;
}

function planDateRange(plan) {
  const start = planStartDate(plan);
  const end = planEndDate(plan) || start;
  if (!start) return "";
  return start === end ? shortDate(start) : `${shortDate(start)} to ${shortDate(end)}`;
}

function planStartDate(plan) {
  return (plan.blocks ?? []).map((block) => datePart(block.start)).filter(Boolean).sort()[0] ||
    datePart(plan.generatedAt);
}

function planEndDate(plan) {
  const dates = (plan.blocks ?? []).map((block) => datePart(block.end)).filter(Boolean).sort();
  return dates.at(-1) || datePart(plan.generatedAt);
}

function shortDate(day) {
  if (!day) return "";
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function shortDateTime(value) {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return shortDate(datePart(value));
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function renderChat() {
  els.chatLog.replaceChildren();
  for (const message of state.messages) {
    const article = document.createElement("article");
    article.dataset.messageRole = message.role;
    appendLinkedText(article, message.content);
    els.chatLog.append(article);
  }
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function renderCalendar() {
  els.calendar.replaceChildren();
  const blocks = calendarBlocks();
  if (!blocks.length) {
    els.calendar.append(renderTimelineDay(todayKey(), []));
    return;
  }
  const groups = groupBy(expandCalendarBlocksByDay(blocks), (block) => block.dayKey);
  for (const [day, blocks] of groups) {
    els.calendar.append(renderTimelineDay(day, blocks));
  }
}

function calendarBlocks() {
  const plan = activePlan();
  if (plan?.blocks?.length) return plan.blocks;
  return (state.planner?.imports ?? []).flatMap((item) =>
    item.events.map((event) => ({
      id: event.id,
      type: "event",
      source: "imported",
      title: event.title,
      start: event.start,
      end: event.end,
      dayKey: datePart(event.start),
      location: event.location,
      details: event.description,
      travelMinutes: null,
      score: event.priorityScore,
      sourceEventId: event.id,
      generatedReason: "",
    }))
  );
}

function renderTimelineDay(day, dayBlocks) {
  const blocks = [...dayBlocks].sort(compareBlocks);
  const bounds = timelineBounds();
  const section = document.createElement("section");
  section.dataset.calendarDay = day;

  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = dayHeading(day);
  const meta = document.createElement("p");
  meta.textContent = "24-hour day";
  header.append(title, meta);
  section.append(header);

  const timeline = document.createElement("section");
  timeline.dataset.timeline = "";
  timeline.style.setProperty(
    "--slots",
    String(Math.max(1, Math.ceil((bounds.end - bounds.start) / TIMELINE_SLOT_MINUTES))),
  );
  timeline.append(
    renderTimeRail(day, bounds.start, bounds.end),
    ...renderEmptySlots(day, bounds.start, bounds.end),
  );

  const lanes = computeCollisionLanes(blocks, day);
  for (const block of blocks) timeline.append(renderTimelineBlock(block, lanes, day, bounds.start));
  section.append(timeline);
  return section;
}

function renderTimeRail(day, startMinute, endMinute) {
  const rail = document.createElement("section");
  rail.dataset.timeRail = "";
  for (let minute = nextHour(startMinute); minute < endMinute; minute += 60) {
    const tick = document.createElement("time");
    tick.dateTime = localDateTimeFromDayMinute(day, minute);
    tick.textContent = hourLabel(minute);
    tick.style.gridRow = `${
      Math.floor((minute - startMinute) / TIMELINE_SLOT_MINUTES) + 1
    } / span 1`;
    rail.append(tick);
  }
  return rail;
}

function renderEmptySlots(day, startMinute, endMinute) {
  const slots = [];
  for (let minute = startMinute; minute < endMinute; minute += EMPTY_SLOT_MINUTES) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.dataset.emptySlot = "";
    slot.dataset.day = day;
    slot.dataset.startMinute = String(minute);
    slot.setAttribute(
      "aria-label",
      `Create event at ${formatMinute(minute)} on ${dayHeading(day)}`,
    );
    slot.style.gridRow = `${
      Math.floor((minute - startMinute) / TIMELINE_SLOT_MINUTES) + 1
    } / span ${Math.max(1, EMPTY_SLOT_MINUTES / TIMELINE_SLOT_MINUTES)}`;
    slots.push(slot);
  }
  return slots;
}

function renderTimelineBlock(block, lanes, day, timelineStart) {
  const article = document.createElement("article");
  const blockId = block.id || block.sourceEventId || `${block.title}-${block.start}`;
  const blockRange = blockMinutesForDay(block, day);
  const lane = lanes.get(blockId) || { index: 0, count: 1 };
  const rowStart = Math.floor((blockRange.start - timelineStart) / TIMELINE_SLOT_MINUTES) + 1;
  const rowSpan = Math.max(
    1,
    Math.ceil((blockRange.end - blockRange.start) / TIMELINE_SLOT_MINUTES),
  );

  article.dataset.entry = blockId;
  article.dataset.calendarEntry = "";
  article.dataset.type = block.type || "event";
  article.dataset.sourceEventId = block.sourceEventId || "";
  article.dataset.blockId = blockId;
  article.style.gridRow = `${rowStart} / span ${rowSpan}`;
  article.style.width = `calc(${100 / lane.count}% - ${lane.count === 1 ? 0 : 3}px)`;
  article.style.marginLeft = lane.index === 0
    ? "0"
    : `calc(${lane.index * 100 / lane.count}% + ${lane.index * 3}px)`;

  if (block.type === "event" && block.sourceEventId) {
    article.dataset.editable = "true";
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", `Edit ${block.title}`);
  }

  const header = document.createElement("header");
  const row = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = compactBlockTitle(block);
  const time = document.createElement("time");
  time.textContent = `${formatMinute(blockRange.start)}-${formatMinute(blockRange.end)}`;
  row.append(title, time);
  header.append(row);

  const meta = document.createElement("p");
  meta.textContent = [block.location, block.details].filter(Boolean).join(" · ");
  article.append(header);
  if (meta.textContent) article.append(meta);
  return article;
}

function handleCalendarClick(event) {
  const entry = event.target.closest("[data-calendar-entry]");
  if (entry) {
    openEditorForEntry(entry);
    return;
  }
  const slot = event.target.closest("[data-empty-slot]");
  if (!slot) return;
  openEventEditor({
    mode: "create",
    day: slot.dataset.day || todayKey(),
    startMinute: Number(slot.dataset.startMinute || DEFAULT_NEW_EVENT_START_MINUTES),
  });
}

function handleCalendarKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const entry = event.target.closest("[data-calendar-entry]");
  if (!entry) return;
  event.preventDefault();
  openEditorForEntry(entry);
}

function openEditorForEntry(entry) {
  if (entry.dataset.editable !== "true") return;
  const block = findCalendarBlock(entry.dataset.sourceEventId, entry.dataset.blockId);
  if (block) openEventEditor({ mode: "edit", block });
}

function findCalendarBlock(sourceEventId, blockId) {
  return calendarBlocks().find((block) =>
    (sourceEventId && block.sourceEventId === sourceEventId) || (blockId && block.id === blockId)
  );
}

function openEventEditor(options) {
  const form = els.eventForm;
  const mode = options.mode === "edit" ? "edit" : "create";
  const block = options.block || null;
  const startMinute = Number.isFinite(options.startMinute)
    ? options.startMinute
    : DEFAULT_NEW_EVENT_START_MINUTES;
  const day = options.day || datePart(block?.start) || todayKey();
  const start = block ? dateTimeLocal(block.start) : localDateTimeFromDayMinute(day, startMinute);
  const end = block ? dateTimeLocal(block.end) : localDateTimeFromDayMinute(day, startMinute + 60);

  form.dataset.mode = mode;
  form.elements.id.value = block?.sourceEventId || "";
  form.elements.title.value = block?.title || "";
  form.elements.start.value = start;
  form.elements.end.value = end;
  form.elements.location.value = block?.location || "";
  form.elements.description.value = block?.details || "";
  els.eventEditorTitle.textContent = mode === "edit" ? "Edit event" : "New event";
  els.eventSubmitLabel.textContent = mode === "edit" ? "Save" : "Create";
  els.eventEditor.hidden = false;
  els.eventEditorBackdrop.hidden = false;
  globalThis.requestAnimationFrame(() => form.elements.title.focus());
}

function closeEventEditor() {
  els.eventEditor.hidden = true;
  els.eventEditorBackdrop.hidden = true;
  els.eventForm.reset();
}

async function saveEventFromEditor(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = els.eventForm;
  const data = new FormData(form);
  const mode = form.dataset.mode === "edit" ? "edit" : "create";
  const id = String(data.get("id") || "");
  const payload = {
    title: String(data.get("title") || "").trim(),
    start: String(data.get("start") || ""),
    end: String(data.get("end") || ""),
    location: String(data.get("location") || "").trim(),
    description: String(data.get("description") || "").trim(),
  };
  if (!payload.title || !payload.start || !payload.end) return;
  if (Date.parse(payload.end) <= Date.parse(payload.start)) {
    appendMessage("assistant", "Event end time must be after the start time.");
    return;
  }
  setBusy(true);
  try {
    const path = mode === "edit"
      ? `/api/planner/events/${encodeURIComponent(id)}`
      : "/api/planner/events";
    const body = await requestJson(path, {
      method: mode === "edit" ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    state.planner = body.planner;
    state.activePanel = "calendar";
    closeEventEditor();
  } catch (error) {
    appendMessage("assistant", errorMessage(error));
  } finally {
    setBusy(false);
    render();
  }
}

function renderImports() {
  els.importList.replaceChildren();
  const imports = state.planner?.imports ?? [];
  if (!imports.length) {
    els.importList.append(emptyState("No sources imported."));
    return;
  }
  for (const item of imports) {
    const article = document.createElement("article");
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = item.name;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.deleteImport = item.id;
    button.setAttribute("aria-label", `Delete ${item.name}`);
    button.innerHTML = '<svg><use href="#icon-trash"></use></svg>';
    header.append(title, button);
    const meta = document.createElement("p");
    meta.textContent = `${item.sourceType.toUpperCase()} · ${item.events.length} events`;
    article.append(header, meta);
    if (item.warnings.length) {
      const warning = document.createElement("p");
      warning.dataset.warning = "";
      warning.textContent = item.warnings.slice(0, 2).join(" ");
      article.append(warning);
    }
    els.importList.append(article);
  }
}

function populateProfile() {
  const profile = state.planner?.profile;
  if (!profile) return;
  els.profileForm.elements.displayName.value = profile.displayName || "";
  els.profileForm.elements.homeBase.value = profile.homeBase || "";
  els.profileForm.elements.timeZone.value = profile.timeZone || "";
  els.profileForm.elements.defaultTravelMinutes.value = profile.defaultTravelMinutes || 30;
  els.profileForm.elements.preferencePrompt.value = profile.preferencePrompt || "";
  els.profileForm.elements.priorityPrompt.value = profile.priorityPrompt || "";
  els.profileForm.elements.logisticsPrompt.value = profile.logisticsPrompt || "";
  els.profileStatus.textContent = "";
}

function appendMessage(role, content) {
  state.messages.push({ role, content });
  state.messages = state.messages.slice(-40);
  renderChat();
}

function activePlan() {
  const planner = state.planner;
  if (!planner?.plans?.length) return null;
  return planner.plans.find((plan) => plan.id === planner.activePlanId) || planner.plans[0];
}

function setBusy(busy) {
  state.busy = busy;
  document.body.dataset.busy = String(busy);
  document.querySelectorAll("button, textarea, input, select").forEach((control) => {
    if (control.closest("[data-profile-form]")) return;
    control.disabled = busy;
  });
}

async function requestJson(path, init = {}, options = {}) {
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
  if (options.empty && response.status === 204) return null;
  const text = await response.text();
  const body = text ? parseJson(text) : null;
  if (!response.ok) {
    throw new Error(body?.error?.message || response.statusText || "Request failed.");
  }
  return body;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function emptyState(text) {
  const p = document.createElement("p");
  p.dataset.empty = "";
  p.textContent = text;
  return p;
}

function appendLinkedText(root, text) {
  const value = String(text || "");
  const pattern = /(https?:\/\/[^\s)]+[^\s).,;:])/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor) {
      root.append(document.createTextNode(value.slice(cursor, match.index)));
    }
    const link = document.createElement("a");
    link.href = match[0];
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = match[0];
    root.append(link);
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) root.append(document.createTextNode(value.slice(cursor)));
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item) || "";
    const group = map.get(key) || [];
    group.push(item);
    map.set(key, group);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function expandCalendarBlocksByDay(blocks) {
  return blocks.flatMap((block) =>
    calendarDaysForBlock(block).map((day) => ({
      ...block,
      dayKey: day,
    }))
  );
}

function calendarDaysForBlock(block) {
  const startDay = datePart(block.start) || block.dayKey || todayKey();
  const endDay = datePart(block.end) || startDay;
  const endMinute = minuteOfDay(block.end);
  const endExclusive = endDay > startDay && endMinute === 0;
  const days = [];
  for (let day = startDay; day <= endDay; day = nextDayKey(day)) {
    if (endExclusive && day === endDay) break;
    days.push(day);
  }
  return days.length ? days : [startDay];
}

function computeCollisionLanes(blocks, day) {
  const sorted = blocks
    .map((block) => {
      const range = blockMinutesForDay(block, day);
      return {
        block,
        id: block.id || block.sourceEventId || `${block.title}-${block.start}`,
        start: range.start,
        end: Math.max(range.end, range.start + TIMELINE_SLOT_MINUTES),
      };
    })
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
      assignments.push({ id: item.id, index: laneIndex });
    }
    const count = Math.max(1, laneEnds.length);
    for (const assignment of assignments) {
      result.set(assignment.id, { index: assignment.index, count });
    }
  }
  return result;
}

function timelineBounds() {
  return { start: FULL_DAY_START_MINUTES, end: FULL_DAY_END_MINUTES };
}

function blockMinutesForDay(block, day) {
  const start = minuteForDay(block.start, day, false);
  const end = Math.max(minuteForDay(block.end, day, true), start + TIMELINE_SLOT_MINUTES);
  return {
    start: clamp(start, 0, 24 * 60),
    end: clamp(end, TIMELINE_SLOT_MINUTES, 24 * 60),
  };
}

function minuteForDay(value, day, isEnd) {
  const valueDay = datePart(value);
  if (valueDay && valueDay < day) return 0;
  if (valueDay && valueDay > day) return 24 * 60;
  const match = String(value || "").match(/[ T](\d{2}):(\d{2})/);
  if (!match) return isEnd ? TIMELINE_SLOT_MINUTES : 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteOfDay(value) {
  const match = String(value || "").match(/[ T](\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compareBlocks(a, b) {
  return dateTimeValue(a.start) - dateTimeValue(b.start) ||
    dateTimeValue(a.end) - dateTimeValue(b.end) ||
    String(a.title || "").localeCompare(String(b.title || ""));
}

function dateTimeValue(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function datePart(value) {
  return String(value || "").slice(0, 10);
}

function todayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function nextDayKey(day) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateTimeLocal(value) {
  return String(value || "").replace(" ", "T").slice(0, 16);
}

function localDateTimeFromDayMinute(day, minute) {
  const date = new Date(`${day}T00:00:00`);
  date.setMinutes(minute);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-") + "T" + [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
}

function dayHeading(day) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day || "Calendar";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMinute(minute) {
  const normalized = ((minute % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function hourLabel(minute) {
  const hour = Math.floor(minute / 60) % 24;
  const suffix = hour >= 12 ? "p" : "a";
  const displayHour = hour % 12 || 12;
  return `${displayHour}${suffix}`;
}

function nextHour(minute) {
  return Math.ceil(minute / 60) * 60;
}

function compactBlockTitle(block) {
  if (block.type === "travel") return "Travel";
  if (block.type === "eating") return "Food";
  if (block.type === "sleeping") return "Sleep";
  return block.title || "Event";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Request failed.";
}
