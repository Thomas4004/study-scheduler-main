import { useEffect, useState } from "react";
import { parseICalEvents } from "@/lib/calendar-parser";

export interface ExternalCalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  allDay?: boolean;
  location?: string;
}

export function useExternalCalendarEvents(secretToken: string | null) {
  const [events, setEvents] = useState<ExternalCalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get the secret key from URL params or cookies
  const getSecretKey = (): string => {
    if (typeof window === "undefined") return secretToken || "";
    
    // Try URL params first
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get("key");
    if (keyFromUrl) return keyFromUrl;
    
    // Try cookies
    const cookies = document.cookie.split(";").reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split("=");
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    return cookies["personal_secret_key"] || secretToken || "";
  };

  useEffect(() => {
    if (!getSecretKey()) return;

    const loadEvents = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch list of external calendars
        const calendarsResponse = await fetch("/api/calendar/external", {
          headers: {
            "x-api-key": getSecretKey(),
          },
        });

        if (!calendarsResponse.ok) {
          throw new Error("Failed to load calendars");
        }

        const { calendars } = await calendarsResponse.json();
        const allEvents: ExternalCalendarEvent[] = [];

        // Fetch events for each calendar
        for (const calendar of calendars) {
          try {
            const response = await fetch(calendar.url, {
              method: "GET",
              headers: {
                Accept: "text/calendar, application/ics",
              },
            });

            if (response.ok) {
              const text = await response.text();
              const parsedEvents = parseICalEvents(text);

              const calendarEvents = parsedEvents.map((event) => ({
                ...event,
                calendarId: calendar.id,
                calendarName: calendar.name,
                calendarColor: calendar.color_code,
              }));

              allEvents.push(...calendarEvents);
            }
          } catch (err) {
            console.error(
              `Failed to load events from ${calendar.name}:`,
              err
            );
          }
        }

        setEvents(allEvents);
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Failed to load events";
        setError(errorMsg);
        console.error("Error loading external calendar events:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadEvents();

    // Refresh every 30 minutes
    const interval = setInterval(loadEvents, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [secretToken]);

  return { events, isLoading, error };
}
