"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { CheckCircle2, Pause, Play, RotateCcw } from "lucide-react";

import { updateTopicConfidence } from "@/app/focus/actions";
import { Button } from "@/components/ui/button";

type ZenFocusModeProps = {
  topic: {
    id: string;
    name: string;
  };
  exam: {
    id: string;
    name: string;
    colorCode: string;
  };
  courseName: string;
  maxFocusMinutes: number;
  autoStart?: boolean;
};

type TimerPhase = "timer" | "feedback" | "done";
type CompletionSource = "timer-ended" | "manual";
type WakeLockSentinelLike = {
  release: () => Promise<void>;
};

type ConfidenceOption = {
  score: 1 | 2 | 3 | 4;
  label: string;
  description: string;
};

const CONFIDENCE_OPTIONS: ConfidenceOption[] = [
  {
    score: 1,
    label: "Azzera",
    description: "Non ricordo nulla",
  },
  {
    score: 2,
    label: "Difficile",
    description: "Ricordo a fatica",
  },
  {
    score: 3,
    label: "Buono",
    description: "Normale",
  },
  {
    score: 4,
    label: "Perfetto",
    description: "Padronanza totale",
  },
];

function formatDuration(totalMilliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(totalMilliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatReviewDate(value: string | null) {
  if (!value) {
    return "Review date not available";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Review date not available";
  }

  return parsed.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ZenFocusMode({
  topic,
  exam,
  courseName,
  maxFocusMinutes,
  autoStart = false,
}: ZenFocusModeProps) {
  const initialDurationMs = Math.max(15, maxFocusMinutes) * 60 * 1000;

  const [remainingMs, setRemainingMs] = useState(initialDurationMs);
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<TimerPhase>("timer");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [nextReview, setNextReview] = useState<string | null>(null);
  const [isPendingVote, startVoteTransition] = useTransition();

  const hasAutoStartedRef = useRef(false);
  const endAtRef = useRef<number | null>(null);
  const remainingMsRef = useRef(initialDurationMs);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const completionInFlightRef = useRef(false);

  const wakeLockSupported = useMemo(() => {
    if (typeof window === "undefined") return false;

    const nav = navigator as Navigator & {
      wakeLock?: {
        request: (type: "screen") => Promise<WakeLockSentinelLike>;
      };
    };

    return typeof nav.wakeLock?.request === "function";
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const activeLock = wakeLockRef.current;
    wakeLockRef.current = null;

    if (!activeLock) return;

    try {
      await activeLock.release();
    } catch {
      // Release may fail if already released by the browser.
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof window === "undefined") return;

    const nav = navigator as Navigator & {
      wakeLock?: {
        request: (type: "screen") => Promise<WakeLockSentinelLike>;
      };
    };

    if (typeof nav.wakeLock?.request !== "function") return;

    try {
      wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // Ignore failures: not all browsers/users allow wake lock.
    }
  }, []);

  const pauseTimer = useCallback(async () => {
    if (endAtRef.current !== null) {
      const updatedRemaining = Math.max(0, endAtRef.current - Date.now());
      remainingMsRef.current = updatedRemaining;
      setRemainingMs(updatedRemaining);
    }

    endAtRef.current = null;
    setIsRunning(false);
    await releaseWakeLock();
  }, [releaseWakeLock]);

  const startTimer = useCallback(async () => {
    if (phase !== "timer") return;

    const safeRemaining = Math.max(1000, remainingMsRef.current);
    remainingMsRef.current = safeRemaining;
    setRemainingMs(safeRemaining);

    endAtRef.current = Date.now() + safeRemaining;
    setIsRunning(true);
    setError(null);
    setMessage(null);

    await requestWakeLock();
  }, [phase, requestWakeLock]);

  const resetTimer = useCallback(async () => {
    await pauseTimer();
    setPhase("timer");
    setRemainingMs(initialDurationMs);
    remainingMsRef.current = initialDurationMs;
    setMessage(null);
    setError(null);
    setSelectedScore(null);
    setNextReview(null);
  }, [initialDurationMs, pauseTimer]);

  const completeSession = useCallback(
    async (source: CompletionSource) => {
      if (completionInFlightRef.current) return;

      completionInFlightRef.current = true;
      setError(null);

      try {
        await pauseTimer();

        setPhase("feedback");
        setMessage(
          source === "timer-ended"
            ? "Timer completato. Ora registra la confidenza di memoria."
            : "Sessione conclusa. Registra ora la tua confidenza.",
        );
      } finally {
        completionInFlightRef.current = false;
      }
    },
    [pauseTimer],
  );

  useEffect(() => {
    if (!isRunning) return;

    const tick = () => {
      const endAt = endAtRef.current;
      if (!endAt) return;

      const updatedRemaining = Math.max(0, endAt - Date.now());
      remainingMsRef.current = updatedRemaining;
      setRemainingMs(updatedRemaining);

      if (updatedRemaining === 0) {
        void completeSession("timer-ended");
      }
    };

    tick();
    const interval = window.setInterval(tick, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [completeSession, isRunning]);

  useEffect(() => {
    if (!isRunning) return;

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;

      void requestWakeLock();
      const endAt = endAtRef.current;
      if (!endAt) return;

      const updatedRemaining = Math.max(0, endAt - Date.now());
      remainingMsRef.current = updatedRemaining;
      setRemainingMs(updatedRemaining);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isRunning, requestWakeLock]);

  useEffect(() => {
    if (!autoStart || phase !== "timer" || hasAutoStartedRef.current) {
      return;
    }

    hasAutoStartedRef.current = true;
    void startTimer();
  }, [autoStart, phase, startTimer]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  const submitConfidenceVote = (score: ConfidenceOption["score"]) => {
    if (isPendingVote || phase !== "feedback") return;

    startVoteTransition(async () => {
      setError(null);

      try {
        const result = await updateTopicConfidence(topic.id, score);
        setSelectedScore(score);
        setNextReview(result.topic.nextReview);
        setPhase("done");
        setMessage("Confidenza salvata. Prossimo ripasso ricalcolato.");
      } catch (voteError) {
        setError(
          voteError instanceof Error
            ? voteError.message
            : "Unable to store confidence",
        );
      }
    });
  };

  return (
    <section className="fixed inset-0 z-[80] bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex h-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              Deep Focus Zen Mode
            </p>
            <p className="mt-2 whitespace-normal break-words text-sm leading-tight sm:text-base">
              <span className="font-semibold text-zinc-100">{courseName}</span>
              <span className="mx-2 text-zinc-600">&gt;</span>
              <span className="text-zinc-300">{exam.name}</span>
              <span className="mx-2 text-zinc-600">&gt;</span>
              <span className="text-zinc-400">{topic.name}</span>
            </p>
          </div>

          <Button
            asChild
            variant="outline"
            className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
          >
            <Link href="/focus">Torna a Focus</Link>
          </Button>
        </header>

        <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center">
          {phase === "timer" ? (
            <>
              <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                Sessione in corso
              </p>
              <div
                className="mt-6 text-[clamp(5rem,18vw,13rem)] font-semibold leading-none tabular-nums"
                style={{ color: exam.colorCode }}
              >
                {formatDuration(remainingMs)}
              </div>

              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  onClick={() => {
                    if (isRunning) {
                      void pauseTimer();
                      return;
                    }

                    void startTimer();
                  }}
                >
                  {isRunning ? (
                    <>
                      <Pause className="h-4 w-4" />
                      Pausa
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Avvia
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                  onClick={() => {
                    void resetTimer();
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                  onClick={() => {
                    void completeSession("manual");
                  }}
                >
                  Concludi sessione
                </Button>
              </div>

              <p className="mt-5 text-xs text-zinc-500">
                Wake Lock:{" "}
                {wakeLockSupported
                  ? "attivo se supportato"
                  : "non supportato dal browser"}
              </p>
            </>
          ) : null}

          {phase === "feedback" ? (
            <div className="w-full max-w-2xl space-y-4">
              <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                Post Session Feedback
              </p>
              <h2 className="text-xl font-semibold sm:text-2xl">
                Come valuti la tua preparazione su questo argomento?
              </h2>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CONFIDENCE_OPTIONS.map((option) => (
                  <button
                    key={option.score}
                    type="button"
                    disabled={isPendingVote}
                    onClick={() => submitConfidenceVote(option.score)}
                    className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <p className="font-semibold text-zinc-100">
                      {option.score}. {option.label}
                    </p>
                    <p className="text-sm text-zinc-400">
                      {option.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="w-full max-w-xl space-y-3">
              <p className="inline-flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Feedback registrato
              </p>
              <p className="text-sm text-zinc-300">
                Voto selezionato:{" "}
                <span className="font-semibold">{selectedScore}</span>
              </p>
              <p className="text-sm text-zinc-400">
                Prossimo ripasso: {formatReviewDate(nextReview)}
              </p>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                  onClick={() => {
                    void resetTimer();
                  }}
                >
                  Nuovo ciclo
                </Button>
              </div>
            </div>
          ) : null}

          {message ? (
            <p className="mt-6 text-sm text-zinc-300">{message}</p>
          ) : null}
          {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
