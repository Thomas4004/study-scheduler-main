"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  EllipsisVertical,
  GripVertical,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { MobileActionDrawer } from "@/components/mobile-action-drawer";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type TopicStatusValue = "TO_STUDY" | "REVIEW" | "MASTERED" | "ARCHIVED";
type MutableTopicStatusValue = Exclude<TopicStatusValue, "ARCHIVED">;

type TopicItem = {
  id: string;
  name: string;
  difficultyWeight: number;
  status: TopicStatusValue;
};

type TopicKanbanBoardProps = {
  examId: string;
  initialTopics: TopicItem[];
};

const columns: Array<{
  status: TopicStatusValue;
  title: string;
  hint: string;
}> = [
  {
    status: "TO_STUDY",
    title: "To Study",
    hint: "New content and first pass",
  },
  {
    status: "REVIEW",
    title: "Reviewing",
    hint: "Repetition and active recall",
  },
  {
    status: "MASTERED",
    title: "Mastered",
    hint: "Stable topics ready for exam",
  },
  {
    status: "ARCHIVED",
    title: "Archived",
    hint: "Frozen topics from completed exams",
  },
];

function nextStatus(status: MutableTopicStatusValue): MutableTopicStatusValue {
  if (status === "TO_STUDY") return "REVIEW";
  if (status === "REVIEW") return "MASTERED";
  return "MASTERED";
}

function previousStatus(
  status: MutableTopicStatusValue,
): MutableTopicStatusValue {
  if (status === "MASTERED") return "REVIEW";
  if (status === "REVIEW") return "TO_STUDY";
  return "TO_STUDY";
}

