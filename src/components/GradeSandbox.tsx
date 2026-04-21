"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GraduationCap,
  Plus,
  Sigma,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  simulateGraduation,
  type HypotheticalExamInput,
  type SimulationCurrentStats,
} from "@/lib/grade-simulation";
import { cn } from "@/lib/utils";

type GradeSandboxProps = {
  currentStats: SimulationCurrentStats;
};

type SandboxRow = {
  id: string;
  name: string;
  cfu: number;
  grade: number;
};

const MIN_GRADE = 18;
const MAX_GRADE = 30;
const DEFAULT_CFU = 6;
const DEFAULT_GRADE = 24;

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createRow(index: number): SandboxRow {
  return {
    id: `sandbox-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: `Esame Futuro ${index}`,
    cfu: DEFAULT_CFU,
    grade: DEFAULT_GRADE,
  };
}

function formatMetric(value: number | null, decimals = 2) {
  if (value === null) return "N/D";
  return value.toFixed(decimals);
}

function formatDelta(value: number) {
  const rounded = round(value, 2);
  if (Math.abs(rounded) < 0.01) return "0.00";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
}

function useAnimatedNumber(target: number | null, duration = 320) {
  const [displayValue, setDisplayValue] = useState<number | null>(target);
  const previousValueRef = useRef<number | null>(target);

  useEffect(() => {
    if (target === null) {
      previousValueRef.current = null;
      setDisplayValue(null);
      return;
    }

    const from = previousValueRef.current ?? target;
    if (Math.abs(from - target) < 0.01) {
      previousValueRef.current = target;
      setDisplayValue(target);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (target - from) * eased;

      setDisplayValue(round(next, 2));

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }

      previousValueRef.current = target;
      setDisplayValue(target);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [duration, target]);

  return displayValue;
}

export function GradeSandbox({ currentStats }: GradeSandboxProps) {
  const [rows, setRows] = useState<SandboxRow[]>(() => [createRow(1)]);

  const hypotheticalExams = useMemo<HypotheticalExamInput[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        cfu: row.cfu,
        grade: row.grade,
      })),
    [rows],
  );

  const projection = useMemo(
    () => simulateGraduation(currentStats, hypotheticalExams),
    [currentStats, hypotheticalExams],
  );

  const animatedAverage = useAnimatedNumber(projection.weightedAverage);
  const animatedDegree = useAnimatedNumber(projection.degreeBaseScore);

  const addRow = () => {
    setRows((current) => [...current, createRow(current.length + 1)]);
  };

  const removeRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const updateRow = <K extends keyof SandboxRow>(
    rowId: string,
    key: K,
    value: SandboxRow[K],
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [key]: value,
            }
          : row,
      ),
    );
  };

  const hasSimulation = projection.hypotheticalCfu > 0;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-[0_22px_55px_-28px_rgba(0,0,0,0.9)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-xs uppercase tracking-[0.16em] text-zinc-300">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            Sandbox Proiezioni
          </p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-100">
            Simulatore What-If del Libretto
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Aggiungi esami futuri, regola i voti con gli slider e osserva in
            tempo reale l&apos;impatto su media ponderata e voto base di laurea.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={addRow}
          className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" />
          Aggiungi esame
        </Button>
      </div>

      <div className="mt-5 grid gap-3">
        {rows.map((row) => (
          <article
            key={row.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/55 px-3 py-3"
          >
            <div className="grid gap-3 sm:grid-cols-[1.3fr_110px_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <label
                  htmlFor={`exam-name-${row.id}`}
                  className="text-[11px] uppercase tracking-wide text-zinc-500"
                >
                  Esame
                </label>
                <Input
                  id={`exam-name-${row.id}`}
                  value={row.name}
                  onChange={(event) =>
                    updateRow(row.id, "name", event.target.value)
                  }
                  placeholder="Nome esame"
                  className="border-zinc-700 bg-zinc-950 text-zinc-100"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={`exam-cfu-${row.id}`}
                  className="text-[11px] uppercase tracking-wide text-zinc-500"
                >
                  CFU
                </label>
                <Input
                  id={`exam-cfu-${row.id}`}
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={row.cfu}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    updateRow(
                      row.id,
                      "cfu",
                      Number.isFinite(next) ? clamp(next, 0, 30) : 0,
                    );
                  }}
                  className="border-zinc-700 bg-zinc-950 text-zinc-100"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-zinc-500">
                  <label htmlFor={`exam-grade-${row.id}`}>
                    Voto Ipotizzato
                  </label>
                  <span className="font-semibold text-cyan-300">
                    {row.grade}
                  </span>
                </div>
                <input
                  id={`exam-grade-${row.id}`}
                  type="range"
                  min={MIN_GRADE}
                  max={MAX_GRADE}
                  step={1}
                  value={row.grade}
                  onChange={(event) =>
                    updateRow(
                      row.id,
                      "grade",
                      clamp(Number(event.target.value), MIN_GRADE, MAX_GRADE),
                    )
                  }
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-400"
                />
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{MIN_GRADE}</span>
                  <span>{MAX_GRADE}</span>
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={() => removeRow(row.id)}
                disabled={rows.length === 1}
                className="h-10 text-zinc-300 hover:bg-zinc-800/80"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <article
          className={cn(
            "rounded-xl border bg-zinc-900/70 px-4 py-3 transition-all duration-300",
            projection.deltas.weightedAverage >= 0
              ? "border-cyan-400/35"
              : "border-amber-400/35",
          )}
        >
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400">
            <Sigma className="h-3.5 w-3.5 text-cyan-400" />
            Media Ponderata (Proiezione)
          </p>
          <p className="mt-1 text-3xl font-bold text-zinc-100">
            {formatMetric(animatedAverage)}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Reale: {formatMetric(currentStats.weightedAverage)} • Delta:{" "}
            <span
              className={cn(
                "font-semibold",
                projection.deltas.weightedAverage >= 0
                  ? "text-emerald-300"
                  : "text-amber-300",
              )}
            >
              {formatDelta(projection.deltas.weightedAverage)}
            </span>
          </p>
        </article>

        <article
          className={cn(
            "rounded-xl border bg-zinc-900/70 px-4 py-3 transition-all duration-300",
            projection.deltas.degreeBaseScore >= 0
              ? "border-cyan-400/35"
              : "border-amber-400/35",
          )}
        >
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400">
            <GraduationCap className="h-3.5 w-3.5 text-cyan-400" />
            Voto Base Laurea (su 110)
          </p>
          <p className="mt-1 text-3xl font-bold text-zinc-100">
            {formatMetric(animatedDegree)}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Reale: {formatMetric(currentStats.degreeBaseScore)} • Delta:{" "}
            <span
              className={cn(
                "font-semibold",
                projection.deltas.degreeBaseScore >= 0
                  ? "text-emerald-300"
                  : "text-amber-300",
              )}
            >
              {formatDelta(projection.deltas.degreeBaseScore)}
            </span>
          </p>
        </article>
      </div>

      <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/55 px-4 py-3">
        <p className="inline-flex items-center gap-2 text-xs text-zinc-400">
          <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />
          Carico simulato: +{projection.hypotheticalCfu.toFixed(0)} CFU •
          Progressione laurea {projection.progressPercent.toFixed(1)}%
        </p>
        {!hasSimulation ? (
          <p className="mt-1 text-xs text-zinc-500">
            Inserisci almeno un esame con CFU &gt; 0 per attivare la proiezione.
          </p>
        ) : null}
      </div>
    </section>
  );
}
