import { revalidatePath } from "next/cache";
import {
  EnergyCurve,
  ExamIntensity,
  ExamStatus,
  TopicStatus,
} from "@prisma/client";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { addDays, startOfDay } from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  archiveCourse as archiveCourseAction,
  createCourse as createCourseAction,
} from "@/app/courses/actions";
import { updateExam as updateExamAction } from "@/app/exams/actions";
import { resolveDayCollision as resolveDayCollisionAction } from "@/app/calendar/actions";
import { updateCorePreferences } from "@/app/settings/actions";
import {
  detectStudyLoadCollisions,
  generateSmartSchedule,
  recalculateSchedule,
} from "@/lib/planning";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYSTEM_PROMPT = `Sei l'amministratore assoluto (God Mode) di StudyOS. Hai accesso a tutti i Tools per modificare, eliminare e creare dati nel database dell'utente.
Regole:
1. Se la richiesta dell'utente e vaga, chiedi conferma prima di usare Tools distruttivi (Delete o Mass Reschedule).
2. Se la richiesta e esplicita (es. 'Svuotami il calendario di domani'), ESEGUI immediatamente usando i Tools senza chiedere permesso, poi comunica cosa hai fatto.
3. Se l'utente ti chiede di organizzare un esame da zero, usa i Tools in sequenza: crea il corso, crea l'esame, genera i topic e schedulali.`;

const EPSILON = 0.001;

const requestSchema = z.object({
  messages: z.array(z.unknown()).min(1),
});

const dayTemplateSchema = z.object({
  monday: z.number().min(0).max(24).optional(),
  tuesday: z.number().min(0).max(24).optional(),
  wednesday: z.number().min(0).max(24).optional(),
  thursday: z.number().min(0).max(24).optional(),
  friday: z.number().min(0).max(24).optional(),
  saturday: z.number().min(0).max(24).optional(),
  sunday: z.number().min(0).max(24).optional(),
});

const createCourseInputSchema = z.object({
  name: z.string().min(2).max(120),
  credits: z.number().int().min(1).max(60),
  targetGrade: z.number().int().min(18).max(30).optional(),
});

const archiveCourseInputSchema = z.object({
  courseId: z.string().min(1),
});

const createExamInputSchema = z.object({
  courseId: z.string().min(1),
  name: z.string().min(2).max(120),
  examDate: z.string().min(1),
  difficulty: z.number().int().min(1).max(5).default(3),
  weight: z.number().positive().optional(),
  bufferDays: z.number().int().min(0).max(60).default(2),
  intensity: z.enum(["SIMPLE", "MEDIUM", "HARD"]).optional(),
  colorCode: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  earliestStartDate: z.string().optional(),
});

const updateExamParametersInputSchema = z
  .object({
    examId: z.string().min(1),
    date: z.string().optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    weight: z.number().positive().optional(),
  })
  .refine(
    (value) =>
      value.date !== undefined ||
      value.difficulty !== undefined ||
      value.weight !== undefined,
    {
      message: "At least one among date, difficulty, weight is required",
    },
  );

const deleteExamInputSchema = z.object({
  examId: z.string().min(1),
});

const addTopicsToCourseInputSchema = z.object({
  courseId: z.string().min(1),
  topics: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        importance: z.number().min(0.5).max(5),
      }),
    )
    .min(1)
    .max(200),
});

const updateTopicStateInputSchema = z.object({
  topicId: z.string().min(1),
  newState: z.enum(["ACTIVE", "MASTERED", "REVIEW", "ARCHIVED"]),
});

const rescheduleTopicInputSchema = z.object({
  topicId: z.string().min(1),
  newDate: z.string().min(1),
});

const clearDayAndPushInputSchema = z.object({
  date: z.string().min(1),
});

const resolveCollisionInputSchema = z.object({
  date: z.string().min(1),
});

const massOptimizeScheduleInputSchema = z.object({});

