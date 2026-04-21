"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";

import {
  resolveDayCollision,
  type ResolveDayCollisionResult,
} from "@/app/calendar/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CollisionFixButtonProps = {
  date: Date | string;
  className?: string;
  onResolved?: (result: ResolveDayCollisionResult) => void;
};

function normalizeDateInput(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data collisione non valida");
  }

  return parsed;
}

export function CollisionFixButton({
  date,
  className,
  onResolved,
}: CollisionFixButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleResolve = () => {
    if (isPending) {
      return;
    }

    setError(null);
    setStatus(null);

    startTransition(async () => {
      try {
        const parsedDate = normalizeDateInput(date);
        const result = await resolveDayCollision(parsedDate);

        const statusLine =
          result.movedTopics > 0
            ? `Collisione ridotta: spostati ${result.movedTopics} topic (${result.movedSessions} sessioni).`
            : "Nessun topic da spostare: carico gia bilanciato o vincoli forti.";

        setStatus(statusLine);
        onResolved?.(result);
        router.refresh();
      } catch (resolveError) {
        setError(
          resolveError instanceof Error
            ? resolveError.message
            : "Impossibile risolvere la collisione.",
        );
      }
    });
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <Button
        type="button"
        variant="outline"
        onClick={handleResolve}
        disabled={isPending}
        className="h-10 rounded-xl border-zinc-700 bg-zinc-900/90 text-zinc-100 hover:bg-zinc-800"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="h-4 w-4" />
        )}
        {isPending ? "Risoluzione..." : "Risolvi Collisione"}
      </Button>

      {status ? <p className="text-xs text-emerald-300">{status}</p> : null}
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
