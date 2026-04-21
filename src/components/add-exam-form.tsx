"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Plus, Sparkles, Trash2 } from "lucide-react";
import { z } from "zod";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const syllabusClientSchema = z.object({
  examTitle: z.string().min(3).max(120),
  estimatedCfu: z.number().int().min(1).max(30),
  cfuSource: z.enum(["EXPLICIT", "INFERRED"]),
  topics: z
    .array(
      z.object({
        name: z.string().min(2).max(140),
        difficulty: z.number().int().min(1).max(5),
      }),
    )
    .min(3)
    .max(120),
});

type SyllabusDraft = z.infer<typeof syllabusClientSchema>;

type CourseTopicOption = {
  id: string;
  name: string;
  difficulty_weight: number;
  status: "TO_STUDY" | "REVIEW" | "MASTERED" | "ARCHIVED";
};

type ExistingCourseOption = {
  id: string;
  name: string;
  topics: CourseTopicOption[];
};

type AddExamFormProps = {
  userId: string | null;
  courses: ExistingCourseOption[];
};

const MIN_STUDY_DAYS_BY_INTENSITY = {
  SIMPLE: 7,
  MEDIUM: 14,
  HARD: 21,
} as const;

function clampDifficulty(value: number) {
  return Math.min(5, Math.max(1, Math.round(value)));
}

function intensityFromDifficulty(value: number): "SIMPLE" | "MEDIUM" | "HARD" {
  const normalized = clampDifficulty(value);
  if (normalized <= 2) return "SIMPLE";
  if (normalized >= 4) return "HARD";
  return "MEDIUM";
}

function defaultDifficultyFromIntensity(value: "SIMPLE" | "MEDIUM" | "HARD") {
  if (value === "SIMPLE") return 2;
  if (value === "HARD") return 4;
  return 3;
}

function parseWeightPercentInput(value: string): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

const TOPIC_STATUS_LABEL: Record<CourseTopicOption["status"], string> = {
  TO_STUDY: "To Study",
  REVIEW: "Review",
  MASTERED: "Mastered",
  ARCHIVED: "Archived",
};

