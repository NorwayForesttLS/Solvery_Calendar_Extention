(function attachCalendarUtils(globalScope) {
  function normalizeMarker(value) {
    return (value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function shouldUseEvent(item, marker) {
    if (!item?.start || !item?.end) {
      return false;
    }

    if (item.recurrence?.length || item.recurringEventId) {
      return false;
    }

    if (!item.start.dateTime || !item.end.dateTime) {
      return false;
    }

    return normalizeMarker(item.summary) === normalizeMarker(marker);
  }

  function buildSlotFromEvent(item, fallbackTimeZone) {
    const startIso = item.start?.dateTime;
    const endIso = item.end?.dateTime;

    if (!startIso || !endIso) {
      return null;
    }

    const start = new Date(startIso);
    const end = new Date(endIso);
    const timeZone = item.start?.timeZone || item.end?.timeZone || fallbackTimeZone || "UTC";
    const date = formatDateParts(start, timeZone);
    const startTime = formatTimeParts(start, timeZone);
    const endTime = formatTimeParts(end, timeZone);

    return {
      id: item.id,
      summary: item.summary || "",
      timeZone,
      dateIso: `${date.year}-${date.month}-${date.day}`,
      dateLabel: `${date.day}.${date.month}.${date.year}`,
      dateForInput: `${date.month}/${date.day}/${date.year}`,
      startTime24: `${startTime.hour}:${startTime.minute}`,
      endTime24: `${endTime.hour}:${endTime.minute}`,
      startTime12: toTwelveHour(startTime.hour, startTime.minute),
      endTime12: toTwelveHour(endTime.hour, endTime.minute),
      key: `${date.year}-${date.month}-${date.day}|${startTime.hour}:${startTime.minute}|${endTime.hour}:${endTime.minute}`
    };
  }

  function formatDateParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    const parts = formatter.formatToParts(date);
    return {
      year: getPart(parts, "year"),
      month: getPart(parts, "month"),
      day: getPart(parts, "day")
    };
  }

  function formatTimeParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });

    const parts = formatter.formatToParts(date);
    return {
      hour: getPart(parts, "hour"),
      minute: getPart(parts, "minute")
    };
  }

  function getPart(parts, type) {
    return parts.find((part) => part.type === type)?.value || "";
  }

  function toTwelveHour(hour24, minute) {
    const hour = Number(hour24);
    const suffix = hour >= 12 ? "pm" : "am";
    const normalized = hour % 12 || 12;
    return `${normalized}:${minute} ${suffix}`;
  }

  const api = {
    buildSlotFromEvent,
    normalizeMarker,
    shouldUseEvent
  };

  globalScope.CalendarUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
