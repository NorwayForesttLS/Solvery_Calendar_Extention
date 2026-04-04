chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "solvery:ensureSchedulerFrame") {
    return undefined;
  }

  ensureSchedulerFrame()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    );

  return true;
});

async function ensureSchedulerFrame() {
  const existingFrame = findSchedulerFrame();
  if (existingFrame) {
    return {
      frameFound: true
    };
  }

  const addButton = findAddButton();
  if (!addButton) {
    throw new Error('На странице Solvery не найдена кнопка "Добавить".');
  }

  addButton.click();
  await waitFor(() => Boolean(findSchedulerFrame()), 10000);

  return {
    frameFound: true
  };
}

function findSchedulerFrame() {
  return document.querySelector('iframe[src*="calndr.pro"]');
}

function findAddButton() {
  const selectors = [
    'a[href*="/availableadd"]',
    'button',
    'a.btn'
  ];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    const target = elements.find((element) => {
      const text = normalizeText(element.textContent);
      const href = element.getAttribute("href") || "";
      return text === "добавить" || href.includes("/availableadd");
    });

    if (target) {
      return target;
    }
  }

  return null;
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function waitFor(check, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (check()) {
      return;
    }

    await delay(250);
  }

  throw new Error("calndr.pro iframe не появился после клика по Добавить.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
