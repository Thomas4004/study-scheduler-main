import {
  EnergyCurve,
  ExamIntensity,
  ExamSetupSource,
  Prisma,
  StudySessionType,
  TopicStatus,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
const PLACEHOLDER_COURSE_CFU = 6;

const weeklyTemplateSchema = z.object({
  monday: z.number().min(0).max(24),
  tuesday: z.number().min(0).max(24),
  wednesday: z.number().min(0).max(24),
  thursday: z.number().min(0).max(24),
  friday: z.number().min(0).max(24),
  saturday: z.number().min(0).max(24),
  sunday: z.number().min(0).max(24),
});

const databaseSnapshotSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.union([z.string().max(120), z.null()]),
    energy_curve: z.nativeEnum(EnergyCurve),
    max_focus_minutes: z.number().int().min(15).max(180),
    weekly_hours_template: weeklyTemplateSchema,
    secret_token: z.string().min(1).max(200),
    calendar_feed_token: z.string().min(1).max(200),
  }),
  courses: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(2).max(120),
        cfu: z.number().int().min(0).max(180).optional().default(0),
        isPassFail: z.boolean().optional().default(false),
        isCompleted: z.boolean().optional().default(false),
        resourceLink: z.union([z.string().url().max(2048), z.null()]),
      }),
    )
    .optional()
    .default([]),
  exams: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(2).max(120),
      color_code: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      // Legacy snapshots may still contain exam-level CFU. We keep it optional
      // only to map old payloads into course-level CFU when needed.
      total_cfu: z.number().int().min(1).max(60).optional(),
      difficulty: z.number().int().min(1).max(5),
      intensity: z
        .nativeEnum(ExamIntensity)
        .optional()
        .default(ExamIntensity.MEDIUM),
      setup_source: z.nativeEnum(ExamSetupSource),
      syllabus_raw: z.union([z.string().max(50000), z.null()]),
      exam_date: z.string().min(1),
      buffer_days: z.number().int().min(0).max(60),
      courseId: z
        .union([z.string().min(1), z.null()])
        .optional()
        .default(null),
      weight: z.number().min(0).max(1).optional().default(1),
    }),
  ),
  topics: z.array(
    z.object({
      id: z.string().min(1),
      examId: z
        .union([z.string().min(1), z.null()])
        .optional()
        .default(null),
      examIds: z.array(z.string().min(1)).optional().default([]),
      courseId: z
        .union([z.string().min(1), z.null()])
        .optional()
        .default(null),
      name: z.string().min(1).max(140),
      status: z.nativeEnum(TopicStatus),
      generated_by_ai: z.boolean(),
      difficulty_weight: z.number().min(0.5).max(5),
      ease_factor: z.number().min(1.3).max(3),
      interval_days: z.number().int().min(1).max(3650),
      last_reviewed: z.union([z.string().min(1), z.null()]),
      next_review: z.union([z.string().min(1), z.null()]),
      resources: z.array(z.string().url().max(2048)).optional().default([]),
    }),
  ),
  materials: z.array(
    z.object({
      id: z.string().min(1),
      topicId: z.string().min(1),
      title: z.string().min(1).max(120),
      url: z.string().url().max(2048),
      type: z.string().min(1).max(32),
    }),
  ),
  studySessions: z.array(
    z.object({
      id: z.string().min(1),
      examId: z.string().min(1),
      topicId: z.union([z.string().min(1), z.null()]),
      planned_date: z.string().min(1),
      planned_hours: z.number().min(0).max(24),
      actual_hours: z.number().min(0).max(24),
      confidence_score: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.null(),
      ]),
      confidence_logged_at: z.union([z.string().min(1), z.null()]),
      type: z.nativeEnum(StudySessionType),
      is_placeholder: z.boolean().optional().default(false),
      is_completed: z.boolean(),
    }),
  ),
});

type ParsedSnapshot = z.infer<typeof databaseSnapshotSchema>;

type WeeklyTemplate = z.infer<typeof weeklyTemplateSchema>;