const updateUserSettingsInputSchema = z
  .object({
    pomodoroLength: z.number().int().min(15).max(120).optional(),
    shortBreakLength: z.number().int().min(3).max(30).optional(),
    longBreakLength: z.number().int().min(10).max(60).optional(),
    targetCFU: z.number().int().min(60).max(420).optional(),
    maxFocusMinutes: z.number().int().min(15).max(180).optional(),
    energyCurve: z.enum(["MORNING", "AFTERNOON", "NIGHT"]).optional(),
    weeklyHoursTemplate: dayTemplateSchema.optional(),
  })
  .refine(
    (value) =>
      value.pomodoroLength !== undefined ||
      value.shortBreakLength !== undefined ||
      value.longBreakLength !== undefined ||
      value.targetCFU !== undefined ||
      value.maxFocusMinutes !== undefined ||
      value.energyCurve !== undefined ||
      value.weeklyHoursTemplate !== undefined,
    {
      message: "At least one settings field is required",
    },
  );

function toIso(value: Date | null | undefined) {
  if (!value) return null;
  return value.toISOString();
}

function parseStartOfDayDate(value: string, fieldName: string) {
  const parsed = startOfDay(new Date(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  return parsed;
}

function parseDate(value: string, fieldName: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  return parsed;
}

function normalizeWeight(value: number | undefined) {
  if (value === undefined) return undefined;

  const normalized = value > 1 ? value / 100 : value;
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1) {
    throw new Error("weight must be between 0 and 1 (or 0-100 as percentage)");
  }

  return Math.round(normalized * 10000) / 10000;
}

function deriveIntensityFromDifficulty(difficulty: number) {
  if (difficulty <= 2) return ExamIntensity.SIMPLE;
  if (difficulty >= 4) return ExamIntensity.HARD;
  return ExamIntensity.MEDIUM;
}

function resolveGeminiApiKey() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";

  const looksLikePlaceholder =
    apiKey.length === 0 ||
    /^incolla-qui/i.test(apiKey) ||
    /^your[-_ ]?google[-_ ]?api[-_ ]?key$/i.test(apiKey);

  return {
    apiKey,
    looksLikePlaceholder,
  };
}

function resolveModelId() {
  const candidate =
    process.env.STUDY_ASSISTANT_MODEL?.trim() ??
    process.env.STUDY_COPILOT_MODEL?.trim();
  if (candidate && candidate.length > 0) {
    return candidate;
  }

  return "gemini-2.5-flash";
}

async function resolveUserId() {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return user.id;
}

function revalidateGodModePaths() {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/courses");
  revalidatePath("/exams");
  revalidatePath("/calendar");
  revalidatePath("/focus");
  revalidatePath("/archive");
  revalidatePath("/libretto");
  revalidatePath("/settings");
}

async function deleteExamForUser(userId: string, examId: string) {
  const normalizedExamId = examId.trim();

  const exam = await prisma.exam.findFirst({
    where: {
      id: normalizedExamId,
      userId,
    },
    select: {
      id: true,
      name: true,
      courseId: true,
      _count: {
        select: {
          topics: true,
          study_sessions: true,
        },
      },
    },
  });

  if (!exam) {
    throw new Error("Exam not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.exam.delete({
      where: {
        id: exam.id,
      },
    });

    if (!exam.courseId) {
      return;
    }

    const [remainingExamCount, remainingIncompleteExamCount] =
      await Promise.all([
        tx.exam.count({
          where: {
            userId,
            courseId: exam.courseId,
          },
        }),
        tx.exam.count({
          where: {
            userId,
            courseId: exam.courseId,
            status: {
              not: ExamStatus.COMPLETED,
            },
          },
        }),
      ]);

    await tx.course.updateMany({
      where: {
        id: exam.courseId,
        userId,
      },
      data: {
        isCompleted:
          remainingExamCount > 0 && remainingIncompleteExamCount === 0,
      },
    });
  });

  revalidateGodModePaths();

  return {
    ok: true,
    deleted: {
      id: exam.id,
      name: exam.name,
      topicsUnlinked: exam._count.topics,
      sessionsRemoved: exam._count.study_sessions,
    },
  };
}

