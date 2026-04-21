"use client";

import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  BookOpenCheck,
  CirclePlus,
  Loader2,
  Search,
  Timer,
} from "lucide-react";

import { GLOBAL_POMODORO_START_EVENT } from "@/components/pomodoro-widget";

type CommandPaletteContextValue = {
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
};

type CommandExam = {
  id: string;
  name: string;
  color_code: string;
  exam_date: string;
  courseName: string;
};

type CommandTopic = {
  id: string;
  name: string;
  examId: string;
  exam: {
    name: string;
    color_code: string;
    courseName: string;
  };
};

type CommandPayload = {
  exams: CommandExam[];
  topics: CommandTopic[];
};

type QuickAction = {
  id: string;
  title: string;
  description: string;
  value: string;
};

const quickActions: QuickAction[] = [
  {
    id: "new-exam",
    title: "Nuovo esame",
    description: "Apri il setup manuale con topics",
    value: "/nuovo esame add exam crea esame",
  },
  {
    id: "start-pomodoro",
    title: "Avvia Pomodoro",
    description: "Avvia subito il timer globale",
    value: "/pomodoro start pomodoro focus timer",
  },
  {
    id: "go-dashboard",
    title: "Dashboard",
    description: "Torna alla home operativa",
    value: "/dashboard home",
  },
];

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

const emptyData: CommandPayload = {
  exams: [],
  topics: [],
};

export function CommandPaletteProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CommandPayload>(emptyData);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);

  const togglePalette = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePalette();
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [togglePalette]);

  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    const hasSearchTerm = trimmed.length >= 2;
    const controller = new AbortController();

    const timeout = setTimeout(
      async () => {
        setIsLoading(true);
        setError(null);

        try {
          const params = new URLSearchParams();
          if (hasSearchTerm) {
            params.set("q", trimmed);
          }

          const endpoint =
            params.toString().length > 0
              ? `/api/command?${params.toString()}`
              : "/api/command";

          const response = await fetch(endpoint, {
            signal: controller.signal,
            cache: "no-store",
          });

          const result = (await response.json()) as
            | CommandPayload
            | { error?: string };

          if (!response.ok) {
            throw new Error(
              "error" in result && typeof result.error === "string"
                ? result.error
                : "Failed to load command data",
            );
          }

          setData(result as CommandPayload);
        } catch (fetchError: unknown) {
          if (
            fetchError instanceof DOMException &&
            fetchError.name === "AbortError"
          ) {
            return;
          }

          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Failed to load command data",
          );
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
      },
      hasSearchTerm ? 140 : 0,
    );

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query]);

  const contextValue = useMemo(
    () => ({
      openPalette,
      closePalette,
      togglePalette,
    }),
    [closePalette, openPalette, togglePalette],
  );

  const runQuickAction = (actionId: QuickAction["id"]) => {
    closePalette();

    if (actionId === "new-exam") {
      router.push("/add-exam");
      return;
    }

    if (actionId === "start-pomodoro") {
      window.dispatchEvent(new Event(GLOBAL_POMODORO_START_EVENT));
      return;
    }

    router.push("/");
  };

  const openExam = (examId: string) => {
    closePalette();
    router.push(`/exam/${examId}`);
  };

  const openTopic = (examId: string, topicId: string) => {
    closePalette();
    router.push(`/exam/${examId}?topic=${topicId}`);
  };

  return (
    <CommandPaletteContext.Provider value={contextValue}>
      {children}

      {open ? (
        <div
          className="fixed inset-0 z-[90] bg-black/45 px-4 py-8 backdrop-blur-sm sm:px-6"
          role="dialog"
          aria-modal="true"
          aria-label="Global command palette"
          onClick={closePalette}
        >
          <div
            className="mx-auto mt-[10vh] w-full max-w-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="overflow-hidden rounded-3xl border border-white/20 bg-card/85 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
              <Command loop shouldFilter>
                <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Command.Input
                    value={query}
                    onValueChange={setQuery}
                    placeholder="Cerca topic, esami o digita /nuovo esame"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <span className="rounded-md border border-border/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Esc
                  </span>
                </div>

                <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                  <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Nessun risultato per questa ricerca.
                  </Command.Empty>

                  <Command.Group heading="Comandi rapidi">
                    {quickActions.map((action) => (
                      <Command.Item
                        key={action.id}
                        value={`${action.title} ${action.value}`}
                        onSelect={() => runQuickAction(action.id)}
                        className="group flex cursor-pointer items-center justify-between rounded-2xl px-3 py-3 text-sm outline-none data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
                      >
                        <span className="inline-flex items-center gap-2">
                          {action.id === "new-exam" ? (
                            <CirclePlus className="h-4 w-4" />
                          ) : action.id === "start-pomodoro" ? (
                            <Timer className="h-4 w-4" />
                          ) : (
                            <BookOpenCheck className="h-4 w-4" />
                          )}
                          {action.title}
                        </span>
                        <span className="text-xs text-muted-foreground group-data-[selected=true]:text-primary-foreground/80">
                          {action.description}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>

                  <Command.Separator className="my-2 h-px bg-border/70" />

                  <Command.Group heading="Argomenti">
                    {data.topics.map((topic) => (
                      <Command.Item
                        key={topic.id}
                        value={`${topic.name} ${topic.exam.courseName} ${topic.exam.name}`}
                        onSelect={() => openTopic(topic.examId, topic.id)}
                        className="group flex cursor-pointer items-center justify-between rounded-2xl px-3 py-3 text-sm outline-none data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
                      >
                        <span className="inline-flex min-w-0 flex-1 items-start gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: topic.exam.color_code }}
                          />
                          <span className="whitespace-normal break-words">
                            {topic.name}
                          </span>
                        </span>
                        <span className="ml-2 max-w-[50%] whitespace-normal break-words text-right text-xs leading-tight text-muted-foreground group-data-[selected=true]:text-primary-foreground/80">
                          <span className="block font-semibold">
                            {topic.exam.courseName}
                          </span>
                          <span className="block opacity-80">
                            {topic.exam.name}
                          </span>
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>

                  <Command.Separator className="my-2 h-px bg-border/70" />

                  <Command.Group heading="Esami">
                    {data.exams.map((exam) => (
                      <Command.Item
                        key={exam.id}
                        value={`${exam.courseName} ${exam.name}`}
                        onSelect={() => openExam(exam.id)}
                        className="group flex cursor-pointer items-center justify-between rounded-2xl px-3 py-3 text-sm outline-none data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
                      >
                        <span className="inline-flex min-w-0 flex-1 items-start gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: exam.color_code }}
                          />
                          <span className="whitespace-normal break-words">
                            {exam.courseName}
                          </span>
                        </span>
                        <span className="max-w-[45%] whitespace-normal break-words text-right text-xs leading-tight text-muted-foreground group-data-[selected=true]:text-primary-foreground/80">
                          <span className="block">{exam.name}</span>
                          <span className="block opacity-80">Apri tracker</span>
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                </Command.List>

                <div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
                  <span>Cmd/Ctrl + K per aprire</span>
                  {isLoading ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Ricerca in corso
                    </span>
                  ) : error ? (
                    <span className="text-red-500">{error}</span>
                  ) : (
                    <span>
                      Digita almeno 2 lettere per filtrare lato server
                    </span>
                  )}
                </div>
              </Command>
            </div>
          </div>
        </div>
      ) : null}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);

  if (!context) {
    throw new Error(
      "useCommandPalette must be used inside CommandPaletteProvider",
    );
  }

  return context;
}
