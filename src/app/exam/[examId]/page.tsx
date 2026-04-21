import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

import prisma from "@/lib/prisma";
import { SmartSchedulerEngine } from "@/lib/planning";
import { CompleteExamModal } from "@/components/complete-exam-modal";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { ExamSettingsForm } from "@/components/exam-settings-form";
import { TopicKanbanBoard } from "@/components/topic-kanban-board";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isMissingTableError } from "@/lib/prisma-compat";

export const dynamic = "force-dynamic";

const schedulerEngine = new SmartSchedulerEngine(prisma);

async function getExamPageData(examId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      topics: {
        orderBy: [
          { status: "asc" },
          { difficulty_weight: "desc" },
          { name: "asc" },
        ],
      },
    },
  });

  if (!exam) {
    return null;
  }

  let earliestStartDate: string | null = null;
  try {
    const planningPreference = await prisma.examPlanningPreference?.findUnique({
      where: {
        examId: exam.id,
      },
      select: {
        earliest_start_date: true,
      },
    });

    earliestStartDate =
      planningPreference?.earliest_start_date?.toISOString() ?? null;
  } catch (error) {
    if (!isMissingTableError(error, "ExamPlanningPreference")) {
      throw error;
    }
  }

  const triage = await schedulerEngine.buildPlan(exam.id, {
    includeProgress: true,
    preserveLoggedSessions: true,
    dryRun: true,
  });

  return {
    exam,
    earliestStartDate,
    triage,
  };
}

export default async function ExamTopicTrackerPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const data = await getExamPageData(examId);

  if (!data) {
    notFound();
  }

  const { exam, triage, earliestStartDate } = data;
  const hasGap = triage.missingHours > 0.001;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{exam.name}</h1>
          <p className="text-sm text-muted-foreground">
            Exam date {format(new Date(exam.exam_date), "dd/MM/yyyy")} • Buffer{" "}
            {exam.buffer_days} day(s) • Status {exam.status} •{" "}
            {exam.topics.length} assigned topic(s)
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/calendar">View Calendar</Link>
          </Button>
          <Button asChild className="w-full sm:w-auto">
            <Link href="/focus">Focus Mode</Link>
          </Button>
          <DeleteEntityButton
            endpoint={`/api/exams/${exam.id}`}
            entityLabel="exam"
            buttonLabel="Delete Exam"
            className="w-full sm:w-auto"
            size="sm"
            redirectTo="/exams"
            confirmMessage={`Delete exam \"${exam.name}\"? This will also remove linked study sessions.`}
          />
          {exam.status === "ACTIVE" ? (
            <CompleteExamModal
              examId={exam.id}
              examName={exam.name}
              triggerLabel="Complete Exam"
              className="w-full sm:w-auto"
              redirectToArchive
            />
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plan Health</CardTitle>
          <CardDescription>
            {hasGap
              ? `Gap ore stimato: ${triage.missingHours.toFixed(2)}h da riallocare.`
              : "Distribuzione oraria bilanciata per questo esame."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Required
            </p>
            <p className="text-xl font-semibold">
              {triage.requiredHours.toFixed(2)}h
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Available
            </p>
            <p className="text-xl font-semibold">
              {triage.availableHours.toFixed(2)}h
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Topics
            </p>
            <p className="text-xl font-semibold">{exam.topics.length}</p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background px-3 py-3 sm:col-span-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Velocita osservata
            </p>
            <p className="mt-1 text-sm text-foreground">
              {triage.projectedDailyVelocity?.toFixed(2) ?? "0.00"}h/day •
              Proiezione entro esame:{" "}
              {triage.projectedHoursByDeadline?.toFixed(2) ?? "0.00"}h
            </p>
          </div>

          {triage.warnings.length > 0 ? (
            <div className="sm:col-span-3 rounded-xl border border-border/70 bg-background px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Engine Notes
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {triage.warnings.slice(0, 4).map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ExamSettingsForm
        exam={{
          id: exam.id,
          name: exam.name,
          examDate: exam.exam_date.toISOString(),
          difficulty: exam.difficulty,
          intensity: exam.intensity,
          bufferDays: exam.buffer_days,
          weight: exam.weight,
          colorCode: exam.color_code,
          grade: exam.grade,
          status: exam.status,
          notes: exam.notes,
        }}
        earliestStartDate={earliestStartDate}
      />

      <TopicKanbanBoard
        examId={exam.id}
        initialTopics={exam.topics.map((topic) => ({
          id: topic.id,
          name: topic.name,
          difficultyWeight: topic.difficulty_weight,
          status: topic.status,
        }))}
      />
    </div>
  );
}
