"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CheckCircle2,
  Circle,
  EllipsisVertical,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";

import { MobileActionDrawer } from "@/components/mobile-action-drawer";
import { UndoToast } from "@/components/undo-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const UNDO_WINDOW_MS = 5000;
const TOAST_DISMISS_MS = 2600;

export type ExamQuickActionItem = {
  id: string;
  name: string;
  courseName?: string | null;
  colorCode: string;
  examDate: string;
  topicCount?: number;
  completedHours?: number;
  requiredHours?: number;
  progressPercent?: number;
};

type ExamQuickActionsGridProps = {
  initialExams: ExamQuickActionItem[];
  compact?: boolean;
};

type ToastState = {
  tone: "neutral" | "success" | "error";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function ExamQuickActionsGrid({
  initialExams,
  compact = false,
}: ExamQuickActionsGridProps) {
  const router = useRouter();
  const [exams, setExams] = useState<ExamQuickActionItem[]>(initialExams);
  const [pendingCompletion, setPendingCompletion] = useState<{
    examId: string;
    examName: string;
  } | null>(null);
  const [busyExamId, setBusyExamId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [mobileDrawerExamId, setMobileDrawerExamId] = useState<string | null>(
    null,
  );

  const completionTimerRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setExams(initialExams);
  }, [initialExams]);

  useEffect(() => {
    return () => {
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }

      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }

      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const queueMobileDrawerLongPress = (examId: string) => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      setMobileDrawerExamId(examId);
      longPressTimerRef.current = null;
    }, 420);
  };

  const clearDismissTimer = () => {
    if (dismissTimerRef.current === null) return;
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
  };

  const scheduleToastDismiss = () => {
    clearDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => {
      setToast(null);
      dismissTimerRef.current = null;
    }, TOAST_DISMISS_MS);
  };

  const showToast = (next: ToastState, autoDismiss = true) => {
    setToast(next);
    if (autoDismiss) {
      scheduleToastDismiss();
      return;
    }
    clearDismissTimer();
  };

  const finalizeCompletion = async (examId: string, examName: string) => {
    setPendingCompletion((current) =>
      current?.examId === examId ? null : current,
    );
    setBusyExamId(examId);

    try {
      const response = await fetch(`/api/exams/${examId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          completedAt: new Date().toISOString(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to complete exam.");
      }

      setExams((current) => current.filter((exam) => exam.id !== examId));
      showToast(
        {
          tone: "success",
          title: "Esame completato",
          description: `${examName} spostato in archivio.`,
        },
        true,
      );
      router.refresh();
    } catch (error: unknown) {
      showToast(
        {
          tone: "error",
          title: "Completamento non riuscito",
          description:
            error instanceof Error
              ? error.message
              : "Riprova tra qualche secondo.",
        },
        true,
      );
    } finally {
      setBusyExamId(null);
      completionTimerRef.current = null;
    }
  };

  const queueCompletion = (exam: ExamQuickActionItem) => {
    if (busyExamId !== null) return;
    if (pendingCompletion !== null) return;

    setPendingCompletion({ examId: exam.id, examName: exam.name });

    completionTimerRef.current = window.setTimeout(() => {
      void finalizeCompletion(exam.id, exam.name);
    }, UNDO_WINDOW_MS);

    showToast(
      {
        tone: "neutral",
        title: `Completo ${exam.name} tra 5 secondi`,
        description: "Puoi annullare subito senza aprire modali.",
        actionLabel: "Annulla",
        onAction: () => {
          if (completionTimerRef.current !== null) {
            window.clearTimeout(completionTimerRef.current);
            completionTimerRef.current = null;
          }
          setPendingCompletion(null);
          setToast(null);
        },
      },
      false,
    );
  };

  const deleteExam = async (exam: ExamQuickActionItem) => {
    if (busyExamId !== null) return;

    const shouldDelete = window.confirm(
      `Delete exam \"${exam.name}\"? This will also remove its study sessions.`,
    );

    if (!shouldDelete) return;

    setBusyExamId(exam.id);

    try {
      const response = await fetch(`/api/exams/${exam.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete exam.");
      }

      setExams((current) => current.filter((item) => item.id !== exam.id));
      showToast(
        {
          tone: "success",
          title: "Esame eliminato",
          description: `${exam.name} rimosso correttamente.`,
        },
        true,
      );
      router.refresh();
    } catch (error: unknown) {
      showToast(
        {
          tone: "error",
          title: "Eliminazione non riuscita",
          description:
            error instanceof Error
              ? error.message
              : "Riprova tra qualche secondo.",
        },
        true,
      );
    } finally {
      setBusyExamId(null);
    }
  };

  const hasExams = exams.length > 0;

  return (
    <>
      {!hasExams ? (
        <p className="text-sm text-muted-foreground">No active exams.</p>
      ) : (
        <div
          className={cn(
            "grid items-stretch gap-3",
            compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2",
          )}
        >
          {exams.map((exam) => {
            const isBusy = busyExamId === exam.id;
            const isQueued = pendingCompletion?.examId === exam.id;

            return (
              <article
                key={exam.id}
                className={cn(
                  "group flex h-full min-h-[12rem] flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/95 p-4 text-zinc-100",
                  isQueued && "ring-2 ring-amber-400/55",
                )}
                onTouchStart={() => queueMobileDrawerLongPress(exam.id)}
                onTouchMove={clearLongPressTimer}
                onTouchEnd={clearLongPressTimer}
                onTouchCancel={clearLongPressTimer}
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex items-start gap-2 text-sm font-semibold">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: exam.colorCode }}
                      />
                      <span className="text-balance break-words leading-tight">
                        {exam.name}
                      </span>
                    </p>
                    <p className="text-balance break-words text-xs text-zinc-500">
                      {exam.courseName?.trim() || "Corso non assegnato"}
                    </p>
                    <p className="text-balance break-words text-xs text-zinc-400">
                      {format(new Date(exam.examDate), "dd/MM/yyyy")}
                      {typeof exam.topicCount === "number"
                        ? ` • ${exam.topicCount} topic(s)`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className={cn(
                        "border-zinc-700 bg-zinc-950 text-zinc-200",
                        !isBusy &&
                          !isQueued &&
                          "hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-emerald-100",
                      )}
                      aria-label={`Mark ${exam.name} as completed`}
                      disabled={isBusy || pendingCompletion !== null}
                      onClick={() => queueCompletion(exam)}
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isQueued ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </Button>

                    <div className="hidden items-center gap-2 opacity-0 transition duration-200 md:flex md:translate-y-1 md:group-hover:translate-y-0 md:group-hover:opacity-100">
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="text-zinc-200 hover:bg-zinc-800"
                      >
                        <Link href={`/exam/${exam.id}`}>
                          <Pencil className="h-4 w-4" />
                          Modifica
                        </Link>
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void deleteExam(exam)}
                        disabled={isBusy}
                      >
                        <Trash2 className="h-4 w-4" />
                        Elimina
                      </Button>
                    </div>

                    <div className="md:hidden">
                      <MobileActionDrawer
                        title={exam.name}
                        description="Quick Actions"
                        open={mobileDrawerExamId === exam.id}
                        onOpenChange={(open) => {
                          setMobileDrawerExamId(open ? exam.id : null);
                        }}
                        trigger={
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            className="border-zinc-700 bg-zinc-950 text-zinc-200"
                            aria-label={`Open quick actions for ${exam.name}`}
                          >
                            <EllipsisVertical className="h-4 w-4" />
                          </Button>
                        }
                        actions={[
                          {
                            label: "Segna completato",
                            icon: <CheckCircle2 className="h-4 w-4" />,
                            onSelect: () => queueCompletion(exam),
                            disabled: isBusy || pendingCompletion !== null,
                          },
                          {
                            label: "Modifica",
                            icon: <Pencil className="h-4 w-4" />,
                            href: `/exam/${exam.id}`,
                          },
                          {
                            label: "Elimina",
                            icon: <Trash2 className="h-4 w-4" />,
                            onSelect: () => {
                              void deleteExam(exam);
                            },
                            destructive: true,
                            disabled: isBusy,
                          },
                        ]}
                      />
                    </div>
                  </div>
                </header>

                {!compact ? (
                  <>
                    <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
                      <div
                        className="h-full bg-emerald-400"
                        style={{
                          width: `${Math.max(0, Math.min(100, exam.progressPercent ?? 0))}%`,
                        }}
                      />
                    </div>

                    {typeof exam.requiredHours === "number" &&
                    typeof exam.completedHours === "number" ? (
                      <p className="whitespace-normal break-words text-xs text-zinc-400">
                        {exam.completedHours.toFixed(1)}h /{" "}
                        {exam.requiredHours.toFixed(1)}h planned
                      </p>
                    ) : null}
                  </>
                ) : null}

                <footer className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <Button
                    asChild
                    variant="outline"
                    className="border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
                  >
                    <Link href={`/exam/${exam.id}`}>Topic Tracker</Link>
                  </Button>
                  <Button
                    asChild
                    className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  >
                    <Link href="/focus?autostart=1">Focus</Link>
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <UndoToast
        open={toast !== null}
        tone={toast?.tone ?? "neutral"}
        title={toast?.title ?? ""}
        description={toast?.description}
        actionLabel={toast?.actionLabel}
        onAction={toast?.onAction}
        onClose={() => setToast(null)}
      />
    </>
  );
}
