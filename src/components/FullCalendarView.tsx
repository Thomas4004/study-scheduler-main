"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flag,
  GripVertical,
  Play,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CollisionFixButton } from "@/components/CollisionFixButton";
import { cn } from "@/lib/utils";

export type CalendarSessionItem = {
  id: string;
  examId: string;
  courseName: string;
  examName: string;
  examColor: string;
  topicId: string | null;
  topicName: string;
  isPlaceholder: boolean;
  plannedDate: string;
  plannedHours: number;
  type: "FIRST_PASS" | "REVIEW";
  isCompleted: boolean;
};

export type CalendarExamMarker = {
  id: string;
  name: string;
  courseName: string;
  colorCode: string;
  examDate: string;
};

export type CalendarCollisionArea = {
  dayKey: string;
  topicDensity: number;
  threshold: number;
  earlyStartSuggestionCount: number;
};

type FullCalendarViewProps = {
  initialSessions: CalendarSessionItem[];
  examMarkers: CalendarExamMarker[];
  collisionAreas: CalendarCollisionArea[];
  calendarFeedUrl: string | null;
  headingClassName?: string;
  monoClassName?: string;
};

type MoveSessionResponse = {
  session: {
    id: string;
    examId: string;
    plannedDate: string;
  };
  previousDate: string;
};

type OptimizeCalendarResponse = {
  optimized: Array<{
    examId: string;
    examName: string;
  }>;
  failed: Array<{
    examId: string;
    examName: string;
    message: string;
  }>;
};

type RecalibrateCalendarResponse = {
  scope: "all";
  blockedDays: number;
  recalculated: number;
  withGapCount: number;
};

type ExamBadge = {
  examId: string;
  courseName: string;
  examName: string;
  examColor: string;
  topicCount: number;
  placeholderOnly: boolean;
};

type DaySessionGroup = {
  examId: string;
  courseName: string;
  examName: string;
  examColor: string;
  sessions: CalendarSessionItem[];
};

const DRAG_MIME = "application/studyscheduler-session-id";

function toDayKey(value: Date | string) {
  return format(
    typeof value === "string" ? startOfDay(new Date(value)) : value,
    "yyyy-MM-dd",
  );
}

function parseDayKey(dayKey: string) {
  return startOfDay(new Date(`${dayKey}T12:00:00`));
}

function sortSessions(a: CalendarSessionItem, b: CalendarSessionItem) {
  const byPlaceholder = Number(a.isPlaceholder) - Number(b.isPlaceholder);
  if (byPlaceholder !== 0) return byPlaceholder;

  const byCourse = a.courseName.localeCompare(b.courseName);
  if (byCourse !== 0) return byCourse;

  const byExam = a.examName.localeCompare(b.examName);
  if (byExam !== 0) return byExam;

  const byType =
    (a.type === "FIRST_PASS" ? 0 : 1) - (b.type === "FIRST_PASS" ? 0 : 1);
  if (byType !== 0) return byType;

  return a.topicName.localeCompare(b.topicName);
}

function getSessionTypeLabel(type: CalendarSessionItem["type"]) {
  return type === "FIRST_PASS" ? "First Pass" : "Review";
}

function groupBadgesByExam(sessions: CalendarSessionItem[]): ExamBadge[] {
  const grouped = new Map<
    string,
    {
      courseName: string;
      examName: string;
      examColor: string;
      topics: Set<string>;
      placeholderCount: number;
      sessionCount: number;
    }
  >();

  for (const session of sessions) {
    const current = grouped.get(session.examId);
    if (!current) {
      grouped.set(session.examId, {
        courseName: session.courseName,
        examName: session.examName,
        examColor: session.examColor,
        topics: new Set([session.topicId ?? "__ghost__"]),
        placeholderCount: session.isPlaceholder ? 1 : 0,
        sessionCount: 1,
      });
      continue;
    }

    current.topics.add(session.topicId ?? "__ghost__");
    current.sessionCount += 1;
    if (session.isPlaceholder) {
      current.placeholderCount += 1;
    }
  }

  return [...grouped.entries()]
    .map(([examId, value]) => ({
      examId,
      courseName: value.courseName,
      examName: value.examName,
      examColor: value.examColor,
      topicCount: value.topics.size,
      placeholderOnly:
        value.sessionCount > 0 && value.placeholderCount === value.sessionCount,
    }))
    .sort((a, b) => b.topicCount - a.topicCount);
}

