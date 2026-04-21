"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type CourseTopic = {
  id: string;
  name: string;
  resources: string[];
};

type CourseTopicAssignmentModalProps = {
  examId: string;
  examName: string;
  courseTopics: CourseTopic[];
  assignedTopicIds: string[];
};

export function CourseTopicAssignmentModal({
  examId,
  examName,
  courseTopics,
  assignedTopicIds,
}: CourseTopicAssignmentModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(assignedTopicIds.map((topicId) => [topicId, true])),
  );

  useEffect(() => {
    setSelected(
      Object.fromEntries(assignedTopicIds.map((topicId) => [topicId, true])),
    );
  }, [assignedTopicIds]);

  const filteredTopics = useMemo(() => {
    if (query.trim().length === 0) {
      return courseTopics;
    }

    const lowered = query.trim().toLowerCase();
    return courseTopics.filter((topic) =>
      topic.name.toLowerCase().includes(lowered),
    );
  }, [courseTopics, query]);

  const selectedTopicIds = Object.entries(selected)
    .filter(([, value]) => value)
    .map(([topicId]) => topicId);

  const saveSelection = () => {
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/exams/${examId}/topics/assign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            topicIds: selectedTopicIds,
          }),
        });

        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(result.error ?? "Unable to assign topics to exam");
        }

        setOpen(false);
        router.refresh();
      } catch (fetchError: unknown) {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Unable to assign topics to exam",
        );
      }
    });
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Assign Topics
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[90] bg-black/65 p-4 backdrop-blur-sm">
          <div className="mx-auto mt-[8vh] w-full max-w-2xl rounded-2xl border border-border/70 bg-card shadow-2xl">
            <div className="border-b border-border/70 px-4 py-3">
              <p className="text-sm font-semibold">Assign Course Topics</p>
              <p className="text-xs text-muted-foreground">
                {examName} · Select which course topics belong to this exam.
              </p>
            </div>

            <div className="space-y-3 px-4 py-4">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter topics..."
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              />

              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {filteredTopics.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                    No matching topics.
                  </p>
                ) : (
                  filteredTopics.map((topic) => (
                    <label
                      key={topic.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background px-3 py-3"
                    >
                      <Checkbox
                        checked={Boolean(selected[topic.id])}
                        onCheckedChange={(checked) => {
                          setSelected((current) => ({
                            ...current,
                            [topic.id]: Boolean(checked),
                          }));
                        }}
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {topic.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {topic.resources.length} resource link(s)
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Selected: {selectedTopicIds.length} / {courseTopics.length}
              </p>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={saveSelection}
                disabled={isPending}
              >
                {isPending ? "Saving..." : "Save Assignment"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
