import type { Exam, User } from "@prisma/client";

import {
  BuildPlanOptions,
  buildCollisionDashboardWarning,
  CollisionArea,
  CollisionDashboardWarning,
  CollisionDetectionOptions,
  detectStudyLoadCollisions,
  ElasticSchedulerEngine,
  estimateTotalStudyHours,
  GENERIC_STUDY_SESSION_NAME,
  generateSmartSchedule,
  recalculateSchedule,
  replaceGhostSessionsWithRealPlan,
  SmartSchedulerEngine,
  SmartSchedulerResult,
} from "@/lib/scheduler";

export type {
  BuildPlanOptions,
  CollisionArea,
  CollisionDashboardWarning,
  CollisionDetectionOptions,
  SmartSchedulerResult,
};

export {
  buildCollisionDashboardWarning,
  detectStudyLoadCollisions,
  ElasticSchedulerEngine,
  GENERIC_STUDY_SESSION_NAME,
  estimateTotalStudyHours,
  generateSmartSchedule,
  recalculateSchedule,
  replaceGhostSessionsWithRealPlan,
  SmartSchedulerEngine,
};

export async function generateStudyPlan(
  exam: Exam,
  user: User,
): Promise<SmartSchedulerResult> {
  void user;
  return generateSmartSchedule(exam.id, {
    includeProgress: false,
    preserveLoggedSessions: false,
    dryRun: false,
  });
}
