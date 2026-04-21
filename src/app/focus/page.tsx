import { format } from "date-fns";
import { Music2 } from "lucide-react";
import { Sora, Space_Mono } from "next/font/google";

import { AppleMusicQuickControls } from "@/components/focus/apple-music-quick-controls";
import { FocusTimerStudio } from "@/components/focus/focus-timer-studio";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
});

async function getFocusData() {
  type FocusUserRecord = {
    id: string;
    max_focus_minutes: number;
    pomodoro_focus_minutes: number;
    pomodoro_short_break_minutes: number;
    pomodoro_long_break_minutes: number;
  };

  let user: FocusUserRecord | null = null;

  try {
    user = await prisma.user.findFirst({
      select: {
        id: true,
        max_focus_minutes: true,
        pomodoro_focus_minutes: true,
        pomodoro_short_break_minutes: true,
        pomodoro_long_break_minutes: true,
      },
    });
  } catch (error) {
    const hasMissingPomodoroColumn =
      isMissingColumnError(error, "pomodoro_focus_minutes") ||
      isMissingColumnError(error, "pomodoro_short_break_minutes") ||
      isMissingColumnError(error, "pomodoro_long_break_minutes");

    if (!hasMissingPomodoroColumn) {
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
          max_focus_minutes: legacyUser.max_focus_minutes,
          pomodoro_focus_minutes: legacyUser.max_focus_minutes,
          pomodoro_short_break_minutes: 5,
          pomodoro_long_break_minutes: 15,
        }
      : null;
  }

  if (!user) {
    return {
      user: null,
    };
  }

  return {
    user: {
      id: user.id,
      focusMinutes:
        user.pomodoro_focus_minutes ?? Math.max(15, user.max_focus_minutes),
      shortBreakMinutes: user.pomodoro_short_break_minutes ?? 5,
      longBreakMinutes: user.pomodoro_long_break_minutes ?? 15,
    },
  };
}

export default async function FocusModePage() {
  const { user } = await getFocusData();

  if (!user) {
    return (
      <Card className="border-zinc-900 bg-zinc-950/40 shadow-none">
        <CardHeader>
          <CardTitle>Focus</CardTitle>
          <CardDescription>
            Crea un profilo utente e almeno un esame attivo per iniziare.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <h1
          className={cn(
            "text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl",
            sora.className,
          )}
        >
          Focus Studio
        </h1>
        <p className="text-sm text-zinc-400">
          {format(new Date(), "EEEE, dd MMMM yyyy")}
        </p>
      </section>

      <section className="bento-rise">
        <FocusTimerStudio
          focusMinutes={user.focusMinutes}
          shortBreakMinutes={user.shortBreakMinutes}
          longBreakMinutes={user.longBreakMinutes}
          headingClassName={sora.className}
          timeClassName={spaceMono.className}
          mediaPanel={
            <div className="space-y-1.5">
              <p
                className={cn(
                  "inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-400",
                  sora.className,
                )}
              >
                <Music2 className="h-3.5 w-3.5 text-emerald-300" />
                Lo-Fi Radio
              </p>
              <AppleMusicQuickControls />
            </div>
          }
        />
      </section>
    </div>
  );
}
