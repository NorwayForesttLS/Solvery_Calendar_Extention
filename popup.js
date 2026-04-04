const connectGoogleButton = document.getElementById("connectGoogleButton");
const toggleSettingsButton = document.getElementById("toggleSettingsButton");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const previewButton = document.getElementById("previewButton");
const syncButton = document.getElementById("syncButton");
const statusNode = document.getElementById("status");
const settingsPanel = document.getElementById("settingsPanel");
const googleClientIdInput = document.getElementById("googleClientIdInput");
const redirectUriInput = document.getElementById("redirectUriInput");
const calendarNameInput = document.getElementById("calendarNameInput");
const eventMarkerInput = document.getElementById("eventMarkerInput");
const lookaheadDaysInput = document.getElementById("lookaheadDaysInput");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const settingsStatusNode = document.getElementById("settingsStatus");
const previewListNode = document.getElementById("previewList");
const failureListNode = document.getElementById("failureList");
const calendarSlotsCountNode = document.getElementById("calendarSlotsCount");
const existingSlotsCountNode = document.getElementById("existingSlotsCount");
const missingSlotsCountNode = document.getElementById("missingSlotsCount");

let lastPreview = null;
let syncPollTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await loadSettings();
  setStatus(
    settings.googleClientId
      ? "Google OAuth client настроен. Откройте Solvery Calendar и запустите Preview."
      : "Сначала откройте Settings и укажите Google OAuth Client ID."
  );
  await refreshSyncState();
});

connectGoogleButton.addEventListener("click", async () => {
  try {
    setBusy(true, "Подключаю Google Calendar...");
    await sendRuntimeMessage({ type: "auth:connectGoogle" });
    setStatus("Google Calendar подключен.");
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
});

toggleSettingsButton.addEventListener("click", async () => {
  const willOpen = settingsPanel.classList.contains("hidden");
  settingsPanel.classList.toggle("hidden", !willOpen);
  if (willOpen) {
    await loadSettings();
  }
});

closeSettingsButton.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

saveSettingsButton.addEventListener("click", async () => {
  saveSettingsButton.disabled = true;
  settingsStatusNode.textContent = "Сохраняю...";

  try {
    const response = await sendRuntimeMessage({
      type: "settings:save",
      payload: {
        googleClientId: googleClientIdInput.value.trim(),
        calendarName: calendarNameInput.value.trim() || "Solvery Slots",
        eventMarker: eventMarkerInput.value.trim() || "Solvery Slots",
        lookaheadDays: Number(lookaheadDaysInput.value || "30")
      }
    });

    const settings = response.settings;
    applySettingsToForm(settings);
    settingsStatusNode.textContent = "Настройки сохранены.";
    settingsStatusNode.style.color = "";
    setStatus(
      settings.googleClientId
        ? "Настройки сохранены. Можно запускать Preview."
        : "Укажите Google OAuth Client ID в Settings.",
      !settings.googleClientId
    );
  } catch (error) {
    settingsStatusNode.textContent = error.message || String(error);
    settingsStatusNode.style.color = "#b42318";
  } finally {
    saveSettingsButton.disabled = false;
  }
});

previewButton.addEventListener("click", async () => {
  try {
    setBusy(true, "Считываю Google Calendar и текущие слоты Solvery...");
    const tab = await getActiveTab();
    const result = await sendRuntimeMessage({
      type: "preview:load",
      tabId: tab.id
    });
    lastPreview = result;
    renderPreview(result.slots || []);
    renderFailures([]);
    calendarSlotsCountNode.textContent = String((result.slots || []).length);
    existingSlotsCountNode.textContent = String((result.existingSlots || []).length);
    missingSlotsCountNode.textContent = String((result.missingSlots || []).length);
    syncButton.disabled = !(result.missingSlots || []).length;
    setStatus(
      result.missingSlots?.length
        ? `Найдено ${result.missingSlots.length} новых слот(ов) для добавления.`
        : "Новых слотов нет."
    );
  } catch (error) {
    syncButton.disabled = true;
    setStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
});

syncButton.addEventListener("click", async () => {
  try {
    setBusy(true, "Запускаю фоновый sync в Solvery...");
    const tab = await getActiveTab();
    const result = await sendRuntimeMessage({
      type: "sync:run",
      tabId: tab.id
    });

    if (result.started) {
      setStatus("Sync запущен в фоне. Статус обновится автоматически.");
      startSyncPolling();
    } else {
      setStatus("Sync уже выполняется.");
      startSyncPolling();
    }
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
});

function renderPreview(slots) {
  if (!slots.length) {
    previewListNode.className = "slot-list empty";
    previewListNode.textContent = "Слоты еще не загружены.";
    return;
  }

  previewListNode.className = "slot-list";
  previewListNode.innerHTML = "";

  slots.forEach((slot) => {
    const item = document.createElement("article");
    item.className = "slot-item";
    item.innerHTML = `
      <div class="slot-meta">
        <strong>${escapeHtml(slot.dateLabel)}</strong>
        <span class="slot-badge ${slot.existsOnSolvery ? "exists" : "missing"}">
          ${slot.existsOnSolvery ? "Already on Solvery" : "Create"}
        </span>
      </div>
      <div>${escapeHtml(slot.startTime24)} - ${escapeHtml(slot.endTime24)}</div>
      <div class="muted">${escapeHtml(slot.timeZone || "")}</div>
    `;
    previewListNode.appendChild(item);
  });
}

function setBusy(isBusy, nextStatus) {
  connectGoogleButton.disabled = isBusy;
  toggleSettingsButton.disabled = isBusy;
  closeSettingsButton.disabled = isBusy;
  saveSettingsButton.disabled = isBusy;
  previewButton.disabled = isBusy;
  syncButton.disabled = isBusy || !lastPreview?.missingSlots?.length;

  if (nextStatus) {
    setStatus(nextStatus);
  }
}

async function loadSettings() {
  const response = await sendRuntimeMessage({ type: "settings:get" });
  const settings = response.settings;
  applySettingsToForm(settings);
  redirectUriInput.value = chrome.identity.getRedirectURL("oauth2");
  return settings;
}

function applySettingsToForm(settings) {
  googleClientIdInput.value = settings.googleClientId || "";
  calendarNameInput.value = settings.calendarName || "Solvery Slots";
  eventMarkerInput.value = settings.eventMarker || "Solvery Slots";
  lookaheadDaysInput.value = String(settings.lookaheadDays || 30);
}

function setStatus(text, isError = false) {
  statusNode.textContent = text;
  statusNode.style.color = isError ? "#b42318" : "";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id || !tab.url?.startsWith("https://solvery.io/")) {
    throw new Error("Активная вкладка должна быть открыта на странице Solvery Calendar.");
  }

  return tab;
}

async function sendRuntimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error || "Unknown extension error");
  }

  return response;
}

