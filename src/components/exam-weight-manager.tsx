"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ExamWeightItem = {
  id: string;
  name: string;
  weight: number;
};

type ExamWeightManagerProps = {
  courseId: string;
  exams: ExamWeightItem[];
};

function asPercent(value: number) {
  return Math.round(value * 10000) / 100;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function ExamWeightManager({ courseId, exams }: ExamWeightManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(exams.map((exam) => [exam.id, asPercent(exam.weight)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const total = useMemo(
    () =>
      Object.values(weights).reduce(
        (sum, weight) => sum + clampPercent(weight),
        0,
      ),
    [weights],
  );

  const updateWeight = (examId: string, nextValue: number) => {
    setWeights((current) => ({
      ...current,
      [examId]: clampPercent(nextValue),
    }));
  };

  const saveWeights = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/courses/${courseId}/weights`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            exams: exams.map((exam) => ({
              examId: exam.id,
              weightPercent: clampPercent(weights[exam.id] ?? 0),
            })),
          }),
        });

        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          updated?: number;
        };

        if (!response.ok) {
          throw new Error(result.error ?? "Unable to save exam weights");
        }

        setSuccess(`Updated ${result.updated ?? exams.length} exam weight(s).`);
        router.refresh();
      } catch (fetchError: unknown) {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Unable to save exam weights",
        );
      }
    });
  };

  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Weight Distribution (0-100%)</CardTitle>
        <CardDescription>
          Define the weight of each exam for the course weighted-grade
          projection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground">
          Current total:{" "}
          <span className="font-semibold text-foreground">
            {total.toFixed(2)}%
          </span>
        </div>

        <div className="space-y-3">
          {exams.map((exam) => {
            const percent = clampPercent(weights[exam.id] ?? 0);

            return (
              <div
                key={exam.id}
                className="rounded-xl border border-border/70 bg-background px-3 py-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{exam.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {percent.toFixed(2)}%
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                  <Input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={percent}
                    onChange={(event) =>
                      updateWeight(exam.id, Number(event.target.value))
                    }
                  />

                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={percent}
                    onChange={(event) =>
                      updateWeight(exam.id, Number(event.target.value))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-400">{success}</p> : null}

        <div className="flex justify-end">
          <Button type="button" onClick={saveWeights} disabled={isPending}>
            {isPending ? "Saving..." : "Save Weights"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
