export {
  ElasticSchedulerEngine,
  GENERIC_STUDY_SESSION_NAME,
  SmartSchedulerEngine,
  estimateTotalStudyHours,
  generateSmartSchedule,
  generateStudyPlan,
  recalculateSchedule,
  replaceGhostSessionsWithRealPlan,
} from "@/lib/scheduler";

export type { BuildPlanOptions, SmartSchedulerResult } from "@/lib/scheduler";