const FALLBACK_TEMPLATE: WeeklyTemplate = {
  monday: 2,
  tuesday: 2,
  wednesday: 2,
  thursday: 2,
  friday: 2,
  saturday: 4,
  sunday: 0,
};

const WEEK_DAYS: Array<keyof WeeklyTemplate> = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function readTemplate(value: unknown): WeeklyTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return FALLBACK_TEMPLATE;
  }

  const record = value as Record<string, unknown>;
  const template: WeeklyTemplate = { ...FALLBACK_TEMPLATE };

  for (const day of WEEK_DAYS) {
    const parsed =
      typeof record[day] === "number" ? record[day] : Number(record[day]);
    template[day] = Number.isFinite(parsed)
      ? Math.max(0, Math.min(24, Math.round(parsed * 100) / 100))
      : FALLBACK_TEMPLATE[day];
  }

  return template;
}

function readTopicResources(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 200);
}

function toDate(value: string, label: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value in ${label}`);
  }
  return parsed;
}

async function resolveUser() {
  return prisma.user.findFirst({
    select: {
      id: true,
    },
  });
}

async function loadSnapshot(userId: string) {
  const [user, courses, exams, topics, materials, studySessions] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          energy_curve: true,
          max_focus_minutes: true,
          weekly_hours_template: true,
          secret_token: true,
          calendar_feed_token: true,
        },
      }),
      prisma.course.findMany({
        where: {
          userId,
        },
        orderBy: [{ name: "asc" }, { created_at: "asc" }],
        select: {
          id: true,
          name: true,
          cfu: true,
          isPassFail: true,
          isCompleted: true,
          resourceLink: true,
        },
      }),
      prisma.exam.findMany({
        where: {
          userId,
        },
        orderBy: {
          exam_date: "asc",
        },
        select: {
          id: true,
          name: true,
          color_code: true,
          difficulty: true,
          intensity: true,
          setup_source: true,
          syllabus_raw: true,
          exam_date: true,
          buffer_days: true,
          courseId: true,
          weight: true,
        },
      }),
      prisma.topic.findMany({
        where: {
          OR: [
            {
              course: {
                userId,
              },
            },
            {
              exams: {
                some: {
                  userId,
                },
              },
            },
          ],
        },
        orderBy: [{ courseId: "asc" }, { name: "asc" }],
        select: {
          id: true,
          courseId: true,
          name: true,
          status: true,
          generated_by_ai: true,
          difficulty_weight: true,
          ease_factor: true,
          interval_days: true,
          last_reviewed: true,
          next_review: true,
          resources: true,
          exams: {
            where: {
              userId,
            },
            select: {
              id: true,
            },
            orderBy: {
              exam_date: "asc",
            },
          },
        },
      }),
      prisma.material.findMany({
        where: {
          topic: {
            OR: [
              {
                course: {
                  userId,
                },
              },
              {
                exams: {
                  some: {
                    userId,
                  },
                },
              },
            ],
          },
        },
        orderBy: [{ topicId: "asc" }, { title: "asc" }],
        select: {
          id: true,
          topicId: true,
          title: true,
          url: true,
          type: true,
        },
      }),
      prisma.studySession.findMany({
        where: {
          exam: {
            userId,
          },
        },
        orderBy: [{ planned_date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          examId: true,
          topicId: true,
          planned_date: true,
          planned_hours: true,
          actual_hours: true,
          confidence_score: true,
          confidence_logged_at: true,
          type: true,
          is_placeholder: true,
          is_completed: true,
        },
      }),
    ]);

  if (!user) {
    return null;
  }

  const calendarFeedToken =
    typeof user.calendar_feed_token === "string" &&
    user.calendar_feed_token.trim().length > 0
      ? user.calendar_feed_token
      : randomUUID().replace(/-/g, "");

  if (!user.calendar_feed_token) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        calendar_feed_token: calendarFeedToken,
      },
    });
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      energy_curve: user.energy_curve,
      max_focus_minutes: user.max_focus_minutes,
      weekly_hours_template: readTemplate(user.weekly_hours_template),
      secret_token: user.secret_token,
      calendar_feed_token: calendarFeedToken,
    },
    courses: courses.map((course) => ({
      id: course.id,
      name: course.name,
      cfu: course.cfu,
      isPassFail: course.isPassFail,
      isCompleted: course.isCompleted,
      resourceLink: course.resourceLink,
    })),
    exams: exams.map((exam) => ({
      id: exam.id,
      name: exam.name,
      color_code: exam.color_code,
      difficulty: exam.difficulty,
      intensity: exam.intensity,
      setup_source: exam.setup_source,
      syllabus_raw: exam.syllabus_raw,
      exam_date: exam.exam_date.toISOString(),
      buffer_days: exam.buffer_days,
      courseId: exam.courseId,
      weight: exam.weight,
    })),
    topics: topics.map((topic) => ({
      id: topic.id,
      examId: topic.exams[0]?.id ?? null,
      examIds: topic.exams.map((exam) => exam.id),
      courseId: topic.courseId,
      name: topic.name,
      status: topic.status,
      generated_by_ai: topic.generated_by_ai,
      difficulty_weight: topic.difficulty_weight,
      ease_factor: topic.ease_factor,
      interval_days: topic.interval_days,
      last_reviewed: topic.last_reviewed?.toISOString() ?? null,
      next_review: topic.next_review?.toISOString() ?? null,
      resources: readTopicResources(topic.resources),
    })),
    materials,
    studySessions: studySessions.map((session) => ({
      id: session.id,
      examId: session.examId,
      topicId: session.topicId,
      planned_date: session.planned_date.toISOString(),
      planned_hours: session.planned_hours,
      actual_hours: session.actual_hours,
      confidence_score: session.confidence_score,
      confidence_logged_at: session.confidence_logged_at?.toISOString() ?? null,
      type: session.type,
      is_placeholder: session.is_placeholder,
      is_completed: session.is_completed,
    })),
  };
}

function extractSnapshotFromBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  return record.snapshot ?? record;
}

function validateReferences(snapshot: ParsedSnapshot) {
  const examIds = new Set(snapshot.exams.map((exam) => exam.id));
  const topicIds = new Set(snapshot.topics.map((topic) => topic.id));
  const courseIds = new Set(snapshot.courses.map((course) => course.id));

  if (courseIds.size > 0) {
    for (const exam of snapshot.exams) {
      if (exam.courseId && !courseIds.has(exam.courseId)) {
        return `Exam ${exam.id} references unknown courseId ${exam.courseId}`;
      }
    }
  }

  for (const topic of snapshot.topics) {
    const linkedExamIds =
      topic.examIds.length > 0
        ? topic.examIds
        : topic.examId
          ? [topic.examId]
          : [];

    for (const examId of linkedExamIds) {
      if (!examIds.has(examId)) {
        return `Topic ${topic.id} references unknown examId ${examId}`;
      }
    }

    if (
      courseIds.size > 0 &&
      topic.courseId &&
      !courseIds.has(topic.courseId)
    ) {
      return `Topic ${topic.id} references unknown courseId ${topic.courseId}`;
    }
  }

  for (const material of snapshot.materials) {
    if (!topicIds.has(material.topicId)) {
      return `Material ${material.id} references unknown topicId ${material.topicId}`;
    }
  }

  for (const session of snapshot.studySessions) {
    if (!examIds.has(session.examId)) {
      return `StudySession ${session.id} references unknown examId ${session.examId}`;
    }

    if (session.topicId && !topicIds.has(session.topicId)) {
      return `StudySession ${session.id} references unknown topicId ${session.topicId}`;
    }
  }

  return null;
}

export async function GET() {
  try {
    const user = await resolveUser();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const snapshot = await loadSnapshot(user.id);
    if (!snapshot) {
      return NextResponse.json(
        { error: "User profile is incomplete" },
        { status: 400 },
      );
    }

    return NextResponse.json(snapshot, { status: 200 });
  } catch (error) {
    console.error("Failed to load database snapshot:", error);
    return NextResponse.json(
      { error: "Failed to load database snapshot" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await resolveUser();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const rawBody = await req.json().catch(() => ({}));
    const payload = extractSnapshotFromBody(rawBody);

    const parsed = databaseSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid database snapshot payload",
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const snapshot = parsed.data;
    if (snapshot.user.id !== user.id) {
      return NextResponse.json(
        {
          error: "user.id in snapshot does not match current profile",
        },
        { status: 400 },
      );
    }

    const currentUserTokens = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        secret_token: true,
        calendar_feed_token: true,
      },
    });

    if (!currentUserTokens) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const normalizedSecretToken = snapshot.user.secret_token.trim();
    if (normalizedSecretToken.length === 0) {
      return NextResponse.json(
        { error: "secret_token is required" },
        { status: 400 },
      );
    }

    const isLegacySecretTokenUnchanged =
      normalizedSecretToken.length < 12 &&
      normalizedSecretToken === currentUserTokens.secret_token;
    if (normalizedSecretToken.length < 12 && !isLegacySecretTokenUnchanged) {
      return NextResponse.json(
        {
          error: "secret_token length must be between 12 and 200 characters",
        },
        { status: 400 },
      );
    }

    const normalizedCalendarFeedToken =
      snapshot.user.calendar_feed_token.trim();
    if (normalizedCalendarFeedToken.length === 0) {
      return NextResponse.json(
        { error: "calendar_feed_token is required" },
        { status: 400 },
      );
    }

    const isLegacyCalendarFeedTokenUnchanged =
      normalizedCalendarFeedToken.length < 12 &&
      normalizedCalendarFeedToken === currentUserTokens.calendar_feed_token;
    if (
      normalizedCalendarFeedToken.length < 12 &&
      !isLegacyCalendarFeedTokenUnchanged
    ) {
      return NextResponse.json(
        {
          error:
            "calendar_feed_token length must be between 12 and 200 characters",
        },
        { status: 400 },
      );
    }

    const referenceError = validateReferences(snapshot);
    if (referenceError) {
      return NextResponse.json({ error: referenceError }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          name:
            typeof snapshot.user.name === "string" &&
            snapshot.user.name.trim().length === 0
              ? null
              : snapshot.user.name,
          energy_curve: snapshot.user.energy_curve,
          max_focus_minutes: snapshot.user.max_focus_minutes,
          weekly_hours_template: snapshot.user.weekly_hours_template,
          secret_token: normalizedSecretToken,
          calendar_feed_token: normalizedCalendarFeedToken,
        },
      });

      for (const course of snapshot.courses) {
        await tx.course.upsert({
          where: {
            id: course.id,
          },
          update: {
            name: course.name,
            cfu: course.cfu,
            isPassFail: course.isPassFail,
            isCompleted: course.isCompleted,
            resourceLink: course.resourceLink,
            userId: user.id,
          },
          create: {
            id: course.id,
            name: course.name,
            cfu: course.cfu,
            isPassFail: course.isPassFail,
            isCompleted: course.isCompleted,
            resourceLink: course.resourceLink,
            userId: user.id,
          },
        });
      }

      const examIdToCourseId = new Map<string, string>();

      for (const exam of snapshot.exams) {
        let resolvedCourseId = exam.courseId;

        if (resolvedCourseId) {
          await tx.course.upsert({
            where: {
              id: resolvedCourseId,
            },
            update: {},
            create: {
              id: resolvedCourseId,
              name: `Corso - ${exam.name}`.slice(0, 120),
              cfu: exam.total_cfu ?? PLACEHOLDER_COURSE_CFU,
              isPassFail: false,
              isCompleted: false,
              userId: user.id,
            },
          });
        } else {
          const placeholderCourse = await tx.course.create({
            data: {
              name: `Corso - ${exam.name}`.slice(0, 120),
              cfu: exam.total_cfu ?? PLACEHOLDER_COURSE_CFU,
              isPassFail: false,
              isCompleted: false,
              userId: user.id,
            },
            select: {
              id: true,
            },
          });

          resolvedCourseId = placeholderCourse.id;
        }

        examIdToCourseId.set(exam.id, resolvedCourseId);

        await tx.exam.upsert({
          where: {
            id: exam.id,
          },
          update: {
            name: exam.name,
            color_code: exam.color_code.toUpperCase(),
            difficulty: exam.difficulty,
            intensity: exam.intensity,
            setup_source: exam.setup_source,
            syllabus_raw: exam.syllabus_raw,
            exam_date: toDate(exam.exam_date, `exams.${exam.id}.exam_date`),
            buffer_days: exam.buffer_days,
            courseId: resolvedCourseId,
            weight: exam.weight,
            userId: user.id,
          },
          create: {
            id: exam.id,
            name: exam.name,
            color_code: exam.color_code.toUpperCase(),
            difficulty: exam.difficulty,
            intensity: exam.intensity,
            setup_source: exam.setup_source,
            syllabus_raw: exam.syllabus_raw,
            exam_date: toDate(exam.exam_date, `exams.${exam.id}.exam_date`),
            buffer_days: exam.buffer_days,
            courseId: resolvedCourseId,
            weight: exam.weight,
            userId: user.id,
          },
        });
      }

      for (const topic of snapshot.topics) {
        const linkedExamIds =
          topic.examIds.length > 0
            ? topic.examIds
            : topic.examId
              ? [topic.examId]
              : [];

        const fallbackCourseId = linkedExamIds
          .map((examId) => examIdToCourseId.get(examId))
          .find((courseId): courseId is string => Boolean(courseId));

        const resolvedCourseId = topic.courseId ?? fallbackCourseId ?? null;

        await tx.topic.upsert({
          where: {
            id: topic.id,
          },
          update: {
            courseId: resolvedCourseId,
            name: topic.name,
            status: topic.status,
            generated_by_ai: topic.generated_by_ai,
            difficulty_weight: topic.difficulty_weight,
            ease_factor: topic.ease_factor,
            interval_days: topic.interval_days,
            last_reviewed: topic.last_reviewed
              ? toDate(topic.last_reviewed, `topics.${topic.id}.last_reviewed`)
              : null,
            next_review: topic.next_review
              ? toDate(topic.next_review, `topics.${topic.id}.next_review`)
              : null,
            resources: topic.resources,
          },
          create: {
            id: topic.id,
            courseId: resolvedCourseId,
            name: topic.name,
            status: topic.status,
            generated_by_ai: topic.generated_by_ai,
            difficulty_weight: topic.difficulty_weight,
            ease_factor: topic.ease_factor,
            interval_days: topic.interval_days,
            last_reviewed: topic.last_reviewed
              ? toDate(topic.last_reviewed, `topics.${topic.id}.last_reviewed`)
              : null,
            next_review: topic.next_review
              ? toDate(topic.next_review, `topics.${topic.id}.next_review`)
              : null,
            resources: topic.resources,
          },
        });

        await tx.topic.update({
          where: {
            id: topic.id,
          },
          data: {
            exams: {
              set: linkedExamIds.map((examId) => ({ id: examId })),
            },
          },
        });
      }

      for (const material of snapshot.materials) {
        await tx.material.upsert({
          where: {
            id: material.id,
          },
          update: {
            topicId: material.topicId,
            title: material.title,
            url: material.url,
            type: material.type,
          },
          create: {
            id: material.id,
            topicId: material.topicId,
            title: material.title,
            url: material.url,
            type: material.type,
          },
        });
      }

      for (const session of snapshot.studySessions) {
        await tx.studySession.upsert({
          where: {
            id: session.id,
          },
          update: {
            examId: session.examId,
            topicId: session.topicId,
            planned_date: toDate(
              session.planned_date,
              `studySessions.${session.id}.planned_date`,
            ),
            planned_hours: session.planned_hours,
            actual_hours: session.actual_hours,
            confidence_score: session.confidence_score,
            confidence_logged_at: session.confidence_logged_at
              ? toDate(
                  session.confidence_logged_at,
                  `studySessions.${session.id}.confidence_logged_at`,
                )
              : null,
            type: session.type,
            is_placeholder: session.is_placeholder,
            is_completed: session.is_completed,
          },
          create: {
            id: session.id,
            examId: session.examId,
            topicId: session.topicId,
            planned_date: toDate(
              session.planned_date,
              `studySessions.${session.id}.planned_date`,
            ),
            planned_hours: session.planned_hours,
            actual_hours: session.actual_hours,
            confidence_score: session.confidence_score,
            confidence_logged_at: session.confidence_logged_at
              ? toDate(
                  session.confidence_logged_at,
                  `studySessions.${session.id}.confidence_logged_at`,
                )
              : null,
            type: session.type,
            is_placeholder: session.is_placeholder,
            is_completed: session.is_completed,
          },
        });
      }

      const sessionIds = snapshot.studySessions.map((item) => item.id);
      if (sessionIds.length > 0) {
        await tx.studySession.deleteMany({
          where: {
            exam: {
              userId: user.id,
            },
            id: {
              notIn: sessionIds,
            },
          },
        });
      } else {
        await tx.studySession.deleteMany({
          where: {
            exam: {
              userId: user.id,
            },
          },
        });
      }

      const materialIds = snapshot.materials.map((item) => item.id);
      if (materialIds.length > 0) {
        await tx.material.deleteMany({
          where: {
            topic: {
              OR: [
                {
                  course: {
                    userId: user.id,
                  },
                },
                {
                  exams: {
                    some: {
                      userId: user.id,
                    },
                  },
                },
              ],
            },
            id: {
              notIn: materialIds,
            },
          },
        });
      } else {
        await tx.material.deleteMany({
          where: {
            topic: {
              OR: [
                {
                  course: {
                    userId: user.id,
                  },
                },
                {
                  exams: {
                    some: {
                      userId: user.id,
                    },
                  },
                },
              ],
            },
          },
        });
      }

      const topicIds = snapshot.topics.map((item) => item.id);
      if (topicIds.length > 0) {
        await tx.topic.deleteMany({
          where: {
            OR: [
              {
                course: {
                  userId: user.id,
                },
              },
              {
                exams: {
                  some: {
                    userId: user.id,
                  },
                },
              },
            ],
            id: {
              notIn: topicIds,
            },
          },
        });
      } else {
        await tx.topic.deleteMany({
          where: {
            OR: [
              {
                course: {
                  userId: user.id,
                },
              },
              {
                exams: {
                  some: {
                    userId: user.id,
                  },
                },
              },
            ],
          },
        });
      }

      const examIds = snapshot.exams.map((item) => item.id);
      if (examIds.length > 0) {
        await tx.exam.deleteMany({
          where: {
            userId: user.id,
            id: {
              notIn: examIds,
            },
          },
        });
      } else {
        await tx.exam.deleteMany({
          where: {
            userId: user.id,
          },
        });
      }
    });

    const nextSnapshot = await loadSnapshot(user.id);
    if (!nextSnapshot) {
      return NextResponse.json(
        { error: "Failed to reload updated snapshot" },
        { status: 500 },
      );
    }

    return NextResponse.json(nextSnapshot, { status: 200 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2003")
    ) {
      return NextResponse.json(
        {
          error:
            "Database constraint violation while applying snapshot. Check unique keys and references.",
        },
        { status: 409 },
      );
    }

    if (
      error instanceof Error &&
      error.message.startsWith("Invalid date value")
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Failed to apply database snapshot:", error);
    return NextResponse.json(
      { error: "Failed to apply database snapshot" },
      { status: 500 },
    );
  }
}
