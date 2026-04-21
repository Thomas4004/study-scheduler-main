"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UndoToastProps = {
  open: boolean;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
  tone?: "neutral" | "success" | "error";
};

export function UndoToast({
  open,
  title,
  description,
  actionLabel,
  onAction,
  onClose,
  tone = "neutral",
}: UndoToastProps) {
  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur",
          tone === "success" &&
            "border-emerald-500/35 bg-emerald-950/90 text-emerald-100",
          tone === "error" && "border-red-500/35 bg-red-950/90 text-red-100",
          tone === "neutral" && "border-zinc-700 bg-zinc-900/95 text-zinc-100",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="whitespace-normal break-words text-sm font-semibold">
            {title}
          </p>
          {description ? (
            <p className="mt-0.5 text-xs text-current/75">{description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {actionLabel && onAction ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onAction}
              className="min-w-20"
            >
              {actionLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
