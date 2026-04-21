import {
  BookCheck,
  Calculator,
  GraduationCap,
  Sigma,
  TrendingUp,
} from "lucide-react";

import { GradeSandbox } from "@/components/GradeSandbox";
import type { GlobalCareerStats } from "@/lib/global-career-stats";

type GlobalCareerDashboardProps = {
  stats: GlobalCareerStats;
  userName?: string | null;
};

function formatGrade(value: number | null) {
  if (value === null) {
    return "N/D";
  }

  return value.toFixed(2);
}

export function GlobalCareerDashboard({
  stats,
  userName,
}: GlobalCareerDashboardProps) {
  const progress = Math.max(0, Math.min(100, stats.progressPercent));
  const ringRadius = 56;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - progress / 100);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-xs uppercase tracking-[0.18em] text-zinc-300">
          <GraduationCap className="h-3.5 w-3.5" />
          Global Career Dashboard
        </p>
        <h1 className="text-2xl font-semibold text-zinc-100">
          {userName
            ? `${userName} · Libretto Universitario`
            : "Libretto Universitario"}
        </h1>
        <p className="text-sm text-zinc-400">
          Tracciamento CFU, media ponderata e stima voto di laurea su base 110.
        </p>
      </div>

      <div className="grid auto-rows-[minmax(220px,auto)] grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-[0_22px_55px_-28px_rgba(0,0,0,0.9)] lg:col-span-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(24,24,27,0.9),rgba(9,9,11,0.95)_65%)]" />
          <div className="relative flex h-full flex-col justify-between gap-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
              <BookCheck className="h-3.5 w-3.5 text-cyan-400" />
              CFU Progress
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="relative h-36 w-36 shrink-0">
                <svg
                  viewBox="0 0 140 140"
                  className="h-full w-full -rotate-90"
                  aria-label="CFU progress ring"
                >
                  <circle
                    cx="70"
                    cy="70"
                    r={ringRadius}
                    stroke="rgb(39 39 42)"
                    strokeWidth="11"
                    fill="transparent"
                  />
                  <circle
                    cx="70"
                    cy="70"
                    r={ringRadius}
                    stroke="rgb(34 211 238)"
                    strokeWidth="11"
                    fill="transparent"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-2xl font-semibold text-zinc-100">
                    {Math.round(progress)}%
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-zinc-400">
                    completato
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-3xl font-bold text-zinc-100">
                  {stats.totalCfu} / {stats.graduationTargetCfu} CFU
                </p>
                <p className="text-sm text-zinc-400">
                  Mancano {stats.cfuRemaining} CFU al traguardo laurea.
                </p>
                <div className="h-2.5 w-full min-w-52 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-[0_22px_55px_-28px_rgba(0,0,0,0.9)] lg:col-span-7">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />
            Analytics
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400">
                <Sigma className="h-3.5 w-3.5 text-cyan-400" />
                Media ponderata
              </p>
              <p className="mt-2 text-3xl font-bold text-zinc-100">
                {stats.weightedAverage === null
                  ? "N/D"
                  : stats.weightedAverage.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Calcolata su {stats.cfuForAverage} CFU formanti media
              </p>
            </article>

            <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400">
                <Calculator className="h-3.5 w-3.5 text-cyan-400" />
                Voto base laurea
              </p>
              <p className="mt-2 text-3xl font-bold text-zinc-100">
                {stats.degreeBaseScore === null
                  ? "N/D"
                  : stats.degreeBaseScore.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Formula: media x 110 / 30
              </p>
            </article>

            <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400">
                <BookCheck className="h-3.5 w-3.5 text-cyan-400" />
                Corsi completati
              </p>
              <p className="mt-2 text-3xl font-bold text-zinc-100">
                {stats.completedCourses.length}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Inclusi corsi con idoneita (pass/fail)
              </p>
            </article>
          </div>
        </section>
      </div>

      <GradeSandbox
        currentStats={{
          weightedAverage: stats.weightedAverage,
          degreeBaseScore: stats.degreeBaseScore,
          cfuForAverage: stats.cfuForAverage,
          totalCfu: stats.totalCfu,
          graduationTargetCfu: stats.graduationTargetCfu,
        }}
      />

      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-[0_22px_55px_-28px_rgba(0,0,0,0.9)]">
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            Corsi completati
          </h2>
          <p className="text-xs text-zinc-400">
            Nome corso, CFU e voto finale. Le idoneita sono escluse dalla media.
          </p>
        </div>

        {stats.completedCourses.length === 0 ? (
          <div className="px-5 py-8 text-sm text-zinc-400">
            Nessun corso completato al momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/70 text-xs uppercase tracking-wide text-zinc-400">
                  <th className="px-5 py-3 font-medium">Corso</th>
                  <th className="px-5 py-3 font-medium">CFU</th>
                  <th className="px-5 py-3 font-medium">Voto</th>
                </tr>
              </thead>
              <tbody>
                {stats.completedCourses.map((course) => (
                  <tr
                    key={course.id}
                    className="border-b border-zinc-900/80 text-zinc-200"
                  >
                    <td className="px-5 py-3">{course.name}</td>
                    <td className="px-5 py-3">{course.cfu}</td>
                    <td className="px-5 py-3">
                      {course.isPassFail ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-emerald-300">
                          Idoneo
                        </span>
                      ) : (
                        <span className="font-semibold text-zinc-100">
                          {formatGrade(course.finalGrade)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
