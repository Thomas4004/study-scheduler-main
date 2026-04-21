"use client";

import { Pause, Play, SkipForward } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LofiStreamStation = {
  id: string;
  name: string;
  url: string;
};

const LOFI_STREAM_STATIONS: LofiStreamStation[] = [
  {
    id: "lautfm-lofi",
    name: "laut.fm LoFi (24/7)",
    url: "https://stream.laut.fm/lofi",
  },
];

function pickRandomStation(excludeId: string | null) {
  const candidates =
    excludeId && LOFI_STREAM_STATIONS.length > 1
      ? LOFI_STREAM_STATIONS.filter((station) => station.id !== excludeId)
      : LOFI_STREAM_STATIONS;

  const safePool = candidates.length > 0 ? candidates : LOFI_STREAM_STATIONS;
  const randomIndex = Math.floor(Math.random() * safePool.length);
  return safePool[randomIndex];
}

export function AppleMusicQuickControls() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStation, setCurrentStation] =
    useState<LofiStreamStation | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const startStation = useCallback(async (excludeId: string | null) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const nextStation = pickRandomStation(excludeId);
    setPlaybackError(null);

    try {
      audio.pause();
      audio.src = nextStation.url;
      audio.load();
      audio.volume = 0.95;
      await audio.play();
      setCurrentStation(nextStation);
      setIsPlaying(true);
    } catch {
      setPlaybackError(
        "Impossibile avviare lo stream ora. Riprova tra qualche secondo.",
      );
    }
  }, []);

  const handlePlay = useCallback(async () => {
    await startStation(currentStation?.id ?? null);
  }, [currentStation?.id, startStation]);

  const handleSkip = useCallback(async () => {
    if (!isPlaying) {
      return;
    }

    await startStation(currentStation?.id ?? null);
  }, [currentStation?.id, isPlaying, startStation]);

  const handleStop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    setIsPlaying(false);
  }, []);

  return (
    <div>
      <audio
        ref={audioRef}
        preload="none"
        loop
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className="hidden"
      />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon-lg"
          className={cn(
            "h-14 w-14 rounded-xl [&_svg]:size-5",
            isPlaying
              ? "bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
              : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
          )}
          onClick={handlePlay}
          aria-label="Avvia Lo-Fi"
          title="Avvia nuovo stream Lo-Fi"
        >
          <Play className="h-4 w-4" />
          <span className="sr-only">Avvia nuovo stream Lo-Fi</span>
        </Button>

        {LOFI_STREAM_STATIONS.length > 1 ? (
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="h-14 w-14 rounded-xl border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800 [&_svg]:size-5"
            onClick={handleSkip}
            disabled={!isPlaying}
            aria-label="Salta stazione Lo-Fi"
            title="Salta a un'altra stazione"
          >
            <SkipForward className="h-4 w-4" />
            <span className="sr-only">Salta a un&apos;altra stazione</span>
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="h-14 w-14 rounded-xl border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800 [&_svg]:size-5"
          onClick={handleStop}
          disabled={!isPlaying}
          aria-label="Stop Lo-Fi"
          title="Stop Lo-Fi"
        >
          <Pause className="h-4 w-4" />
          <span className="sr-only">Stop Lo-Fi</span>
        </Button>
      </div>

      {currentStation ? (
        <p className="mt-3 max-w-full break-words text-sm leading-snug text-zinc-400">
          {currentStation.name}
        </p>
      ) : null}

      {playbackError ? (
        <p className="mt-3 max-w-full break-words text-sm leading-snug text-amber-300">
          {playbackError}
        </p>
      ) : null}
    </div>
  );
}
