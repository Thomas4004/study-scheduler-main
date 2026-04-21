"use client";

import { useState, useTransition } from "react";

import { addTopicResourceLink } from "@/app/courses/actions";
import { Button } from "@/components/ui/button";

type TopicResourceLinkFormProps = {
  topicId: string;
};

export function TopicResourceLinkForm({ topicId }: TopicResourceLinkFormProps) {
  const [resourceUrl, setResourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        if (resourceUrl.trim().length === 0) {
          throw new Error("Insert a valid http(s) URL");
        }

        const result = await addTopicResourceLink({
          topicId,
          resourceUrl,
        });

        setSuccess(
          result.created ? "Resource link added." : "Link already present.",
        );
        setResourceUrl("");
      } catch (actionError: unknown) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : "Unable to add resource link",
        );
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="url"
          placeholder="https://resource-link"
          value={resourceUrl}
          onChange={(event) => setResourceUrl(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          disabled={isPending}
        />
        <Button type="button" size="sm" onClick={submit} disabled={isPending}>
          {isPending ? "Adding..." : "Add"}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-400">{success}</p> : null}
    </div>
  );
}
