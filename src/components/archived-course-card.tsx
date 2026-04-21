"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { unarchiveCourse } from "@/app/courses/actions";
import { Button } from "@/components/ui/button";

type ArchivedCourseCardProps = {
  course: {
    id: string;
    name: string;
    cfu: number;
    isCompleted: boolean;
    examCount: number;
    topicCount: number;
    updatedAt: string;
  };
};

export function ArchivedCourseCard({ course }: ArchivedCourseCardProps) {
  const router = useRouter();
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restoreCourse = async () => {
    if (isRestoring) return;

    setIsRestoring(true);
    setError(null);

    try {
      await unarchiveCourse(course.id);
      router.refresh();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Unable to restore course.",
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <article className="rounded-2xl border border-border/70 bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{course.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {new Date(course.updatedAt).toLocaleDateString()}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void restoreCourse();
          }}
          disabled={isRestoring}
        >
          <RotateCcw className="h-4 w-4" />
          {isRestoring ? "Ripristino..." : "Ripristina"}
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border/70 bg-background px-2 py-2">
          <p className="text-muted-foreground">CFU</p>
          <p className="font-semibold">{course.cfu}</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-background px-2 py-2">
          <p className="text-muted-foreground">Exams</p>
          <p className="font-semibold">{course.examCount}</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-background px-2 py-2">
          <p className="text-muted-foreground">Topics</p>
          <p className="font-semibold">{course.topicCount}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Stato: {course.isCompleted ? "Completato" : "Archiviato"}
      </p>

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </article>
  );
}
