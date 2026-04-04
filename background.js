importScripts("lib/calendar-utils.js");

const { buildSlotFromEvent, shouldUseEvent } = globalThis.CalendarUtils;
const sessionStorage = chrome.storage.session;

const STORAGE_KEYS = {
  auth: "auth",
  settings: "settings",
  syncState: "syncState"
};

const DEFAULT_SETTINGS = {
  calendarName: "Solvery Slots",
  eventMarker: "Solvery Slots",
  lookaheadDays: 30,
  googleClientId: ""
};

const IDLE_SYNC_STATE = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  synced: [],
  skipped: [],
  failures: [],
  preview: null,
  error: ""
};

let activeSyncPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  const { [STORAGE_KEYS.settings]: settings } = await chrome.storage.local.get(STORAGE_KEYS.settings);
  if (!settings) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "settings:get":
      return {
        settings: await getSettings()
      };
    case "settings:save":
      return {
        settings: await saveSettings(message.payload || {})
      };
    case "auth:connectGoogle":
      return {
        auth: await connectGoogle()
      };
    case "preview:load":
      return await buildPreview(message.tabId);
    case "sync:run":
      return await startSync(message.tabId);
    case "sync:status":
      return {
        syncState: await getSyncState()
      };
    default:
      throw new Error("Unknown message type");
  }
}

async function getSettings() {
  const { [STORAGE_KEYS.settings]: rawSettings } = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...(rawSettings || {})
  };
}

async function saveSettings(payload) {
  const nextSettings = {
    ...(await getSettings()),
    ...payload
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: nextSettings
  });

  return nextSettings;
}

async function getSyncState() {
  const { [STORAGE_KEYS.syncState]: syncState } = await sessionStorage.get(STORAGE_KEYS.syncState);
  return {
    ...IDLE_SYNC_STATE,
    ...(syncState || {})
  };
}

async function setSyncState(nextState) {
  const merged = {
    ...(await getSyncState()),
    ...nextState
  };

  await sessionStorage.set({
    [STORAGE_KEYS.syncState]: merged
  });

  return merged;
}

async function connectGoogle() {
  const settings = await getSettings();

  if (!settings.googleClientId) {
    throw new Error("Укажите Google OAuth Client ID на странице Options.");
  }

  const redirectUri = chrome.identity.getRedirectURL("oauth2");
  const scope = "https://www.googleapis.com/auth/calendar.readonly";
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  authUrl.searchParams.set("client_id", settings.googleClientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    interactive: true,
    url: authUrl.toString()
  });

  if (!responseUrl) {
    throw new Error("Google OAuth did not return a redirect URL.");
  }

  const fragment = new URLSearchParams(responseUrl.split("#")[1] || "");
  const accessToken = fragment.get("access_token");
  const expiresIn = Number(fragment.get("expires_in") || "0");

  if (!accessToken) {
    throw new Error("Не удалось получить access token от Google.");
  }

  const auth = {
    accessToken,
    expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000
  };

  await sessionStorage.set({
    [STORAGE_KEYS.auth]: auth
  });

  return auth;
}

async function getAccessToken() {
  const { [STORAGE_KEYS.auth]: auth } = await sessionStorage.get(STORAGE_KEYS.auth);

  if (auth?.accessToken && auth?.expiresAt && auth.expiresAt > Date.now()) {
    return auth.accessToken;
  }

  const result = await connectGoogle();
  return result.accessToken;
}

async function buildPreview(tabId) {
  if (!tabId) {
    throw new Error("Не найдена активная вкладка Solvery.");
  }

  const slots = await getCalendarSlots();
  const existingSlots = await getExistingSolverySlots(tabId);
  const existingKeys = new Set(existingSlots.map((slot) => slot.key));

  const preview = slots.map((slot) => ({
    ...slot,
    existsOnSolvery: existingKeys.has(slot.key)
  }));

  return {
    slots: preview,
    existingSlots,
    missingSlots: preview.filter((slot) => !slot.existsOnSolvery)
  };
}

