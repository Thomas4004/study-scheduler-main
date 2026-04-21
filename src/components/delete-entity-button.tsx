"use client";

import { type ComponentProps, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type DeleteEntityButtonProps = {
  endpoint: string;
  entityLabel: string;
  buttonLabel?: string;
  confirmMessage?: string;
  redirectTo?: string;
  refreshAfterDelete?: boolean;
  onDeleted?: () => void;
  className?: string;
  disabled?: boolean;
  size?: ComponentProps<typeof Button>["size"];
  variant?: ComponentProps<typeof Button>["variant"];
};

export function DeleteEntityButton({
  endpoint,
  entityLabel,
  buttonLabel = "Delete",
  confirmMessage,
  redirectTo,
  refreshAfterDelete = true,
  onDeleted,
  className,
  disabled,
  size = "default",
  variant = "destructive",
}: DeleteEntityButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const runDelete = () => {
    if (isPending || disabled) {
      return;
    }

    const message =
      confirmMessage ??
      `Delete this ${entityLabel}? This action cannot be undone.`;

    if (!window.confirm(message)) {
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "DELETE",
        });

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            payload.error ?? `Unable to delete ${entityLabel.toLowerCase()}`,
          );
        }

        onDeleted?.();

        if (redirectTo) {
          router.push(redirectTo);
        }

        if (refreshAfterDelete) {
          router.refresh();
        }
      } catch (deleteError: unknown) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : `Unable to delete ${entityLabel.toLowerCase()}`,
        );
      }
    });
  };

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={runDelete}
        disabled={isPending || disabled}
      >
        <Trash2 className="h-4 w-4" />
        {isPending ? "Deleting..." : buttonLabel}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
