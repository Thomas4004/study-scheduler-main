import { NextRequest, NextResponse } from "next/server";
import { ExamIntensity, ExamSetupSource, TopicStatus } from "@prisma/client";

import prisma from "@/lib/prisma";
import { generateSmartSchedule } from "@/lib/planning";
import { isMissingTableError } from "@/lib/prisma-compat";

function normalizeColorCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return undefined;
}

type InputTopic = {
  name: string;
  difficulty_weight: number;
  status: TopicStatus;
  generated_by_ai: boolean;
};

const PLACEHOLDER_COURSE_CFU = 6;

function parseTopicIds(value: unknown): {
  topicIds: string[];
  error?: string;
} {
  if (value === undefined || value === null) {
    return {
      topicIds: [],
    };
  }

  if (!Array.isArray(value)) {
    return {
      topicIds: [],
      error: "topicIds must be an array",
    };
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    topicIds: Array.from(new Set(normalized)),
  };
}

function normalizeSetupSource(value: unknown): ExamSetupSource {
  if (typeof value !== "string") return ExamSetupSource.MANUAL;

  const raw = value.trim().toUpperCase();
  if (raw === "AI_SYLLABUS") {
    return ExamSetupSource.AI_SYLLABUS;
  }

  return ExamSetupSource.MANUAL;
}

function normalizeIntensity(value: unknown): ExamIntensity {
  if (typeof value !== "string") return ExamIntensity.MEDIUM;

  const raw = value.trim().toUpperCase();

  if (raw === "SIMPLE" || raw === "SEMPLICE") {
    return ExamIntensity.SIMPLE;
  }

  if (raw === "MEDIUM" || raw === "MEDIO") {
    return ExamIntensity.MEDIUM;
  }

  if (raw === "HARD" || raw === "DIFFICILE") {
    return ExamIntensity.HARD;
  }

  return ExamIntensity.MEDIUM;
}

function defaultDifficultyFromIntensity(intensity: ExamIntensity) {
  if (intensity === ExamIntensity.SIMPLE) return 2;
  if (intensity === ExamIntensity.HARD) return 4;
  return 3;
}

function parseOptionalInteger(
  value: unknown,
  input: {
    min: number;
    max: number;
    fallback: number;
  },
) {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return input.fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed < input.min || parsed > input.max) {
    return null;
  }

  return parsed;
}

function parseDifficultyWeight(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 5) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function parseExamWeight(value: unknown): number | null {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return 1;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  const normalized = parsed > 1 ? parsed / 100 : parsed;
  if (normalized <= 0 || normalized > 1) {
    return null;
  }

  return Math.round(normalized * 10000) / 10000;
}

function parseOptionalDate(value: unknown): {
  value: Date | null;
  invalid: boolean;
} {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return {
      value: null,
      invalid: false,
    };
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return {
      value: null,
      invalid: true,
    };
  }

  return {
    value: parsed,
    invalid: false,
  };
}

function normalizeCourseName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 2) return undefined;
  return trimmed.slice(0, 120);
}

function normalizeTopicStatus(value: unknown): TopicStatus | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toUpperCase();

  if (raw === "TO_STUDY" || raw === "TO STUDY") return TopicStatus.TO_STUDY;
  if (raw === "REVIEW" || raw === "REVIEWING") return TopicStatus.REVIEW;
  if (raw === "MASTERED") return TopicStatus.MASTERED;

  return null;
}