export function AddExamForm({ userId, courses }: AddExamFormProps) {
  type TopicStatusValue = "TO_STUDY" | "REVIEW" | "MASTERED";
  type IntensityValue = "SIMPLE" | "MEDIUM" | "HARD";
  type DraftTopic = {
    name: string;
    difficulty_weight: number;
    status: TopicStatusValue;
  };
  type SetupSource = "MANUAL" | "AI_SYLLABUS";

  const router = useRouter();
  const [date, setDate] = useState<Date>();
  const [examName, setExamName] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(
    courses[0]?.id ?? "",
  );
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [examWeight, setExamWeight] = useState("100");
  const [colorCode, setColorCode] = useState("#3B82F6");
  const [difficulty, setDifficulty] = useState("3");
  const [intensity, setIntensity] = useState<IntensityValue>("MEDIUM");
  const [bufferDays, setBufferDays] = useState("2");
  const [syllabusText, setSyllabusText] = useState("");
  const [setupSource, setSetupSource] = useState<SetupSource>("MANUAL");
  const [isLoading, setIsLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiDetectedTopics, setAiDetectedTopics] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [topics, setTopics] = useState<DraftTopic[]>([]);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );

  const selectedCourseTopics = useMemo(
    () => selectedCourse?.topics ?? [],
    [selectedCourse],
  );

  useEffect(() => {
    if (!selectedCourseId && courses[0]?.id) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, selectedCourseId]);

  useEffect(() => {
    setSelectedTopicIds((current) =>
      current.filter((topicId) =>
        selectedCourseTopics.some((topic) => topic.id === topicId),
      ),
    );
  }, [selectedCourseTopics]);

  const toggleExistingTopic = (topicId: string, isChecked: boolean) => {
    setSelectedTopicIds((current) => {
      if (isChecked) {
        if (current.includes(topicId)) return current;
        return [...current, topicId];
      }

      return current.filter((id) => id !== topicId);
    });
  };

  const updateTopic = <K extends keyof DraftTopic>(
    index: number,
    field: K,
    value: DraftTopic[K],
  ) => {
    setTopics((current) =>
      current.map((topic, i) =>
        i === index
          ? {
              ...topic,
              [field]: value,
            }
          : topic,
      ),
    );
  };

  const addTopicRow = () => {
    setTopics((current) => [
      ...current,
      {
        name: "",
        difficulty_weight: 3,
        status: "TO_STUDY",
      },
    ]);
  };

  const removeTopicRow = (index: number) => {
    setTopics((current) => current.filter((_, i) => i !== index));
  };

  const normalizeAiTopics = (draft: SyllabusDraft) => {
    return draft.topics
      .map((topic) => ({
        name: topic.name.trim(),
        difficulty_weight: topic.difficulty,
        status: "TO_STUDY" as TopicStatusValue,
      }))
      .filter((topic) => topic.name.length > 0);
  };

  const createExam = async (
    data: Record<string, unknown>,
    successMessage: string,
    redirectDelayMs = 2000,
  ) => {
    const response = await fetch("/api/exams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      warning?: string;
    };

    if (!response.ok) {
      throw new Error(result.error || "Failed to create exam");
    }

    if (result.warning) {
      setWarning(result.warning);
    }

    setSuccess(successMessage);
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, redirectDelayMs);
  };

  const submitAiExam = async (draft: SyllabusDraft, rawSyllabus: string) => {
    if (!userId) {
      throw new Error("User profile not found.");
    }

    if (!date) {
      throw new Error("Please select an exam date before AI auto-save.");
    }

    if (!selectedCourseId) {
      throw new Error("Please select a course before AI auto-save.");
    }

    const normalizedTopics = normalizeAiTopics(draft);
    if (normalizedTopics.length === 0) {
      throw new Error("AI returned no valid topics.");
    }

    const avgDifficulty =
      normalizedTopics.reduce(
        (sum, topic) => sum + topic.difficulty_weight,
        0,
      ) / normalizedTopics.length;

    const parsedBufferDays = Number(bufferDays);
    const safeBufferDays =
      Number.isInteger(parsedBufferDays) && parsedBufferDays >= 1
        ? parsedBufferDays
        : 2;

    const parsedWeightPercent = parseWeightPercentInput(examWeight);
    if (parsedWeightPercent === null) {
      throw new Error("Exam weight must be between 0 and 100.");
    }

    await createExam(
      {
        name: draft.examTitle.trim(),
        courseId: selectedCourseId,
        topicIds: selectedTopicIds,
        weight: parsedWeightPercent,
        color_code: colorCode,
        difficulty: clampDifficulty(avgDifficulty),
        intensity: intensityFromDifficulty(avgDifficulty),
        exam_date: date,
        buffer_days: safeBufferDays,
        setup_source: "AI_SYLLABUS",
        syllabus_raw: rawSyllabus,
        topics: normalizedTopics.map((topic) => ({
          ...topic,
          generated_by_ai: true,
        })),
        userId,
      },
      "Exam created automatically from syllabus. Redirecting to dashboard...",
      1800,
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setWarning(null);
    setSuccess(null);

    if (!date) {
      setError("Please select an exam date.");
      setIsLoading(false);
      return;
    }

    if (!userId) {
      setError("User profile not found.");
      setIsLoading(false);
      return;
    }

    if (!selectedCourseId) {
      setError("Please select an existing course.");
      setIsLoading(false);
      return;
    }

    const preparedTopics = topics
      .map((topic) => ({
        ...topic,
        name: topic.name.trim(),
      }))
      .filter((topic) => topic.name.length > 0);

    const fallbackDifficulty = defaultDifficultyFromIntensity(intensity);
    const parsedDifficulty =
      difficulty.trim().length === 0
        ? fallbackDifficulty
        : Number(difficulty.trim());
    if (
      !Number.isInteger(parsedDifficulty) ||
      parsedDifficulty < 1 ||
      parsedDifficulty > 5
    ) {
      setError("Difficulty must be between 1 and 5.");
      setIsLoading(false);
      return;
    }

    const parsedBufferDays =
      bufferDays.trim().length === 0 ? 2 : Number(bufferDays.trim());
    if (
      !Number.isInteger(parsedBufferDays) ||
      parsedBufferDays < 0 ||
      parsedBufferDays > 60
    ) {
      setError("Buffer days must be an integer between 0 and 60.");
      setIsLoading(false);
      return;
    }

    const parsedWeightPercent = parseWeightPercentInput(examWeight);
    if (parsedWeightPercent === null) {
      setError("Exam weight must be between 0 and 100.");
      setIsLoading(false);
      return;
    }

    const data = {
      name: examName.trim(),
      courseId: selectedCourseId,
      topicIds: selectedTopicIds,
      weight: parsedWeightPercent,
      color_code: colorCode,
      difficulty: parsedDifficulty,
      intensity,
      exam_date: date,
      buffer_days: parsedBufferDays,
      setup_source: setupSource,
      syllabus_raw:
        setupSource === "AI_SYLLABUS" ? syllabusText.trim() : undefined,
      topics: preparedTopics.map((topic) => ({
        ...topic,
        generated_by_ai: setupSource === "AI_SYLLABUS",
      })),
      userId,
    };

    try {
      await createExam(
        data,
        "Exam created successfully. Redirecting to dashboard...",
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create exam");
    } finally {
      setIsLoading(false);
    }
  };

  const runAiSetup = async () => {
    setError(null);
    setWarning(null);
    setSuccess(null);

    if (!date) {
      setError("Please select an exam date before scanning the syllabus.");
      return;
    }

    if (!selectedCourseId) {
      setError(
        "Please select an existing course before scanning the syllabus.",
      );
      return;
    }

    const trimmedSyllabus = syllabusText.trim();
    if (trimmedSyllabus.length < 60) {
      setError("Paste a richer syllabus (at least 60 characters).");
      return;
    }

    setIsAiLoading(true);

    try {
      const response = await fetch("/api/scan-syllabus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          syllabusText: trimmedSyllabus,
        }),
      });

      const rawResult = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(rawResult.error || "Unable to analyze syllabus.");
      }

      const parsedDraft = syllabusClientSchema.safeParse(rawResult);
      if (!parsedDraft.success) {
        throw new Error("AI returned an invalid syllabus structure.");
      }

      const draft = parsedDraft.data;
      const normalizedTopics = normalizeAiTopics(draft);

      if (normalizedTopics.length === 0) {
        throw new Error("AI returned no valid topics.");
      }

      const avgDifficulty =
        normalizedTopics.reduce(
          (sum, topic) => sum + topic.difficulty_weight,
          0,
        ) / normalizedTopics.length;

      setExamName(draft.examTitle);
      setDifficulty(String(clampDifficulty(avgDifficulty)));
      setIntensity(intensityFromDifficulty(avgDifficulty));
      setTopics(normalizedTopics);
      setSetupSource("AI_SYLLABUS");
      setAiDetectedTopics(normalizedTopics.length);

      await submitAiExam(draft, trimmedSyllabus);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to analyze syllabus right now.",
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Add a New Exam</CardTitle>
        <CardDescription>
          Fill in the details below to generate a new study plan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Auto-Setup Esame (AI)</h3>
                <p className="text-xs text-muted-foreground">
                  Incolla il syllabus e genera automaticamente titolo e topics.
                  Al termine, l&apos;esame viene salvato subito nel database.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={runAiSetup}
                disabled={isAiLoading || !userId || !selectedCourseId}
              >
                <Sparkles className="h-4 w-4" />
                {isAiLoading ? "Analyzing..." : "Scan + Auto-Save"}
              </Button>
            </div>

            <textarea
              value={syllabusText}
              onChange={(event) => setSyllabusText(event.target.value)}
              placeholder="Paste the full exam program here..."
              className="min-h-36 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />

            <p className="text-xs text-muted-foreground">
              Setup mode: {setupSource === "AI_SYLLABUS" ? "AI" : "Manual"}
              {aiDetectedTopics > 0
                ? ` • AI detected ${aiDetectedTopics} topic(s)`
                : ""}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Exam Name</Label>
            <Input
              id="name"
              name="name"
              value={examName}
              onChange={(event) => setExamName(event.target.value)}
              placeholder="e.g., Analysis I"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="course_id">Course</Label>
              <Select
                value={selectedCourseId}
                onValueChange={setSelectedCourseId}
                disabled={courses.length === 0}
              >
                <SelectTrigger id="course_id">
                  <SelectValue placeholder="Select an existing course" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select one of your existing courses.
              </p>
              {courses.length === 0 ? (
                <p className="text-xs text-amber-500">
                  No courses available. Create one from{" "}
                  <Link href="/courses" className="underline">
                    Courses
                  </Link>{" "}
                  before adding an exam.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam_weight">Exam Weight (%)</Label>
              <Input
                id="exam_weight"
                name="exam_weight"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={examWeight}
                onChange={(event) => setExamWeight(event.target.value)}
                placeholder="100"
              />
              <p className="text-xs text-muted-foreground">
                Example: 30 means this exam contributes 30% to the final course
                grade.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="color_code">Color</Label>
            <Input
              id="color_code"
              name="color_code"
              type="color"
              value={colorCode}
              onChange={(event) => setColorCode(event.target.value)}
              className="h-11 w-24 p-1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="difficulty">Difficulty Level</Label>
            <Select
              name="difficulty"
              value={difficulty}
              onValueChange={setDifficulty}
            >
              <SelectTrigger>
                <SelectValue placeholder="Default from intensity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 (Very Easy)</SelectItem>
                <SelectItem value="2">2 (Easy)</SelectItem>
                <SelectItem value="3">3 (Medium)</SelectItem>
                <SelectItem value="4">4 (Hard)</SelectItem>
                <SelectItem value="5">5 (Very Hard)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intensity">Study Intensity</Label>
            <Select
              name="intensity"
              value={intensity}
              onValueChange={(value) => setIntensity(value as IntensityValue)}
            >
              <SelectTrigger id="intensity">
                <SelectValue placeholder="Select intensity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SIMPLE">
                  Semplice (min 7 giorni pre-buffer)
                </SelectItem>
                <SelectItem value="MEDIUM">
                  Medio (min 14 giorni pre-buffer)
                </SelectItem>
                <SelectItem value="HARD">
                  Difficile (min 21 giorni pre-buffer)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              L&apos;algoritmo Ghost pianifica almeno{" "}
              {MIN_STUDY_DAYS_BY_INTENSITY[intensity]} giorno/i generici prima
              del buffer.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="exam_date">Exam Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !date && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="buffer_days">Buffer Days</Label>
              <Input
                id="buffer_days"
                name="buffer_days"
                type="number"
                value={bufferDays}
                onChange={(event) => setBufferDays(event.target.value)}
                placeholder="e.g., 7"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Course Topics</h3>
                <p className="text-xs text-muted-foreground">
                  Seleziona i topic esistenti del corso da collegare a questo
                  esame.
                </p>
              </div>
            </div>

            {selectedCourse ? (
              selectedCourseTopics.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                  Questo corso non ha ancora topic esistenti.
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedCourseTopics.map((topic) => (
                    <label
                      key={topic.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-background px-3 py-2"
                    >
                      <Checkbox
                        checked={selectedTopicIds.includes(topic.id)}
                        onCheckedChange={(checked) =>
                          toggleExistingTopic(topic.id, checked === true)
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {topic.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Difficulty {topic.difficulty_weight} •{" "}
                          {TOPIC_STATUS_LABEL[topic.status]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                Seleziona prima un corso per vedere i topic disponibili.
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Selected existing topics: {selectedTopicIds.length}
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">New Topics (optional)</h3>
                <p className="text-xs text-muted-foreground">
                  I nuovi topic verranno creati nel corso selezionato e
                  collegati anche all&apos;esame.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={addTopicRow}
                className="shrink-0"
                disabled={!selectedCourseId}
              >
                <Plus className="h-4 w-4" />
                Add Topic
              </Button>
            </div>

            <div className="space-y-3">
              {topics.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                  Nessun topic inserito: verranno create sessioni generiche di
                  studio, sostituite automaticamente quando aggiungerai il primo
                  topic.
                </div>
              ) : null}

              {topics.map((topic, index) => (
                <div
                  key={`topic-${index}`}
                  className="rounded-lg border border-border/70 bg-background p-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.6fr_0.7fr_1fr_auto] sm:items-end">
                    <div className="space-y-2">
                      <Label>Topic Name</Label>
                      <Input
                        value={topic.name}
                        onChange={(event) =>
                          updateTopic(index, "name", event.target.value)
                        }
                        placeholder="e.g., Integrali doppi"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Difficulty</Label>
                      <Select
                        value={String(topic.difficulty_weight)}
                        onValueChange={(value) =>
                          updateTopic(index, "difficulty_weight", Number(value))
                        }
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
                        value={topic.status}
                        onValueChange={(value) =>
                          updateTopic(
                            index,
                            "status",
                            value as TopicStatusValue,
                          )
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
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTopicRow(index)}
                      aria-label={`Remove topic ${index + 1}`}
                      className="justify-self-end"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !userId || !selectedCourseId}
          >
            {isLoading ? "Generating Plan..." : "Add Exam and Generate Plan"}
          </Button>

          {error && <p className="text-sm text-red-500 mt-4">{error}</p>}
          {warning && <p className="text-sm text-yellow-500 mt-4">{warning}</p>}
          {success && <p className="text-sm text-green-600 mt-4">{success}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
