"use server";

import { headers } from "next/headers";

export async function validateAndFetchCalendarUrl(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "text/calendar, application/ics",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "it-IT,it;q=0.9",
        "Referer": "https://www.google.com/",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();

    // Validate iCalendar format
    if (!text.includes("BEGIN:VCALENDAR")) {
      throw new Error("URL does not contain valid iCalendar data");
    }

    return {
      success: true,
      data: text,
      contentType: response.headers.get("content-type") || "text/calendar",
    };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("AbortSignal")) {
      return {
        success: false,
        error: "Calendar fetch timeout after 15 seconds",
      };
    }

    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to fetch calendar",
    };
  }
}

/**
 * Validate calendar URL by fetching it with realistic user-agent.
 * This is a server action to bypass CORS and authentication issues.
 */
export async function validateCalendarUrlProxy(url: string) {
  if (!url || !url.trim()) {
    return { success: false, error: "URL is required" };
  }

  try {
    new URL(url);
  } catch {
    return { success: false, error: "Invalid URL format" };
  }

  return validateAndFetchCalendarUrl(url);
}