function parseTopics(value: unknown): {
  topics: InputTopic[];
  error?: string;
} {
  if (value === undefined || value === null) {
    return { topics: [] };
  }

  if (!Array.isArray(value)) {
    return { topics: [], error: "topics must be an array" };
  }

  const topics: InputTopic[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return { topics: [], error: "Each topic must be an object" };
    }

    const candidate = entry as {
      name?: unknown;
      difficulty_weight?: unknown;
      difficulty?: unknown;
      status?: unknown;
      generated_by_ai?: unknown;
    };

    if (
      typeof candidate.name !== "string" ||
      candidate.name.trim().length === 0
    ) {
      return { topics: [], error: "Each topic must include a non-empty name" };
    }

    const difficultyWeight = parseDifficultyWeight(
      candidate.difficulty_weight ?? candidate.difficulty,
    );
    if (difficultyWeight === null) {
      return {
        topics: [],
        error: `Topic '${candidate.name}' must have difficulty_weight between 0.5 and 5`,
      };
    }

    const status =
      normalizeTopicStatus(candidate.status) ?? TopicStatus.TO_STUDY;

    topics.push({
      name: candidate.name.trim(),
      difficulty_weight: difficultyWeight,
      status,
      generated_by_ai: Boolean(candidate.generated_by_ai),
    });
  }

  return { topics };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      difficulty,
      intensity,
      exam_date,
      buffer_days,
      userId,
      courseId,
      courseName,
      weight,
      color_code,
      topics,
      topicIds,
      setup_source,
      syllabus_raw,
      earliest_start_date,
      earliestStartDate,
    } = body;

    // Basic validation
    if (!name || !exam_date || !userId) {
      return NextResponse.json(
        { error: "Missing required fields (name, exam_date, userId)" },
        { status: 400 },
      );
    }

    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      return NextResponse.json(
        { error: "name must be between 2 and 120 characters" },
        { status: 400 },
      );
    }

    const parsedExamDate = new Date(String(exam_date));
    if (Number.isNaN(parsedExamDate.getTime())) {
      return NextResponse.json(
        { error: "exam_date must be a valid date" },
        { status: 400 },
      );
    }

    // In a real app, you'd get the user from the session, but we'll find them for now
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const normalizedColor = normalizeColorCode(color_code);
    const setupSource = normalizeSetupSource(setup_source);
    const normalizedIntensity = normalizeIntensity(intensity);
    const syllabusRaw =
      typeof syllabus_raw === "string" && syllabus_raw.trim().length > 0
        ? syllabus_raw.trim().slice(0, 50000)
        : undefined;

    const parsedDifficulty = parseOptionalInteger(difficulty, {
      min: 1,
      max: 5,
      fallback: defaultDifficultyFromIntensity(normalizedIntensity),
    });
    if (parsedDifficulty === null) {
      return NextResponse.json(
        { error: "difficulty must be an integer between 1 and 5" },
        { status: 400 },
      );
    }

    const parsedBufferDays = parseOptionalInteger(buffer_days, {
      min: 0,
      max: 60,
      fallback: 2,
    });
    if (parsedBufferDays === null) {
      return NextResponse.json(
        { error: "buffer_days must be an integer between 0 and 60" },
        { status: 400 },
      );
    }

    const parsedTopics = parseTopics(topics);
    if (parsedTopics.error) {
      return NextResponse.json({ error: parsedTopics.error }, { status: 400 });
    }

    const parsedTopicIds = parseTopicIds(topicIds);
    if (parsedTopicIds.error) {
      return NextResponse.json(
        { error: parsedTopicIds.error },
        { status: 400 },
      );
    }

    const parsedWeight = parseExamWeight(weight);
    if (parsedWeight === null) {
      return NextResponse.json(
        {
          error:
            "weight must be a number between 0 and 1 (or 0-100 as percentage)",
        },
        { status: 400 },
      );
    }

    const parsedEarliestStartDate = parseOptionalDate(
      earliest_start_date ?? earliestStartDate,
    );
    if (parsedEarliestStartDate.invalid) {
      return NextResponse.json(
        { error: "earliestStartDate must be a valid date" },
        { status: 400 },
      );
    }

    let resolvedCourseId: string;

    if (typeof courseId === "string" && courseId.trim().length > 0) {
      const existingCourse = await prisma.course.findFirst({
        where: {
          id: courseId.trim(),
          userId,
        },
        select: {
          id: true,
        },
      });

      if (!existingCourse) {
        return NextResponse.json(
          { error: "Course not found" },
          { status: 404 },
        );
      }

      resolvedCourseId = existingCourse.id;
    } else {
      const normalizedCourseName =
        normalizeCourseName(courseName) ?? `Corso - ${normalizedName}`;

      const existingCourse = await prisma.course.findFirst({
        where: {
          userId,
          name: normalizedCourseName,
        },
        select: {
          id: true,
        },
      });

      if (existingCourse) {
        resolvedCourseId = existingCourse.id;
      } else {
        const createdCourse = await prisma.course.create({
          data: {
            name: normalizedCourseName,
            cfu: PLACEHOLDER_COURSE_CFU,
            isPassFail: false,
            userId,
          },
          select: {
            id: true,
          },
        });

        resolvedCourseId = createdCourse.id;
      }
    }

    if (parsedTopicIds.topicIds.length > 0) {
      const matchingTopics = await prisma.topic.findMany({
        where: {
          id: {
            in: parsedTopicIds.topicIds,
          },
          courseId: resolvedCourseId,
        },
        select: {
          id: true,
        },
      });

      if (matchingTopics.length !== parsedTopicIds.topicIds.length) {
        return NextResponse.json(
          {
            error:
              "One or more selected topicIds do not belong to the selected course",
          },
          { status: 400 },
        );
      }
    }

    const newExam = await prisma.$transaction(async (tx) => {
      await tx.course.update({
        where: {
          id: resolvedCourseId,
        },
        data: {
          isCompleted: false,
        },
      });

      const createdExam = await tx.exam.create({
        data: {
          name: normalizedName,
          difficulty: parsedDifficulty,
          intensity: normalizedIntensity,
          exam_date: parsedExamDate,
          buffer_days: parsedBufferDays,
          setup_source: setupSource,
          ...(syllabusRaw ? { syllabus_raw: syllabusRaw } : {}),
          ...(normalizedColor ? { color_code: normalizedColor } : {}),
          courseId: resolvedCourseId,
          weight: parsedWeight,
          userId,
        },
      });

      if (parsedTopicIds.topicIds.length > 0) {
        await tx.exam.update({
          where: {
            id: createdExam.id,
          },
          data: {
            topics: {
              connect: parsedTopicIds.topicIds.map((topicId) => ({
                id: topicId,
              })),
            },
          },
        });
      }

      if (parsedTopics.topics.length > 0) {
        for (const topic of parsedTopics.topics) {
          await tx.topic.create({
            data: {
              ...topic,
              courseId: resolvedCourseId,
              exams: {
                connect: {
                  id: createdExam.id,
                },
              },
            },
          });
        }
      }

      return createdExam;
    });

    if (parsedEarliestStartDate.value) {
      try {
        await prisma.examPlanningPreference?.upsert({
          where: {
            examId: newExam.id,
          },
          update: {
            earliest_start_date: parsedEarliestStartDate.value,
          },
          create: {
            examId: newExam.id,
            earliest_start_date: parsedEarliestStartDate.value,
          },
        });
      } catch (error) {
        if (!isMissingTableError(error, "ExamPlanningPreference")) {
          throw error;
        }
      }
    }

    const planResult = await generateSmartSchedule(newExam.id, {
      includeProgress: false,
      preserveLoggedSessions: false,
      dryRun: false,
    });

    if (!planResult.success) {
      // Even if the plan has warnings, the exam is still created.
      // The frontend will display the warning message.
      return NextResponse.json(
        {
          exam: newExam,
          warning: planResult.message,
          seededSessions: planResult.sessionsCreated,
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      {
        exam: newExam,
        message: planResult.message,
        seededSessions: planResult.sessionsCreated,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create exam:", error);
    return NextResponse.json(
      { error: "Failed to create exam" },
      { status: 500 },
    );
  }
}
