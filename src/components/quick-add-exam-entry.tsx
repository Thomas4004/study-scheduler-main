"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type IntensityValue = "SIMPLE" | "MEDIUM" | "HARD";

const SEEDED_USER_ID = "clxzw75h9000014ut33z1xtu1";

function normalizeIntensity(token: string): IntensityValue | null {
  const value = token.trim().toUpperCase();

  if (value === "SIMPLE" || value === "SEMPLICE") return "SIMPLE";
  if (value === "MEDIUM" || value === "MEDIO") return "MEDIUM";
  if (value === "HARD" || value === "DIFFICILE") return "HARD";

  return null;
}

function parseDateToken(token: string): Date | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const isoCandidate = new Date(trimmed);
  if (!Number.isNaN(isoCandidate.getTime())) {
    return new Date(
      isoCandidate.getFullYear(),
      isoCandidate.getMonth(),
      isoCandidate.getDate(),
      12,
      0,
      0,
      0,
    );
  }

  const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!ddmmyyyy) return null;

  const day = Number(ddmmyyyy[1]);
  const month = Number(ddmmyyyy[2]);
  const year = Number(ddmmyyyy[3]);
  const parsed = new Date(year, month - 1, day);

  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function defaultDifficultyFromIntensity(intensity: IntensityValue) {
  if (intensity === "SIMPLE") return 2;
  if (intensity === "HARD") return 4;
  return 3;
}

function parseQuickLine(line: string):
  | {
      name: string;
      examDate: Date;
      intensity: IntensityValue;
    }
  | {
      error: string;
    } {
  const chunks = line
    .split("|")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length < 2) {
    return {
      error:
        "Formato rapido: Nome esame | YYYY-MM-DD | semplice|medio|difficile",
    };
  }

  const name = chunks[0];
  if (name.length < 2) {
    return { error: "Il nome esame deve avere almeno 2 caratteri." };
  }

  const examDate = parseDateToken(chunks[1]);
  if (!examDate) {
    return { error: "Data non valida. Usa YYYY-MM-DD o DD/MM/YYYY." };
  }

  let intensity: IntensityValue = "MEDIUM";

  for (const rawToken of chunks.slice(2)) {
    const token = rawToken.trim();
    if (!token) continue;

    const maybeIntensity = normalizeIntensity(token);
    if (maybeIntensity) {
      intensity = maybeIntensity;
    }
  }

  return {
    name,
    examDate,
    intensity,
  };
}

export function QuickAddExamEntry() {
  const router = useRouter();
  const [line, setLine] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const preview = useMemo(() => parseQuickLine(line), [line]);

  const handleQuickAdd = async () => {
    setError(null);
    setStatus(null);

    const parsed = parseQuickLine(line);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/exams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: parsed.name,
          exam_date: parsed.examDate.toISOString(),
          intensity: parsed.intensity,
          difficulty: defaultDifficultyFromIntensity(parsed.intensity),
          topics: [],
          userId: SEEDED_USER_ID,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        warning?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Creazione esame rapida non riuscita.",
        );
      }

      setStatus(
        payload.warning
          ? `Esame creato con warning: ${payload.warning}`
          : "Esame creato con Quick Add.",
      );
      setLine("");
      router.refresh();
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Creazione esame rapida non riuscita.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-border/70 bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="inline-flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Quick Add
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={line}
            onChange={(event) => setLine(event.target.value)}
            placeholder="Analisi II | 2026-07-15 | difficile"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!isSubmitting) {
                  void handleQuickAdd();
                }
              }
            }}
          />
          <Button onClick={() => void handleQuickAdd()} disabled={isSubmitting}>
            <CornerDownLeft className="h-4 w-4" />
            {isSubmitting ? "Creazione..." : "Aggiungi"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Inserisci: nome | data | intensita opzionale.
        </p>

        {line.trim().length > 0 && !("error" in preview) ? (
          <p className="text-xs text-muted-foreground">
            Preview: {preview.name} -{" "}
            {preview.examDate.toISOString().slice(0, 10)} - {preview.intensity}
          </p>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {status ? <p className="text-xs text-foreground">{status}</p> : null}
      </CardContent>
    </Card>
  );
}
