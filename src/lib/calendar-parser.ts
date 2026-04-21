/**
 * Simple iCalendar parser for external calendar imports.
 * Parses VEVENT objects from iCal format.
 */

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  allDay?: boolean;
  location?: string;
}

/**
 * Parse an iCalendar text and extract events.
 */
export function parseICalEvents(icsText: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  // Split by VEVENT
  const eventMatches = icsText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  for (const eventText of eventMatches) {
    const event = parseVEvent(eventText);
    if (event) {
      events.push(event);
    }
  }

  // Remove duplicates based on ID
  const seenIds = new Set<string>();
  return events.filter((event) => {
    if (seenIds.has(event.id)) {
      return false;
    }
    seenIds.add(event.id);
    return true;
  });
}

/**
 * Parse a single VEVENT block.
 */
function parseVEvent(eventText: string): CalendarEvent | null {
  try {
    const uid = extractField(eventText, "UID");
    const title = extractField(eventText, "SUMMARY");
    const description = extractField(eventText, "DESCRIPTION");
    const location = extractField(eventText, "LOCATION");

    // Parse dates - handle both DATE and DATETIME formats
    const dtStart = extractField(eventText, "DTSTART");
    const dtEnd = extractField(eventText, "DTEND");

    if (!dtStart || !title) {
      return null;
    }

    const startDate = parseICalDate(dtStart);
    const parsedEndDate = dtEnd ? parseICalDate(dtEnd) : null;
    const endDate = parsedEndDate === null ? undefined : parsedEndDate;

    if (!startDate) {
      return null;
    }

    const allDay = isAllDayEvent(eventText);

    return {
      id: uid || `${title}-${startDate.getTime()}`,
      title: unescapeICalText(title),
      description: description ? unescapeICalText(description) : undefined,
      startDate,
      endDate,
      allDay,
      location: location ? unescapeICalText(location) : undefined,
    };
  } catch (error) {
    console.error("Error parsing VEVENT:", error);
    return null;
  }
}

/**
 * Extract a field value from iCal text.
 * Handles folded lines and quoted values.
 */
function extractField(text: string, fieldName: string): string | null {
  // Unfold lines first (RFC 5545 line folding)
  const unfolded = text.replace(/\r?\n[ \t]/g, "");

  // Match the field, handling parameters like DTSTART;TZID=Europe/London:...
  const regex = new RegExp(
    `${fieldName}(?:;[^:]*)?:([^\r\n]*)`,
    "i"
  );
  const match = unfolded.match(regex);

  return match ? match[1].trim() : null;
}

/**
 * Parse iCalendar date/datetime format (YYYYMMDD or YYYYMMDDTHHMMSS or with Z/timezone).
 */
function parseICalDate(dateString: string): Date | null {
  dateString = dateString.trim();

  // Remove timezone info, if present
  if (dateString.includes("T")) {
    // DateTime format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
    const match = dateString.match(
      /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/
    );
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // JS months are 0-indexed
      const day = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      const minute = parseInt(match[5], 10);
      const second = parseInt(match[6], 10);
      const isUTC = match[7] === "Z";

      if (isUTC) {
        return new Date(Date.UTC(year, month, day, hour, minute, second));
      } else {
        return new Date(year, month, day, hour, minute, second);
      }
    }
  } else {
    // Date only format: YYYYMMDD
    const match = dateString.match(/(\d{4})(\d{2})(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(year, month, day);
    }
  }

  // If we have a dash format (less common but possible)
  try {
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch {}

  return null;
}

/**
 * Check if an event is all-day (VALUE=DATE in DTSTART).
 */
function isAllDayEvent(eventText: string): boolean {
  return /DTSTART[^:]*VALUE=DATE[^:]*:/i.test(eventText);
}

/**
 * Unescape iCalendar text (handle escaped characters).
 */
function unescapeICalText(text: string): string {
  return text
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\N/g, "\n")
    .replace(/\\\\/g, "\\");
}

/**
 * Check if a URL is a valid calendar URL (basic validation).
 */
export function isValidCalendarUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch {
    return false;
  }
}
