"use server";

import { revalidatePath } from "next/cache";
import { ExamIntensity, ExamStatus, Prisma } from "@prisma/client";

import { recalculateSchedule } from "@/lib/planning";
import prisma from "@/lib/prisma";
import { isMissingColumnError, isMissingTableError } from "@/lib/prisma-compat";

export type UpdateExamInput = {
  examId: string;
  name?: string;
  examDate?: Date | string;
  bufferDays?: number;
  difficulty?: number;
  intensity?: ExamIntensity | "SIMPLE" | "MEDIUM" | "HARD";
  weight?: number;
  colorCode?: string;
  grade?: number | null;
  status?: ExamStatus | "ACTIVE" | "COMPLETED" | "ARCHIVED";
  notes?: string | null;
  earliestStartDate?: Date | string | null;
};

type UpdateExamResult = {
  ok: boolean;
  examId: string;
  warning?: string;
};

type ArchiveExamResult = {
  ok: boolean;
  examId: string;
  alreadyArchived: boolean;
};

type UnarchiveExamResult = {
  ok: boolean;
  examId: string;
  restored: boolean;
  warning?: string;
};

function parseExamName(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("name must be a string");
  }

  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 120) {
    throw new Error("name must be between 2 and 120 characters");
  }

  return normalized;
}

function parseExamDate(value: unknown) {
  if (value === undefined) return undefined;

  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("examDate must be a valid date");
  }

  return parsed;
}

function parseBufferDays(value: unknown) {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60) {
    throw new Error("bufferDays must be an integer between 0 and 60");
  }

  return parsed;
}

function parseDifficulty(value: unknown) {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new Error("difficulty must be an integer between 1 and 5");
  }

  return parsed;
}

function parseIntensity(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("intensity must be SIMPLE, MEDIUM or HARD");
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "SIMPLE") return ExamIntensity.SIMPLE;
  if (normalized === "MEDIUM") return ExamIntensity.MEDIUM;
  if (normalized === "HARD") return ExamIntensity.HARD;

  throw new Error("intensity must be SIMPLE, MEDIUM or HARD");
}

function parseWeight(value: unknown) {
  if (value === undefined) return undefined;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("weight must be a positive number");
  }

  const normalized = parsed > 1 ? parsed / 100 : parsed;
  if (normalized <= 0 || normalized > 1) {
    throw new Error("weight must be between 0 and 1 (or 0-100 as percentage)");
  }

  return Math.round(normalized * 10000) / 10000;
}

function parseColorCode(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("colorCode must be a string");
  }

  const normalized = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error("colorCode must be a valid hex color like #3B82F6");
  }

  return normalized;
}

function parseGrade(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 110) {
    throw new Error("grade must be an integer between 0 and 110");
  }

  return parsed;
}

function parseStatus(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("status must be ACTIVE, COMPLETED or ARCHIVED");
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "ACTIVE") return ExamStatus.ACTIVE;
  if (normalized === "COMPLETED") return ExamStatus.COMPLETED;
  if (normalized === "ARCHIVED") return ExamStatus.ARCHIVED;

  throw new Error("status must be ACTIVE, COMPLETED or ARCHIVED");
}

function parseNotes(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("notes must be a string");
  }

  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized.slice(0, 4000);
}

function parseEarliestStartDate(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("earliestStartDate must be a valid date");
  }

  return parsed;
}

function deriveIntensityFromDifficulty(difficulty: number) {
  if (difficulty <= 2) return ExamIntensity.SIMPLE;
  if (difficulty >= 4) return ExamIntensity.HARD;
  return ExamIntensity.MEDIUM;
}

