"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, RefreshCw, AlertCircle } from "lucide-react";

import { validateCalendarUrlProxy } from "@/app/settings/calendar-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Upload } from "lucide-react";

interface ExternalCalendar {
  id: string;
  name: string;
  url: string;
  color_code: string;
  isEnabled: boolean;
  syncedAt?: string;
  lastError?: string;
}

interface ExternalCalendarImportProps {
  secretToken: string;
}

export function ExternalCalendarImport({ secretToken }: ExternalCalendarImportProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false);
  const [calendars, setCalendars] = useState<ExternalCalendar[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [calendarName, setCalendarName] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<"url" | "file">("url");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadCalendars = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/calendar/external", {
        headers: {
          "x-secret-key": secretToken,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to load calendars");
      }

      const data = await response.json();
      setCalendars(data.calendars || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load calendars"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportUrl = () => {
    setError(null);
    setSuccess(null);

    // Validate inputs
    if (!calendarName.trim()) {
      setError("Calendar name is required");
      return;
    }

    if (!calendarUrl.trim()) {
      setError("Calendar URL is required");
      return;
    }

    // Basic URL validation
    try {
      new URL(calendarUrl);
    } catch {
      setError("Invalid URL format");
      return;
    }

    startTransition(async () => {
      try {
        // First, validate the calendar URL using server action (with proper User-Agent)
        const validationResult = await validateCalendarUrlProxy(calendarUrl);
        
        if (!validationResult.success) {
          throw new Error(validationResult.error || "Invalid calendar URL");
        }

        // Now import the calendar
        const response = await fetch("/api/calendar/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-secret-key": secretToken,
          },
          body: JSON.stringify({
            name: calendarName,
            url: calendarUrl,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to import calendar");
        }

        const newCalendar = await response.json();
        setCalendars([newCalendar, ...calendars]);
        setSuccess("Calendar imported successfully!");
        setCalendarName("");
        setCalendarUrl("");
        setShowForm(false);

        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to import calendar"
        );
      }
    });
  };

  const handleImportFile = () => {
    setError(null);
    setSuccess(null);

    // Validate inputs
    if (!calendarName.trim()) {
      setError("Calendar name is required");
      return;
    }

    if (!selectedFile) {
      setError("File is required");
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith(".ics")) {
      setError("File must be an .ics file");
      return;
    }

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("name", calendarName);

        const response = await fetch("/api/calendar/import-file", {
          method: "POST",
          headers: {
            "x-secret-key": secretToken,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to import calendar file");
        }

        const newCalendar = await response.json();
        setCalendars([newCalendar, ...calendars]);
        setSuccess("Calendar file imported successfully!");
        setCalendarName("");
        setSelectedFile(null);
        setShowForm(false);

        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to import calendar file"
        );
      }
    });
  };

  const handleImport = () => {
    if (importMode === "url") {
      handleImportUrl();
    } else {
      handleImportFile();
    }
  };

  const handleDelete = (calendarId: string) => {
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/calendar/sync/${calendarId}`,
          {
            method: "DELETE",
            headers: {
              "x-secret-key": secretToken,
            },
          }
        );

        if (!response.ok) {
          throw new Error("Failed to delete calendar");
        }

        setCalendars(calendars.filter((c) => c.id !== calendarId));
        setSuccess("Calendar deleted");
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete calendar"
        );
      }
    });
  };

  const handleSync = (calendarId: string) => {
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/calendar/sync-proxy/${calendarId}`,
          {
            headers: {
              "x-secret-key": secretToken,
            },
          }
        );

        if (!response.ok) {
          throw new Error("Failed to sync calendar");
        }

        const syncedCalendar = await response.json();
        setCalendars(
          calendars.map((c) =>
            c.id === calendarId
              ? { ...c, syncedAt: syncedCalendar.syncedAt, lastError: undefined }
              : c
          )
        );
        setSuccess(`${syncedCalendar.name} synced successfully`);
        router.refresh();
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Failed to sync calendar";
        setCalendars(
          calendars.map((c) =>
            c.id === calendarId ? { ...c, lastError: errorMsg } : c
          )
        );
        setError(errorMsg);
      }
    });
  };

  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>External Calendars</CardTitle>
        <CardDescription>
          Import calendars (Google, Outlook, etc.) to display them alongside
          your study schedule
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error/Success messages */}
        {error && (
          <div className="flex gap-2 rounded-lg border border-red-200/50 bg-red-50/50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex gap-2 rounded-lg border border-green-200/50 bg-green-50/50 p-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-950/20 dark:text-green-400">
            <span>✓ {success}</span>
          </div>
        )}

        {/* Import Form */}
        {!showForm ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setShowForm(true);
              loadCalendars();
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Calendar
          </Button>
        ) : (
          <div className="space-y-3 rounded-xl border border-border/70 bg-background px-4 py-4">
            {/* Mode Selector */}
            <div className="flex gap-2 rounded-lg bg-muted/50 p-1">
              <button
                onClick={() => setImportMode("url")}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  importMode === "url"
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                disabled={isPending}
              >
                From URL
              </button>
              <button
                onClick={() => setImportMode("file")}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  importMode === "file"
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                disabled={isPending}
              >
                From File
              </button>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="calendar-name"
                className="text-xs font-medium text-muted-foreground"
              >
                Calendar Name
              </label>
              <Input
                id="calendar-name"
                placeholder="e.g., Uni Timeline"
                value={calendarName}
                onChange={(e) => setCalendarName(e.target.value)}
                disabled={isPending}
              />
            </div>

            {importMode === "url" ? (
              <div className="space-y-2">
                <label
                  htmlFor="calendar-url"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Calendar URL (iCal/ICS link)
                </label>
                <Input
                  id="calendar-url"
                  placeholder="https://calendar.google.com/calendar/ics/... or webcal://..."
                  value={calendarUrl}
                  onChange={(e) => setCalendarUrl(e.target.value)}
                  disabled={isPending}
                  type="url"
                />
                <p className="text-xs text-muted-foreground">
                  Right-click any shared calendar and copy the public link/ICS URL
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label
                  htmlFor="calendar-file"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Calendar File (.ics)
                </label>
                <input
                  id="calendar-file"
                  type="file"
                  accept=".ics"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  disabled={isPending}
                  className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                />
                {selectedFile && (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    Selected: {selectedFile.name}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Upload an .ics file from your computer
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleImport}
                disabled={isPending || !calendarName || (importMode === "url" ? !calendarUrl : !selectedFile)}
                className="flex-1"
              >
                {isPending ? "Importing..." : "Import"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setSelectedFile(null);
                  setCalendarUrl("");
                  setCalendarName("");
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Calendar List */}
        {calendars.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Imported Calendars ({calendars.length})
            </p>
            <div className="space-y-2">
              {calendars.map((calendar) => (
                <div
                  key={calendar.id}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-background p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: calendar.color_code }}
                      />
                      <h4 className="font-medium text-sm">{calendar.name}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {calendar.url}
                    </p>
                    {calendar.lastError && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                        Error: {calendar.lastError}
                      </p>
                    )}
                    {calendar.syncedAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Synced: {new Date(calendar.syncedAt).toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-1 ml-2 flex-shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSync(calendar.id)}
                      disabled={isPending}
                      title="Sync calendar"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(calendar.id)}
                      disabled={isPending}
                      title="Remove calendar"
                    >
                      <X className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
