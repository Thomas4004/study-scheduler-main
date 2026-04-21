import {
  EnergyCurve,
  ExamIntensity,
  ExamSetupSource,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";
import { recalculateSchedule } from "@/lib/planning";

export const dynamic = "force-dynamic";

type WeeklyTemplate = {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
};

type ParsedUserInput = {
  name: string | null;
  energy_curve: EnergyCurve;
  max_focus_minutes: number;
  weekly_hours_template: WeeklyTemplate;
  secret_token: string;
  calendar_feed_token: string;
};

type ParsedExamInput = {
  id?: string;
  name: string;
  color_code: string;
  difficulty: number;
  intensity: ExamIntensity;
  setup_source: ExamSetupSource;
  syllabus_raw: string | null;
  exam_date: Date;
  buffer_days: number;
};

type ParseUserInputOptions = {
  existingSecretToken?: string | null;
  existingCalendarFeedToken?: string | null;
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

const FALLBACK_TEMPLATE: WeeklyTemplate = {
  monday: 2,
  tuesday: 2,
  wednesday: 2,
  thursday: 2,
  friday: 2,
  saturday: 4,
  sunday: 0,
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseInteger(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function parseFloatNumber(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return Math.round(parsed * 100) / 100;
}

function parseColor(value: unknown) {
  const normalized = normalizeString(value);
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return normalized.toUpperCase();
}

function parseDate(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? "");
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseEnergyCurve(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === EnergyCurve.MORNING ||
    normalized === EnergyCurve.AFTERNOON ||
    normalized === EnergyCurve.NIGHT
  ) {
    return normalized as EnergyCurve;
  }

  return null;
}

function parseSetupSource(value: unknown) {
  if (typeof value !== "string") return ExamSetupSource.MANUAL;
  const normalized = value.trim().toUpperCase();
  if (normalized === ExamSetupSource.AI_SYLLABUS) {
    return ExamSetupSource.AI_SYLLABUS;
  }

  return ExamSetupSource.MANUAL;
}

function parseIntensity(value: unknown) {
  if (typeof value !== "string") return ExamIntensity.MEDIUM;

  const normalized = value.trim().toUpperCase();
  if (normalized === ExamIntensity.SIMPLE || normalized === "SEMPLICE") {
    return ExamIntensity.SIMPLE;
  }

  if (normalized === ExamIntensity.HARD || normalized === "DIFFICILE") {
    return ExamIntensity.HARD;
  }

  return ExamIntensity.MEDIUM;
}

function readTemplate(value: unknown): WeeklyTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return FALLBACK_TEMPLATE;
  }

  const record = value as Record<string, unknown>;
  const template: WeeklyTemplate = { ...FALLBACK_TEMPLATE };

  for (const day of WEEK_DAYS) {
    const parsed = parseFloatNumber(record[day], 0, 24);
    template[day] = parsed ?? FALLBACK_TEMPLATE[day];
  }

  return template;
}

function parseUserInput(
  value: unknown,
  options: ParseUserInputOptions = {},
): {
  data?: ParsedUserInput;
  error?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "user payload is required" };
  }

  const payload = value as Record<string, unknown>;

  const nameRaw = normalizeString(payload.name);
  if (nameRaw.length > 120) {
    return { error: "name must be at most 120 characters" };
  }

  const energyCurve = parseEnergyCurve(payload.energy_curve);
  if (!energyCurve) {
    return { error: "Invalid energy_curve" };
  }

  const maxFocus = parseInteger(payload.max_focus_minutes, 15, 180);
  if (maxFocus === null) {
    return { error: "max_focus_minutes must be an integer between 15 and 180" };
  }

  const secretToken = normalizeString(payload.secret_token);
  const existingSecretToken = normalizeString(options.existingSecretToken);
  const isLegacySecretTokenUnchanged =
    existingSecretToken.length > 0 && secretToken === existingSecretToken;

  if (
    (secretToken.length < 12 || secretToken.length > 200) &&
    !isLegacySecretTokenUnchanged
  ) {
    return {
      error: "secret_token length must be between 12 and 200 characters",
    };
  }

  const calendarFeedToken = normalizeString(payload.calendar_feed_token);
  const existingCalendarFeedToken = normalizeString(
    options.existingCalendarFeedToken,
  );
  const isLegacyCalendarTokenUnchanged =
    existingCalendarFeedToken.length > 0 &&
    calendarFeedToken === existingCalendarFeedToken;

  if (
    (calendarFeedToken.length < 12 || calendarFeedToken.length > 200) &&
    !isLegacyCalendarTokenUnchanged
  ) {
    return {
      error: "calendar_feed_token length must be between 12 and 200 characters",
    };
  }

  return {
    data: {
      name: nameRaw.length > 0 ? nameRaw : null,
      energy_curve: energyCurve,
      max_focus_minutes: maxFocus,
      weekly_hours_template: readTemplate(payload.weekly_hours_template),
      secret_token: secretToken,
      calendar_feed_token: calendarFeedToken,
    },
  };
}

