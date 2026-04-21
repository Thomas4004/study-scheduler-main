"use client";

import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type PomodoroWidgetProps = {
  floating?: boolean;
  className?: string;
};

type PomodoroSnapshot = {
  endAt: number | null;
  remainingMs: number;
  isRunning: boolean;
};

const DEFAULT_FOCUS_MS = 25 * 60 * 1000;
const STORAGE_KEY = "study-scheduler:global-pomodoro:v1";

export const GLOBAL_POMODORO_START_EVENT =
  "study-scheduler:global-pomodoro:start";
export const GLOBAL_POMODORO_TOGGLE_EVENT =
  "study-scheduler:global-pomodoro:toggle";
export const GLOBAL_POMODORO_RESET_EVENT =
  "study-scheduler:global-pomodoro:reset";

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function parseSnapshot(value: string | null): PomodoroSnapshot | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<PomodoroSnapshot>;
    const remainingMs =
      typeof parsed.remainingMs === "number" &&
      Number.isFinite(parsed.remainingMs)
        ? Math.max(0, parsed.remainingMs)
        : DEFAULT_FOCUS_MS;
    const isRunning = parsed.isRunning === true;
    const endAt =
      typeof parsed.endAt === "number" && Number.isFinite(parsed.endAt)
        ? parsed.endAt
        : null;

    return {
      endAt,
      remainingMs,
      isRunning,
    };
  } catch {
    return null;
  }
}

function getProgressPercent(remainingMs: number) {
  const boundedRemaining = Math.min(DEFAULT_FOCUS_MS, Math.max(0, remainingMs));
  const elapsed = DEFAULT_FOCUS_MS - boundedRemaining;
  return Math.max(0, Math.min(100, (elapsed / DEFAULT_FOCUS_MS) * 100));
}

export function PomodoroWidget({
  floating = false,
  className,
}: PomodoroWidgetProps) {
  const pathname = usePathname();

  const [remainingMs, setRemainingMs] = useState(DEFAULT_FOCUS_MS);
  const [isRunning, setIsRunning] = useState(false);
  const endAtRef = useRef<number | null>(null);

  const progressPercent = useMemo(
    () => getProgressPercent(remainingMs),
    [remainingMs],
  );
  const statusLabel = useMemo(() => {
    if (isRunning) return "In corso";
    if (remainingMs === DEFAULT_FOCUS_MS) return "Pronto";
    return "In pausa";
  }, [isRunning, remainingMs]);

  const pauseTimer = useCallback(() => {
    if (endAtRef.current !== null) {
      setRemainingMs(Math.max(0, endAtRef.current - Date.now()));
    }

    endAtRef.current = null;
    setIsRunning(false);
  }, []);

  const startTimer = useCallback(() => {
    if (isRunning) return;

    const safeRemainingMs = Math.max(1000, remainingMs);
    endAtRef.current = Date.now() + safeRemainingMs;
    setRemainingMs(safeRemainingMs);
    setIsRunning(true);
  }, [isRunning, remainingMs]);

  const resetTimer = useCallback(() => {
    endAtRef.current = null;
    setIsRunning(false);
    setRemainingMs(DEFAULT_FOCUS_MS);
  }, []);

  const toggleTimer = useCallback(() => {
    if (isRunning) {
      pauseTimer();
      return;
    }

    startTimer();
  }, [isRunning, pauseTimer, startTimer]);

  /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage */
  useEffect(() => {
    const snapshot = parseSnapshot(window.localStorage.getItem(STORAGE_KEY));
    if (!snapshot) {
      return;
    }

    if (snapshot.isRunning && snapshot.endAt) {
      const recalculated = Math.max(0, snapshot.endAt - Date.now());
      if (recalculated === 0) {
        endAtRef.current = null;
        setIsRunning(false);
        setRemainingMs(DEFAULT_FOCUS_MS);
        return;
      }

      endAtRef.current = Date.now() + recalculated;
      setRemainingMs(recalculated);
      setIsRunning(true);
      return;
    }

    endAtRef.current = null;
    setIsRunning(false);
    setRemainingMs(snapshot.remainingMs);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const snapshot: PomodoroSnapshot = {
      endAt: endAtRef.current,
      remainingMs,
      isRunning,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [isRunning, remainingMs]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(() => {
      const endAt = endAtRef.current;
      if (!endAt) return;

      const updated = Math.max(0, endAt - Date.now());
      setRemainingMs(updated);

      if (updated > 0) return;

      endAtRef.current = null;
      setIsRunning(false);

      if (
        typeof navigator !== "undefined" &&
        typeof navigator.vibrate === "function"
      ) {
        navigator.vibrate(180);
      }
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [isRunning]);

  useEffect(() => {
    const handleStart = () => startTimer();
    const handleToggle = () => toggleTimer();
    const handleReset = () => resetTimer();

    window.addEventListener(GLOBAL_POMODORO_START_EVENT, handleStart);
    window.addEventListener(GLOBAL_POMODORO_TOGGLE_EVENT, handleToggle);
    window.addEventListener(GLOBAL_POMODORO_RESET_EVENT, handleReset);

    return () => {
      window.removeEventListener(GLOBAL_POMODORO_START_EVENT, handleStart);
      window.removeEventListener(GLOBAL_POMODORO_TOGGLE_EVENT, handleToggle);
      window.removeEventListener(GLOBAL_POMODORO_RESET_EVENT, handleReset);
    };
  }, [resetTimer, startTimer, toggleTimer]);

  if (pathname === "/focus" || pathname.startsWith("/focus/")) {
    return null;
  }

  return (
    <div
      className={cn(
        floating
          ? "pointer-events-none fixed right-2 top-2 z-[85] sm:right-4 sm:top-4"
          : "",
        className,
      )}
    >
      <section className="pointer-events-auto w-[min(90vw,18rem)] rounded-2xl border border-zinc-800/90 bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 p-3 text-zinc-100 shadow-[0_14px_38px_-22px_rgba(0,0,0,0.95)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            Pomodoro
          </p>
          <span
            className={cn(
              "text-[11px] font-medium",
              isRunning ? "text-emerald-400" : "text-zinc-500",
            )}
          >
            {statusLabel}
          </span>
        </div>

        <p className="mt-2 text-center font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-[2rem]">
          {formatDuration(remainingMs)}
        </p>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={cn(
              "h-full rounded-full transition-[width,background-color] duration-300",
              isRunning ? "bg-emerald-400" : "bg-zinc-500",
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition",
              isRunning
                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
            )}
            onClick={toggleTimer}
            aria-label={isRunning ? "Pausa timer" : "Avvia timer"}
          >
            {isRunning ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isRunning ? "Pausa" : "Avvia"}
          </button>

          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
            onClick={resetTimer}
            aria-label="Reset timer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </section>
    </div>
  );
}
