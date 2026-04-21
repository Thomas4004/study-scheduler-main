"use server";

import { revalidatePath } from "next/cache";
import { ExamStatus } from "@prisma/client";
import {
  addDays,
  differenceInCalendarDays,
  startOfDay,
  subDays,
} from "date-fns";

import prisma from "@/lib/prisma";
import { DEFAULT_COLLISION_TOPIC_THRESHOLD } from "@/lib/scheduler";

const EPSILON = 0.001;
const HIGH_IMPORTANCE_WEIGHT_THRESHOLD = 4;
const MAX_FORWARD_SHIFT_DAYS = 30;
const MAX_BACKWARD_SHIFT_DAYS = 7;

type TopicGroup = {
  examId: string;
  examName: string;
  examDate: Date;
  topicId: string;
  topicName: string;
  importanceWeight: number;
};

export type ResolveDayCollisionResult = {
  ok: true;
  targetDate: string;
  threshold: number;
  initialTopicDensity: number;
  keptTopics: Array<{
    examId: string;
    examName: string;
    topicId: string;
    topicName: string;
    importanceWeight: number;
  }>;
  movedTopics: number;
  movedSessions: number;
  moves: Array<{
    examId: string;
    examName: string;
    topicId: string;
    topicName: string;
    fromDate: string;
    toDate: string;
    sessionsMoved: number;
  }>;
  unresolvedTopics: Array<{
    examId: string;
    examName: string;
    topicId: string;
    topicName: string;
    reason: string;
  }>;
  remainingTopicDensity: number;
};

function toDayKey(value: Date) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function getOrCreateDaySet(
  densityByDay: Map<string, Set<string>>,
  day: Date,
): Set<string> {
  const dayKey = toDayKey(day);
  const existing = densityByDay.get(dayKey);

  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  densityByDay.set(dayKey, created);
  return created;
}

function normalizeCollisionDate(input: Date | string) {
  if (input instanceof Date) {
    const parsed = startOfDay(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Invalid date");
    }

    return parsed;
  }

  const parsed = startOfDay(new Date(input));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date");
  }

  return parsed;
}

function resolveUserId() {
  return prisma.user.findFirst({
    select: {
      id: true,
    },
  });
}