async function addTopicsToCourseForUser(input: {
  userId: string;
  courseId: string;
  topics: Array<{ title: string; importance: number }>;
}) {
  const course = await prisma.course.findFirst({
    where: {
      id: input.courseId,
      userId: input.userId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!course) {
    throw new Error("Course not found");
  }

  const activeExams = await prisma.exam.findMany({
    where: {
      userId: input.userId,
      courseId: course.id,
      status: ExamStatus.ACTIVE,
    },
    select: {
      id: true,
      name: true,
    },
  });

  const existingTopics = await prisma.topic.findMany({
    where: {
      courseId: course.id,
    },
    select: {
      id: true,
      name: true,
    },
  });

  const existingNames = new Set(
    existingTopics.map((topic) => topic.name.trim().toLowerCase()),
  );
  const seenNames = new Set<string>();

  const payload = input.topics
    .map((topic) => ({
      title: topic.title.trim(),
      importance: Math.round(topic.importance * 100) / 100,
    }))
    .filter((topic) => topic.title.length > 0)
    .filter((topic) => {
      const key = topic.title.toLowerCase();
      if (existingNames.has(key) || seenNames.has(key)) {
        return false;
      }

      seenNames.add(key);
      return true;
    });

  const createdTopics = await prisma.$transaction(
    payload.map((topic) =>
      prisma.topic.create({
        data: {
          courseId: course.id,
          name: topic.title,
          difficulty_weight: topic.importance,
          status: TopicStatus.TO_STUDY,
          generated_by_ai: true,
          exams:
            activeExams.length > 0
              ? {
                  connect: activeExams.map((exam) => ({ id: exam.id })),
                }
              : undefined,
        },
        select: {
          id: true,
          name: true,
          difficulty_weight: true,
        },
      }),
    ),
  );

  const scheduleSettled = await Promise.allSettled(
    activeExams.map((exam) => recalculateSchedule(exam.id)),
  );

  const scheduleFailed = scheduleSettled
    .map((result, index) => ({ result, exam: activeExams[index] }))
    .filter((entry) => entry.result.status === "rejected")
    .map((entry) => ({
      examId: entry.exam.id,
      examName: entry.exam.name,
      message:
        entry.result.status === "rejected" &&
        entry.result.reason instanceof Error
          ? entry.result.reason.message
          : "Unknown scheduling error",
    }));

  revalidateGodModePaths();
  revalidatePath(`/courses/${course.id}`);

  for (const exam of activeExams) {
    revalidatePath(`/exam/${exam.id}`);
  }

  return {
    ok: true,
    course: {
      id: course.id,
      name: course.name,
    },
    createdCount: createdTopics.length,
    skippedCount: input.topics.length - createdTopics.length,
    createdTopics,
    connectedActiveExamCount: activeExams.length,
    schedulingFailures: scheduleFailed,
  };
}

function mapAssistantTopicState(
  state: "ACTIVE" | "MASTERED" | "REVIEW" | "ARCHIVED",
) {
  if (state === "ACTIVE") return TopicStatus.TO_STUDY;
  if (state === "REVIEW") return TopicStatus.REVIEW;
  if (state === "MASTERED") return TopicStatus.MASTERED;
  return TopicStatus.ARCHIVED;
}

async function updateTopicStateForUser(input: {
  userId: string;
  topicId: string;
  newState: "ACTIVE" | "MASTERED" | "REVIEW" | "ARCHIVED";
}) {
  const topic = await prisma.topic.findFirst({
    where: {
      id: input.topicId,
      OR: [
        {
          course: {
            userId: input.userId,
          },
        },
        {
          exams: {
            some: {
              userId: input.userId,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      courseId: true,
      status: true,
      exams: {
        where: {
          userId: input.userId,
          status: ExamStatus.ACTIVE,
        },
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!topic) {
    throw new Error("Topic not found");
  }

  const today = startOfDay(new Date());
  const status = mapAssistantTopicState(input.newState);

  const data: {
    status: TopicStatus;
    next_review?: Date | null;
    last_reviewed?: Date | null;
    interval_days?: number;
  } = {
    status,
  };

  if (status === TopicStatus.TO_STUDY) {
    data.next_review = today;
  }

  if (status === TopicStatus.REVIEW) {
    data.next_review = today;
    data.last_reviewed = today;
    data.interval_days = 1;
  }

  if (status === TopicStatus.MASTERED || status === TopicStatus.ARCHIVED) {
    data.next_review = null;
  }

  const updated = await prisma.topic.update({
    where: {
      id: topic.id,
    },
    data,
    select: {
      id: true,
      name: true,
      status: true,
      next_review: true,
      last_reviewed: true,
      interval_days: true,
    },
  });

  const scheduleSettled = await Promise.allSettled(
    topic.exams.map((exam) => recalculateSchedule(exam.id)),
  );

  const scheduleFailed = scheduleSettled
    .map((result, index) => ({ result, exam: topic.exams[index] }))
    .filter((entry) => entry.result.status === "rejected")
    .map((entry) => ({
      examId: entry.exam.id,
      examName: entry.exam.name,
      message:
        entry.result.status === "rejected" &&
        entry.result.reason instanceof Error
          ? entry.result.reason.message
          : "Unknown scheduling error",
    }));

  revalidateGodModePaths();

  if (topic.courseId) {
    revalidatePath(`/courses/${topic.courseId}`);
  }

  for (const exam of topic.exams) {
    revalidatePath(`/exam/${exam.id}`);
  }

  return {
    ok: true,
    topic: {
      id: updated.id,
      name: updated.name,
      status: updated.status,
      nextReview: toIso(updated.next_review),
      lastReviewed: toIso(updated.last_reviewed),
      intervalDays: updated.interval_days,
    },
    recalculatedExamCount: topic.exams.length,
    schedulingFailures: scheduleFailed,
  };
}

async function rescheduleTopicForUser(input: {
  userId: string;
  topicId: string;
  newDate: string;
}) {
  const targetDate = parseStartOfDayDate(input.newDate, "newDate");

  const session = await prisma.studySession.findFirst({
    where: {
      topicId: input.topicId,
      exam: {
        userId: input.userId,
        status: ExamStatus.ACTIVE,
      },
      is_completed: false,
      actual_hours: {
        lte: EPSILON,
      },
    },
    orderBy: {
      planned_date: "asc",
    },
    select: {
      id: true,
      examId: true,
      planned_date: true,
      exam: {
        select: {
          id: true,
          name: true,
          exam_date: true,
        },
      },
      topic: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!session) {
    throw new Error("No schedulable session found for this topic");
  }

  if (targetDate.getTime() > startOfDay(session.exam.exam_date).getTime()) {
    throw new Error("newDate cannot be after the exam date");
  }

  const updated = await prisma.studySession.update({
    where: {
      id: session.id,
    },
    data: {
      planned_date: targetDate,
    },
    select: {
      id: true,
      examId: true,
      topicId: true,
      planned_date: true,
      exam: {
        select: {
          id: true,
          name: true,
          exam_date: true,
        },
      },
      topic: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  revalidateGodModePaths();
  revalidatePath(`/exam/${updated.exam.id}`);

  return {
    ok: true,
    movedSession: {
      id: updated.id,
      examId: updated.examId,
      topicId: updated.topicId,
      topicName: updated.topic?.name ?? "N/A",
      examName: updated.exam.name,
      previousDate: toIso(startOfDay(session.planned_date)),
      newDate: toIso(updated.planned_date),
      examDate: toIso(updated.exam.exam_date),
    },
  };
}

async function clearDayAndPushForUser(input: { userId: string; date: string }) {
  const targetDate = parseStartOfDayDate(input.date, "date");
  const nextDay = addDays(targetDate, 1);

  const sessions = await prisma.studySession.findMany({
    where: {
      exam: {
        userId: input.userId,
        status: ExamStatus.ACTIVE,
      },
      planned_date: {
        gte: targetDate,
        lt: nextDay,
      },
      is_completed: false,
      actual_hours: {
        lte: EPSILON,
      },
    },
    select: {
      id: true,
      examId: true,
    },
  });

  const examIds = Array.from(
    new Set(sessions.map((session) => session.examId)),
  );

  if (examIds.length === 0) {
    return {
      ok: true,
      date: toIso(targetDate),
      affectedExams: 0,
      affectedSessions: 0,
      recalculated: [],
      message: "No pending sessions found on the selected day",
    };
  }

  const exams = await prisma.exam.findMany({
    where: {
      id: {
        in: examIds,
      },
      userId: input.userId,
      status: ExamStatus.ACTIVE,
    },
    select: {
      id: true,
      name: true,
    },
  });

  const settled = await Promise.allSettled(
    exams.map((exam) =>
      recalculateSchedule(exam.id, {
        referenceDate: targetDate,
        blockedDays: 1,
      }),
    ),
  );

  const recalculated = settled
    .map((result, index) => ({ result, exam: exams[index] }))
    .filter((entry) => entry.result.status === "fulfilled")
    .map((entry) => ({
      examId: entry.exam.id,
      examName: entry.exam.name,
      sessionsCreated:
        entry.result.status === "fulfilled"
          ? entry.result.value.sessionsCreated
          : 0,
      missingHours:
        entry.result.status === "fulfilled"
          ? entry.result.value.missingHours
          : 0,
    }));

  const failed = settled
    .map((result, index) => ({ result, exam: exams[index] }))
    .filter((entry) => entry.result.status === "rejected")
    .map((entry) => ({
      examId: entry.exam.id,
      examName: entry.exam.name,
      message:
        entry.result.status === "rejected" &&
        entry.result.reason instanceof Error
          ? entry.result.reason.message
          : "Unknown scheduling error",
    }));

  revalidateGodModePaths();

  for (const exam of exams) {
    revalidatePath(`/exam/${exam.id}`);
  }

  return {
    ok: true,
    date: toIso(targetDate),
    affectedExams: exams.length,
    affectedSessions: sessions.length,
    recalculated,
    failed,
  };
}

async function massOptimizeScheduleForUser(userId: string) {
  const today = startOfDay(new Date());
  const horizonEnd = addDays(today, 30);

  const collisionsBefore = await detectStudyLoadCollisions(userId, {
    referenceDate: today,
  });

  const exams = await prisma.exam.findMany({
    where: {
      userId,
      status: ExamStatus.ACTIVE,
      exam_date: {
        gte: today,
        lte: horizonEnd,
      },
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      exam_date: "asc",
    },
  });

  const settled = await Promise.allSettled(
    exams.map((exam) =>
      recalculateSchedule(exam.id, {
        referenceDate: today,
      }),
    ),
  );

  const optimized = settled
    .map((result, index) => ({ result, exam: exams[index] }))
    .filter((entry) => entry.result.status === "fulfilled")
    .map((entry) => ({
      examId: entry.exam.id,
      examName: entry.exam.name,
      sessionsCreated:
        entry.result.status === "fulfilled"
          ? entry.result.value.sessionsCreated
          : 0,
      missingHours:
        entry.result.status === "fulfilled"
          ? entry.result.value.missingHours
          : 0,
    }));

  const failed = settled
    .map((result, index) => ({ result, exam: exams[index] }))
    .filter((entry) => entry.result.status === "rejected")
    .map((entry) => ({
      examId: entry.exam.id,
      examName: entry.exam.name,
      message:
        entry.result.status === "rejected" &&
        entry.result.reason instanceof Error
          ? entry.result.reason.message
          : "Unknown scheduling error",
    }));

  const collisionsAfter = await detectStudyLoadCollisions(userId, {
    referenceDate: today,
  });

  revalidateGodModePaths();

  for (const exam of exams) {
    revalidatePath(`/exam/${exam.id}`);
  }

  return {
    ok: true,
    optimizedCount: optimized.length,
    failedCount: failed.length,
    optimized,
    failed,
    collisionsBefore: collisionsBefore.length,
    collisionsAfter: collisionsAfter.length,
  };
}

const tools = {
  createCourse: tool({
    description:
      "Crea un nuovo corso (omnipotenza corsi). targetGrade viene accettato ma non e persistito nello schema corrente.",
    inputSchema: createCourseInputSchema,
    execute: async ({ name, credits, targetGrade }) => {
      const result = await createCourseAction({
        name,
        cfu: credits,
        isPassFail: false,
      });

      return {
        ...result,
        targetGradeReceived: targetGrade ?? null,
        targetGradePersisted: false,
      };
    },
  }),

  archiveCourse: tool({
    description: "Archivia un corso e i suoi esami attivi.",
    inputSchema: archiveCourseInputSchema,
    execute: async ({ courseId }) => {
      return archiveCourseAction(courseId.trim());
    },
  }),

  createExam: tool({
    description:
      "Crea un esame collegato a un corso e genera immediatamente la pianificazione smart.",
    inputSchema: createExamInputSchema,
    execute: async ({
      courseId,
      name,
      examDate,
      difficulty,
      weight,
      bufferDays,
      intensity,
      colorCode,
      earliestStartDate,
    }) => {
      const userId = await resolveUserId();
      const parsedExamDate = parseDate(examDate, "examDate");

      const course = await prisma.course.findFirst({
        where: {
          id: courseId.trim(),
          userId,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (!course) {
        throw new Error("Course not found");
      }

      const normalizedWeight = normalizeWeight(weight) ?? 1;
      const resolvedIntensity =
        intensity !== undefined
          ? ExamIntensity[intensity]
          : deriveIntensityFromDifficulty(difficulty);

      const exam = await prisma.exam.create({
        data: {
          name: name.trim(),
          userId,
          courseId: course.id,
          exam_date: parsedExamDate,
          difficulty,
          intensity: resolvedIntensity,
          buffer_days: bufferDays,
          weight: normalizedWeight,
          ...(colorCode ? { color_code: colorCode } : {}),
        },
        select: {
          id: true,
          name: true,
          exam_date: true,
          difficulty: true,
          intensity: true,
          buffer_days: true,
          weight: true,
          courseId: true,
        },
      });

      if (earliestStartDate) {
        const parsedEarliest = parseDate(
          earliestStartDate,
          "earliestStartDate",
        );
        await prisma.examPlanningPreference.upsert({
          where: {
            examId: exam.id,
          },
          update: {
            earliest_start_date: parsedEarliest,
          },
          create: {
            examId: exam.id,
            earliest_start_date: parsedEarliest,
          },
        });
      }

      const schedule = await generateSmartSchedule(exam.id, {
        includeProgress: false,
        preserveLoggedSessions: false,
        dryRun: false,
      });

      revalidateGodModePaths();
      revalidatePath(`/courses/${course.id}`);
      revalidatePath(`/exam/${exam.id}`);

      return {
        ok: true,
        exam: {
          id: exam.id,
          name: exam.name,
          examDate: toIso(exam.exam_date),
          difficulty: exam.difficulty,
          intensity: exam.intensity,
          bufferDays: exam.buffer_days,
          weight: exam.weight,
          courseId: exam.courseId,
        },
        schedule: {
          success: schedule.success,
          message: schedule.message,
          sessionsCreated: schedule.sessionsCreated,
          missingHours: schedule.missingHours,
          warnings: schedule.warnings,
        },
      };
    },
  }),

  updateExamParameters: tool({
    description:
      "Aggiorna parametri core di un esame esistente (data, difficolta, peso).",
    inputSchema: updateExamParametersInputSchema,
    execute: async ({ examId, date, difficulty, weight }) => {
      return updateExamAction({
        examId: examId.trim(),
        examDate: date,
        difficulty,
        weight: normalizeWeight(weight),
      });
    },
  }),

  deleteExam: tool({
    description: "Elimina definitivamente un esame (azione distruttiva).",
    inputSchema: deleteExamInputSchema,
    execute: async ({ examId }) => {
      const userId = await resolveUserId();
      return deleteExamForUser(userId, examId);
    },
  }),

  addTopicsToCourse: tool({
    description:
      "Inserisce in massa topic in un corso e li connette agli esami attivi del corso.",
    inputSchema: addTopicsToCourseInputSchema,
    execute: async ({ courseId, topics }) => {
      const userId = await resolveUserId();
      return addTopicsToCourseForUser({
        userId,
        courseId: courseId.trim(),
        topics,
      });
    },
  }),

  updateTopicState: tool({
    description:
      "Aggiorna lo stato triage di un topic. ACTIVE viene mappato a TO_STUDY.",
    inputSchema: updateTopicStateInputSchema,
    execute: async ({ topicId, newState }) => {
      const userId = await resolveUserId();
      return updateTopicStateForUser({
        userId,
        topicId: topicId.trim(),
        newState,
      });
    },
  }),

  rescheduleTopic: tool({
    description:
      "Sposta la prossima sessione pianificata del topic alla nuova data.",
    inputSchema: rescheduleTopicInputSchema,
    execute: async ({ topicId, newDate }) => {
      const userId = await resolveUserId();
      return rescheduleTopicForUser({
        userId,
        topicId: topicId.trim(),
        newDate,
      });
    },
  }),

  clearDayAndPush: tool({
    description:
      "Svuota operativamente un giorno bloccandolo e ripianificando in avanti con algoritmo Just-in-Time.",
    inputSchema: clearDayAndPushInputSchema,
    execute: async ({ date }) => {
      const userId = await resolveUserId();
      return clearDayAndPushForUser({ userId, date });
    },
  }),

  resolveCollision: tool({
    description:
      "Utilizza questo strumento quando l'utente segnala una collisione o un sovraccarico in una data specifica o quando l'algoritmo rileva un errore di collisione. Lo strumento sposta automaticamente i task in eccesso per bilanciare il carico.",
    inputSchema: resolveCollisionInputSchema,
    execute: async ({ date }) => {
      const parsedDate = parseDate(date, "date");
      return resolveDayCollisionAction(parsedDate);
    },
  }),

  massOptimizeSchedule: tool({
    description:
      "Ottimizza in massa la pianificazione dei prossimi 30 giorni (capacity engine).",
    inputSchema: massOptimizeScheduleInputSchema,
    execute: async () => {
      const userId = await resolveUserId();
      return massOptimizeScheduleForUser(userId);
    },
  }),

  updateUserSettings: tool({
    description:
      "Aggiorna impostazioni globali utente (pomodoro, target CFU, curva energia, template settimanale).",
    inputSchema: updateUserSettingsInputSchema,
    execute: async ({
      pomodoroLength,
      shortBreakLength,
      longBreakLength,
      targetCFU,
      maxFocusMinutes,
      energyCurve,
      weeklyHoursTemplate,
    }) => {
      const user = await prisma.user.findFirst({
        select: {
          id: true,
          max_focus_minutes: true,
          pomodoro_focus_minutes: true,
          pomodoro_short_break_minutes: true,
          pomodoro_long_break_minutes: true,
          degree_target_cfu: true,
          energy_curve: true,
          weekly_hours_template: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      const hasCoreSettingsMutation =
        pomodoroLength !== undefined ||
        shortBreakLength !== undefined ||
        longBreakLength !== undefined ||
        targetCFU !== undefined;

      if (hasCoreSettingsMutation) {
        const formData = new FormData();

        formData.set(
          "pomodoroFocusMinutes",
          String(pomodoroLength ?? user.pomodoro_focus_minutes),
        );
        formData.set(
          "pomodoroShortBreakMinutes",
          String(shortBreakLength ?? user.pomodoro_short_break_minutes),
        );
        formData.set(
          "pomodoroLongBreakMinutes",
          String(longBreakLength ?? user.pomodoro_long_break_minutes),
        );
        formData.set(
          "degreeTargetCfu",
          String(targetCFU ?? user.degree_target_cfu),
        );

        await updateCorePreferences(formData);
      }

      const extraUpdateData: {
        max_focus_minutes?: number;
        energy_curve?: EnergyCurve;
        weekly_hours_template?: Record<string, number>;
      } = {};

      if (maxFocusMinutes !== undefined) {
        extraUpdateData.max_focus_minutes = maxFocusMinutes;
      }

      if (energyCurve !== undefined) {
        extraUpdateData.energy_curve = EnergyCurve[energyCurve];
      }

      if (weeklyHoursTemplate !== undefined) {
        const currentTemplateRaw =
          user.weekly_hours_template &&
          typeof user.weekly_hours_template === "object"
            ? (user.weekly_hours_template as Record<string, unknown>)
            : {};

        extraUpdateData.weekly_hours_template = {
          monday:
            weeklyHoursTemplate.monday ??
            Number(currentTemplateRaw.monday ?? 2) ??
            2,
          tuesday:
            weeklyHoursTemplate.tuesday ??
            Number(currentTemplateRaw.tuesday ?? 2) ??
            2,
          wednesday:
            weeklyHoursTemplate.wednesday ??
            Number(currentTemplateRaw.wednesday ?? 2) ??
            2,
          thursday:
            weeklyHoursTemplate.thursday ??
            Number(currentTemplateRaw.thursday ?? 2) ??
            2,
          friday:
            weeklyHoursTemplate.friday ??
            Number(currentTemplateRaw.friday ?? 2) ??
            2,
          saturday:
            weeklyHoursTemplate.saturday ??
            Number(currentTemplateRaw.saturday ?? 4) ??
            4,
          sunday:
            weeklyHoursTemplate.sunday ??
            Number(currentTemplateRaw.sunday ?? 0) ??
            0,
        };
      }

      if (Object.keys(extraUpdateData).length > 0) {
        await prisma.user.update({
          where: {
            id: user.id,
          },
          data: extraUpdateData,
        });
      }

      revalidateGodModePaths();

      return {
        ok: true,
        updated: {
          pomodoroLength: pomodoroLength ?? null,
          shortBreakLength: shortBreakLength ?? null,
          longBreakLength: longBreakLength ?? null,
          targetCFU: targetCFU ?? null,
          maxFocusMinutes: maxFocusMinutes ?? null,
          energyCurve: energyCurve ?? null,
          weeklyHoursTemplate: weeklyHoursTemplate ?? null,
        },
      };
    },
  }),
};

export async function POST(request: Request) {
  try {
    const { looksLikePlaceholder } = resolveGeminiApiKey();
    if (looksLikePlaceholder) {
      return NextResponse.json(
        {
          error:
            "GOOGLE_GENERATIVE_AI_API_KEY non configurata correttamente. Inserisci una chiave reale di Google AI Studio.",
        },
        { status: 500 },
      );
    }

    const rawBody = (await request.json().catch(() => null)) as unknown;
    const parsedBody = requestSchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Payload assistant non valido: messages obbligatorio.",
        },
        { status: 400 },
      );
    }

    const modelMessages = await convertToModelMessages(
      parsedBody.data.messages as Array<UIMessage>,
    );

    const maxSteps = 10;

    const result = streamText({
      model: google(resolveModelId()),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(maxSteps),
      temperature: 0.2,
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("StudyOS God Mode stream error:", error);
        return "Errore durante la generazione della risposta dell'assistente.";
      },
    });
  } catch (error) {
    console.error("Failed to handle /api/assistant request:", error);

    return NextResponse.json(
      {
        error: "Impossibile completare la richiesta dell'assistente.",
      },
      { status: 500 },
    );
  }
}
