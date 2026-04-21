import {
  ExamStatus,
  ExamIntensity,
  Prisma,
  StudySessionType,
  TopicStatus,
  type Exam,
  type User,
} from "@prisma/client";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";

import prisma from "@/lib/prisma";
import { isMissingTableError } from "@/lib/prisma-compat";

const EPSILON = 0.001;
const MIN_TOPIC_INTERVAL_DAYS = 1;
const MIN_TOPIC_EASE = 1.3;
const MAX_TOPIC_EASE = 3;
const MAX_BLOCKED_DAYS = 30;
const JIT_CRITICAL_LOAD_RATIO = 0.55;
const JIT_CRESCENDO_EXPONENT = 1.8;
const JIT_WINDOW_HEADROOM_RATIO = 1.0;
const FIRST_PASS_HOURS_MULTIPLIER = 1.0;
const REVIEW_HOURS_MULTIPLIER = 0.25;
const MIN_REVIEW_HOURS = 0.2;
const TO_STUDY_MAX_REVIEWS = 1;
const REVIEW_MAX_REVIEWS = 3;
const DYNAMIC_MAX_REVIEWS_AFTER_FIRST_PASS = 1;
export const DEFAULT_COLLISION_TOPIC_THRESHOLD = 5;
export const DEFAULT_COLLISION_LOW_DENSITY_THRESHOLD = 2;
const MAX_COLLISION_SUGGESTIONS_PER_DAY = 4;

export const GENERIC_STUDY_SESSION_NAME = "Sessione Generica di Studio";

const GHOST_MIN_DAYS_BY_INTENSITY: Record<ExamIntensity, number> = {
  [ExamIntensity.SIMPLE]: 7,
  [ExamIntensity.MEDIUM]: 14,
  [ExamIntensity.HARD]: 21,
};

const JIT_MIN_WINDOW_DAYS_BY_INTENSITY: Record<ExamIntensity, number> = {
  [ExamIntensity.SIMPLE]: 3,
  [ExamIntensity.MEDIUM]: 5,
  [ExamIntensity.HARD]: 7,
};

const JIT_MAX_WINDOW_DAYS_BY_INTENSITY: Record<ExamIntensity, number> = {
  [ExamIntensity.SIMPLE]: 8,
  [ExamIntensity.MEDIUM]: 13,
  [ExamIntensity.HARD]: 18,
};

const JIT_MAX_CRITICAL_EARLY_DAYS_BY_INTENSITY: Record<ExamIntensity, number> =
  {
    [ExamIntensity.SIMPLE]: 5,
    [ExamIntensity.MEDIUM]: 7,
    [ExamIntensity.HARD]: 10,
  };

type PrismaClientLike = typeof prisma;

type WeeklyHoursTemplate = {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
};

type SessionDraft = {
  examId: string;
  topicId: string | null;
  planned_date: Date;
  planned_hours: number;
  type: StudySessionType;
  is_placeholder: boolean;
};

type DayBucket = {
  date: Date;
  capacity: number;
  reserved: number;
  drafts: SessionDraft[];
};

type ReviewTask = {
  id: string;
  topicId: string;
  topicName: string;
  dueDate: Date;
  remainingHours: number;
  difficultyWeight: number;
};

type NewTopicTask = {
  topicId: string;
  topicName: string;
  remainingHours: number;
  reviewHours: number;
  intervalDays: number;
  easeFactor: number;
  difficultyWeight: number;
  reviewSeeded: boolean;
};

type CollisionTopicSession = {
  examId: string;
  examName: string;
  courseName: string;
  examDate: Date;
  topicId: string;
  topicName: string;
};

type CollisionDayLoad = {
  dayKey: string;
  date: Date;
  topicDensity: number;
  sessions: CollisionTopicSession[];
};

export type BuildPlanOptions = {
  referenceDate?: Date;
  includeProgress?: boolean;
  preserveLoggedSessions?: boolean;
  dryRun?: boolean;
  blockedDays?: number;
  earliestStartDate?: Date | string | null;
};

export type CollisionEarlyStartSuggestion = {
  examId: string;
  examName: string;
  courseName: string;
  topicId: string;
  topicName: string;
  fromDate: string;
  suggestedDate: string;
  daysEarly: number;
};

export type CollisionArea = {
  dayKey: string;
  date: string;
  topicDensity: number;
  threshold: number;
  overloadedBy: number;
  earlyStartSuggestions: CollisionEarlyStartSuggestion[];
};

export type CollisionDashboardWarning = {
  message: string;
  weekStartDate: string;
  collisionDate: string;
  topicDensity: number;
  threshold: number;
  suggestedCourseName: string | null;
  recommendedAdvanceDays: number | null;
};

export type CollisionDetectionOptions = {
  referenceDate?: Date;
  threshold?: number;
  lowDensityThreshold?: number;
  maxSuggestionsPerDay?: number;
};

export type SmartSchedulerResult = {
  success: boolean;
  message: string;
  contracted: boolean;
  contractedRatio: number;
  missingHours: number;
  requiredHours: number;
  availableHours: number;
  sessionsCreated: number;
  warnings: string[];
  projectedDailyVelocity?: number;
  projectedHoursByDeadline?: number;
  blockedDaysApplied?: number;
  recommendedStartDate?: string;
  effectiveStartDate?: string;
  collisionAreas?: CollisionArea[];
  collisionWarning?: string;
};

const DEFAULT_WEEKLY_TEMPLATE: WeeklyHoursTemplate = {
  monday: 2,
  tuesday: 2,
  wednesday: 2,
  thursday: 2,
  friday: 2,
  saturday: 4,
  sunday: 0,
};

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function readNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function parseWeeklyTemplate(value: Prisma.JsonValue): WeeklyHoursTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_WEEKLY_TEMPLATE;
  }

  const record = value as Record<string, unknown>;

  return {
    monday: readNumber(record.monday, DEFAULT_WEEKLY_TEMPLATE.monday),
    tuesday: readNumber(record.tuesday, DEFAULT_WEEKLY_TEMPLATE.tuesday),
    wednesday: readNumber(record.wednesday, DEFAULT_WEEKLY_TEMPLATE.wednesday),
    thursday: readNumber(record.thursday, DEFAULT_WEEKLY_TEMPLATE.thursday),
    friday: readNumber(record.friday, DEFAULT_WEEKLY_TEMPLATE.friday),
    saturday: readNumber(record.saturday, DEFAULT_WEEKLY_TEMPLATE.saturday),
    sunday: readNumber(record.sunday, DEFAULT_WEEKLY_TEMPLATE.sunday),
  };
}

