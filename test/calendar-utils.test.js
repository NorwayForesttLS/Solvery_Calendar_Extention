const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSlotFromEvent,
  normalizeMarker,
  shouldUseEvent
} = require("../lib/calendar-utils.js");

test("normalizeMarker ignores case and extra spaces", () => {
  assert.equal(normalizeMarker("  Solvery   Slots "), "solvery slots");
  assert.equal(normalizeMarker("Solvery slots"), "solvery slots");
});

test("shouldUseEvent accepts matching marker regardless of case", () => {
  const event = {
    summary: "Solvery slots",
    start: { dateTime: "2026-04-05T15:00:00+03:00" },
    end: { dateTime: "2026-04-05T16:00:00+03:00" }
  };

  assert.equal(shouldUseEvent(event, "Solvery Slots"), true);
});

test("shouldUseEvent rejects all-day events", () => {
  const event = {
    summary: "Solvery Slots",
    start: { date: "2026-04-05" },
    end: { date: "2026-04-06" }
  };

  assert.equal(shouldUseEvent(event, "Solvery Slots"), false);
});

test("shouldUseEvent rejects recurring events", () => {
  const event = {
    summary: "Solvery Slots",
    recurrence: ["RRULE:FREQ=WEEKLY"],
    start: { dateTime: "2026-04-05T15:00:00+03:00" },
    end: { dateTime: "2026-04-05T16:00:00+03:00" }
  };

  assert.equal(shouldUseEvent(event, "Solvery Slots"), false);
});

test("buildSlotFromEvent formats slot fields in calendar timezone", () => {
  const event = {
    id: "evt-1",
    summary: "Solvery Slots",
    start: {
      dateTime: "2026-04-05T12:00:00Z",
      timeZone: "Europe/Moscow"
    },
    end: {
      dateTime: "2026-04-05T13:30:00Z",
      timeZone: "Europe/Moscow"
    }
  };

  assert.deepEqual(buildSlotFromEvent(event, "UTC"), {
    id: "evt-1",
    summary: "Solvery Slots",
    timeZone: "Europe/Moscow",
    dateIso: "2026-04-05",
    dateLabel: "05.04.2026",
    dateForInput: "04/05/2026",
    startTime24: "15:00",
    endTime24: "16:30",
    startTime12: "3:00 pm",
    endTime12: "4:30 pm",
    key: "2026-04-05|15:00|16:30"
  });
});

test("buildSlotFromEvent returns null when event has no timed boundaries", () => {
  const event = {
    id: "evt-2",
    summary: "Solvery Slots",
    start: { date: "2026-04-05" },
    end: { date: "2026-04-06" }
  };

  assert.equal(buildSlotFromEvent(event, "Europe/Moscow"), null);
});
