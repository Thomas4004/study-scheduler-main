"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";

import { completeTopicToday, replanTopicTomorrow } from "@/app/focus/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type TodayTaskItem = {
  topicId: string;
  topicTitle: string;
  courseName: string;
  scheduledDate: string;
};

type OptimisticTask = TodayTaskItem & {
  completed: boolean;
  removed: boolean;
  mode: "idle" | "complete" | "replan";
};

type OptimisticAction =
  | { type: "complete"; topicId: string }
  | { type: "replan"; topicId: string }
  | { type: "remove"; topicId: string }
  | { type: "reset"; payload: TodayTaskItem[] };

function toOptimisticTask(task: TodayTaskItem): OptimisticTask {
  return {
    ...task,
    completed: false,
    removed: false,
    mode: "idle",
  };
}

function formatDateLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Oggi";
  }

  return parsed.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function TodayTaskList({ tasks }: { tasks: TodayTaskItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingByTopic, setPendingByTopic] = useState<Record<string, boolean>>(
    {},
  );

  const [optimisticTasks, dispatchOptimistic] = useOptimistic<
    OptimisticTask[],
    OptimisticAction
  >(tasks.map(toOptimisticTask), (state, action) => {
    if (action.type === "reset") {
      return action.payload.map(toOptimisticTask);
    }

    return state.map((task) => {
      if (task.topicId !== action.topicId) {
        return task;
      }

      if (action.type === "complete") {
        return {
          ...task,
          completed: true,
          mode: "complete",
        };
      }

      if (action.type === "replan") {
        return {
          ...task,
          completed: true,
          mode: "replan",
        };
      }

      if (action.type === "remove") {
        return {
          ...task,
          removed: true,
        };
      }

      return task;
    });
  });

  const visibleTasks = optimisticTasks.filter((task) => !task.removed);

  const scheduleRemoval = (topicId: string) => {
    window.setTimeout(() => {
      dispatchOptimistic({ type: "remove", topicId });
    }, 520);
  };

  const runAction = (
    topicId: string,
    mode: "complete" | "replan",
    action: (id: string) => Promise<unknown>,
  ) => {
    if (pendingByTopic[topicId]) {
      return;
    }

    setError(null);
    setPendingByTopic((current) => ({
      ...current,
      [topicId]: true,
    }));

    dispatchOptimistic({
      type: mode === "complete" ? "complete" : "replan",
      topicId,
    });
    scheduleRemoval(topicId);

    startTransition(async () => {
      try {
        await action(topicId);
        router.refresh();
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : "Operazione non riuscita.",
        );
        dispatchOptimistic({ type: "reset", payload: tasks });
      } finally {
        setPendingByTopic((current) => ({
          ...current,
          [topicId]: false,
        }));
      }
    });
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900 shadow-none">
      <CardHeader>
        <CardTitle className="text-xl text-zinc-100">
          Il Tuo Obiettivo di Oggi
        </CardTitle>
        <CardDescription className="text-zinc-400">
          Un click per chiudere il task o ripianificarlo a domani.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {visibleTasks.length === 0 ? (
          <p className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-5 text-sm text-zinc-400">
            Inbox giornaliera vuota. Hai chiuso tutti i task previsti.
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleTasks.map((task) => {
              const rowPending = pendingByTopic[task.topicId] === true;
              const isCompleted = task.completed;

              return (
                <li
                  key={task.topicId}
                  className={cn(
                    "rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 transition-all duration-500",
                    isCompleted && "opacity-40 line-through",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Completa ${task.topicTitle}`}
                      disabled={rowPending}
                      onClick={() =>
                        runAction(task.topicId, "complete", completeTopicToday)
                      }
                      className="h-11 w-11 min-h-11 min-w-11 rounded-full border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                    >
                      {rowPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-300">
                        {task.courseName}
                      </p>
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {task.topicTitle}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <p className="shrink-0 text-xs text-zinc-500">
                        {formatDateLabel(task.scheduledDate)}
                      </p>

                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Ripianifica ${task.topicTitle} a domani`}
                        disabled={rowPending}
                        onClick={() =>
                          runAction(task.topicId, "replan", replanTopicTomorrow)
                        }
                        className="h-11 w-11 min-h-11 min-w-11 rounded-full border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
