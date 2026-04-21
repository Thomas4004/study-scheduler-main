"use client";

import { ExamIntensity, ExamStatus } from "@prisma/client";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { archiveExam, updateExam } from "@/app/exams/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ExamSettingsFormProps = {
  exam: {
    id: string;
    name: string;
    examDate: string;
    difficulty: number;
    intensity: ExamIntensity;
    bufferDays: number;
    weight: number;
    colorCode: string;
    grade: number | null;
    status: ExamStatus;
    notes: string | null;
  };
  earliestStartDate: string | null;
};

function toDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

export function ExamSettingsForm({
  exam,
  earliestStartDate,
}: ExamSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(exam.name);
  const [examDate, setExamDate] = useState(toDateInputValue(exam.examDate));
  const [difficulty, setDifficulty] = useState(String(exam.difficulty));
  const [intensity, setIntensity] = useState<"SIMPLE" | "MEDIUM" | "HARD">(
    exam.intensity,
  );
  const [bufferDays, setBufferDays] = useState(String(exam.bufferDays));
  const [weightPercent, setWeightPercent] = useState(
    String(Math.round(exam.weight * 10000) / 100),
  );
  const [colorCode, setColorCode] = useState(exam.colorCode);
  const [grade, setGrade] = useState(
    exam.grade === null ? "" : String(exam.grade),
  );
  const [status, setStatus] = useState<"ACTIVE" | "COMPLETED" | "ARCHIVED">(
    exam.status,
  );
  const [notes, setNotes] = useState(exam.notes ?? "");
  const [earliestDate, setEarliestDate] = useState(
    toDateInputValue(earliestStartDate),
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const hydrateFormFromExam = () => {
    setName(exam.name);
    setExamDate(toDateInputValue(exam.examDate));
    setDifficulty(String(exam.difficulty));
    setIntensity(exam.intensity);
    setBufferDays(String(exam.bufferDays));
    setWeightPercent(String(Math.round(exam.weight * 10000) / 100));
    setColorCode(exam.colorCode);
    setGrade(exam.grade === null ? "" : String(exam.grade));
    setStatus(exam.status);
    setNotes(exam.notes ?? "");
    setEarliestDate(toDateInputValue(earliestStartDate));
  };

  const dirty = useMemo(() => {
    return (
      name !== exam.name ||
      examDate !== toDateInputValue(exam.examDate) ||
      difficulty !== String(exam.difficulty) ||
      intensity !== exam.intensity ||
      bufferDays !== String(exam.bufferDays) ||
      weightPercent !== String(Math.round(exam.weight * 10000) / 100) ||
      colorCode !== exam.colorCode ||
      grade !== (exam.grade === null ? "" : String(exam.grade)) ||
      status !== exam.status ||
      notes !== (exam.notes ?? "") ||
      earliestDate !== toDateInputValue(earliestStartDate)
    );
  }, [
    bufferDays,
    colorCode,
    difficulty,
    earliestDate,
    earliestStartDate,
    exam.bufferDays,
    exam.colorCode,
    exam.difficulty,
    exam.examDate,
    exam.grade,
    exam.intensity,
    exam.name,
    exam.notes,
    exam.status,
    exam.weight,
    examDate,
    grade,
    intensity,
    name,
    notes,
    status,
    weightPercent,
  ]);

  const handleSubmit = () => {
    setError(null);
    setFeedback(null);

    const parsedDifficulty = Number(difficulty);
    const parsedBufferDays = Number(bufferDays);
    const parsedWeightPercent = Number(weightPercent);

    if (
      !Number.isInteger(parsedDifficulty) ||
      parsedDifficulty < 1 ||
      parsedDifficulty > 5
    ) {
      setError("Difficulty deve essere un intero tra 1 e 5.");
      return;
    }

    if (
      !Number.isInteger(parsedBufferDays) ||
      parsedBufferDays < 0 ||
      parsedBufferDays > 60
    ) {
      setError("Buffer days deve essere un intero tra 0 e 60.");
      return;
    }

    if (
      !Number.isFinite(parsedWeightPercent) ||
      parsedWeightPercent <= 0 ||
      parsedWeightPercent > 100
    ) {
      setError("Weight deve essere compreso tra 0 e 100.");
      return;
    }

    const parsedGrade = grade.trim().length === 0 ? null : Number(grade);
    if (
      parsedGrade !== null &&
      (!Number.isInteger(parsedGrade) || parsedGrade < 0 || parsedGrade > 110)
    ) {
      setError("Grade deve essere un intero tra 0 e 110.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateExam({
          examId: exam.id,
          name,
          examDate,
          difficulty: parsedDifficulty,
          intensity,
          bufferDays: parsedBufferDays,
          weight: parsedWeightPercent,
          colorCode,
          grade: parsedGrade,
          status,
          notes,
          earliestStartDate:
            earliestDate.trim().length > 0 ? earliestDate : null,
        });

        setFeedback(
          result.warning
            ? `Salvato con warning: ${result.warning}`
            : "Parametri esame aggiornati con successo.",
        );
        setOpen(false);
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Aggiornamento non riuscito.",
        );
      }
    });
  };

  const handleArchive = () => {
    if (isPending || status === "ARCHIVED") {
      return;
    }

    const shouldArchive = window.confirm(
      `Archiviare l'esame \"${name}\"? I topic del corso rimarranno invariati.`,
    );

    if (!shouldArchive) {
      return;
    }

    setError(null);
    setFeedback(null);

    startTransition(async () => {
      try {
        await archiveExam(exam.id);
        setStatus("ARCHIVED");
        setFeedback("Esame archiviato con successo.");
        setOpen(false);
        router.refresh();
      } catch (archiveError) {
        setError(
          archiveError instanceof Error
            ? archiveError.message
            : "Archiviazione non riuscita.",
        );
      }
    });
  };

  const closeModal = () => {
    if (isPending) {
      return;
    }

    setOpen(false);
    setError(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Parametri Esame</p>
          <p className="text-xs text-zinc-400">
            Modifica completa via modal con ricalcolo Just-in-Time.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            hydrateFormFromExam();
            setError(null);
            setOpen(true);
          }}
        >
          Modifica Esame
        </Button>
      </div>

      {feedback ? <p className="text-sm text-emerald-300">{feedback}</p> : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/85 backdrop-blur-sm"
            aria-label="Close exam settings modal"
            onClick={closeModal}
          />

          <Card className="relative max-h-[92vh] w-full max-w-4xl overflow-hidden border-zinc-800 bg-zinc-900/95 shadow-2xl">
            <CardHeader className="border-b border-zinc-800/80 pb-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-zinc-100">
                    Modifica Parametri Esame
                  </CardTitle>
                  <CardDescription className="text-zinc-400">
                    Aggiorna nome, peso, difficolta, data e strategia JIT.
                  </CardDescription>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={closeModal}
                  aria-label="Close"
                  disabled={isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="max-h-[calc(92vh-7rem)] space-y-4 overflow-y-auto pt-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="exam-name">Nome Esame</Label>
                  <Input
                    id="exam-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exam-date">Data Esame</Label>
                  <Input
                    id="exam-date"
                    type="date"
                    value={examDate}
                    onChange={(event) => setExamDate(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="earliest-start">Earliest Start (JIT)</Label>
                  <Input
                    id="earliest-start"
                    type="date"
                    value={earliestDate}
                    onChange={(event) => setEarliestDate(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exam-weight">Peso (%)</Label>
                  <Input
                    id="exam-weight"
                    type="number"
                    min={1}
                    max={100}
                    step="0.1"
                    value={weightPercent}
                    onChange={(event) => setWeightPercent(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exam-difficulty">Difficolta (1-5)</Label>
                  <Input
                    id="exam-difficulty"
                    type="number"
                    min={1}
                    max={5}
                    value={difficulty}
                    onChange={(event) => setDifficulty(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Intensita</Label>
                  <Select
                    value={intensity}
                    onValueChange={(value) =>
                      setIntensity(value as "SIMPLE" | "MEDIUM" | "HARD")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SIMPLE">Simple</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HARD">Hard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exam-buffer">Buffer Days</Label>
                  <Input
                    id="exam-buffer"
                    type="number"
                    min={0}
                    max={60}
                    value={bufferDays}
                    onChange={(event) => setBufferDays(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exam-grade">Voto</Label>
                  <Input
                    id="exam-grade"
                    type="number"
                    min={0}
                    max={110}
                    value={grade}
                    onChange={(event) => setGrade(event.target.value)}
                    placeholder="Opzionale"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={status}
                    onValueChange={(value) =>
                      setStatus(value as "ACTIVE" | "COMPLETED" | "ARCHIVED")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                      <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                      <SelectItem value="ARCHIVED">ARCHIVED</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exam-color">Colore</Label>
                  <Input
                    id="exam-color"
                    value={colorCode}
                    onChange={(event) => setColorCode(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="exam-notes">Note</Label>
                <textarea
                  id="exam-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-offset-background placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Note opzionali"
                />
              </div>

              {error ? <p className="text-sm text-rose-400">{error}</p> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isPending || !dirty}
                  className="min-w-36"
                >
                  {isPending ? "Salvataggio..." : "Salva Parametri"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={closeModal}
                  disabled={isPending}
                >
                  Annulla
                </Button>

                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleArchive}
                  disabled={isPending || status === "ARCHIVED"}
                >
                  Archivia Esame
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