async function getCurrentUserId() {
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

function revalidateExamPaths(examId: string) {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/exams");
  revalidatePath("/calendar");
  revalidatePath("/focus");
  revalidatePath("/archive");
  revalidatePath("/libretto");
  revalidatePath(`/exam/${examId}`);
}

export async function updateExam(
  input: UpdateExamInput,
): Promise<UpdateExamResult> {
  const examId = typeof input.examId === "string" ? input.examId.trim() : "";
  if (examId.length === 0) {
    throw new Error("examId is required");
  }

  const userId = await getCurrentUserId();

  const exam = await prisma.exam.findFirst({
    where: {
      id: examId,
      userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!exam) {
    throw new Error("Exam not found");
  }

  const parsedName = parseExamName(input.name);
  const parsedExamDate = parseExamDate(input.examDate);
  const parsedBufferDays = parseBufferDays(input.bufferDays);
  const parsedDifficulty = parseDifficulty(input.difficulty);
  const parsedIntensity = parseIntensity(input.intensity);
  const parsedWeight = parseWeight(input.weight);
  const parsedColorCode = parseColorCode(input.colorCode);
  const parsedGrade = parseGrade(input.grade);
  const parsedStatus = parseStatus(input.status);
  const parsedNotes = parseNotes(input.notes);

  const hasEarliestStartDate = Object.prototype.hasOwnProperty.call(
    input,
    "earliestStartDate",
  );
  const parsedEarliestStartDate = parseEarliestStartDate(
    input.earliestStartDate,
  );

  const data: Prisma.ExamUpdateInput = {};

  if (parsedName !== undefined) {
    data.name = parsedName;
  }

  if (parsedExamDate !== undefined) {
    data.exam_date = parsedExamDate;
  }

  if (parsedBufferDays !== undefined) {
    data.buffer_days = parsedBufferDays;
  }

  if (parsedDifficulty !== undefined) {
    data.difficulty = parsedDifficulty;
    if (parsedIntensity === undefined) {
      data.intensity = deriveIntensityFromDifficulty(parsedDifficulty);
    }
  }

  if (parsedIntensity !== undefined) {
    data.intensity = parsedIntensity;
  }

  if (parsedWeight !== undefined) {
    data.weight = parsedWeight;
  }

  if (parsedColorCode !== undefined) {
    data.color_code = parsedColorCode;
  }

  if (parsedGrade !== undefined) {
    data.grade = parsedGrade;
  }

  if (parsedStatus !== undefined) {
    data.status = parsedStatus;

    if (parsedStatus === ExamStatus.ACTIVE) {
      data.completedAt = null;
      if (parsedGrade === undefined) {
        data.grade = null;
      }
    }

    if (parsedStatus === ExamStatus.COMPLETED && parsedGrade === undefined) {
      data.completedAt = new Date();
    }
  }

  if (parsedNotes !== undefined) {
    data.notes = parsedNotes;
  }

  await prisma.exam.update({
    where: { id: exam.id },
    data,
  });

  if (hasEarliestStartDate && parsedEarliestStartDate !== undefined) {
    try {
      if (parsedEarliestStartDate === null) {
        await prisma.examPlanningPreference?.deleteMany({
          where: { examId: exam.id },
        });
      } else {
        await prisma.examPlanningPreference?.upsert({
          where: {
            examId: exam.id,
          },
          update: {
            earliest_start_date: parsedEarliestStartDate,
          },
          create: {
            examId: exam.id,
            earliest_start_date: parsedEarliestStartDate,
          },
        });
      }
    } catch (error) {
      if (!isMissingTableError(error, "ExamPlanningPreference")) {
        throw error;
      }
    }
  }

  let warning: string | undefined;
  const statusForRecalc = parsedStatus ?? exam.status;
  const scheduleInputsChanged =
    parsedExamDate !== undefined ||
    parsedBufferDays !== undefined ||
    parsedDifficulty !== undefined ||
    parsedIntensity !== undefined ||
    parsedWeight !== undefined ||
    hasEarliestStartDate;

  const shouldRecalculate =
    statusForRecalc === ExamStatus.ACTIVE &&
    (scheduleInputsChanged || parsedStatus === ExamStatus.ACTIVE);

  if (shouldRecalculate) {
    try {
      await recalculateSchedule(exam.id);
    } catch (error) {
      console.error("Failed to recalculate schedule after exam update:", error);
      warning =
        "Exam updated, but schedule recalculation failed. Run a manual recalibration.";
    }
  }

  revalidateExamPaths(exam.id);

  return {
    ok: true,
    examId: exam.id,
    warning,
  };
}

export async function archiveExam(examId: string): Promise<ArchiveExamResult> {
  const normalizedExamId = typeof examId === "string" ? examId.trim() : "";
  if (normalizedExamId.length === 0) {
    throw new Error("examId is required");
  }

  const userId = await getCurrentUserId();

  const exam = await prisma.exam.findFirst({
    where: {
      id: normalizedExamId,
      userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!exam) {
    throw new Error("Exam not found");
  }

  if (exam.status === ExamStatus.ARCHIVED) {
    return {
      ok: true,
      examId: exam.id,
      alreadyArchived: true,
    };
  }

  // Archive exam without cascading side effects on related topics.
  await prisma.exam.update({
    where: {
      id: exam.id,
    },
    data: {
      status: ExamStatus.ARCHIVED,
    },
  });

  revalidateExamPaths(exam.id);

  return {
    ok: true,
    examId: exam.id,
    alreadyArchived: false,
  };
}

export async function unarchiveExam(
  examId: string,
): Promise<UnarchiveExamResult> {
  const normalizedExamId = typeof examId === "string" ? examId.trim() : "";
  if (normalizedExamId.length === 0) {
    throw new Error("examId is required");
  }

  const userId = await getCurrentUserId();

  const exam = await prisma.exam.findFirst({
    where: {
      id: normalizedExamId,
      userId,
    },
    select: {
      id: true,
      status: true,
      courseId: true,
    },
  });

  if (!exam) {
    throw new Error("Exam not found");
  }

  if (exam.status !== ExamStatus.ARCHIVED) {
    return {
      ok: true,
      examId: exam.id,
      restored: exam.status === ExamStatus.ACTIVE,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.exam.update({
      where: {
        id: exam.id,
      },
      data: {
        status: ExamStatus.ACTIVE,
        completedAt: null,
        grade: null,
      },
    });

    if (!exam.courseId) {
      return;
    }

    const courseId = exam.courseId;

    await tx.course
      .updateMany({
        where: {
          id: courseId,
          userId,
        },
        data: {
          isArchived: false,
          isCompleted: false,
        },
      })
      .catch(async (error) => {
        if (!isMissingColumnError(error, "isArchived")) {
          throw error;
        }

        await tx.course.updateMany({
          where: {
            id: courseId,
            userId,
          },
          data: {
            isCompleted: false,
          },
        });
      });
  });

  let warning: string | undefined;
  try {
    await recalculateSchedule(exam.id);
  } catch (error) {
    console.error("Failed to recalculate schedule after exam restore:", error);
    warning =
      "Exam restored, but schedule recalculation failed. Run a manual recalibration.";
  }

  revalidateExamPaths(exam.id);

  return {
    ok: true,
    examId: exam.id,
    restored: true,
    warning,
  };
}
