"use server";

import { revalidatePath } from "next/cache";
import { TopicStatus } from "@prisma/client";
import { addDays, startOfDay } from "date-fns";

import { recalculateSchedule } from "@/lib/planning";
import prisma from "@/lib/prisma";
import {
  type ConfidenceScore,
  recalculateIntervalFromConfidence,
} from "@/lib/retention";

function parseConfidenceScore(value: number): ConfidenceScore {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error("Confidence score must be an integer between 1 and 4");
  }

  return value as ConfidenceScore;
}

type ToggleTopicCompletionMode = "MASTER" | "REPLAN_TOMORROW";

export async function toggleTopicCompletion(
  topicId: string,
  mode: ToggleTopicCompletionMode = "MASTER",
) {
  if (typeof topicId !== "string" || topicId.trim().length === 0) {
    throw new Error("topicId is required");
  }

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const normalizedTopicId = topicId.trim();

  const topic = await prisma.topic.findFirst({
    where: {
      id: normalizedTopicId,
      exams: {
        some: {
          userId: user.id,
          status: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      name: true,
      courseId: true,
      exams: {
        where: {
          userId: user.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!topic) {
    throw new Error("Topic not found");
  }

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);

  await prisma.$transaction(async (tx) => {
    if (mode === "MASTER") {
      await tx.topic.update({
        where: {
          id: topic.id,
        },
        data: {
          status: TopicStatus.MASTERED,
          last_reviewed: today,
          next_review: null,
        },
      });

      await tx.studySession.updateMany({
        where: {
          topicId: topic.id,
          exam: {
            userId: user.id,
            status: "ACTIVE",
          },
          is_completed: false,
          actual_hours: {
            lte: 0.001,
          },
          planned_date: {
            lte: today,
          },
        },
        data: {
          is_completed: true,
          actual_hours: 0,
        },
      });

      return;
    }

    await tx.topic.update({
      where: {
        id: topic.id,
      },
      data: {
        status: TopicStatus.REVIEW,
        next_review: tomorrow,
      },
    });

    await tx.studySession.updateMany({
      where: {
        topicId: topic.id,
        exam: {
          userId: user.id,
          status: "ACTIVE",
        },
        is_completed: false,
        actual_hours: {
          lte: 0.001,
        },
        planned_date: {
          lte: today,
        },
      },
      data: {
        planned_date: tomorrow,
      },
    });
  });

  await Promise.allSettled(
    topic.exams.map((exam) => recalculateSchedule(exam.id)),
  );

  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/focus");

  if (topic.courseId) {
    revalidatePath(`/courses/${topic.courseId}`);
  }

  for (const exam of topic.exams) {
    revalidatePath(`/exam/${exam.id}`);
  }

  return {
    ok: true,
    topicId: topic.id,
    mode,
  };
}

export async function completeTopicToday(topicId: string) {
  return toggleTopicCompletion(topicId, "MASTER");
}

export async function replanTopicTomorrow(topicId: string) {
  return toggleTopicCompletion(topicId, "REPLAN_TOMORROW");
}

export async function updateTopicConfidence(topicId: string, score: number) {
  if (typeof topicId !== "string" || topicId.trim().length === 0) {
    throw new Error("topicId is required");
  }

  const confidence = parseConfidenceScore(score);

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const topic = await prisma.topic.findFirst({
    where: {
      id: topicId.trim(),
      exams: {
        some: {
          userId: user.id,
          status: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      name: true,
      courseId: true,
      ease_factor: true,
      interval_days: true,
      exams: {
        where: {
          userId: user.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!topic) {
    throw new Error("Topic not found or not linked to an active exam");
  }

  const retention = recalculateIntervalFromConfidence({
    confidence,
    easeFactor: topic.ease_factor,
    intervalDays: topic.interval_days,
  });

  const updated = await prisma.topic.update({
    where: {
      id: topic.id,
    },
    data: {
      ease_factor: retention.easeFactor,
      interval_days: retention.intervalDays,
      last_reviewed: retention.lastReviewed,
      next_review: retention.nextReview,
    },
    select: {
      id: true,
      name: true,
      ease_factor: true,
      interval_days: true,
      next_review: true,
    },
  });

  const recalculationResults = await Promise.allSettled(
    topic.exams.map((exam) => recalculateSchedule(exam.id)),
  );

  const recalculatedExamIds: string[] = [];
  const failedRecalculations: Array<{ examId: string; message: string }> = [];

  recalculationResults.forEach((result, index) => {
    const examId = topic.exams[index]?.id;
    if (!examId) return;

    if (result.status === "fulfilled") {
      recalculatedExamIds.push(examId);
      return;
    }

    failedRecalculations.push({
      examId,
      message:
        result.reason instanceof Error
          ? result.reason.message
          : "Schedule recalculation failed",
    });
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/focus");
  revalidatePath(`/focus/${topic.id}`);

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
      easeFactor: updated.ease_factor,
      intervalDays: updated.interval_days,
      nextReview: updated.next_review?.toISOString() ?? null,
    },
    recalculatedExamIds,
    failedRecalculations,
  };
}