async function startSync(tabId) {
  if (!tabId) {
    throw new Error("Не найдена активная вкладка Solvery.");
  }

  const currentState = await getSyncState();
  if (currentState.status === "running") {
    return {
      started: false,
      syncState: currentState
    };
  }

  const initialState = await setSyncState({
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    synced: [],
    skipped: [],
    failures: [],
    preview: null,
    error: ""
  });

  activeSyncPromise = runSync(tabId)
    .then(async (result) => {
      await setSyncState({
        status: "completed",
        finishedAt: new Date().toISOString(),
        synced: result.synced || [],
        skipped: result.skipped || [],
        failures: result.failures || [],
        preview: {
          slots: result.slots || [],
          existingSlots: result.existingSlots || [],
          missingSlots: result.missingSlots || []
        },
        error: ""
      });
    })
    .catch(async (error) => {
      await setSyncState({
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
    })
    .finally(() => {
      activeSyncPromise = null;
    });

  return {
    started: true,
    syncState: initialState
  };
}

async function runSync(tabId) {
  const preview = await buildPreview(tabId);
  const missingSlots = preview.missingSlots;

  if (!missingSlots.length) {
    return {
      ...preview,
      synced: [],
      skipped: []
    };
  }

  const synced = [];
  const skipped = [];
  const failures = [];

  for (const slot of missingSlots) {
    try {
      const currentSlots = await getExistingSolverySlots(tabId);
      if (currentSlots.some((existingSlot) => existingSlot.key === slot.key)) {
        skipped.push({
          ...slot,
          reason: "already_exists"
        });
        continue;
      }

      await openCalndrAddForm(tabId);
      await fillCalndrSlotForm(tabId, slot);
      await submitCalndrSlotForm(tabId);
      await waitForSlotToAppear(tabId, slot, 12000);
      synced.push(slot);
    } catch (error) {
      failures.push({
        slot,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ...preview,
    synced,
    skipped,
    failures
  };
}

async function getCalendarSlots() {
  const settings = await getSettings();
  const accessToken = await getAccessToken();
  const calendar = await findCalendarByName(accessToken, settings.calendarName);

  if (!calendar) {
    throw new Error(`Календарь "${settings.calendarName}" не найден в Google Calendar.`);
  }

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + settings.lookaheadDays * 24 * 60 * 60 * 1000).toISOString();

  const eventsUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`
  );
  eventsUrl.searchParams.set("singleEvents", "true");
  eventsUrl.searchParams.set("orderBy", "startTime");
  eventsUrl.searchParams.set("timeMin", timeMin);
  eventsUrl.searchParams.set("timeMax", timeMax);
  eventsUrl.searchParams.set("maxResults", "250");

  const response = await fetch(eventsUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await buildGoogleApiError("Google Calendar events request failed", response));
  }

  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : [];

  return items
    .filter((item) => shouldUseEvent(item, settings.eventMarker))
    .map((item) => buildSlotFromEvent(item, calendar.timeZone))
    .filter(Boolean);
}

async function findCalendarByName(accessToken, calendarName) {
  const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  url.searchParams.set("minAccessRole", "owner");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await buildGoogleApiError("Google Calendar calendarList request failed", response));
  }

  const data = await response.json();
  const calendars = Array.isArray(data.items) ? data.items : [];

  return calendars.find((calendar) => calendar.summary === calendarName) || null;
}

async function buildGoogleApiError(prefix, response) {
  let details = "";

  try {
    const data = await response.json();
    details =
      data?.error?.message ||
      data?.error_description ||
      JSON.stringify(data);
  } catch {
    try {
      details = await response.text();
    } catch {
      details = "";
    }
  }

  return details
    ? `${prefix}: ${response.status}. ${details}`
    : `${prefix}: ${response.status}`;
}

async function getExistingSolverySlots(tabId) {
  const frameId = await getCalndrFrameId(tabId);
  const result = await sendMessageToCalndrFrame(tabId, frameId, {
    type: "calndr:getExistingSlots"
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Не удалось прочитать существующие слоты из calndr.pro.");
  }

  return result.slots || [];
}

async function openCalndrAddForm(tabId) {
  const frameId = await getCalndrFrameId(tabId);
  const result = await sendMessageToCalndrFrame(tabId, frameId, {
    type: "calndr:openAddForm"
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Не удалось открыть форму "Добавить" в calndr.pro.');
  }

  await waitForCalndrSlotForm(tabId, 12000);
}

async function fillCalndrSlotForm(tabId, slot) {
  const frameId = await getCalndrFrameId(tabId);
  const result = await sendMessageToCalndrFrame(tabId, frameId, {
    type: "calndr:fillSlotForm",
    payload: { slot }
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Не удалось заполнить форму слота в calndr.pro.");
  }
}

async function submitCalndrSlotForm(tabId) {
  const frameId = await getCalndrFrameId(tabId);
  const result = await sendMessageToCalndrFrame(tabId, frameId, {
    type: "calndr:submitSlotForm"
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Не удалось отправить форму слота в calndr.pro.");
  }
}

async function waitForSlotToAppear(tabId, slot, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const currentSlots = await getExistingSolverySlots(tabId);
      if (currentSlots.some((existingSlot) => existingSlot.key === slot.key)) {
        return;
      }
    } catch {
      // Ignore transient iframe reloads and keep polling.
    }

    await delay(500);
  }

  throw new Error(`Слот ${slot.dateLabel} ${slot.startTime24}-${slot.endTime24} не появился после сохранения.`);
}

async function sendMessageToCalndrFrame(tabId, frameId, message) {
  let lastError = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId });
    } catch (error) {
      lastError = error;
      const errorText = error instanceof Error ? error.message : String(error);

      if (
        !errorText.includes("Receiving end does not exist") &&
        !errorText.includes("message channel closed")
      ) {
        throw new Error(errorText);
      }

      await delay(300);
      try {
        frameId = await getCalndrFrameId(tabId);
      } catch {
        // Keep retrying while the iframe is reloading.
      }
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : String(lastError));
}

async function getCalndrFrameId(tabId) {
  await chrome.tabs.sendMessage(tabId, {
    type: "solvery:ensureSchedulerFrame"
  });

  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const frame = frames.find((item) => item.url && item.url.startsWith("https://calndr.pro/"));

  if (!frame) {
    throw new Error("Не найден iframe calndr.pro. Откройте страницу календаря Solvery и дождитесь загрузки расписания.");
  }

  return frame.frameId;
}

async function waitForCalndrSlotForm(tabId, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const frameId = await getCalndrFrameId(tabId);
      const result = await sendMessageToCalndrFrame(tabId, frameId, {
        type: "calndr:hasSlotForm"
      });

      if (result?.ok && result.hasForm) {
        return;
      }
    } catch {
      // Ignore transient iframe reload states and keep polling.
    }

    await delay(300);
  }

  throw new Error("Форма добавления слота в calndr.pro не появилась после клика по Добавить.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
