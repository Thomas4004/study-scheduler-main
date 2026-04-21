import { AlertTriangle, Gauge, GraduationCap, Timer } from "lucide-react";

import {
  deleteAllWorkspaceData,
  updateCorePreferences,
} from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  type SettingsUserRecord = {
    id: string;
    pomodoro_focus_minutes: number;
    pomodoro_short_break_minutes: number;
    pomodoro_long_break_minutes: number;
    degree_target_cfu: number;
  };

  let user: SettingsUserRecord | null = null;

  try {
    user = await prisma.user.findFirst({
      select: {
        id: true,
        pomodoro_focus_minutes: true,
        pomodoro_short_break_minutes: true,
        pomodoro_long_break_minutes: true,
        degree_target_cfu: true,
      },
    });
  } catch (error) {
    const hasMissingSettingsColumn =
      isMissingColumnError(error, "pomodoro_focus_minutes") ||
      isMissingColumnError(error, "pomodoro_short_break_minutes") ||
      isMissingColumnError(error, "pomodoro_long_break_minutes") ||
      isMissingColumnError(error, "degree_target_cfu");

    if (!hasMissingSettingsColumn) {
      throw error;
    }

    const legacyUser = await prisma.user.findFirst({
      select: {
        id: true,
        max_focus_minutes: true,
      },
    });

    user = legacyUser
      ? {
          id: legacyUser.id,
          pomodoro_focus_minutes: legacyUser.max_focus_minutes,
          pomodoro_short_break_minutes: 5,
          pomodoro_long_break_minutes: 15,
          degree_target_cfu: 180,
        }
      : null;
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            No user profile found. Run seed to bootstrap default settings.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Control Center
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
          Settings
        </h1>
        <p className="text-sm text-zinc-400">
          Preferenze essenziali per timer, carriera universitaria e sicurezza
          dati.
        </p>
      </section>

      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-zinc-100">
            <Timer className="h-4 w-4" />
            Timer Preferences
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Configura durata Focus e pause per la modalita Focus.
          </CardDescription>
        </CardHeader>
        <form action={updateCorePreferences} className="space-y-4 px-6 pb-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pomodoroFocusMinutes">Focus (min)</Label>
              <Input
                id="pomodoroFocusMinutes"
                name="pomodoroFocusMinutes"
                type="number"
                min={15}
                max={120}
                defaultValue={user.pomodoro_focus_minutes}
                required
                className="border-zinc-700 bg-zinc-950 text-zinc-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pomodoroShortBreakMinutes">
                Short Break (min)
              </Label>
              <Input
                id="pomodoroShortBreakMinutes"
                name="pomodoroShortBreakMinutes"
                type="number"
                min={3}
                max={30}
                defaultValue={user.pomodoro_short_break_minutes}
                required
                className="border-zinc-700 bg-zinc-950 text-zinc-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pomodoroLongBreakMinutes">Long Break (min)</Label>
              <Input
                id="pomodoroLongBreakMinutes"
                name="pomodoroLongBreakMinutes"
                type="number"
                min={10}
                max={60}
                defaultValue={user.pomodoro_long_break_minutes}
                required
                className="border-zinc-700 bg-zinc-950 text-zinc-100"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-2 inline-flex items-center gap-2 text-zinc-200">
              <GraduationCap className="h-4 w-4" />
              <p className="text-sm font-semibold">Target Universita</p>
            </div>
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="degreeTargetCfu">CFU obiettivo laurea</Label>
              <Input
                id="degreeTargetCfu"
                name="degreeTargetCfu"
                type="number"
                min={60}
                max={420}
                defaultValue={user.degree_target_cfu}
                required
                className="border-zinc-700 bg-zinc-950 text-zinc-100"
              />
            </div>
          </div>

          <Button
            type="submit"
            className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
          >
            <Gauge className="h-4 w-4" />
            Salva Preferenze
          </Button>
        </form>
      </Card>

      <Card className="border-red-950 bg-red-950/20">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-red-100">
            <AlertTriangle className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <CardDescription className="text-red-200/75">
            Elimina tutti i dati di corsi, esami, topic, materiali e sessioni.
            Azione irreversibile.
          </CardDescription>
        </CardHeader>
        <form action={deleteAllWorkspaceData} className="px-6 pb-6">
          <Button type="submit" variant="destructive">
            Elimina Tutti i Dati
          </Button>
        </form>
      </Card>
    </div>
  );
}
