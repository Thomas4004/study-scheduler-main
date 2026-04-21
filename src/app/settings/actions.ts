"use server";

import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";

function readInt(formData: FormData, field: string, min: number, max: number) {
  const raw = formData.get(field);
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }

  return value;
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

export async function updateCorePreferences(formData: FormData) {
  const userId = await resolveUserId();

  const pomodoroFocusMinutes = readInt(
    formData,
    "pomodoroFocusMinutes",
    15,
    120,
  );
  const pomodoroShortBreakMinutes = readInt(
    formData,
    "pomodoroShortBreakMinutes",
    3,
    30,
  );
  const pomodoroLongBreakMinutes = readInt(
    formData,
    "pomodoroLongBreakMinutes",
    10,
    60,
  );
  const degreeTargetCfu = readInt(formData, "degreeTargetCfu", 60, 420);

  try {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        max_focus_minutes: pomodoroFocusMinutes,
        pomodoro_focus_minutes: pomodoroFocusMinutes,
        pomodoro_short_break_minutes: pomodoroShortBreakMinutes,
        pomodoro_long_break_minutes: pomodoroLongBreakMinutes,
        degree_target_cfu: degreeTargetCfu,
      },
    });
  } catch (error) {
    const hasMissingSettingsColumn =
      isMissingColumnError(error, "pomodoro_focus_minutes") ||
      isMissingColumnError(error, "pomodoro_short_break_minutes") ||
      isMissingColumnError(error, "pomodoro_long_break_minutes") ||
      isMissingColumnError(error, "degree_target_cfu");

    if (!hasMissingSettingsColumn) {
      throw error;
    }

    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        max_focus_minutes: pomodoroFocusMinutes,
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/focus");
  revalidatePath("/libretto");
  revalidatePath("/settings");
}

export async function deleteAllWorkspaceData() {
  const userId = await resolveUserId();

  await prisma.$transaction(async (tx) => {
    await tx.studySession.deleteMany({
      where: {
        exam: {
          userId,
        },
      },
    });

    await tx.material.deleteMany({
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
    });

    await tx.topic.deleteMany({
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
    });

    await tx.exam.deleteMany({
      where: {
        userId,
      },
    });

    await tx.course.deleteMany({
      where: {
        userId,
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath("/exams");
  revalidatePath("/focus");
  revalidatePath("/calendar");
  revalidatePath("/archive");
  revalidatePath("/libretto");
  revalidatePath("/settings");
}
