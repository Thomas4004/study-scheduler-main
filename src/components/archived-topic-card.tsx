"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { unarchiveTopic } from "@/app/courses/actions";
import { Button } from "@/components/ui/button";

type ArchivedTopicCardProps = {
  topic: {
    id: string;
    name: string;
    courseName: string;
    linkedExams: number;
    updatedAt: string;
  };
};

export function ArchivedTopicCard({ topic }: ArchivedTopicCardProps) {
  const router = useRouter();
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restoreTopic = async () => {
    if (isRestoring) return;

    setIsRestoring(true);
    setError(null);

    try {
      await unarchiveTopic(topic.id);
      router.refresh();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Unable to restore topic.",
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <article className="rounded-2xl border border-border/70 bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-balance break-words">
            {topic.name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {topic.courseName} • {topic.linkedExams} exam link(s)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {new Date(topic.updatedAt).toLocaleDateString()}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void restoreTopic();
          }}
          disabled={isRestoring}
        >
          <RotateCcw className="h-4 w-4" />
          {isRestoring ? "Ripristino..." : "Ripristina"}
        </Button>
      </div>

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </article>
  );
}