function getDailyCapacity(template: WeeklyHoursTemplate, day: Date) {
  switch (day.getDay()) {
    case 0:
      return template.sunday;
    case 1:
      return template.monday;
    case 2:
      return template.tuesday;
    case 3:
      return template.wednesday;
    case 4:
      return template.thursday;
    case 5:
      return template.friday;
    case 6:
      return template.saturday;
    default:
      return 0;
  }
}

function estimateFirstPassHours(topicWeight: number, status: TopicStatus) {
  if (status === TopicStatus.MASTERED || status === TopicStatus.ARCHIVED) {
    return 0;
  }
  const normalized = clamp(topicWeight, 0.5, 5);
  const statusMultiplier = status === TopicStatus.REVIEW ? 0.4 : 1;
  return roundHours(
    normalized * FIRST_PASS_HOURS_MULTIPLIER * statusMultiplier,
  );
}

function estimateReviewHours(firstPassHours: number) {
  return roundHours(
    Math.max(MIN_REVIEW_HOURS, firstPassHours * REVIEW_HOURS_MULTIPLIER),
  );
}

function estimateTemplateAwareHours(totalCfu: number, difficulty: number) {
  const normalizedCfu = Number.isFinite(totalCfu) ? clamp(totalCfu, 0, 30) : 0;
  if (normalizedCfu <= 0) return 0;

  return roundHours(normalizedCfu * 2.1 * clamp(difficulty, 1, 5));
}

function normalizeTopicIntervalDays(value: number | null | undefined) {
  if (!Number.isFinite(value)) return MIN_TOPIC_INTERVAL_DAYS;
  return Math.max(MIN_TOPIC_INTERVAL_DAYS, Math.round(value ?? 1));
}

function normalizeTopicEaseFactor(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 2.5;
  return clamp(value ?? 2.5, MIN_TOPIC_EASE, MAX_TOPIC_EASE);
}

function parseOptionalDate(value: unknown) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }

    return startOfDay(value);
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return startOfDay(parsed);
  }

  return null;
}

function clampDateToRange(date: Date, minDate: Date, maxDate: Date) {
  const minTime = minDate.getTime();
  const maxTime = maxDate.getTime();
  if (date.getTime() < minTime) return minDate;
  if (date.getTime() > maxTime) return maxDate;
  return date;
}

function resolveRecommendedJitStartDate(input: {
  today: Date;
  lastStudyDay: Date;
  latestNewTopicStart: Date;
  intensity: ExamIntensity;
  explicitEarliestStartDate: Date | null;
  requiredHoursForWindow: number;
  averageDailyAvailableCapacity: number;
}) {
  const maxDate =
    input.latestNewTopicStart.getTime() < input.today.getTime()
      ? input.today
      : input.latestNewTopicStart;

  const minWindowDays = JIT_MIN_WINDOW_DAYS_BY_INTENSITY[input.intensity];
  const maxWindowDays = JIT_MAX_WINDOW_DAYS_BY_INTENSITY[input.intensity];
  const normalizedDailyCapacity = Math.max(
    0.75,
    input.averageDailyAvailableCapacity,
  );
  const adaptiveWindowDays = clampInt(
    Math.ceil(
      (Math.max(0, input.requiredHoursForWindow) / normalizedDailyCapacity) *
        JIT_WINDOW_HEADROOM_RATIO,
    ),
    minWindowDays,
    maxWindowDays,
  );

  const smartDefaultDate = clampDateToRange(
    startOfDay(subDays(input.lastStudyDay, adaptiveWindowDays)),
    input.today,
    maxDate,
  );

  if (!input.explicitEarliestStartDate) {
    return smartDefaultDate;
  }

  // earliestStartDate means "do not start before this date".
  // It should delay the smart start when later, never force an earlier start.
  const explicitDate = clampDateToRange(
    input.explicitEarliestStartDate,
    input.today,
    maxDate,
  );

  return explicitDate.getTime() > smartDefaultDate.getTime()
    ? explicitDate
    : smartDefaultDate;
}

function getAverageDailyAvailableCapacity(buckets: DayBucket[]) {
  const positiveCapacities = buckets
    .map((bucket) => Math.max(0, bucket.capacity - bucket.reserved))
    .filter((value) => value > EPSILON);

  if (positiveCapacities.length === 0) {
    return 0;
  }

  return roundHours(
    positiveCapacities.reduce((sum, value) => sum + value, 0) /
      positiveCapacities.length,
  );
}

function sumAvailableHoursFromDate(buckets: DayBucket[], fromDate: Date) {
  return roundHours(
    buckets.reduce((sum, bucket) => {
      if (bucket.date.getTime() < fromDate.getTime()) {
        return sum;
      }

      return sum + Math.max(0, bucket.capacity - bucket.reserved);
    }, 0),
  );
}

function resolveCriticalJitStartDate(input: {
  buckets: DayBucket[];
  preferredStartDate: Date;
  requiredHours: number;
  maxEarlyDays: number;
}) {
  const sorted = [...input.buckets].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  if (sorted.length === 0) {
    return input.preferredStartDate;
  }

  let preferredIndex = sorted.findIndex(
    (bucket) => bucket.date.getTime() >= input.preferredStartDate.getTime(),
  );
  if (preferredIndex < 0) {
    preferredIndex = sorted.length - 1;
  }

  const minimumIndex = Math.max(
    0,
    preferredIndex - Math.max(0, Math.round(input.maxEarlyDays)),
  );

  const targetHours = roundHours(input.requiredHours * JIT_CRITICAL_LOAD_RATIO);
  let capturedHours = sumAvailableHoursFromDate(
    sorted,
    sorted[preferredIndex].date,
  );

  if (capturedHours + EPSILON >= targetHours) {
    return sorted[preferredIndex].date;
  }

  for (let index = preferredIndex - 1; index >= minimumIndex; index -= 1) {
    capturedHours = roundHours(
      capturedHours +
        Math.max(0, sorted[index].capacity - sorted[index].reserved),
    );

    if (capturedHours + EPSILON >= targetHours) {
      return sorted[index].date;
    }
  }

  return sorted[minimumIndex].date;
}