function sortByUrgency(a: TopicGroup, b: TopicGroup) {
  const byExamDate = a.examDate.getTime() - b.examDate.getTime();
  if (byExamDate !== 0) return byExamDate;

  const byWeight = b.importanceWeight - a.importanceWeight;
  if (byWeight !== 0) return byWeight;

  const byExamName = a.examName.localeCompare(b.examName);
  if (byExamName !== 0) return byExamName;

  return a.topicName.localeCompare(b.topicName);
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

function findCandidateDay(input: {
  topic: TopicGroup;
  targetDay: Date;
  today: Date;
  backwardLimit: Date;
  absoluteForwardLimit: Date;
  threshold: number;
  densityByDay: Map<string, Set<string>>;
}) {
  const futureHardLimit = minDate(
    startOfDay(input.topic.examDate),
    input.absoluteForwardLimit,
  );

  const forwardAvailableDays = Math.max(
    0,
    Math.min(
      MAX_FORWARD_SHIFT_DAYS,
      differenceInCalendarDays(futureHardLimit, input.targetDay),
    ),
  );

  for (let offset = 1; offset <= forwardAvailableDays; offset += 1) {
    const candidate = addDays(input.targetDay, offset);
    const candidateDensity =
      input.densityByDay.get(toDayKey(candidate))?.size ?? 0;

    if (candidateDensity < input.threshold) {
      return candidate;
    }
  }

  const backwardHardLimit = maxDate(input.backwardLimit, input.today);
  const backwardAvailableDays = Math.max(
    0,
    Math.min(
      MAX_BACKWARD_SHIFT_DAYS,
      differenceInCalendarDays(input.targetDay, backwardHardLimit),
    ),
  );

  for (let offset = 1; offset <= backwardAvailableDays; offset += 1) {
    const candidate = subDays(input.targetDay, offset);
    const candidateDensity =
      input.densityByDay.get(toDayKey(candidate))?.size ?? 0;

    if (candidateDensity < input.threshold) {
      return candidate;
    }
  }

  return null;
}

export async function resolveDayCollision(
  date: Date,
): Promise<ResolveDayCollisionResult> {
  const user = await resolveUserId();
  if (!user) {
    throw new Error("User not found");
  }

  const today = startOfDay(new Date());
  const targetDay = normalizeCollisionDate(date);
  const nextDay = addDays(targetDay, 1);
  const threshold = DEFAULT_COLLISION_TOPIC_THRESHOLD;

  const targetSessions = await prisma.studySession.findMany({
    where: {
      exam: {
        userId: user.id,
        status: ExamStatus.ACTIVE,
      },
      planned_date: {
        gte: targetDay,
        lt: nextDay,
      },
      is_placeholder: false,
      is_completed: false,
      actual_hours: {
        lte: EPSILON,
      },
      topicId: {
        not: null,
      },
    },
    select: {
      examId: true,
      topicId: true,
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
          difficulty_weight: true,
        },
      },
    },
  });

  const uniqueTopics = new Map<string, TopicGroup>();

  for (const session of targetSessions) {
    if (!session.topicId || !session.topic) {
      continue;
    }

    const key = `${session.examId}:${session.topicId}`;
    if (uniqueTopics.has(key)) {
      continue;
    }

    uniqueTopics.set(key, {
      examId: session.exam.id,
      examName: session.exam.name,
      examDate: startOfDay(session.exam.exam_date),
      topicId: session.topic.id,
      topicName: session.topic.name,
      importanceWeight: session.topic.difficulty_weight,
    });
  }

  const sortedTopics = [...uniqueTopics.values()].sort(sortByUrgency);

  if (sortedTopics.length <= threshold) {
    revalidatePath("/calendar");
    revalidatePath("/");
    revalidatePath("/dashboard");

    return {
      ok: true,
      targetDate: targetDay.toISOString(),
      threshold,
      initialTopicDensity: sortedTopics.length,
      keptTopics: sortedTopics.map((topic) => ({
        examId: topic.examId,
        examName: topic.examName,
        topicId: topic.topicId,
        topicName: topic.topicName,
        importanceWeight: topic.importanceWeight,
      })),
      movedTopics: 0,
      movedSessions: 0,
      moves: [],
      unresolvedTopics: [],
      remainingTopicDensity: sortedTopics.length,
    };
  }

  const highImportance = sortedTopics.filter(
    (topic) => topic.importanceWeight >= HIGH_IMPORTANCE_WEIGHT_THRESHOLD,
  );

  const nonHighImportance = sortedTopics.filter(
    (topic) => topic.importanceWeight < HIGH_IMPORTANCE_WEIGHT_THRESHOLD,
  );

  const imminentSlots = Math.max(0, threshold - highImportance.length);
  const imminentTopics = nonHighImportance.slice(0, imminentSlots);

  const keptTopicKeys = new Set(
    [...highImportance, ...imminentTopics].map(
      (topic) => `${topic.examId}:${topic.topicId}`,
    ),
  );

  const overflowTopics = sortedTopics.filter(
    (topic) => !keptTopicKeys.has(`${topic.examId}:${topic.topicId}`),
  );

  const backwardLimit = maxDate(
    subDays(targetDay, MAX_BACKWARD_SHIFT_DAYS),
    today,
  );
  const absoluteForwardLimit = addDays(targetDay, MAX_FORWARD_SHIFT_DAYS);

  const furthestSearchDate = overflowTopics.reduce((latest, topic) => {
    const bounded = minDate(startOfDay(topic.examDate), absoluteForwardLimit);
    return maxDate(latest, bounded);
  }, targetDay);

  const mapRangeEnd = addDays(furthestSearchDate, 1);

  const searchWindowSessions = await prisma.studySession.findMany({
    where: {
      exam: {
        userId: user.id,
        status: ExamStatus.ACTIVE,
      },
      planned_date: {
        gte: backwardLimit,
        lt: mapRangeEnd,
      },
      is_placeholder: false,
      is_completed: false,
      topicId: {
        not: null,
      },
    },
    select: {
      examId: true,
      topicId: true,
      planned_date: true,
    },
  });

  const densityByDay = new Map<string, Set<string>>();

  for (const session of searchWindowSessions) {
    if (!session.topicId) continue;

    const daySet = getOrCreateDaySet(densityByDay, session.planned_date);
    daySet.add(`${session.examId}:${session.topicId}`);
  }

  getOrCreateDaySet(densityByDay, targetDay);

  const moves: ResolveDayCollisionResult["moves"] = [];
  const unresolvedTopics: ResolveDayCollisionResult["unresolvedTopics"] = [];

  let movedTopics = 0;
  let movedSessions = 0;

  for (const topic of overflowTopics) {
    const topicKey = `${topic.examId}:${topic.topicId}`;

    const candidateDay = findCandidateDay({
      topic,
      targetDay,
      today,
      backwardLimit,
      absoluteForwardLimit,
      threshold,
      densityByDay,
    });

    if (!candidateDay) {
      unresolvedTopics.push({
        examId: topic.examId,
        examName: topic.examName,
        topicId: topic.topicId,
        topicName: topic.topicName,
        reason: "No free slot found within smart search window",
      });
      continue;
    }

    const updateResult = await prisma.studySession.updateMany({
      where: {
        examId: topic.examId,
        topicId: topic.topicId,
        planned_date: {
          gte: targetDay,
          lt: nextDay,
        },
        is_placeholder: false,
        is_completed: false,
        actual_hours: {
          lte: EPSILON,
        },
      },
      data: {
        planned_date: candidateDay,
      },
    });

    if (updateResult.count <= 0) {
      unresolvedTopics.push({
        examId: topic.examId,
        examName: topic.examName,
        topicId: topic.topicId,
        topicName: topic.topicName,
        reason: "No movable sessions found for this topic",
      });
      continue;
    }

    movedTopics += 1;
    movedSessions += updateResult.count;

    const sourceSet = getOrCreateDaySet(densityByDay, targetDay);
    sourceSet.delete(topicKey);

    const destinationSet = getOrCreateDaySet(densityByDay, candidateDay);
    destinationSet.add(topicKey);

    moves.push({
      examId: topic.examId,
      examName: topic.examName,
      topicId: topic.topicId,
      topicName: topic.topicName,
      fromDate: targetDay.toISOString(),
      toDate: candidateDay.toISOString(),
      sessionsMoved: updateResult.count,
    });
  }

  revalidatePath("/calendar");
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/focus");

  const affectedExamIds = new Set(overflowTopics.map((topic) => topic.examId));
  for (const examId of affectedExamIds) {
    revalidatePath(`/exam/${examId}`);
  }

  const remainingTopicDensity = getOrCreateDaySet(densityByDay, targetDay).size;

  return {
    ok: true,
    targetDate: targetDay.toISOString(),
    threshold,
    initialTopicDensity: sortedTopics.length,
    keptTopics: sortedTopics
      .filter((topic) => keptTopicKeys.has(`${topic.examId}:${topic.topicId}`))
      .map((topic) => ({
        examId: topic.examId,
        examName: topic.examName,
        topicId: topic.topicId,
        topicName: topic.topicName,
        importanceWeight: topic.importanceWeight,
      })),
    movedTopics,
    movedSessions,
    moves,
    unresolvedTopics,
    remainingTopicDensity,
  };
}
