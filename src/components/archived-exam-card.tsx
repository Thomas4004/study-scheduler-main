"use client";

import { format } from "date-fns";
import { type ExamStatus } from "@prisma/client";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { unarchiveExam } from "@/app/exams/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ArchivedExamCardProps = {
  exam: {
    id: string;
    name: string;
    colorCode: string;
    status: ExamStatus;
    grade: number | null;
    completedAt: string | null;
    notes: string | null;
    totalTopics: number;
  };
  stats: {
    totalStudyHours: number;
    totalFocusMinutes: number;
    reviewSessionsExecuted: number;
    averageFinalConfidence: number | null;
  };
};

function formatConfidence(value: number | null) {
  if (value === null) {
    return "-";
  }

  return `${value.toFixed(1)}/5`;
}

export function ArchivedExamCard({ exam, stats }: ArchivedExamCardProps) {
  const router = useRouter();
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restoreExam = async () => {
    if (isRestoring) return;

    setIsRestoring(true);
    setError(null);

    try {
      await unarchiveExam(exam.id);

      router.refresh();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Unable to restore exam.",
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Card className="relative h-full min-h-[12rem] overflow-hidden border border-border/80 bg-gradient-to-br from-card to-muted/20">
      <div
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: exam.colorCode }}
      />

      <CardHeader className="pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-balance break-words">
              {exam.name}
            </CardTitle>
            <CardDescription className="mt-1">
              {exam.completedAt
                ? `Completed on ${format(new Date(exam.completedAt), "dd/MM/yyyy")}`
                : "Completed date not available"}
            </CardDescription>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {exam.status === "ARCHIVED" ? "Archived" : "Completed"}
            </span>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-border/70 bg-background"
              onClick={() => {
                void restoreExam();
              }}
              disabled={isRestoring}
            >
              <RotateCcw className="h-4 w-4" />
              {isRestoring ? "Ripristino..." : "Ripristina"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pl-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Grade
            </p>
            <p className="mt-1 text-base font-semibold">
              {exam.grade === null ? "-" : exam.grade}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Study Hours
            </p>
            <p className="mt-1 text-base font-semibold">
              {stats.totalStudyHours.toFixed(1)}h
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Review Sessions
            </p>
            <p className="mt-1 text-base font-semibold">
              {stats.reviewSessionsExecuted}
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Avg Confidence
            </p>
            <p className="mt-1 text-base font-semibold">
              {formatConfidence(stats.averageFinalConfidence)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-background px-2 py-1">
            {exam.totalTopics} topic(s)
          </span>
          <span className="rounded-full border border-border/70 bg-background px-2 py-1">
            {Math.round(stats.totalFocusMinutes)} focus min
          </span>
        </div>

        {exam.notes ? (
          <p className="rounded-xl border border-border/70 bg-background px-3 py-3 text-sm text-muted-foreground">
            {exam.notes}
          </p>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