function resolveCrescendoShare(input: {
  bucketDate: Date;
  startDate: Date;
  endDate: Date;
  criticalLoad: boolean;
}) {
  if (input.bucketDate.getTime() <= input.startDate.getTime()) {
    return input.criticalLoad ? 0.25 : 0.1;
  }

  const fullSpan = Math.max(
    1,
    differenceInCalendarDays(input.endDate, input.startDate),
  );
  const elapsed = clamp(
    differenceInCalendarDays(input.bucketDate, input.startDate),
    0,
    fullSpan,
  );
  const progress = fullSpan <= 0 ? 1 : elapsed / fullSpan;

  const minShare = input.criticalLoad ? 0.25 : 0.1;
  const easedProgress = Math.pow(progress, JIT_CRESCENDO_EXPONENT);

  return clamp(minShare + (1 - minShare) * easedProgress, minShare, 1);
}

function minimumGhostDays(intensity: ExamIntensity | null | undefined) {
  return GHOST_MIN_DAYS_BY_INTENSITY[intensity ?? ExamIntensity.MEDIUM];
}

function calculateGhostSessionHours(bucket: DayBucket) {
  const remaining = Math.max(0, bucket.capacity - bucket.reserved);
  if (remaining <= EPSILON) return 0.75;
  return roundHours(Math.max(0.75, Math.min(1.5, remaining)));
}

function buildGhostSessionDrafts(input: {
  buckets: DayBucket[];
  examId: string;
  today: Date;
  lastStudyDay: Date;
  firstBufferDay: Date;
  intensity: ExamIntensity;
  warnings: string[];
}) {
  const targetDays = minimumGhostDays(input.intensity);

  const latestPreBufferDay = startOfDay(subDays(input.firstBufferDay, 1));
  const anchorDay =
    latestPreBufferDay.getTime() < input.today.getTime()
      ? input.lastStudyDay
      : latestPreBufferDay.getTime() < input.lastStudyDay.getTime()
        ? latestPreBufferDay
        : input.lastStudyDay;

  const bucketsByDay = new Map<number, DayBucket>(
    input.buckets.map((bucket) => [bucket.date.getTime(), bucket]),
  );

  const selectedBuckets: DayBucket[] = [];
  let cursor = startOfDay(anchorDay);

  while (
    differenceInCalendarDays(cursor, input.today) >= 0 &&
    selectedBuckets.length < targetDays
  ) {
    const bucket = bucketsByDay.get(cursor.getTime());
    if (bucket) {
      selectedBuckets.push(bucket);
    }

    cursor = subDays(cursor, 1);
  }

  const drafts: SessionDraft[] = selectedBuckets
    .map((bucket) => ({
      examId: input.examId,
      topicId: null,
      planned_date: bucket.date,
      planned_hours: calculateGhostSessionHours(bucket),
      type: StudySessionType.FIRST_PASS,
      is_placeholder: true,
    }))
    .filter((draft) => draft.planned_hours > EPSILON)
    .sort((a, b) => a.planned_date.getTime() - b.planned_date.getTime());

  const missingDays = Math.max(0, targetDays - drafts.length);
  if (missingDays > 0) {
    input.warnings.push(
      `Ghost planning shortfall: requested ${targetDays} day(s), scheduled ${drafts.length}.`,
    );
  }

  return {
    drafts,
    targetDays,
    missingDays,
  };
}

function sameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function isBeforeDay(a: Date, b: Date) {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function sortReviewTasks(a: ReviewTask, b: ReviewTask) {
  const byDueDate = a.dueDate.getTime() - b.dueDate.getTime();
  if (byDueDate !== 0) return byDueDate;
  return b.difficultyWeight - a.difficultyWeight;
}

function buildReviewChain(input: {
  topicId: string;
  topicName: string;
  startDate: Date;
  endDate: Date;
  reviewHours: number;
  intervalDays: number;
  easeFactor: number;
  maxReviews: number;
  difficultyWeight: number;
}): ReviewTask[] {
  const tasks: ReviewTask[] = [];
  let dueDate = startOfDay(input.startDate);
  let interval = normalizeTopicIntervalDays(input.intervalDays);
  const easeFactor = normalizeTopicEaseFactor(input.easeFactor);

  for (let i = 0; i < input.maxReviews; i += 1) {
    if (dueDate > input.endDate) break;

    tasks.push({
      id: `${input.topicId}-${dueDate.toISOString()}-${i}`,
      topicId: input.topicId,
      topicName: input.topicName,
      dueDate,
      remainingHours: input.reviewHours,
      difficultyWeight: input.difficultyWeight,
    });

    interval = Math.max(
      MIN_TOPIC_INTERVAL_DAYS,
      Math.round(interval * easeFactor),
    );
    dueDate = addDays(dueDate, interval);
  }

  return tasks;
}

function getRemainingCapacity(bucket: DayBucket) {
  const usedByDrafts = bucket.drafts.reduce(
    (sum, draft) => sum + draft.planned_hours,
    0,
  );
  return Math.max(0, bucket.capacity - bucket.reserved - usedByDrafts);
}

function sumHours(values: number[]) {
  return roundHours(values.reduce((sum, value) => sum + value, 0));
}

function compressDrafts(drafts: SessionDraft[]) {
  const grouped = new Map<string, SessionDraft>();

  for (const draft of drafts) {
    const dayIso = startOfDay(draft.planned_date).toISOString();
    const topicKey = draft.topicId ?? "ghost";
    const placeholderKey = draft.is_placeholder ? "placeholder" : "regular";
    const key = `${topicKey}-${draft.type}-${dayIso}-${placeholderKey}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...draft,
        planned_date: startOfDay(draft.planned_date),
      });
      continue;
    }

    existing.planned_hours = roundHours(
      existing.planned_hours + draft.planned_hours,
    );
  }

  return [...grouped.values()]
    .filter((draft) => draft.planned_hours > EPSILON)
    .sort((a, b) => {
      const byDate = a.planned_date.getTime() - b.planned_date.getTime();
      if (byDate !== 0) return byDate;

      const byType =
        (a.type === StudySessionType.REVIEW ? 0 : 1) -
        (b.type === StudySessionType.REVIEW ? 0 : 1);
      if (byType !== 0) return byType;

      return b.planned_hours - a.planned_hours;
    });
}

async function getProjectedThroughput(
  prismaClient: PrismaClientLike,
  examId: string,
  today: Date,
  endDate: Date,
) {
  const aggregate = await prismaClient.studySession.aggregate({
    where: {
      examId,
      actual_hours: {
        gt: 0,
      },
    },
    _sum: {
      actual_hours: true,
    },
    _min: {
      planned_date: true,
    },
  });

  const firstTrackedDay = startOfDay(aggregate._min.planned_date ?? today);
  const observedDays = Math.max(
    1,
    differenceInCalendarDays(today, firstTrackedDay) + 1,
  );
  const totalActual = roundHours(aggregate._sum.actual_hours ?? 0);
  const dailyVelocity = roundHours(totalActual / observedDays);
  const daysLeft = Math.max(1, differenceInCalendarDays(endDate, today) + 1);
  const projectedHoursByDeadline = roundHours(dailyVelocity * daysLeft);

  return {
    dailyVelocity,
    projectedHoursByDeadline,
  };
}

async function getFirstPassActualHoursByTopic(
  prismaClient: PrismaClientLike,
  examId: string,
): Promise<Map<string, number>> {
  const rows = await prismaClient.studySession.groupBy({
    by: ["topicId"],
    where: {
      examId,
      type: StudySessionType.FIRST_PASS,
      actual_hours: {
        gt: 0,
      },
    },
    _sum: {
      actual_hours: true,
    },
  });

  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.topicId) continue;
    map.set(row.topicId, roundHours(row._sum.actual_hours ?? 0));
  }

  return map;
}

function allocateReviewTasksForBucket(input: {
  bucket: DayBucket;
  examId: string;
  tasks: ReviewTask[];
}) {
  let remainingCapacity = getRemainingCapacity(input.bucket);
  if (remainingCapacity <= EPSILON || input.tasks.length === 0) {
    return;
  }

  for (const task of input.tasks) {
    if (remainingCapacity <= EPSILON) break;
    if (task.remainingHours <= EPSILON) continue;

    const chunk = Math.min(remainingCapacity, task.remainingHours);
    input.bucket.drafts.push({
      examId: input.examId,
      topicId: task.topicId,
      planned_date: input.bucket.date,
      planned_hours: roundHours(chunk),
      type: StudySessionType.REVIEW,
      is_placeholder: false,
    });

    task.remainingHours = roundHours(task.remainingHours - chunk);
    remainingCapacity = roundHours(remainingCapacity - chunk);
  }
}

function allocateNewTopicsForBucket(input: {
  bucket: DayBucket;
  examId: string;
  newTopicQueue: NewTopicTask[];
  reviewQueue: ReviewTask[];
  lastStudyDay: Date;
  onReviewHoursCreated: (hours: number) => void;
  maxAllocationHours?: number;
}) {
  let remainingCapacity = getRemainingCapacity(input.bucket);
  if (remainingCapacity <= EPSILON) return;

  let allocationBudget =
    input.maxAllocationHours === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, input.maxAllocationHours);

  if (allocationBudget <= EPSILON) {
    return;
  }

  while (remainingCapacity > EPSILON && allocationBudget > EPSILON) {
    const candidate = input.newTopicQueue.find(
      (topic) => topic.remainingHours > EPSILON,
    );

    if (!candidate) break;

    const chunk = Math.min(
      remainingCapacity,
      candidate.remainingHours,
      allocationBudget,
    );
    input.bucket.drafts.push({
      examId: input.examId,
      topicId: candidate.topicId,
      planned_date: input.bucket.date,
      planned_hours: roundHours(chunk),
      type: StudySessionType.FIRST_PASS,
      is_placeholder: false,
    });

    candidate.remainingHours = roundHours(candidate.remainingHours - chunk);
    remainingCapacity = roundHours(remainingCapacity - chunk);
    allocationBudget = roundHours(allocationBudget - chunk);

    if (candidate.remainingHours > EPSILON || candidate.reviewSeeded) {
      continue;
    }

    // Ricalcolo dinamico: appena completiamo il first pass, aggiungiamo
    // la sua catena review nel calendario residuo invece di "spingere" tutto domani.
    const chainStart = addDays(input.bucket.date, candidate.intervalDays);
    const chain = buildReviewChain({
      topicId: candidate.topicId,
      topicName: candidate.topicName,
      startDate: chainStart,
      endDate: input.lastStudyDay,
      reviewHours: candidate.reviewHours,
      intervalDays: candidate.intervalDays,
      easeFactor: candidate.easeFactor,
      maxReviews: DYNAMIC_MAX_REVIEWS_AFTER_FIRST_PASS,
      difficultyWeight: candidate.difficultyWeight,
    });

    const generatedHours = sumHours(chain.map((task) => task.remainingHours));
    if (generatedHours > EPSILON) {
      input.onReviewHoursCreated(generatedHours);
    }

    input.reviewQueue.push(...chain);
    candidate.reviewSeeded = true;
  }
}

function toDayKey(date: Date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function sortCollisionSessions(
  a: CollisionTopicSession,
  b: CollisionTopicSession,
) {
  const byExamDistance = b.examDate.getTime() - a.examDate.getTime();
  if (byExamDistance !== 0) return byExamDistance;

  const byCourse = a.courseName.localeCompare(b.courseName);
  if (byCourse !== 0) return byCourse;

  return a.topicName.localeCompare(b.topicName);
}

function buildEarlyStartSuggestions(input: {
  day: CollisionDayLoad;
  allDays: CollisionDayLoad[];
  densityByDay: Map<string, number>;
  lowDensityThreshold: number;
  maxSuggestions: number;
}): CollisionEarlyStartSuggestion[] {
  const suggestions: CollisionEarlyStartSuggestion[] = [];
  const handledTopicIds = new Set<string>();

  const sortedSessions = [...input.day.sessions].sort(sortCollisionSessions);

  for (const session of sortedSessions) {
    if (handledTopicIds.has(session.topicId)) continue;

    const candidateDay = [...input.allDays]
      .filter((entry) => entry.date.getTime() < input.day.date.getTime())
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .find((entry) => {
        const density =
          input.densityByDay.get(entry.dayKey) ?? entry.topicDensity;
        return density < input.lowDensityThreshold;
      });

    if (!candidateDay) {
      continue;
    }

    const currentDensity =
      input.densityByDay.get(candidateDay.dayKey) ?? candidateDay.topicDensity;
    input.densityByDay.set(candidateDay.dayKey, currentDensity + 1);

    handledTopicIds.add(session.topicId);

    suggestions.push({
      examId: session.examId,
      examName: session.examName,
      courseName: session.courseName,
      topicId: session.topicId,
      topicName: session.topicName,
      fromDate: input.day.date.toISOString(),
      suggestedDate: candidateDay.date.toISOString(),
      daysEarly: Math.max(
        0,
        differenceInCalendarDays(input.day.date, candidateDay.date),
      ),
    });

    if (suggestions.length >= input.maxSuggestions) {
      break;
    }
  }

  return suggestions;
}

export async function detectStudyLoadCollisions(
  userId: string,
  options: CollisionDetectionOptions = {},
  prismaClient: PrismaClientLike = prisma,
): Promise<CollisionArea[]> {
  const today = startOfDay(options.referenceDate ?? new Date());
  const threshold = clampInt(
    Number(options.threshold ?? DEFAULT_COLLISION_TOPIC_THRESHOLD),
    1,
    50,
  );
  const lowDensityThreshold = clampInt(
    Number(
      options.lowDensityThreshold ?? DEFAULT_COLLISION_LOW_DENSITY_THRESHOLD,
    ),
    0,
    threshold,
  );
  const maxSuggestions = clampInt(
    Number(options.maxSuggestionsPerDay ?? MAX_COLLISION_SUGGESTIONS_PER_DAY),
    1,
    10,
  );

  const activeExams = await prismaClient.exam.findMany({
    where: {
      userId,
      status: ExamStatus.ACTIVE,
      exam_date: {
        gte: today,
      },
    },
    select: {
      id: true,
      exam_date: true,
    },
    orderBy: {
      exam_date: "asc",
    },
  });

  if (activeExams.length === 0) {
    return [];
  }

  const horizonEnd = startOfDay(activeExams[activeExams.length - 1].exam_date);

  const sessions = await prismaClient.studySession.findMany({
    where: {
      exam: {
        userId,
        status: ExamStatus.ACTIVE,
        exam_date: {
          gte: today,
        },
      },
      planned_date: {
        gte: today,
        lte: horizonEnd,
      },
      is_completed: false,
    },
    select: {
      examId: true,
      topicId: true,
      is_placeholder: true,
      planned_date: true,
      exam: {
        select: {
          id: true,
          name: true,
          exam_date: true,
          course: {
            select: {
              name: true,
            },
          },
        },
      },
      topic: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      planned_date: "asc",
    },
  });

  const byDay = new Map<
    string,
    {
      date: Date;
      topicKeys: Set<string>;
      sessions: CollisionTopicSession[];
    }
  >();

  for (const session of sessions) {
    if (session.is_placeholder || !session.topicId || !session.topic) {
      continue;
    }

    const key = toDayKey(session.planned_date);
    const date = startOfDay(session.planned_date);

    const current = byDay.get(key);
    if (!current) {
      byDay.set(key, {
        date,
        topicKeys: new Set([`${session.examId}:${session.topicId}`]),
        sessions: [
          {
            examId: session.exam.id,
            examName: session.exam.name,
            courseName: session.exam.course?.name ?? "Corso non assegnato",
            examDate: startOfDay(session.exam.exam_date),
            topicId: session.topic.id,
            topicName: session.topic.name,
          },
        ],
      });

      continue;
    }

    const uniqueTopicKey = `${session.examId}:${session.topicId}`;
    if (current.topicKeys.has(uniqueTopicKey)) {
      continue;
    }

    current.topicKeys.add(uniqueTopicKey);
    current.sessions.push({
      examId: session.exam.id,
      examName: session.exam.name,
      courseName: session.exam.course?.name ?? "Corso non assegnato",
      examDate: startOfDay(session.exam.exam_date),
      topicId: session.topic.id,
      topicName: session.topic.name,
    });
  }

  const allDayLoads: CollisionDayLoad[] = [];
  let cursor = new Date(today);

  while (differenceInCalendarDays(horizonEnd, cursor) >= 0) {
    const key = toDayKey(cursor);
    const entry = byDay.get(key);

    allDayLoads.push({
      dayKey: key,
      date: startOfDay(cursor),
      topicDensity: entry?.topicKeys.size ?? 0,
      sessions: entry?.sessions ?? [],
    });

    cursor = addDays(cursor, 1);
  }

  const densityByDay = new Map(
    allDayLoads.map((entry) => [entry.dayKey, entry.topicDensity]),
  );

  const collisions: CollisionArea[] = [];

  for (const dayLoad of allDayLoads) {
    if (dayLoad.topicDensity <= threshold) {
      continue;
    }

    const earlyStartSuggestions = buildEarlyStartSuggestions({
      day: dayLoad,
      allDays: allDayLoads,
      densityByDay,
      lowDensityThreshold,
      maxSuggestions,
    });

    collisions.push({
      dayKey: dayLoad.dayKey,
      date: dayLoad.date.toISOString(),
      topicDensity: dayLoad.topicDensity,
      threshold,
      overloadedBy: dayLoad.topicDensity - threshold,
      earlyStartSuggestions,
    });
  }

  return collisions;
}

export async function buildCollisionDashboardWarning(
  userId: string,
  options: CollisionDetectionOptions = {},
  prismaClient: PrismaClientLike = prisma,
): Promise<CollisionDashboardWarning | null> {
  const collisions = await detectStudyLoadCollisions(
    userId,
    options,
    prismaClient,
  );

  if (collisions.length === 0) {
    return null;
  }

  const firstCollision = collisions[0];
  const weekStart = startOfWeek(new Date(firstCollision.date), {
    weekStartsOn: 1,
  });
  const primarySuggestion = firstCollision.earlyStartSuggestions[0] ?? null;
  const weekLabel = format(weekStart, "dd/MM");

  const message = primarySuggestion
    ? `Attenzione: Carico irrealistico nella settimana del ${weekLabel}. Considera di posticipare un appello o iniziare il Corso ${primarySuggestion.courseName} con ${primarySuggestion.daysEarly} giorni di anticipo.`
    : `Attenzione: Carico irrealistico nella settimana del ${weekLabel}. Considera di posticipare un appello o anticipare i topic degli esami piu lontani.`;

  return {
    message,
    weekStartDate: weekStart.toISOString(),
    collisionDate: firstCollision.date,
    topicDensity: firstCollision.topicDensity,
    threshold: firstCollision.threshold,
    suggestedCourseName: primarySuggestion?.courseName ?? null,
    recommendedAdvanceDays: primarySuggestion?.daysEarly ?? null,
  };
}

export async function generateElasticSchedule(
  examId: string,
  options: BuildPlanOptions = {},
  prismaClient: PrismaClientLike = prisma,
): Promise<SmartSchedulerResult> {
  const warnings: string[] = [];
  const today = startOfDay(options.referenceDate ?? new Date());
  const includeProgress = options.includeProgress ?? false;
  const preserveLoggedSessions = options.preserveLoggedSessions ?? false;
  const dryRun = options.dryRun ?? false;
  const blockedDays = clampInt(
    Number(options.blockedDays ?? 0),
    0,
    MAX_BLOCKED_DAYS,
  );

  const exam = await prismaClient.exam.findUnique({
    where: { id: examId },
    include: {
      user: {
        select: {
          weekly_hours_template: true,
        },
      },
      topics: true,
    },
  });

  if (!exam) {
    return {
      success: false,
      message: "Exam not found.",
      contracted: false,
      contractedRatio: 0,
      missingHours: 0,
      requiredHours: 0,
      availableHours: 0,
      sessionsCreated: 0,
      warnings: ["Exam not found."],
    };
  }

  if (exam.status !== ExamStatus.ACTIVE) {
    return {
      success: false,
      message: "Exam is not active.",
      contracted: false,
      contractedRatio: 0,
      missingHours: 0,
      requiredHours: 0,
      availableHours: 0,
      sessionsCreated: 0,
      warnings: ["Exam is not active."],
    };
  }

  const lastStudyDay = startOfDay(subDays(exam.exam_date, 1));
  const firstBufferDay = startOfDay(subDays(exam.exam_date, exam.buffer_days));

  if (differenceInCalendarDays(lastStudyDay, today) < 0) {
    return {
      success: false,
      message: "No scheduling window left before the exam.",
      contracted: false,
      contractedRatio: 0,
      missingHours: 0,
      requiredHours: 0,
      availableHours: 0,
      sessionsCreated: 0,
      warnings: ["No available day before the exam date."],
      blockedDaysApplied: blockedDays,
    };
  }

  let storedEarliestStartDate: Date | null = null;
  try {
    const preference = await prismaClient.examPlanningPreference?.findUnique({
      where: {
        examId: exam.id,
      },
      select: {
        earliest_start_date: true,
      },
    });

    storedEarliestStartDate = parseOptionalDate(
      preference?.earliest_start_date,
    );
  } catch (error) {
    if (!isMissingTableError(error, "ExamPlanningPreference")) {
      throw error;
    }
  }

  const optionEarliestStartDate = parseOptionalDate(options.earliestStartDate);
  const explicitEarliestStartDate =
    optionEarliestStartDate ?? storedEarliestStartDate;

  const template = parseWeeklyTemplate(exam.user.weekly_hours_template);

  const buckets: DayBucket[] = [];
  let cursor = new Date(today);
  while (differenceInCalendarDays(lastStudyDay, cursor) >= 0) {
    const date = startOfDay(cursor);
    const offsetFromToday = differenceInCalendarDays(date, today);
    const isBlockedDay = offsetFromToday >= 0 && offsetFromToday < blockedDays;

    buckets.push({
      date,
      capacity: isBlockedDay ? 0 : roundHours(getDailyCapacity(template, date)),
      reserved: 0,
      drafts: [],
    });

    cursor = addDays(cursor, 1);
  }

  if (blockedDays > 0) {
    warnings.push(
      `Forced recalculation applied: first ${blockedDays} day(s) set to 0h capacity.`,
    );
  }

  const existingSessions = await prismaClient.studySession.findMany({
    where: {
      examId,
      planned_date: {
        gte: today,
        lte: lastStudyDay,
      },
    },
    select: {
      id: true,
      topicId: true,
      planned_date: true,
      planned_hours: true,
      actual_hours: true,
      is_completed: true,
    },
  });

  const keepIds = new Set<string>();
  if (preserveLoggedSessions) {
    for (const session of existingSessions) {
      if (session.actual_hours > EPSILON || session.is_completed) {
        keepIds.add(session.id);
      }
    }
  }

  const replaceableIds = existingSessions
    .filter((session) => !keepIds.has(session.id))
    .map((session) => session.id);

  const keptSessions = existingSessions.filter((session) =>
    keepIds.has(session.id),
  );

  for (const session of keptSessions) {
    const dayKey = startOfDay(session.planned_date).getTime();
    const bucket = buckets.find((entry) => entry.date.getTime() === dayKey);
    if (!bucket) continue;
    bucket.reserved = roundHours(bucket.reserved + session.planned_hours);
  }

  const latestNewTopicStartDate = startOfDay(subDays(firstBufferDay, 1));
  const averageDailyAvailableCapacity =
    getAverageDailyAvailableCapacity(buckets);
  const defaultPreferredNewTopicStartDate = resolveRecommendedJitStartDate({
    today,
    lastStudyDay,
    latestNewTopicStart: latestNewTopicStartDate,
    intensity: exam.intensity,
    explicitEarliestStartDate,
    requiredHoursForWindow: 0,
    averageDailyAvailableCapacity,
  });

  const activeTopics = exam.topics
    .filter(
      (topic) =>
        topic.status !== TopicStatus.MASTERED &&
        topic.status !== TopicStatus.ARCHIVED,
    )
    .sort((a, b) => b.difficulty_weight - a.difficulty_weight);

  if (activeTopics.length === 0) {
    const ghostPlan = buildGhostSessionDrafts({
      buckets,
      examId,
      today,
      lastStudyDay,
      firstBufferDay,
      intensity: exam.intensity,
      warnings,
    });

    const requiredHours = roundHours(ghostPlan.targetDays * 0.75);
    const availableHours = roundHours(
      buckets.reduce(
        (sum, bucket) => sum + Math.max(0, bucket.capacity - bucket.reserved),
        0,
      ),
    );

    const missingHours = roundHours(ghostPlan.missingDays * 0.75);
    const contractedRatio =
      ghostPlan.targetDays > 0
        ? roundHours(ghostPlan.drafts.length / ghostPlan.targetDays)
        : 1;
    const contracted = ghostPlan.missingDays > 0;

    if (ghostPlan.drafts.length > 0) {
      warnings.push(
        `${GENERIC_STUDY_SESSION_NAME}: generated ${ghostPlan.drafts.length} placeholder day(s) before exam.`,
      );
    }

    if (!dryRun) {
      const tx: Prisma.PrismaPromise<unknown>[] = [];

      if (replaceableIds.length > 0) {
        tx.push(
          prismaClient.studySession.deleteMany({
            where: { id: { in: replaceableIds } },
          }),
        );
      }

      if (ghostPlan.drafts.length > 0) {
        tx.push(
          prismaClient.studySession.createMany({
            data: ghostPlan.drafts.map((draft) => ({
              examId: draft.examId,
              topicId: draft.topicId,
              planned_date: draft.planned_date,
              planned_hours: draft.planned_hours,
              actual_hours: 0,
              type: draft.type,
              is_placeholder: draft.is_placeholder,
              is_completed: false,
            })),
          }),
        );
      }

      await prismaClient.$transaction(tx);
    }

    return {
      success: true,
      message:
        ghostPlan.drafts.length > 0
          ? `${GENERIC_STUDY_SESSION_NAME} generated.`
          : "No active topics to schedule.",
      contracted,
      contractedRatio,
      missingHours,
      requiredHours,
      availableHours,
      sessionsCreated: ghostPlan.drafts.length,
      warnings,
      blockedDaysApplied: blockedDays,
      recommendedStartDate: defaultPreferredNewTopicStartDate.toISOString(),
      effectiveStartDate: defaultPreferredNewTopicStartDate.toISOString(),
    };
  }

  const firstPassActualByTopic = includeProgress
    ? await getFirstPassActualHoursByTopic(prismaClient, examId)
    : new Map<string, number>();

  const reviewQueue: ReviewTask[] = [];
  const newTopicQueue: NewTopicTask[] = [];

  let requiredReviewHours = 0;
  let requiredNewHours = 0;

  for (const topic of activeTopics) {
    const firstPassTarget = estimateFirstPassHours(
      topic.difficulty_weight,
      topic.status,
    );
    const reviewHours = estimateReviewHours(Math.max(firstPassTarget, 0.5));

    const firstPassActual = includeProgress
      ? (firstPassActualByTopic.get(topic.id) ?? 0)
      : 0;

    const firstPassRemaining =
      topic.status === TopicStatus.TO_STUDY
        ? roundHours(Math.max(0, firstPassTarget - firstPassActual))
        : 0;

    if (firstPassRemaining > EPSILON) {
      newTopicQueue.push({
        topicId: topic.id,
        topicName: topic.name,
        remainingHours: firstPassRemaining,
        reviewHours,
        intervalDays: normalizeTopicIntervalDays(topic.interval_days),
        easeFactor: normalizeTopicEaseFactor(topic.ease_factor),
        difficultyWeight: topic.difficulty_weight,
        reviewSeeded: false,
      });

      requiredNewHours = roundHours(requiredNewHours + firstPassRemaining);
    }

    const hasExplicitReviewAnchor =
      topic.next_review !== null || topic.status === TopicStatus.REVIEW;

    if (!hasExplicitReviewAnchor) {
      continue;
    }

    const reviewAnchor = startOfDay(topic.next_review ?? today);
    const chain = buildReviewChain({
      topicId: topic.id,
      topicName: topic.name,
      startDate: reviewAnchor,
      endDate: lastStudyDay,
      reviewHours,
      intervalDays: normalizeTopicIntervalDays(topic.interval_days),
      easeFactor: normalizeTopicEaseFactor(topic.ease_factor),
      maxReviews:
        topic.status === TopicStatus.TO_STUDY
          ? TO_STUDY_MAX_REVIEWS
          : REVIEW_MAX_REVIEWS,
      difficultyWeight: topic.difficulty_weight,
    });

    if (chain.length === 0) {
      continue;
    }

    reviewQueue.push(...chain);

    const chainHours = sumHours(chain.map((task) => task.remainingHours));
    requiredReviewHours = roundHours(requiredReviewHours + chainHours);

    const seeded = newTopicQueue.find((entry) => entry.topicId === topic.id);
    if (seeded) {
      seeded.reviewSeeded = true;
    }
  }

  const requiredHoursForWindow = roundHours(
    requiredNewHours + requiredReviewHours,
  );
  const preferredNewTopicStartDate = resolveRecommendedJitStartDate({
    today,
    lastStudyDay,
    latestNewTopicStart: latestNewTopicStartDate,
    intensity: exam.intensity,
    explicitEarliestStartDate,
    requiredHoursForWindow,
    averageDailyAvailableCapacity,
  });
  const availableFromPreferredStart = sumAvailableHoursFromDate(
    buckets,
    preferredNewTopicStartDate,
  );

  const criticalLoadDetected =
    requiredHoursForWindow > EPSILON &&
    availableFromPreferredStart + EPSILON <
      requiredHoursForWindow * JIT_CRITICAL_LOAD_RATIO;

  const effectiveNewTopicStartDate = criticalLoadDetected
    ? resolveCriticalJitStartDate({
        buckets,
        preferredStartDate: preferredNewTopicStartDate,
        requiredHours: requiredHoursForWindow,
        maxEarlyDays: JIT_MAX_CRITICAL_EARLY_DAYS_BY_INTENSITY[exam.intensity],
      })
    : preferredNewTopicStartDate;

  if (
    effectiveNewTopicStartDate.getTime() < preferredNewTopicStartDate.getTime()
  ) {
    warnings.push(
      `Critical load detected: first pass starts earlier (${effectiveNewTopicStartDate.toISOString().slice(0, 10)}) than the recommended window (${preferredNewTopicStartDate.toISOString().slice(0, 10)}).`,
    );
  }

  newTopicQueue.sort((a, b) => {
    if (b.difficultyWeight !== a.difficultyWeight) {
      return b.difficultyWeight - a.difficultyWeight;
    }

    return b.remainingHours - a.remainingHours;
  });

  const prioritizeNewTopics = !includeProgress;

  // Allocazione giornaliera a bucket. In seeding iniziale privilegiamo
  // nuovi argomenti (first pass) e poi i ripassi; in ricalcolo manteniamo
  // review-first per proteggere la curva di retention.
  for (const bucket of buckets) {
    reviewQueue.sort(sortReviewTasks);

    const isBufferDay = bucket.date.getTime() >= firstBufferDay.getTime();
    const jitUnlocked =
      bucket.date.getTime() >= effectiveNewTopicStartDate.getTime();

    const crescendoShare = resolveCrescendoShare({
      bucketDate: bucket.date,
      startDate: effectiveNewTopicStartDate,
      endDate: lastStudyDay,
      criticalLoad: criticalLoadDetected,
    });

    const firstPassBudget =
      !isBufferDay && jitUnlocked
        ? roundHours(getRemainingCapacity(bucket) * crescendoShare)
        : 0;

    if (!isBufferDay && prioritizeNewTopics && jitUnlocked) {
      allocateNewTopicsForBucket({
        bucket,
        examId,
        newTopicQueue,
        reviewQueue,
        lastStudyDay,
        onReviewHoursCreated: (hours) => {
          requiredReviewHours = roundHours(requiredReviewHours + hours);
        },
        maxAllocationHours: firstPassBudget,
      });
    }

    const overdueReviews = reviewQueue
      .filter(
        (task) =>
          task.remainingHours > EPSILON &&
          isBeforeDay(task.dueDate, bucket.date),
      )
      .sort(sortReviewTasks);

    allocateReviewTasksForBucket({
      bucket,
      examId,
      tasks: overdueReviews,
    });

    const dueTodayReviews = reviewQueue
      .filter(
        (task) =>
          task.remainingHours > EPSILON && sameDay(task.dueDate, bucket.date),
      )
      .sort(sortReviewTasks);

    allocateReviewTasksForBucket({
      bucket,
      examId,
      tasks: dueTodayReviews,
    });

    if (!isBufferDay && !prioritizeNewTopics && jitUnlocked) {
      const postReviewBudget = roundHours(
        getRemainingCapacity(bucket) * crescendoShare,
      );

      allocateNewTopicsForBucket({
        bucket,
        examId,
        newTopicQueue,
        reviewQueue,
        lastStudyDay,
        onReviewHoursCreated: (hours) => {
          requiredReviewHours = roundHours(requiredReviewHours + hours);
        },
        maxAllocationHours: postReviewBudget,
      });
    }

    reviewQueue.sort(sortReviewTasks);
  }

  const reducedReviewQueue = reviewQueue.filter(
    (task) => task.remainingHours > EPSILON,
  );

  const requiredHours = roundHours(requiredNewHours + requiredReviewHours);
  const availableHours = roundHours(
    buckets.reduce(
      (sum, bucket) => sum + Math.max(0, bucket.capacity - bucket.reserved),
      0,
    ),
  );

  const drafts = compressDrafts(
    buckets.flatMap((bucket) =>
      bucket.drafts.filter((draft) => draft.planned_hours > EPSILON),
    ),
  );

  const sessionsCreated = drafts.length;

  const remainingReviewHours = sumHours(
    reducedReviewQueue.map((task) => task.remainingHours),
  );
  const remainingNewHours = sumHours(
    newTopicQueue.map((task) => task.remainingHours),
  );
  const missingHours = roundHours(remainingReviewHours + remainingNewHours);

  const contractedRatio =
    requiredHours > EPSILON
      ? roundHours(Math.min(1, availableHours / requiredHours))
      : 1;
  const contracted = contractedRatio < 1 - EPSILON;

  if (remainingReviewHours > EPSILON) {
    warnings.push(
      `Review backlog after redistribution: ${remainingReviewHours.toFixed(2)}h still overdue/due before exam.`,
    );
  }

  if (remainingNewHours > EPSILON) {
    warnings.push(
      `New topic backlog: ${remainingNewHours.toFixed(2)}h could not fit without violating daily capacity/buffer constraints.`,
    );
  }

  if (contracted) {
    warnings.push(
      `Workload gap: required ${requiredHours.toFixed(2)}h, available ${availableHours.toFixed(2)}h.`,
    );
  }

  const inBufferWithNewBacklog =
    differenceInCalendarDays(firstBufferDay, today) <= 0 &&
    remainingNewHours > 0;
  if (inBufferWithNewBacklog) {
    warnings.push(
      `Golden buffer active: new topics are blocked in the last ${exam.buffer_days} day(s).`,
    );
  }

  const throughput = await getProjectedThroughput(
    prismaClient,
    examId,
    today,
    lastStudyDay,
  );

  if (throughput.projectedHoursByDeadline + EPSILON < requiredHours) {
    const projectedGap = roundHours(
      requiredHours - throughput.projectedHoursByDeadline,
    );
    warnings.push(
      `Projected throughput at current pace: ${throughput.projectedHoursByDeadline.toFixed(2)}h by deadline (gap ${projectedGap.toFixed(2)}h).`,
    );
  }

  if (!dryRun) {
    const tx: Prisma.PrismaPromise<unknown>[] = [];

    if (replaceableIds.length > 0) {
      tx.push(
        prismaClient.studySession.deleteMany({
          where: { id: { in: replaceableIds } },
        }),
      );
    }

    if (drafts.length > 0) {
      tx.push(
        prismaClient.studySession.createMany({
          data: drafts.map((draft) => ({
            examId: draft.examId,
            topicId: draft.topicId,
            planned_date: draft.planned_date,
            planned_hours: draft.planned_hours,
            actual_hours: 0,
            type: draft.type,
            is_placeholder: draft.is_placeholder,
            is_completed: false,
          })),
        }),
      );
    }

    if (tx.length > 0) {
      await prismaClient.$transaction(tx);
    }
  }

  return {
    success: true,
    message:
      missingHours > EPSILON
        ? "Elastic plan generated with pending workload."
        : "Elastic plan generated successfully.",
    contracted,
    contractedRatio,
    missingHours,
    requiredHours,
    availableHours,
    sessionsCreated,
    warnings,
    projectedDailyVelocity: throughput.dailyVelocity,
    projectedHoursByDeadline: throughput.projectedHoursByDeadline,
    blockedDaysApplied: blockedDays,
    recommendedStartDate: preferredNewTopicStartDate.toISOString(),
    effectiveStartDate: effectiveNewTopicStartDate.toISOString(),
  };
}

export const generateSmartSchedule = generateElasticSchedule;

export class ElasticSchedulerEngine {
  constructor(private readonly prismaClient: PrismaClientLike = prisma) {}

  buildPlan(examId: string, options: BuildPlanOptions = {}) {
    return generateElasticSchedule(examId, options, this.prismaClient);
  }
}

export class SmartSchedulerEngine extends ElasticSchedulerEngine {}

export function estimateTotalStudyHours(totalCfu: number, difficulty: number) {
  return estimateTemplateAwareHours(totalCfu, difficulty);
}

export async function generateStudyPlan(exam: Exam, user: User) {
  void user;
  return generateElasticSchedule(exam.id, {
    includeProgress: false,
    preserveLoggedSessions: false,
    dryRun: false,
  });
}

export async function recalculateSchedule(
  examId: string,
  options: Pick<BuildPlanOptions, "referenceDate" | "blockedDays"> = {},
) {
  return generateElasticSchedule(examId, {
    includeProgress: true,
    preserveLoggedSessions: true,
    dryRun: false,
    blockedDays: options.blockedDays,
    referenceDate: options.referenceDate,
  });
}

export async function replaceGhostSessionsWithRealPlan(
  examId: string,
  options: Pick<BuildPlanOptions, "referenceDate" | "blockedDays"> = {},
  prismaClient: PrismaClientLike = prisma,
) {
  const referenceDate = startOfDay(options.referenceDate ?? new Date());

  await prismaClient.studySession.deleteMany({
    where: {
      examId,
      is_placeholder: true,
      planned_date: {
        gte: referenceDate,
      },
      actual_hours: {
        lte: EPSILON,
      },
      is_completed: false,
    },
  });

  return generateElasticSchedule(
    examId,
    {
      includeProgress: true,
      preserveLoggedSessions: true,
      dryRun: false,
      blockedDays: options.blockedDays,
      referenceDate,
    },
    prismaClient,
  );
}