function parseExamsInput(value: unknown): {
  data?: ParsedExamInput[];
  error?: string;
} {
  if (!Array.isArray(value)) {
    return { error: "exams must be an array" };
  }

  const parsed: ParsedExamInput[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: "Each exam must be an object" };
    }

    const exam = entry as Record<string, unknown>;

    const name = normalizeString(exam.name);
    if (name.length < 2 || name.length > 120) {
      return { error: `Exam '${name || "<empty>"}': invalid name` };
    }

    const color = parseColor(exam.color_code);
    if (!color) {
      return { error: `Exam '${name}': invalid color_code` };
    }

    const difficulty = parseInteger(exam.difficulty, 1, 5);
    if (difficulty === null) {
      return { error: `Exam '${name}': difficulty must be between 1 and 5` };
    }

    const examDate = parseDate(exam.exam_date);
    if (!examDate) {
      return { error: `Exam '${name}': invalid exam_date` };
    }

    const bufferDays = parseInteger(exam.buffer_days, 0, 60);
    if (bufferDays === null) {
      return { error: `Exam '${name}': buffer_days must be between 0 and 60` };
    }

    const setupSource = parseSetupSource(exam.setup_source);
    const intensity = parseIntensity(exam.intensity);
    const syllabusRaw =
      typeof exam.syllabus_raw === "string"
        ? exam.syllabus_raw.trim().slice(0, 50000)
        : null;

    parsed.push({
      id:
        typeof exam.id === "string" && exam.id.trim().length > 0
          ? exam.id.trim()
          : undefined,
      name,
      color_code: color,
      difficulty,
      intensity,
      setup_source: setupSource,
      syllabus_raw: syllabusRaw && syllabusRaw.length > 0 ? syllabusRaw : null,
      exam_date: examDate,
      buffer_days: bufferDays,
    });
  }

  return { data: parsed };
}

async function readUserAndExams(prismaClient: PrismaClient) {
  const user = await prismaClient.user.findFirst({
    select: {
      id: true,
      name: true,
      energy_curve: true,
      max_focus_minutes: true,
      weekly_hours_template: true,
      secret_token: true,
      calendar_feed_token: true,
    },
  });

  if (!user) {
    return null;
  }

  const calendarFeedToken =
    typeof user.calendar_feed_token === "string" &&
    user.calendar_feed_token.trim().length > 0
      ? user.calendar_feed_token
      : randomUUID().replace(/-/g, "");

  if (!user.calendar_feed_token) {
    await prismaClient.user.update({
      where: { id: user.id },
      data: {
        calendar_feed_token: calendarFeedToken,
      },
    });
  }

  const exams = await prismaClient.exam.findMany({
    where: {
      userId: user.id,
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
      _count: {
        select: {
          topics: true,
          study_sessions: true,
        },
      },
    },
    orderBy: {
      exam_date: "asc",
    },
  });

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
      topic_count: exam._count.topics,
      session_count: exam._count.study_sessions,
    })),
  };
}

export async function GET() {
  try {
    const data = await readUserAndExams(prisma);
    if (!data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Failed to load settings customization:", error);
    return NextResponse.json(
      { error: "Failed to load settings customization" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      user?: unknown;
      exams?: unknown;
      autoRebuildPlan?: unknown;
    };

    const user = await prisma.user.findFirst({
      select: {
        id: true,
        secret_token: true,
        calendar_feed_token: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const parsedUser = parseUserInput(body.user, {
      existingSecretToken: user.secret_token,
      existingCalendarFeedToken: user.calendar_feed_token,
    });
    if (!parsedUser.data) {
      return NextResponse.json(
        { error: parsedUser.error ?? "Invalid user payload" },
        { status: 400 },
      );
    }

    const parsedExams = parseExamsInput(body.exams);
    if (!parsedExams.data) {
      return NextResponse.json(
        { error: parsedExams.error ?? "Invalid exams payload" },
        { status: 400 },
      );
    }

    const userData = parsedUser.data;
    const examsData = parsedExams.data;

    const rebuildPlan = body.autoRebuildPlan !== false;

    const existingExams = await prisma.exam.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    const existingIds = new Set(existingExams.map((exam) => exam.id));

    const persistedExamIds = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: userData,
      });

      const touchedIds: string[] = [];

      for (const exam of examsData) {
        if (exam.id && existingIds.has(exam.id)) {
          const updated = await tx.exam.update({
            where: { id: exam.id },
            data: {
              name: exam.name,
              color_code: exam.color_code,
              difficulty: exam.difficulty,
              intensity: exam.intensity,
              setup_source: exam.setup_source,
              syllabus_raw: exam.syllabus_raw,
              exam_date: exam.exam_date,
              buffer_days: exam.buffer_days,
            },
            select: {
              id: true,
            },
          });
          touchedIds.push(updated.id);
          continue;
        }

        const created = await tx.exam.create({
          data: {
            name: exam.name,
            color_code: exam.color_code,
            difficulty: exam.difficulty,
            intensity: exam.intensity,
            setup_source: exam.setup_source,
            syllabus_raw: exam.syllabus_raw,
            exam_date: exam.exam_date,
            buffer_days: exam.buffer_days,
            userId: user.id,
          },
          select: {
            id: true,
          },
        });
        touchedIds.push(created.id);
      }

      if (touchedIds.length > 0) {
        await tx.exam.deleteMany({
          where: {
            userId: user.id,
            id: {
              notIn: touchedIds,
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

      return touchedIds;
    });

    if (rebuildPlan && persistedExamIds.length > 0) {
      await Promise.allSettled(
        persistedExamIds.map((examId) => recalculateSchedule(examId)),
      );
    }

    const nextState = await readUserAndExams(prisma);
    if (!nextState) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        ...nextState,
        rebuiltPlans: rebuildPlan,
      },
      { status: 200 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "Unique constraint violation. secret_token or calendar_feed_token is already in use.",
        },
        { status: 409 },
      );
    }

    console.error("Failed to update settings customization:", error);
    return NextResponse.json(
      { error: "Failed to update settings customization" },
      { status: 500 },
    );
  }
}
