"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bot,
  Loader2,
  MessageSquareText,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";

import { useFocusLock } from "@/components/providers/focus-lock-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ToolInvocationBadge = {
  key: string;
  label: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied"
    | "unknown";
};

const INITIAL_MESSAGES: UIMessage[] = [
  {
    id: "copilot-welcome",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Sono StudyOS Copilot. Posso analizzare corsi, esami, collisioni e progressione del libretto in tempo reale.",
      },
    ],
  },
];

function getToolStateLabel(
  toolName: string,
  state: ToolInvocationBadge["state"],
) {
  if (toolName === "getFullContext") {
    if (state === "output-available") return "Contesto completo acquisito";
    if (state === "output-error") return "Errore nel recupero contesto";
    return "Analizzando corsi, esami attivi e libretto";
  }

  if (toolName === "detectCollisions") {
    if (state === "output-available") return "Collision detector completato";
    if (state === "output-error") return "Errore nel collision detector";
    return "Valutando collisioni sui prossimi 14 giorni";
  }

  if (state === "output-available") {
    return `${toolName} completato`;
  }

  if (state === "output-error") {
    return `${toolName} in errore`;
  }

  return `${toolName} in esecuzione`;
}

function extractToolBadges(message: UIMessage): ToolInvocationBadge[] {
  const badges: ToolInvocationBadge[] = [];

  for (const part of message.parts) {
    if (part.type === "dynamic-tool") {
      const state = part.state ?? "unknown";
      badges.push({
        key: `${message.id}-${part.toolCallId}`,
        label: getToolStateLabel(part.toolName, state),
        state,
      });
      continue;
    }

    if (!part.type.startsWith("tool-")) {
      continue;
    }

    const toolPart = part as {
      type: string;
      state?: ToolInvocationBadge["state"];
      toolCallId?: string;
    };

    const toolName = toolPart.type.slice("tool-".length);
    const state = toolPart.state ?? "unknown";

    badges.push({
      key: `${message.id}-${toolPart.toolCallId ?? toolPart.type}`,
      label: getToolStateLabel(toolName, state),
      state,
    });
  }

  return badges;
}

function badgeClassForState(state: ToolInvocationBadge["state"]) {
  if (state === "output-available") {
    return "border-emerald-400/45 bg-emerald-500/15 text-emerald-100";
  }

  if (state === "output-error" || state === "output-denied") {
    return "border-rose-400/45 bg-rose-500/15 text-rose-100";
  }

  if (state === "approval-requested") {
    return "border-amber-400/45 bg-amber-500/15 text-amber-100";
  }

  return "border-cyan-400/45 bg-cyan-500/15 text-cyan-100";
}

export function CopilotSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { isLocked } = useFocusLock();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const refreshedToolCallIdsRef = useRef<Set<string>>(new Set());

  const { messages, sendMessage, status, error, clearError } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/assistant",
    }),
    messages: INITIAL_MESSAGES,
    experimental_throttle: 40,
  });

  const isBusy = status === "submitted" || status === "streaming";

  const hiddenByRoute = pathname.startsWith("/focus/") || isLocked;

  const flattenedToolBadges = useMemo(
    () => messages.flatMap((message) => extractToolBadges(message)),
    [messages],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [messages, status, isOpen]);

  useEffect(() => {
    let shouldRefresh = false;

    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      for (const part of message.parts) {
        if (part.type === "dynamic-tool") {
          if (part.state !== "output-available") {
            continue;
          }

          if (refreshedToolCallIdsRef.current.has(part.toolCallId)) {
            continue;
          }

          refreshedToolCallIdsRef.current.add(part.toolCallId);
          shouldRefresh = true;
          continue;
        }

        if (!part.type.startsWith("tool-")) {
          continue;
        }

        const typedPart = part as {
          state?: string;
          toolCallId?: string;
        };

        if (typedPart.state !== "output-available") {
          continue;
        }

        const callId = typedPart.toolCallId ?? `${message.id}:${part.type}`;
        if (refreshedToolCallIdsRef.current.has(callId)) {
          continue;
        }

        refreshedToolCallIdsRef.current.add(callId);
        shouldRefresh = true;
      }
    }

    if (shouldRefresh) {
      router.refresh();
    }
  }, [messages, router]);

  if (hiddenByRoute) {
    return null;
  }

  const submitPrompt = async () => {
    const text = draft.trim();
    if (!text) return;

    setDraft("");
    await sendMessage({ text });
  };

  return (
    <>
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-[80] inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950/95 px-3 py-2 text-sm font-medium text-zinc-100 shadow-[0_20px_40px_-28px_rgba(0,0,0,1)] transition hover:bg-zinc-900 lg:bottom-6"
        >
          <MessageSquareText className="h-4 w-4 text-cyan-300" />
          AI Study Copilot
        </button>
      ) : null}

      <aside
        className={cn(
          "fixed right-0 top-0 z-[90] flex h-dvh w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-[-20px_0_60px_-45px_rgba(0,0,0,1)] transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
              <Bot className="h-3.5 w-3.5 text-cyan-300" />
              StudyOS Copilot
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Assistente AI con tool su dati reali Prisma
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsOpen(false)}
            className="text-zinc-300 hover:bg-zinc-800/80"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div
          ref={scrollContainerRef}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        >
          {messages.map((message) => {
            const textParts = message.parts.filter(
              (part): part is Extract<typeof part, { type: "text" }> =>
                part.type === "text",
            );
            const toolBadges = extractToolBadges(message);

            return (
              <article
                key={message.id}
                className={cn(
                  "max-w-[92%] rounded-2xl border px-3 py-2",
                  message.role === "user"
                    ? "ml-auto border-cyan-400/35 bg-cyan-500/12"
                    : "mr-auto border-zinc-800 bg-zinc-900/70",
                )}
              >
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                  {message.role === "user" ? "Tu" : "StudyOS"}
                </p>

                {textParts.length > 0 ? (
                  <div className="space-y-1.5 text-sm leading-relaxed text-zinc-100">
                    {textParts.map((part, index) => (
                      <p key={`${message.id}-text-${index}`}>{part.text}</p>
                    ))}
                  </div>
                ) : null}

                {toolBadges.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {toolBadges.map((badge) => (
                      <span
                        key={badge.key}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                          badgeClassForState(badge.state),
                        )}
                      >
                        <Sparkles className="h-3 w-3" />
                        {badge.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}

          {isBusy ? (
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Copilot al lavoro sui tuoi dati...
            </p>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-zinc-800 px-4 py-3">
          {error ? (
            <div className="rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              <p>{error.message}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearError}
                className="mt-1 h-7 px-2 text-rose-100 hover:bg-rose-500/20"
              >
                Chiudi errore
              </Button>
            </div>
          ) : null}

          {flattenedToolBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {flattenedToolBadges.slice(-3).map((badge) => (
                <span
                  key={`summary-${badge.key}`}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]",
                    badgeClassForState(badge.state),
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitPrompt();
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Chiedi analisi su esami, collisioni o media..."
              className="h-10 border-zinc-700 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500"
            />

            <Button
              type="submit"
              disabled={draft.trim().length === 0 || isBusy}
              className="h-10 bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
            >
              <SendHorizontal className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </aside>
    </>
  );
}
