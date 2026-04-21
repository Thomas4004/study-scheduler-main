import { addDays, startOfDay } from "date-fns";

const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3;

export type ConfidenceScore = 1 | 2 | 3 | 4;

export type RetentionUpdate = {
  easeFactor: number;
  intervalDays: number;
  lastReviewed: Date;
  nextReview: Date;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEaseFactor(value: number) {
  if (!Number.isFinite(value)) return 2.5;
  return clamp(value, MIN_EASE_FACTOR, MAX_EASE_FACTOR);
}

function normalizeIntervalDays(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function toSm2Quality(confidence: ConfidenceScore): number {
  switch (confidence) {
    case 1:
      return 1;
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 5;
    default:
      return 1;
  }
}

function computeEaseDelta(quality: number) {
  return 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
}

export function recalculateIntervalFromConfidence(input: {
  confidence: ConfidenceScore;
  easeFactor: number;
  intervalDays: number;
  reviewedAt?: Date;
}): RetentionUpdate {
  const reviewedAt = startOfDay(input.reviewedAt ?? new Date());
  const quality = toSm2Quality(input.confidence);

  const currentEase = normalizeEaseFactor(input.easeFactor);
  const currentInterval = normalizeIntervalDays(input.intervalDays);

  const nextEase = clamp(
    currentEase + computeEaseDelta(quality),
    MIN_EASE_FACTOR,
    MAX_EASE_FACTOR,
  );

  let nextInterval = 1;

  if (quality >= 3) {
    if (currentInterval <= 1) {
      nextInterval = currentInterval === 0 ? 1 : 6;
    } else {
      nextInterval = Math.max(1, Math.round(currentInterval * nextEase));
    }
  }

  const nextReview = addDays(reviewedAt, nextInterval);

  return {
    easeFactor: Math.round(nextEase * 100) / 100,
    intervalDays: nextInterval,
    lastReviewed: reviewedAt,
    nextReview,
  };
}
