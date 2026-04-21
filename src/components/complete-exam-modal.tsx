"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CompletionResponse = {
  exam: {
    id: string;
    name: string;
    grade: number | null;
    completedAt: string | null;
  };
  stats: {
    totalHoursStudied: number;
    reviewSessionsExecuted: number;
    averageConfidence: number | null;
    removedFutureSessions: number;
  };
};

type CompleteExamModalProps = {
  examId: string;
  examName: string;
  triggerLabel?: string;
  triggerVariant?:
    | "default"
    | "outline"
    | "secondary"
    | "ghost"
    | "destructive"
    | "link";
  className?: string;
  redirectToArchive?: boolean;
};

function toDateInputValue(date: Date) {
  const offsetMinutes = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offsetMinutes * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function toCompletionIso(value: string): string | null {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function CompleteExamModal({
  examId,
  examName,
  triggerLabel = "Complete",
  triggerVariant = "destructive",
  className,
  redirectToArchive = false,
}: CompleteExamModalProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [grade, setGrade] = useState("");
  const [completedAt, setCompletedAt] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CompletionResponse | null>(null);

  function resetState() {
    setGrade("");
    setCompletedAt(toDateInputValue(new Date()));
    setNotes("");
    setError(null);
    setSummary(null);
    setIsSubmitting(false);
  }

  function closeModal() {
    setOpen(false);
    resetState();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setError(null);

    const normalizedGrade = grade.trim();
    let parsedGrade: number | null = null;

    if (normalizedGrade.length > 0) {
      const candidate = Number(normalizedGrade);
      if (!Number.isInteger(candidate) || candidate < 0 || candidate > 110) {
        setError("Grade must be an integer between 0 and 110.");
        return;
      }
      parsedGrade = candidate;
    }

    const completionDateIso = toCompletionIso(completedAt);
    if (!completionDateIso) {
      setError("Completion date is invalid.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/exams/${examId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grade: parsedGrade,
          completedAt: completionDateIso,
          notes,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | CompletionResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(
          payload && "error" in payload
            ? (payload.error ?? "Unable to complete exam.")
            : "Unable to complete exam.",
        );
        setIsSubmitting(false);
        return;
      }

      const completion = payload as CompletionResponse;

      router.refresh();

      if (redirectToArchive) {
        router.push("/archive");
        return;
      }

      setSummary(completion);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected error while completing exam.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        className={className}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/85 backdrop-blur-sm"
            aria-label="Close completion modal"
            onClick={closeModal}
          />

          <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border/70 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Complete Exam</h2>
                <p className="text-sm text-muted-foreground">{examName}</p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={closeModal}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="px-5 py-5">
              {summary ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                    <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      Exam completed successfully
                    </p>
                    <p className="mt-1 text-xs text-emerald-200/90">
                      Future sessions removed:{" "}
                      {summary.stats.removedFutureSessions}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Total Hours
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {summary.stats.totalHoursStudied.toFixed(1)}h
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Reviews
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {summary.stats.reviewSessionsExecuted}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Avg Confidence
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {summary.stats.averageConfidence === null
                          ? "-"
                          : `${summary.stats.averageConfidence.toFixed(1)}/5`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeModal}
                    >
                      Close
                    </Button>
                    <Button type="button" asChild>
                      <Link href="/archive">Open Archive</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                    Completing this exam will keep course topics active and only
                    remove future study sessions from your active plan.
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`grade-${examId}`}>
                        Grade (optional)
                      </Label>
                      <Input
                        id={`grade-${examId}`}
                        type="number"
                        min={0}
                        max={110}
                        step={1}
                        inputMode="numeric"
                        value={grade}
                        onChange={(event) => setGrade(event.target.value)}
                        placeholder="e.g. 28"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`completed-at-${examId}`}>
                        Completion Date
                      </Label>
                      <Input
                        id={`completed-at-${examId}`}
                        type="date"
                        value={completedAt}
                        onChange={(event) => setCompletedAt(event.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`notes-${examId}`}>Reflection Notes</Label>
                    <textarea
                      id={`notes-${examId}`}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      maxLength={4000}
                      placeholder="What worked, what to improve, key takeaways..."
                      className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">
                      {notes.length}/4000 characters
                    </p>
                  </div>

                  {error ? (
                    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeModal}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </span>
                      ) : (
                        "Complete Exam"
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
