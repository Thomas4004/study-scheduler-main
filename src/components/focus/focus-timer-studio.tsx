"use client";

import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useFocusLock } from "@/components/providers/focus-lock-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TimerMode = "focus" | "shortBreak" | "longBreak";

type FocusTimerStudioProps = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  headingClassName?: string;
  timeClassName?: string;
  mediaPanel?: ReactNode;
};

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function minutesToMs(minutes: number) {
  return Math.max(1, minutes) * 60 * 1000;
}

export function FocusTimerStudio({
  focusMinutes,
  shortBreakMinutes,
  longBreakMinutes,
  headingClassName,
  timeClassName,
  mediaPanel,
}: FocusTimerStudioProps) {
  const durations = useMemo(
    () => ({
      focus: minutesToMs(focusMinutes),
      shortBreak: minutesToMs(shortBreakMinutes),
      longBreak: minutesToMs(longBreakMinutes),
    }),
    [focusMinutes, longBreakMinutes, shortBreakMinutes],
  );

  const [mode, setMode] = useState<TimerMode>("focus");
  const [remainingMs, setRemainingMs] = useState(durations.focus);
  const [isRunning, setIsRunning] = useState(false);
  const endAtRef = useRef<number | null>(null);

  const { setLocked } = useFocusLock();

  const totalMs = durations[mode];
  const modeTheme = useMemo(() => {
    if (mode === "shortBreak") {
      return {
        ringColor: "#38bdf8",
        chipClass: "border-sky-400/30 bg-sky-500/15 text-sky-100",
        dotClass: "bg-sky-300",
      };
    }

    if (mode === "longBreak") {
      return {
        ringColor: "#f59e0b",
        chipClass: "border-amber-400/30 bg-amber-500/15 text-amber-100",
        dotClass: "bg-amber-300",
      };
    }

    return {
      ringColor: "#34d399",
      chipClass: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
      dotClass: "bg-emerald-300",
    };
  }, [mode]);

  const progressPercent = useMemo(() => {
    const elapsed = totalMs - Math.max(0, Math.min(totalMs, remainingMs));
    return Math.max(0, Math.min(100, (elapsed / totalMs) * 100));
  }, [remainingMs, totalMs]);

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
    setRemainingMs(totalMs);
  }, [totalMs]);

  const changeMode = useCallback(
    (nextMode: TimerMode) => {
      if (isRunning) return;
      setMode(nextMode);
      setRemainingMs(durations[nextMode]);
    },
    [durations, isRunning],
  );

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
        navigator.vibrate([120, 80, 120]);
      }
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [isRunning]);

  useEffect(() => {
    setLocked(isRunning);
    return () => {
      setLocked(false);
    };
  }, [isRunning, setLocked]);

  return (
    <div className="mx-auto max-w-5xl">
      <section className="relative overflow-hidden rounded-[2rem] border border-zinc-800/80 bg-[linear-gradient(165deg,rgba(39,39,42,0.8),rgba(9,9,11,0.96))] p-4 shadow-[0_35px_100px_-70px_rgba(0,0,0,1)] sm:p-6">
        <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-gradient-to-br from-emerald-400/15 to-cyan-400/5 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-gradient-to-tr from-amber-300/10 to-transparent blur-3xl" />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1
              className={cn(
                "mt-1 text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl",
                headingClassName,
              )}
            >
              Timer
            </h1>
          </div>
          <p
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
              isRunning
                ? modeTheme.chipClass
                : "border-zinc-700 bg-zinc-950 text-zinc-400",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isRunning ? modeTheme.dotClass : "bg-zinc-500",
              )}
            />
            {isRunning ? "Sessione attiva" : "Pronto"}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => changeMode("focus")}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm font-medium transition",
              mode === "focus"
                ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800",
            )}
          >
            Focus {focusMinutes}m
          </button>
          <button
            type="button"
            onClick={() => changeMode("shortBreak")}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm font-medium transition",
              mode === "shortBreak"
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800",
            )}
          >
            Short break {shortBreakMinutes}m
          </button>
          <button
            type="button"
            onClick={() => changeMode("longBreak")}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm font-medium transition",
              mode === "longBreak"
                ? "border-blue-400/60 bg-blue-500/15 text-blue-200"
                : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800",
            )}
          >
            Long break {longBreakMinutes}m
          </button>
        </div>

        <div className="my-6 flex justify-center">
          <div
            className="relative grid h-64 w-64 place-items-center rounded-full border border-zinc-700/70 bg-zinc-950/90 transition-[box-shadow] duration-500 sm:h-72 sm:w-72"
            style={{
              backgroundImage: `conic-gradient(${modeTheme.ringColor} ${progressPercent}%, rgba(39,39,42,0.95) ${progressPercent}% 100%)`,
              boxShadow: `0 0 0 1px rgba(63,63,70,0.45), 0 18px 70px -35px ${modeTheme.ringColor}55`,
            }}
          >
            <div className="absolute inset-[10px] grid place-items-center rounded-full border border-zinc-700/80 bg-[radial-gradient(circle_at_top,rgba(63,63,70,0.3),rgba(9,9,11,0.95)_55%)]">
              <p className="text-center text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                {mode === "focus"
                  ? "Focus"
                  : mode === "shortBreak"
                    ? "Short break"
                    : "Long break"}
              </p>
              <p
                className={cn(
                  "font-mono text-6xl font-semibold tracking-tight text-zinc-100 tabular-nums sm:text-7xl",
                  timeClassName,
                )}
              >
                {formatDuration(remainingMs)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Button
            type="button"
            className={cn(
              "h-11 text-sm font-semibold",
              isRunning
                ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
            )}
            onClick={() => {
              if (isRunning) {
                pauseTimer();
                return;
              }
              startTimer();
            }}
          >
            {isRunning ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunning ? "Pausa" : "Avvia"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-11 border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800"
            onClick={resetTimer}
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </div>

        {mediaPanel ? (
          <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950/65 p-3.5">
            {mediaPanel}
          </div>
        ) : null}

        <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950/65 p-2.5 text-xs text-zinc-400">
          <p className="inline-flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            Durante il timer attivo la navigazione laterale viene nascosta.
          </p>
        </div>
      </section>
    </div>
  );
}