export function TopicKanbanBoard({
  examId,
  initialTopics,
}: TopicKanbanBoardProps) {
  const router = useRouter();
  const [topics, setTopics] = useState<TopicItem[]>(initialTopics);
  const [draggingTopicId, setDraggingTopicId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingTopicId, setSavingTopicId] = useState<string | null>(null);
  const [mobileActionTopicId, setMobileActionTopicId] = useState<string | null>(
    null,
  );
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTopicName, setEditingTopicName] = useState("");
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOpenedRef = useRef(false);

  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicDifficulty, setNewTopicDifficulty] = useState("3");
  const [newTopicStatus, setNewTopicStatus] =
    useState<MutableTopicStatusValue>("TO_STUDY");
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);

  const groupedTopics = useMemo(() => {
    return columns.map((column) => ({
      ...column,
      topics: topics
        .filter((topic) => topic.status === column.status)
        .sort((a, b) => b.difficultyWeight - a.difficultyWeight),
    }));
  }, [topics]);

  useEffect(() => {
    return () => {
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

  const queueTopicLongPress = (topicId: string) => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;

    longPressOpenedRef.current = false;
    clearLongPressTimer();

    longPressTimerRef.current = window.setTimeout(() => {
      longPressOpenedRef.current = true;
      setMobileActionTopicId(topicId);
      longPressTimerRef.current = null;
    }, 420);
  };

  const persistTopicStatus = async (
    topicId: string,
    status: MutableTopicStatusValue,
  ) => {
    const previous = topics;
    setSavingTopicId(topicId);
    setError(null);

    setTopics((current) =>
      current.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              status,
            }
          : topic,
      ),
    );

    try {
      const response = await fetch(`/api/topics/${topicId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to update topic status");
      }
    } catch (err: unknown) {
      setTopics(previous);
      setError(
        err instanceof Error ? err.message : "Failed to update topic status",
      );
    } finally {
      setSavingTopicId(null);
    }
  };

  const deleteTopic = async (topic: TopicItem) => {
    if (savingTopicId) return;

    const shouldDelete = window.confirm(
      `Delete topic \"${topic.name}\"? This action cannot be undone.`,
    );
    if (!shouldDelete) return;

    setSavingTopicId(topic.id);
    setError(null);

    try {
      const response = await fetch(`/api/topics/${topic.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete topic right now.");
      }

      setTopics((currentTopics) =>
        currentTopics.filter((entry) => entry.id !== topic.id),
      );
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete topic right now.",
      );
    } finally {
      setSavingTopicId(null);
    }
  };

  const handleDrop = (targetStatus: TopicStatusValue) => {
    if (targetStatus === "ARCHIVED") return;
    if (!draggingTopicId) return;
    const draggedTopic = topics.find((topic) => topic.id === draggingTopicId);
    if (!draggedTopic) return;
    if (draggedTopic.status === "ARCHIVED") return;
    if (draggedTopic.status === targetStatus) return;

    void persistTopicStatus(draggingTopicId, targetStatus);
    setDraggingTopicId(null);
  };

  const createTopic = async () => {
    const trimmedName = newTopicName.trim();
    if (!trimmedName) {
      setError("Topic name is required.");
      return;
    }

    setError(null);
    setIsCreatingTopic(true);

    try {
      const response = await fetch(`/api/exams/${examId}/topics`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          difficulty_weight: Number(newTopicDifficulty),
          status: newTopicStatus,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to create topic");
      }

      setTopics((current) => [
        {
          id: result.topic.id,
          name: result.topic.name,
          difficultyWeight: result.topic.difficulty_weight,
          status: result.topic.status,
        },
        ...current,
      ]);
      setNewTopicName("");
      setNewTopicDifficulty("3");
      setNewTopicStatus("TO_STUDY");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create topic");
    } finally {
      setIsCreatingTopic(false);
    }
  };

  const beginInlineRename = (topic: TopicItem) => {
    if (topic.status === "ARCHIVED") return;
    setEditingTopicId(topic.id);
    setEditingTopicName(topic.name);
    setError(null);
  };

  const cancelInlineRename = () => {
    setEditingTopicId(null);
    setEditingTopicName("");
  };

  const persistInlineRename = async (topicId: string) => {
    if (savingTopicId === topicId) {
      return;
    }

    if (editingTopicId !== topicId) {
      return;
    }

    const nextName = editingTopicName.trim();
    if (!nextName) {
      setError("Topic name is required.");
      return;
    }

    const previousTopic = topics.find((topic) => topic.id === topicId);
    if (!previousTopic) {
      cancelInlineRename();
      return;
    }

    const previousName = previousTopic.name;
    if (previousName === nextName) {
      cancelInlineRename();
      return;
    }

    setSavingTopicId(topicId);
    setError(null);
    setTopics((current) =>
      current.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              name: nextName,
            }
          : topic,
      ),
    );

    try {
      const response = await fetch(`/api/topics/${topicId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: nextName,
        }),
      });

      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "Failed to rename topic");
      }

      cancelInlineRename();
    } catch (err: unknown) {
      setTopics((current) =>
        current.map((topic) =>
          topic.id === topicId
            ? {
                ...topic,
                name: previousName,
              }
            : topic,
        ),
      );
      setError(err instanceof Error ? err.message : "Failed to rename topic");
    } finally {
      setSavingTopicId(null);
    }
  };

  const renderColumn = (column: {
    status: TopicStatusValue;
    title: string;
    hint: string;
    topics: TopicItem[];
  }) => {
    const handleTouchEnd = (
      topic: TopicItem,
      event: React.TouchEvent<HTMLElement>,
    ) => {
      clearLongPressTimer();

      if (longPressOpenedRef.current) {
        longPressOpenedRef.current = false;
        setTouchStartX(null);
        return;
      }

      if (touchStartX === null || savingTopicId !== null) return;
      if (topic.status === "ARCHIVED") return;

      const deltaX = event.changedTouches[0].clientX - touchStartX;
      setTouchStartX(null);

      if (Math.abs(deltaX) < 45) return;

      if (deltaX < 0 && topic.status !== "MASTERED") {
        void persistTopicStatus(topic.id, nextStatus(topic.status));
      }

      if (deltaX > 0 && topic.status !== "TO_STUDY") {
        void persistTopicStatus(topic.id, previousStatus(topic.status));
      }
    };

    return (
      <section
        key={column.status}
        className={cn(
          "flex min-h-[22rem] min-w-[86vw] snap-center flex-col rounded-xl border bg-card p-3 md:min-w-0",
          column.status === "MASTERED"
            ? "border-primary/45"
            : column.status === "ARCHIVED"
              ? "border-border/60"
              : "border-border",
        )}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => handleDrop(column.status)}
      >
        <header className="mb-3 border-b border-border/70 pb-2">
          <h3 className="text-sm font-semibold">{column.title}</h3>
          <p className="text-xs text-muted-foreground">{column.hint}</p>
        </header>

        <div className="space-y-2">
          {column.topics.length === 0 ? (
            <div className="space-y-2 rounded-lg border border-dashed border-border/80 px-3 py-4 text-center text-xs text-muted-foreground">
              <p>
                {column.status === "ARCHIVED"
                  ? "No archived topics."
                  : "Drop a topic here."}
              </p>
              {column.status !== "ARCHIVED" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(`/focus?autostart=1&examId=${examId}`)
                  }
                >
                  <Play className="h-4 w-4" />
                  Start Timer
                </Button>
              ) : null}
            </div>
          ) : (
            column.topics.map((topic) => (
              <article
                key={topic.id}
                draggable
                onDragStart={() => setDraggingTopicId(topic.id)}
                onDragEnd={() => setDraggingTopicId(null)}
                onTouchStart={(event) => {
                  setTouchStartX(event.changedTouches[0].clientX);
                  queueTopicLongPress(topic.id);
                }}
                onTouchMove={clearLongPressTimer}
                onTouchCancel={clearLongPressTimer}
                onTouchEnd={(event) => handleTouchEnd(topic, event)}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border bg-background p-3",
                  topic.status === "MASTERED"
                    ? "border-primary/35 bg-primary/10"
                    : topic.status === "ARCHIVED"
                      ? "border-border/60 bg-muted/50"
                      : "border-border/80",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {editingTopicId === topic.id ? (
                      <Input
                        autoFocus
                        value={editingTopicName}
                        onChange={(event) =>
                          setEditingTopicName(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void persistInlineRename(topic.id);
                          }

                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelInlineRename();
                          }
                        }}
                        onBlur={() => {
                          void persistInlineRename(topic.id);
                        }}
                        disabled={savingTopicId === topic.id}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => beginInlineRename(topic)}
                        className="w-full whitespace-normal break-words text-left font-medium leading-tight hover:underline"
                      >
                        {topic.name.trim().length > 0
                          ? topic.name
                          : "Untitled Topic"}
                      </button>
                    )}
                    <p className="whitespace-normal break-words text-xs text-muted-foreground">
                      Difficulty {topic.difficultyWeight}/5
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="rounded-md border border-border/70 px-2 py-1 text-muted-foreground">
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <div className="md:hidden">
                      <MobileActionDrawer
                        open={mobileActionTopicId === topic.id}
                        onOpenChange={(open) => {
                          if (!open) {
                            setMobileActionTopicId((currentId) =>
                              currentId === topic.id ? null : currentId,
                            );
                            return;
                          }

                          setMobileActionTopicId(topic.id);
                        }}
                        title={
                          topic.name.trim().length > 0 ? topic.name : "Topic"
                        }
                        description="Quick Actions"
                        trigger={
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            className="border-border/80"
                            aria-label={`Open quick actions for ${topic.name}`}
                          >
                            <EllipsisVertical className="h-4 w-4" />
                          </Button>
                        }
                        actions={[
                          {
                            label: "Rename",
                            icon: <Pencil className="h-4 w-4" />,
                            onSelect: () => beginInlineRename(topic),
                            disabled:
                              topic.status === "ARCHIVED" ||
                              savingTopicId !== null,
                          },
                          {
                            label: "Back",
                            onSelect: () => {
                              if (
                                topic.status === "ARCHIVED" ||
                                topic.status === "TO_STUDY"
                              ) {
                                return;
                              }

                              void persistTopicStatus(
                                topic.id,
                                previousStatus(topic.status),
                              );
                            },
                            disabled:
                              savingTopicId !== null ||
                              topic.status === "TO_STUDY" ||
                              topic.status === "ARCHIVED",
                          },
                          {
                            label: "Forward",
                            onSelect: () => {
                              if (
                                topic.status === "ARCHIVED" ||
                                topic.status === "MASTERED"
                              ) {
                                return;
                              }

                              void persistTopicStatus(
                                topic.id,
                                nextStatus(topic.status),
                              );
                            },
                            disabled:
                              savingTopicId !== null ||
                              topic.status === "MASTERED" ||
                              topic.status === "ARCHIVED",
                          },
                          {
                            label: "Delete",
                            icon: <Trash2 className="h-4 w-4" />,
                            onSelect: () => {
                              void deleteTopic(topic);
                            },
                            destructive: true,
                            disabled: savingTopicId !== null,
                          },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() =>
                      topic.status === "ARCHIVED"
                        ? null
                        : void persistTopicStatus(
                            topic.id,
                            previousStatus(topic.status),
                          )
                    }
                    disabled={
                      savingTopicId !== null ||
                      topic.status === "TO_STUDY" ||
                      topic.status === "ARCHIVED"
                    }
                    className="w-full justify-center gap-2.5"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    size="lg"
                    onClick={() =>
                      topic.status === "ARCHIVED"
                        ? null
                        : void persistTopicStatus(
                            topic.id,
                            nextStatus(topic.status),
                          )
                    }
                    disabled={
                      savingTopicId !== null ||
                      topic.status === "MASTERED" ||
                      topic.status === "ARCHIVED"
                    }
                    className="w-full justify-center gap-2.5"
                  >
                    <ArrowRight className="h-4 w-4" />
                    Forward
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    onClick={() => {
                      void deleteTopic(topic);
                    }}
                    disabled={savingTopicId !== null}
                    className="w-full justify-center gap-2.5 sm:col-span-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Tracker</CardTitle>
        <CardDescription>
          Drag and drop topics between columns as your preparation evolves.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_0.7fr_0.9fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="new-topic-name">New Topic</Label>
              <Input
                id="new-topic-name"
                value={newTopicName}
                onChange={(event) => setNewTopicName(event.target.value)}
                placeholder="e.g., Gradient methods"
              />
            </div>

            <div className="space-y-2">
              <Label>Difficulty</Label>
              <Select
                value={newTopicDifficulty}
                onValueChange={setNewTopicDifficulty}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={newTopicStatus}
                onValueChange={(value) =>
                  setNewTopicStatus(value as MutableTopicStatusValue)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TO_STUDY">To Study</SelectItem>
                  <SelectItem value="REVIEW">Reviewing</SelectItem>
                  <SelectItem value="MASTERED">Mastered</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              onClick={createTopic}
              disabled={isCreatingTopic}
              className="md:mb-[1px]"
            >
              <Plus className="h-4 w-4" />
              {isCreatingTopic ? "Adding..." : "Add Topic"}
            </Button>
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="overflow-x-auto pb-1 md:overflow-visible">
          <div className="flex snap-x snap-mandatory gap-3 md:grid md:grid-cols-4 md:gap-4">
            {groupedTopics.map((column) => renderColumn(column))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