async function refreshSyncState() {
  try {
    const response = await sendRuntimeMessage({ type: "sync:status" });
    const syncState = response.syncState;

    if (syncState.preview?.slots?.length) {
      lastPreview = syncState.preview;
      renderPreview(syncState.preview.slots || []);
      calendarSlotsCountNode.textContent = String((syncState.preview.slots || []).length);
      existingSlotsCountNode.textContent = String(
        (syncState.preview.existingSlots || []).length + (syncState.synced || []).length
      );
      missingSlotsCountNode.textContent = String(
        Math.max((syncState.preview.missingSlots || []).length - (syncState.synced || []).length, 0)
      );
    }

    renderFailures(syncState.failures || []);

    if (syncState.status === "running") {
      setStatus("Sync выполняется...");
      startSyncPolling();
      return;
    }

    stopSyncPolling();

    if (syncState.status === "completed") {
      const failures = syncState.failures || [];
      const synced = syncState.synced || [];

      if (failures.length) {
        setStatus(`Синхронизировано: ${synced.length}. Ошибок: ${failures.length}.`, true);
      } else if (syncState.finishedAt) {
        setStatus(`Синхронизировано ${synced.length} слот(ов).`);
      }
      return;
    }

    if (syncState.status === "failed") {
      setStatus(syncState.error || "Sync завершился с ошибкой.", true);
      return;
    }
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

function renderFailures(failures) {
  if (!failures.length) {
    failureListNode.className = "slot-list empty";
    failureListNode.textContent = "Ошибок пока нет.";
    return;
  }

  failureListNode.className = "slot-list";
  failureListNode.innerHTML = "";

  failures.forEach((failure) => {
    const slot = failure.slot || {};
    const item = document.createElement("article");
    item.className = "slot-item error";
    item.innerHTML = `
      <div class="slot-meta">
        <strong>${escapeHtml(slot.dateLabel || "Unknown date")}</strong>
        <span class="slot-badge missing">Error</span>
      </div>
      <div>${escapeHtml(slot.startTime24 || "--:--")} - ${escapeHtml(slot.endTime24 || "--:--")}</div>
      <div class="muted">${escapeHtml(failure.error || "Unknown error")}</div>
    `;
    failureListNode.appendChild(item);
  });
}

function startSyncPolling() {
  if (syncPollTimer) {
    return;
  }

  syncPollTimer = window.setInterval(() => {
    refreshSyncState();
  }, 1000);
}

function stopSyncPolling() {
  if (!syncPollTimer) {
    return;
  }

  window.clearInterval(syncPollTimer);
  syncPollTimer = null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