function withAlpha(hexColor: string, alphaHex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hexColor)) return "#1F2937";
  return `${hexColor}${alphaHex}`;
}

export function FullCalendarView({
  initialSessions,
  examMarkers,
  collisionAreas,
  calendarFeedUrl,
  headingClassName,
  monoClassName,
}: FullCalendarViewProps) {
  const router = useRouter();
  const [isPortalReady, setIsPortalReady] = useState(false);

  const [sessions, setSessions] =
    useState<CalendarSessionItem[]>(initialSessions);
  const [monthCursor, setMonthCursor] = useState(startOfMonth(new Date()));
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(
    null,
  );
  const [dropTargetDayKey, setDropTargetDayKey] = useState<string | null>(null);
  const [movingSessionId, setMovingSessionId] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isRecalibrating, setIsRecalibrating] = useState(false);
  const [dirtyExamIds, setDirtyExamIds] = useState<string[]>([]);
  const [optimizationAnchor, setOptimizationAnchor] = useState<string | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, CalendarSessionItem[]>();

    for (const session of sessions) {
      const dayKey = toDayKey(session.plannedDate);
      const current = map.get(dayKey) ?? [];
      current.push(session);
      map.set(dayKey, current);
    }

    for (const [key, daySessions] of map) {
      map.set(key, [...daySessions].sort(sortSessions));
    }

    return map;
  }, [sessions]);

  const examMarkersByDay = useMemo(() => {
    const map = new Map<string, CalendarExamMarker[]>();

    for (const exam of examMarkers) {
      const dayKey = toDayKey(exam.examDate);
      const current = map.get(dayKey) ?? [];
      current.push(exam);
      map.set(dayKey, current);
    }

    return map;
  }, [examMarkers]);

  const collisionAreasByDay = useMemo(() => {
    return new Map(collisionAreas.map((entry) => [entry.dayKey, entry]));
  }, [collisionAreas]);

  const monthStart = startOfMonth(monthCursor);
  const monthEnd = endOfMonth(monthCursor);

  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const gridDays = eachDayOfInterval({
    start: gridStart,
    end: gridEnd,
  });

  const monthDays = eachDayOfInterval({
    start: monthStart,
    end: monthEnd,
  });

  const todayDayKey = toDayKey(new Date());

  const agendaDays = monthDays.filter((day) => {
    const key = toDayKey(day);
    const isTodayKey = key === todayDayKey;
    const hasSessions = (sessionsByDay.get(key)?.length ?? 0) > 0;
    const hasExamMarkers = (examMarkersByDay.get(key)?.length ?? 0) > 0;
    return isTodayKey || hasSessions || hasExamMarkers;
  });

  const selectedDay = selectedDayKey ? parseDayKey(selectedDayKey) : null;
  const isSelectedDayToday = selectedDay ? isToday(selectedDay) : false;

  const selectedDaySessions = useMemo(() => {
    if (!selectedDayKey) return [];
    return sessionsByDay.get(selectedDayKey) ?? [];
  }, [selectedDayKey, sessionsByDay]);

  const selectedDayExams = useMemo(() => {
    if (!selectedDayKey) return [];
    return examMarkersByDay.get(selectedDayKey) ?? [];
  }, [examMarkersByDay, selectedDayKey]);

  const selectedDayCollision = useMemo(() => {
    if (!selectedDayKey) return null;
    return collisionAreasByDay.get(selectedDayKey) ?? null;
  }, [collisionAreasByDay, selectedDayKey]);

  const selectedDayStats = useMemo(() => {
    const totalHours = selectedDaySessions.reduce(
      (sum, session) => sum + session.plannedHours,
      0,
    );
    const firstPassCount = selectedDaySessions.filter(
      (session) => session.type === "FIRST_PASS",
    ).length;
    const reviewCount = selectedDaySessions.length - firstPassCount;
    const uniqueExamCount = new Set([
      ...selectedDaySessions.map((session) => session.examId),
      ...selectedDayExams.map((exam) => exam.id),
    ]).size;

    return {
      totalHours,
      firstPassCount,
      reviewCount,
      uniqueExamCount,
    };
  }, [selectedDayExams, selectedDaySessions]);

  const groupedDaySessions = useMemo(() => {
    const grouped = new Map<string, DaySessionGroup>();

    for (const session of selectedDaySessions) {
      const current = grouped.get(session.examId);
      if (!current) {
        grouped.set(session.examId, {
          examId: session.examId,
          courseName: session.courseName,
          examName: session.examName,
          examColor: session.examColor,
          sessions: [session],
        });
        continue;
      }

      current.sessions.push(session);
    }

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort(sortSessions),
      }))
      .sort((a, b) => {
        const byCourse = a.courseName.localeCompare(b.courseName);
        if (byCourse !== 0) return byCourse;
        return a.examName.localeCompare(b.examName);
      });
  }, [selectedDaySessions]);

  useEffect(() => {
    if (!selectedDayKey) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedDayKey(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedDayKey]);

  useEffect(() => {
    setIsPortalReady(true);
    return () => {
      setIsPortalReady(false);
    };
  }, []);

  const goToPrevMonth = () => {
    setMonthCursor((current) => addMonths(current, -1));
  };

  const goToNextMonth = () => {
    setMonthCursor((current) => addMonths(current, 1));
  };

  const openDay = (day: Date) => {
    setSelectedDayKey(toDayKey(day));
  };

  const closeDayDetails = () => {
    setSelectedDayKey(null);
  };

  const registerDirtyExam = (
    examId: string,
    sourceDayKey: string,
    targetDayKey: string,
  ) => {
    const anchorCandidate =
      sourceDayKey < targetDayKey ? sourceDayKey : targetDayKey;

    setDirtyExamIds((current) =>
      current.includes(examId) ? current : [...current, examId],
    );

    setOptimizationAnchor((current) => {
      if (!current) return anchorCandidate;
      return anchorCandidate < current ? anchorCandidate : current;
    });
  };

  const handleMoveSession = async (sessionId: string, targetDate: Date) => {
    const targetDayKey = toDayKey(targetDate);
    const source = sessions.find((session) => session.id === sessionId);

    if (!source) return;

    const sourceDayKey = toDayKey(source.plannedDate);
    if (sourceDayKey === targetDayKey) return;

    setMovingSessionId(sessionId);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/calendar/sessions/move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          targetDate: targetDayKey,
        }),
      });

      const result = (await response.json()) as
        | MoveSessionResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in result && typeof result.error === "string"
            ? result.error
            : "Unable to move study block",
        );
      }

      const payload = result as MoveSessionResponse;

      setSessions((current) =>
        current.map((entry) =>
          entry.id === payload.session.id
            ? {
                ...entry,
                plannedDate: payload.session.plannedDate,
              }
            : entry,
        ),
      );

      registerDirtyExam(source.examId, sourceDayKey, targetDayKey);
      setStatusMessage("Blocco spostato. Puoi ora ottimizzare il calendario.");
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to move study block",
      );
    } finally {
      setMovingSessionId(null);
      setDropTargetDayKey(null);
      setDraggingSessionId(null);
    }
  };

  const handleOptimizeCalendar = async () => {
    if (dirtyExamIds.length === 0 || isOptimizing) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/calendar/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examIds: dirtyExamIds,
          referenceDate: optimizationAnchor,
        }),
      });

      const result = (await response.json()) as
        | OptimizeCalendarResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in result && typeof result.error === "string"
            ? result.error
            : "Unable to optimize calendar",
        );
      }

      const payload = result as OptimizeCalendarResponse;
      const failedCount = payload.failed.length;

      setDirtyExamIds([]);
      setOptimizationAnchor(null);
      setStatusMessage(
        failedCount > 0
          ? `Ottimizzazione completata con ${failedCount} errore/i.`
          : "Calendario ottimizzato correttamente.",
      );

      router.refresh();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to optimize calendar",
      );
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleRecalibrateCalendar = async () => {
    if (isRecalibrating || isOptimizing) return;

    setIsRecalibrating(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/planning/recalibrate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          blockedDays: 0,
        }),
      });

      const result = (await response.json()) as
        | RecalibrateCalendarResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in result && typeof result.error === "string"
            ? result.error
            : "Unable to recalibrate calendar",
        );
      }

      const payload = result as RecalibrateCalendarResponse;

      setDirtyExamIds([]);
      setOptimizationAnchor(null);

      setStatusMessage(
        payload.withGapCount > 0
          ? `Ricalibrati ${payload.recalculated} esami. Gap residui: ${payload.withGapCount}.`
          : `Ricalibrati ${payload.recalculated} esami con il nuovo algoritmo.`,
      );

      router.refresh();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to recalibrate calendar",
      );
    } finally {
      setIsRecalibrating(false);
    }
  };

  const onCellDrop = async (
    event: DragEvent<HTMLDivElement>,
    targetDate: Date,
  ) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData(DRAG_MIME);
    if (!sessionId) return;

    await handleMoveSession(sessionId, targetDate);
  };

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden rounded-[2rem] border-zinc-800/80 bg-[linear-gradient(165deg,rgba(39,39,42,0.82),rgba(9,9,11,0.97))] py-0 text-zinc-100 shadow-[0_35px_100px_-70px_rgba(0,0,0,1)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-emerald-400/12 to-cyan-400/5 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-gradient-to-tr from-amber-300/10 to-transparent blur-3xl" />

        <CardHeader className="relative !rounded-none gap-4 border-b border-zinc-800/70 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5 sm:py-5">
          <div className="space-y-2">
            <CardTitle
              className={cn(
                "inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-100",
                headingClassName,
              )}
            >
              <CalendarDays className="h-5 w-5" />
              Visualizzazione Calendario
            </CardTitle>
            <CardDescription className="max-w-2xl text-zinc-400">
              Trascina i blocchi tra i giorni e poi usa Ottimizza Calendario per
              riequilibrare i giorni successivi.
            </CardDescription>

            <p
              className={cn(
                "inline-flex rounded-full border px-3 py-1 text-xs font-medium",
                dirtyExamIds.length > 0
                  ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-100"
                  : "border-zinc-700 bg-zinc-900/70 text-zinc-400",
              )}
            >
              {dirtyExamIds.length > 0
                ? `${dirtyExamIds.length} esami pronti per ottimizzazione`
                : "Nessuna modifica pendente"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {calendarFeedUrl ? (
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-xl border-zinc-700 bg-zinc-950/80 text-zinc-100 hover:bg-zinc-900"
              >
                <a href={calendarFeedUrl} target="_blank" rel="noreferrer">
                  Export iCal
                </a>
              </Button>
            ) : null}

            <Button
              variant="outline"
              disabled={isRecalibrating || isOptimizing}
              onClick={() => void handleRecalibrateCalendar()}
              className="h-11 rounded-xl border-zinc-700 bg-zinc-950/80 text-zinc-200 hover:bg-zinc-900"
            >
              <RefreshCw className="h-4 w-4" />
              {isRecalibrating ? "Ricalibrazione..." : "Ricalibra Calendario"}
            </Button>

            <Button
              variant="outline"
              disabled={
                dirtyExamIds.length === 0 || isOptimizing || isRecalibrating
              }
              onClick={() => void handleOptimizeCalendar()}
              className={cn(
                "h-11 rounded-xl border-zinc-700 bg-zinc-950/80 text-zinc-200 hover:bg-zinc-900",
                dirtyExamIds.length > 0 &&
                  !isOptimizing &&
                  !isRecalibrating &&
                  "border-emerald-400/45 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25",
              )}
            >
              <RefreshCw className="h-4 w-4" />
              {isOptimizing ? "Ottimizzazione..." : "Ottimizza Calendario"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="relative space-y-4 px-4 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4">
          <div className="flex items-center justify-between rounded-2xl border border-zinc-700/70 bg-zinc-950/70 px-3 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToPrevMonth}
              className="h-10 rounded-xl text-zinc-200 hover:bg-zinc-800/70"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>

            <p
              className={cn(
                "text-sm font-semibold uppercase tracking-[0.16em] text-zinc-100",
                monoClassName,
              )}
            >
              {format(monthCursor, "MMMM yyyy")}
            </p>

            <Button
              variant="ghost"
              size="sm"
              onClick={goToNextMonth}
              className="h-10 rounded-xl text-zinc-200 hover:bg-zinc-800/70"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {statusMessage ? (
            <p className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 px-3 py-2 text-sm text-emerald-100">
              {statusMessage}
            </p>
          ) : null}

          {errorMessage ? (
            <p className="rounded-xl border border-amber-400/35 bg-amber-500/12 px-3 py-2 text-sm text-amber-100">
              {errorMessage}
            </p>
          ) : null}

          <div className="hidden md:block">
            <div className="grid grid-cols-7 gap-2 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                (weekday) => (
                  <p key={weekday} className="px-1 py-1 text-center">
                    {weekday}
                  </p>
                ),
              )}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-2">
              {gridDays.map((day) => {
                const dayKey = toDayKey(day);
                const daySessions = sessionsByDay.get(dayKey) ?? [];
                const dayBadges = groupBadgesByExam(daySessions);
                const dayExamMarkers = examMarkersByDay.get(dayKey) ?? [];
                const dayCollision = collisionAreasByDay.get(dayKey) ?? null;
                const isCurrentMonthDay = isSameMonth(day, monthCursor);
                const isTodayDay = isToday(day);
                const isSelectedDay = selectedDayKey === dayKey;
                const isDropTarget = dropTargetDayKey === dayKey;

                return (
                  <div
                    key={dayKey}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropTargetDayKey(dayKey);
                    }}
                    onDragLeave={() => {
                      setDropTargetDayKey((current) =>
                        current === dayKey ? null : current,
                      );
                    }}
                    onDrop={(event) => void onCellDrop(event, day)}
                    className={cn(
                      "min-h-40 rounded-2xl border border-zinc-800/75 bg-zinc-950/55 p-2.5 transition-colors",
                      !isCurrentMonthDay && "opacity-45",
                      dayCollision &&
                        "border-rose-400/70 bg-rose-500/12 shadow-[0_0_0_1px_rgba(251,113,133,0.24)]",
                      isTodayDay &&
                        "border-cyan-300/70 bg-cyan-500/12 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]",
                      isSelectedDay &&
                        "border-emerald-400/65 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]",
                      isDropTarget && "border-emerald-300 bg-emerald-500/12",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openDay(day)}
                      className="mb-2 inline-flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left hover:bg-zinc-800/60"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-zinc-100">
                          {format(day, "d")}
                        </span>
                        {isTodayDay ? (
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.7)]"
                          />
                        ) : null}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        {dayCollision ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/45 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-100">
                            <AlertTriangle className="h-3 w-3" />
                            Collisione
                          </span>
                        ) : null}

                        {isTodayDay ? (
                          <span className="rounded-full border border-cyan-300/45 bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                            Oggi
                          </span>
                        ) : null}

                        {dayExamMarkers.length > 0 ? (
                          <Flag className="h-3.5 w-3.5 text-amber-300" />
                        ) : null}
                      </span>
                    </button>

                    <div className="space-y-1">
                      {dayCollision ? (
                        <p className="inline-flex w-full items-center gap-1 rounded-lg border border-rose-400/35 bg-rose-500/12 px-2 py-1 text-[11px] text-rose-100">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {dayCollision.topicDensity} topic (soglia{" "}
                          {dayCollision.threshold})
                        </p>
                      ) : null}

                      {dayExamMarkers.map((exam) => (
                        <div
                          key={`${exam.id}-${dayKey}`}
                          className="inline-flex w-full items-start gap-1 rounded-lg border border-amber-400/35 bg-amber-500/12 px-2 py-1 text-[11px] font-medium text-zinc-100"
                        >
                          <Flag className="h-3 w-3" />
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block whitespace-normal break-words font-semibold text-zinc-100">
                              {exam.courseName}
                            </span>
                            <span className="block whitespace-normal break-words text-zinc-300">
                              {exam.name}
                            </span>
                          </span>
                        </div>
                      ))}

                      {dayBadges.slice(0, 3).map((badge) => (
                        <div
                          key={`${badge.examId}-${dayKey}`}
                          className="inline-flex w-full items-center justify-between rounded-lg border px-2 py-1 text-[11px] font-medium text-zinc-100"
                          style={{
                            borderColor: withAlpha(
                              badge.examColor,
                              badge.placeholderOnly ? "55" : "88",
                            ),
                            borderStyle: badge.placeholderOnly
                              ? "dashed"
                              : "solid",
                            backgroundColor: withAlpha(
                              badge.examColor,
                              badge.placeholderOnly ? "12" : "1F",
                            ),
                          }}
                        >
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block whitespace-normal break-words font-semibold text-zinc-100">
                              {badge.courseName}
                            </span>
                            <span className="block whitespace-normal break-words text-zinc-300">
                              {badge.examName}
                            </span>
                          </span>
                          <span className="ml-2 shrink-0">
                            {badge.topicCount}
                          </span>
                        </div>
                      ))}

                      {dayBadges.length > 3 ? (
                        <p className="px-1 text-[11px] text-zinc-400">
                          +{dayBadges.length - 3} esami
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {agendaDays.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800/75 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                Nessun blocco pianificato nel mese selezionato.
              </div>
            ) : (
              agendaDays.map((day) => {
                const dayKey = toDayKey(day);
                const daySessions = sessionsByDay.get(dayKey) ?? [];
                const dayBadges = groupBadgesByExam(daySessions);
                const dayExamMarkers = examMarkersByDay.get(dayKey) ?? [];
                const dayCollision = collisionAreasByDay.get(dayKey) ?? null;
                const isTodayDay = isToday(day);

                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => openDay(day)}
                    className={cn(
                      "w-full rounded-2xl border border-zinc-800/75 bg-zinc-950/60 p-3 text-left",
                      dayCollision &&
                        "border-rose-400/70 bg-rose-500/10 shadow-[0_0_0_1px_rgba(251,113,133,0.2)]",
                      isTodayDay &&
                        "border-cyan-300/70 bg-cyan-500/12 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-100">
                        {format(day, "EEE dd MMM")}
                      </p>
                      <div className="inline-flex items-center gap-1.5">
                        {dayCollision ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-rose-400/35 bg-rose-500/12 px-2 py-0.5 text-[11px] text-rose-100">
                            <AlertTriangle className="h-3 w-3" />
                            {dayCollision.topicDensity}
                          </span>
                        ) : null}

                        {isTodayDay ? (
                          <span className="inline-flex items-center rounded-full border border-cyan-300/45 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                            Oggi
                          </span>
                        ) : null}

                        {dayExamMarkers.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/35 bg-amber-500/12 px-2 py-0.5 text-[11px] text-zinc-100">
                            <Flag className="h-3 w-3" />
                            Esame
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-1">
                      {dayCollision ? (
                        <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100">
                          Area di collisione: {dayCollision.topicDensity} topic
                          (soglia {dayCollision.threshold})
                        </p>
                      ) : null}

                      {dayBadges.length === 0 && dayExamMarkers.length === 0 ? (
                        <p className="rounded-md border border-zinc-800/70 bg-zinc-900/50 px-2 py-1.5 text-[11px] text-zinc-400">
                          Nessun blocco pianificato.
                        </p>
                      ) : null}

                      {dayBadges.map((badge) => (
                        <div
                          key={`${badge.examId}-${dayKey}`}
                          className="inline-flex w-full items-center justify-between rounded-md border px-2 py-1 text-[11px] font-medium text-zinc-100"
                          style={{
                            borderColor: withAlpha(
                              badge.examColor,
                              badge.placeholderOnly ? "55" : "88",
                            ),
                            borderStyle: badge.placeholderOnly
                              ? "dashed"
                              : "solid",
                            backgroundColor: withAlpha(
                              badge.examColor,
                              badge.placeholderOnly ? "12" : "1F",
                            ),
                          }}
                        >
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block whitespace-normal break-words font-semibold text-zinc-100">
                              {badge.courseName}
                            </span>
                            <span className="block whitespace-normal break-words text-zinc-300">
                              {badge.examName}
                            </span>
                          </span>
                          <span className="ml-2 shrink-0">
                            {badge.topicCount}
                          </span>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {isPortalReady && selectedDay
        ? createPortal(
            <section
              className="pointer-events-none fixed inset-0 z-[90] bg-black/65 backdrop-blur-[2px]"
              onClick={closeDayDetails}
            >
              <div
                className="pointer-events-auto relative ml-auto flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-zinc-800/75 bg-[linear-gradient(165deg,rgba(39,39,42,0.85),rgba(9,9,11,0.98))]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="pointer-events-none absolute -right-28 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-emerald-400/10 to-cyan-400/5 blur-3xl" />

                <div className="relative flex items-center justify-between border-b border-zinc-800/75 px-4 py-3 sm:px-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                      Day Details
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <h2
                        className={cn(
                          "text-lg font-semibold tracking-tight text-zinc-100",
                          headingClassName,
                        )}
                      >
                        {format(selectedDay, "EEEE, dd MMMM yyyy")}
                      </h2>

                      {isSelectedDayToday ? (
                        <span className="inline-flex items-center rounded-full border border-cyan-300/45 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                          Oggi
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={closeDayDetails}
                    className="rounded-xl text-zinc-300 hover:bg-zinc-800/80"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="relative flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/65 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                        Sessioni
                      </p>
                      <p className="mt-1 text-xl font-semibold text-zinc-100">
                        {selectedDaySessions.length}
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/65 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                        Ore pianificate
                      </p>
                      <p className="mt-1 text-xl font-semibold text-zinc-100">
                        {selectedDayStats.totalHours.toFixed(1)}h
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/65 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                        Esami coinvolti
                      </p>
                      <p className="mt-1 text-xl font-semibold text-zinc-100">
                        {selectedDayStats.uniqueExamCount}
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/65 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                        First/Review
                      </p>
                      <p className="mt-1 text-sm font-semibold text-zinc-100">
                        {selectedDayStats.firstPassCount} /{" "}
                        {selectedDayStats.reviewCount}
                      </p>
                    </div>
                  </div>

                  {selectedDayExams.length > 0 ? (
                    <div className="rounded-2xl border border-amber-400/35 bg-amber-500/12 px-3 py-2 text-sm text-zinc-100">
                      <p className="inline-flex items-center gap-2 font-semibold">
                        <Flag className="h-4 w-4" />
                        Data d&apos;esame
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs text-zinc-200">
                        {selectedDayExams.map((exam) => (
                          <li
                            key={`${exam.id}-marker`}
                            className="leading-tight"
                          >
                            <span className="block font-semibold text-zinc-100">
                              {exam.courseName}
                            </span>
                            <span className="block text-zinc-300">
                              {exam.name}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {selectedDayCollision ? (
                    <div className="rounded-2xl border border-rose-400/35 bg-rose-500/12 px-3 py-2 text-sm text-zinc-100">
                      <p className="inline-flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" />
                        Area di Collisione
                      </p>
                      <p className="mt-1 text-xs text-zinc-200">
                        Densita rilevata: {selectedDayCollision.topicDensity}{" "}
                        topic (soglia {selectedDayCollision.threshold}).
                      </p>
                      {selectedDayCollision.earlyStartSuggestionCount > 0 ? (
                        <p className="mt-1 text-xs text-emerald-200">
                          Early-start suggeriti:{" "}
                          {selectedDayCollision.earlyStartSuggestionCount}
                        </p>
                      ) : null}

                      <CollisionFixButton
                        date={selectedDay}
                        className="mt-2"
                        onResolved={(result) => {
                          setErrorMessage(null);
                          setStatusMessage(
                            result.movedTopics > 0
                              ? `Collisione risolta: spostati ${result.movedTopics} topic.`
                              : "Nessun topic spostato: collisione gia bilanciata o vincoli stretti.",
                          );
                        }}
                      />
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-zinc-800/75 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
                    Trascina un blocco da questa lista e rilascialo su un altro
                    giorno del calendario per spostarlo.
                  </div>

                  {selectedDaySessions.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-800/75 bg-zinc-950/60 px-3 py-5 text-sm text-zinc-400">
                      Nessuna sessione pianificata per questo giorno.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {groupedDaySessions.map((group) => (
                        <section
                          key={group.examId}
                          className="rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{
                                    backgroundColor: withAlpha(
                                      group.examColor,
                                      "FF",
                                    ),
                                  }}
                                />
                                <span className="whitespace-normal break-words">
                                  {group.courseName}
                                </span>
                              </p>
                              <p className="mt-0.5 text-xs text-zinc-300">
                                {group.examName}
                              </p>
                            </div>
                            <span className="rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-0.5 text-[11px] text-zinc-300">
                              {group.sessions.length} blocchi
                            </span>
                          </div>

                          <ul className="mt-3 space-y-2">
                            {group.sessions.map((session) => {
                              const isMoving = movingSessionId === session.id;
                              const isGhost = session.isPlaceholder;

                              return (
                                <li
                                  key={session.id}
                                  draggable={!isMoving && !isOptimizing}
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData(
                                      DRAG_MIME,
                                      session.id,
                                    );
                                    event.dataTransfer.effectAllowed = "move";
                                    setDraggingSessionId(session.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggingSessionId(null);
                                    setDropTargetDayKey(null);
                                  }}
                                  className={cn(
                                    "rounded-xl border border-zinc-800 bg-zinc-950/70 p-3",
                                    isGhost &&
                                      "border-dashed border-zinc-700/80 bg-zinc-900/60",
                                    draggingSessionId === session.id &&
                                      "opacity-60",
                                  )}
                                >
                                  <div className="flex items-start gap-2.5">
                                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />

                                    <div className="min-w-0 flex-1">
                                      <p className="whitespace-normal break-words text-sm font-medium text-zinc-100">
                                        {session.topicName}
                                      </p>

                                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                        <span
                                          className={cn(
                                            "rounded-md border px-1.5 py-0.5",
                                            session.type === "FIRST_PASS"
                                              ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                                              : "border-emerald-400/45 bg-emerald-500/15 text-emerald-100",
                                          )}
                                        >
                                          {getSessionTypeLabel(session.type)}
                                        </span>
                                        <span className="rounded-md border border-zinc-700 bg-zinc-900/80 px-1.5 py-0.5 text-zinc-300">
                                          {session.plannedHours.toFixed(2)}h
                                        </span>
                                        {isGhost ? (
                                          <span className="rounded-md border border-zinc-700 bg-zinc-900/80 px-1.5 py-0.5 uppercase tracking-wide text-zinc-400">
                                            Ghost
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <Button
                                      asChild
                                      size="sm"
                                      variant="outline"
                                      className="rounded-xl border-zinc-700 bg-zinc-950/80 text-zinc-200 hover:bg-zinc-800"
                                    >
                                      <Link
                                        href={
                                          session.topicId
                                            ? `/focus/${session.topicId}?autostart=1&examId=${encodeURIComponent(session.examId)}`
                                            : `/focus?autostart=1&examId=${encodeURIComponent(session.examId)}`
                                        }
                                      >
                                        <Play className="h-4 w-4" />
                                        Timer
                                      </Link>
                                    </Button>
                                    <Button
                                      asChild
                                      size="sm"
                                      variant="ghost"
                                      className="rounded-xl text-zinc-300 hover:bg-zinc-800/80"
                                    >
                                      <Link href={`/exam/${session.examId}`}>
                                        Esame
                                      </Link>
                                    </Button>
                                  </div>

                                  {isMoving ? (
                                    <p className="mt-2 text-xs text-zinc-400">
                                      Spostamento in corso...
                                    </p>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>,
            document.body,
          )
        : null}
    </div>
  );
}
