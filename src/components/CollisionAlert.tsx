import { AlertTriangle, CalendarRange, Sparkles } from "lucide-react";

import { CollisionFixButton } from "@/components/CollisionFixButton";
import type { CollisionDashboardWarning } from "@/lib/scheduler";

type CollisionAlertProps = {
  warning: CollisionDashboardWarning | null;
};

function formatIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "N/D";
  }

  return parsed.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function CollisionAlert({ warning }: CollisionAlertProps) {
  if (!warning) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-rose-400/40 bg-[linear-gradient(155deg,rgba(127,29,29,0.35),rgba(24,24,27,0.9))] px-4 py-4 shadow-[0_20px_45px_-30px_rgba(220,38,38,0.6)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-rose-400/35 bg-rose-500/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-rose-100">
            <AlertTriangle className="h-3.5 w-3.5" />
            Collision Detector
          </p>
          <h2 className="mt-2 text-base font-semibold text-zinc-100">
            Carico critico rilevato
          </h2>
          <p className="mt-1 text-sm text-zinc-200">{warning.message}</p>
        </div>

        <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
          <p className="inline-flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5 text-rose-300" />
            Settimana dal {formatIsoDate(warning.weekStartDate)}
          </p>
          <p className="mt-1">Picco: {warning.topicDensity} topic/giorno</p>
          <p>Soglia: {warning.threshold} topic/giorno</p>
          {warning.suggestedCourseName &&
          warning.recommendedAdvanceDays !== null ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              Early start: {warning.suggestedCourseName} (
              {warning.recommendedAdvanceDays}gg)
            </p>
          ) : null}

          <CollisionFixButton date={warning.collisionDate} className="mt-2" />
        </div>
      </div>
    </section>
  );
}
