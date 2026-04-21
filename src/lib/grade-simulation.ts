export type SimulationCurrentStats = {
  weightedAverage: number | null;
  degreeBaseScore: number | null;
  cfuForAverage: number;
  totalCfu: number;
  graduationTargetCfu: number;
};

export type HypotheticalExamInput = {
  id?: string;
  name?: string;
  cfu: number;
  grade: number;
};

export type GraduationSimulationResult = {
  weightedAverage: number | null;
  degreeBaseScore: number | null;
  cfuForAverage: number;
  totalCfu: number;
  cfuRemaining: number;
  progressPercent: number;
  hypotheticalCfu: number;
  deltas: {
    weightedAverage: number;
    degreeBaseScore: number;
    totalCfu: number;
  };
};

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeCfu(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, round(parsed, 2));
}

function normalizeGrade(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 18;
  }

  return round(clamp(parsed, 18, 30), 2);
}

function computeDelta(projected: number | null, baseline: number | null) {
  if (projected === null && baseline === null) return 0;
  if (projected === null) return round(-(baseline ?? 0), 2);
  if (baseline === null) return round(projected, 2);
  return round(projected - baseline, 2);
}

export function simulateGraduation(
  currentStats: SimulationCurrentStats,
  hypotheticalExams: HypotheticalExamInput[],
): GraduationSimulationResult {
  const currentCfuForAverage = normalizeCfu(currentStats.cfuForAverage);
  const currentTotalCfu = normalizeCfu(currentStats.totalCfu);
  const graduationTargetCfu = Math.max(
    0,
    normalizeCfu(currentStats.graduationTargetCfu),
  );

  const baselineWeightedAverage =
    currentStats.weightedAverage === null
      ? null
      : round(currentStats.weightedAverage, 2);
  const baselinePoints =
    (baselineWeightedAverage ?? 0) * Math.max(0, currentCfuForAverage);

  const normalizedHypothetical = hypotheticalExams
    .map((exam) => ({
      cfu: normalizeCfu(exam.cfu),
      grade: normalizeGrade(exam.grade),
    }))
    .filter((exam) => exam.cfu > 0);

  const hypotheticalCfu = round(
    normalizedHypothetical.reduce((sum, exam) => sum + exam.cfu, 0),
    2,
  );

  const hypotheticalPoints = round(
    normalizedHypothetical.reduce(
      (sum, exam) => sum + exam.grade * exam.cfu,
      baselinePoints,
    ),
    4,
  );

  const projectedCfuForAverage = round(
    currentCfuForAverage + hypotheticalCfu,
    2,
  );
  const projectedWeightedAverage =
    projectedCfuForAverage > 0
      ? round(hypotheticalPoints / projectedCfuForAverage, 2)
      : null;

  const projectedDegreeBase =
    projectedWeightedAverage === null
      ? null
      : round((projectedWeightedAverage * 110) / 30, 2);

  const projectedTotalCfu = round(currentTotalCfu + hypotheticalCfu, 2);
  const projectedRemainingCfu = Math.max(
    0,
    round(graduationTargetCfu - projectedTotalCfu, 2),
  );
  const projectedProgressPercent =
    graduationTargetCfu > 0
      ? round(Math.min(100, (projectedTotalCfu / graduationTargetCfu) * 100), 2)
      : 0;

  const baselineDegreeBase =
    currentStats.degreeBaseScore === null
      ? null
      : round(currentStats.degreeBaseScore, 2);

  return {
    weightedAverage: projectedWeightedAverage,
    degreeBaseScore: projectedDegreeBase,
    cfuForAverage: projectedCfuForAverage,
    totalCfu: projectedTotalCfu,
    cfuRemaining: projectedRemainingCfu,
    progressPercent: projectedProgressPercent,
    hypotheticalCfu,
    deltas: {
      weightedAverage: computeDelta(
        projectedWeightedAverage,
        baselineWeightedAverage,
      ),
      degreeBaseScore: computeDelta(projectedDegreeBase, baselineDegreeBase),
      totalCfu: round(projectedTotalCfu - currentTotalCfu, 2),
    },
  };
}
