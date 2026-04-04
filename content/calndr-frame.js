chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "calndr:getExistingSlots") {
    sendResponse({
      ok: true,
      slots: collectExistingSlots()
    });
    return undefined;
  }

  if (message?.type === "calndr:hasSlotForm") {
    sendResponse({
      ok: true,
      hasForm: Boolean(getSlotDateInput() && getSlotStartInput() && getSlotEndInput())
    });
    return undefined;
  }

  if (message?.type === "calndr:openAddForm") {
    try {
      openAddForm();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return undefined;
  }

  if (message?.type === "calndr:fillSlotForm") {
    fillSlotForm(message.payload?.slot)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message?.type === "calndr:submitSlotForm") {
    try {
      submitSlotForm();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return undefined;
  }

  return undefined;
});

function collectExistingSlots() {
  const rows = Array.from(document.querySelectorAll("tr"));
  const slots = [];

  rows.forEach((row) => {
    const cells = Array.from(row.querySelectorAll("td, th")).map((cell) =>
      normalizeText(cell.textContent)
    );

    if (cells.length < 3) {
      return;
    }

    const dateCell = cells.find((cell) => /\d{2}\.\d{2}\.\d{4}/.test(cell));
    const timeCells = cells.filter((cell) => /\d{2}:\d{2}/.test(cell));

    if (!dateCell || timeCells.length < 2) {
      return;
    }

    const [day, month, year] = dateCell.match(/\d{2}\.\d{2}\.\d{4}/)[0].split(".");
    const startTime = timeCells[0].match(/\d{2}:\d{2}/)[0];
    const endTime = timeCells[1].match(/\d{2}:\d{2}/)[0];

    slots.push({
      dateIso: `${year}-${month}-${day}`,
      dateLabel: `${day}.${month}.${year}`,
      startTime24: startTime,
      endTime24: endTime,
      key: `${year}-${month}-${day}|${startTime}|${endTime}`
    });
  });

  return dedupeByKey(slots);
}

function openAddForm() {
  if (getSlotDateInput()) {
    return;
  }

  const addButton = findAddButton();
  if (!addButton) {
    throw new Error('Внутри calndr.pro не найдена кнопка "Добавить".');
  }

  addButton.click();
}

async function fillSlotForm(slot) {
  if (!slot) {
    throw new Error("Не переданы данные слота для заполнения формы.");
  }

  const dateInput = await findSlotDateInput(8000);
  const timeStartInput = await findSlotStartInput(8000);
  const timeEndInput = await findSlotEndInput(8000);

  await setDateInput(dateInput, slot);
  await setTimeInput(timeStartInput, slot.startTime24);
  await setTimeInput(timeEndInput, slot.endTime24);
}

function submitSlotForm() {
  const saveButton = getSaveButton();
  if (!saveButton) {
    throw new Error('Не найдена кнопка "Сохранить" в форме слота.');
  }

  saveButton.click();
}

async function findSlotDateInput(timeoutMs) {
  let found = null;

  await waitFor(() => {
    found = getSlotDateInput();
    return Boolean(found);
  }, timeoutMs);

  return found;
}

async function findSlotStartInput(timeoutMs) {
  let found = null;

  await waitFor(() => {
    found = getSlotStartInput();
    return Boolean(found);
  }, timeoutMs);

  return found;
}

async function findSlotEndInput(timeoutMs) {
  let found = null;

  await waitFor(() => {
    found = getSlotEndInput();
    return Boolean(found);
  }, timeoutMs);

  return found;
}

function getSlotDateInput() {
  return document.querySelector("#id_slot_date, input[name='slot_date']");
}

function getSlotStartInput() {
  return document.querySelector("#id_start_time, input[name='start_time']");
}

function getSlotEndInput() {
  return document.querySelector("#id_end_time, input[name='end_time']");
}

function getSaveButton() {
  return document.querySelector(
    "input[type='submit'][name='btn_save'][value='Сохранить'], input[type='submit'][name='btn_save'], button[name='btn_save']"
  );
}

function findAddButton() {
  return (
    document.querySelector(
      "a.btn.btn-outline-primary.btn-md[href*='/availableadd'], a[href*='/availableadd'], input[type='button'][value='Добавить'], input[type='submit'][value='Добавить']"
    ) || findButton(["Добавить", "Add"])
  );
}

async function setDateInput(input, slot) {
  await fillInput(input, [slot.dateIso]);
}

async function setTimeInput(input, value24) {
  await fillInput(input, [value24]);
}

async function fillInput(input, candidates) {
  input.focus();
  input.click();

  for (const candidate of candidates) {
    setNativeValue(input, candidate);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await delay(150);

    if (normalizeText(input.value).includes(normalizeText(candidate)) || input.value === candidate) {
      return;
    }
  }

  throw new Error(`Не удалось установить значение в поле: ${candidates.join(", ")}`);
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return;
  }

  element.value = value;
}

function findButton(candidates) {
  const normalizedCandidates = candidates.map((candidate) => normalizeText(candidate));
  const elements = Array.from(
    document.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button']")
  );

  return (
    elements.find((element) => {
      const text = normalizeText(element.textContent);
      const value = normalizeText(element.getAttribute("value"));
      return normalizedCandidates.some(
        (candidate) =>
          text === candidate ||
          text.includes(candidate) ||
          value === candidate ||
          value.includes(candidate)
      );
    }) || null
  );
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function dedupeByKey(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.key)) {
      return false;
    }

    seen.add(item.key);
    return true;
  });
}

async function waitFor(check, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (check()) {
      return;
    }

    await delay(250);
  }

  throw new Error("Timed out while waiting for calndr.pro UI.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
