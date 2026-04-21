"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createCourse } from "@/app/courses/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function CreateCourseForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cfu, setCfu] = useState("6");
  const [isPassFail, setIsPassFail] = useState(false);
  const [resourceLink, setResourceLink] = useState("");
  const [createdCourseId, setCreatedCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    setSuccess(null);

    const parsedCfu = Number(cfu);
    if (!Number.isInteger(parsedCfu) || parsedCfu < 1 || parsedCfu > 60) {
      setError("CFU must be an integer between 1 and 60.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await createCourse({
          name,
          cfu: parsedCfu,
          isPassFail,
          resourceLink,
        });

        setCreatedCourseId(result.courseId);
        setSuccess(
          result.created
            ? "Course created successfully."
            : "A course with this name already exists. Opened existing reference.",
        );

        if (result.created) {
          setName("");
          setCfu("6");
          setIsPassFail(false);
          setResourceLink("");
        }

        router.refresh();
      } catch (actionError: unknown) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : "Unable to create course",
        );
      }
    });
  };

  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Create Course</CardTitle>
        <CardDescription>
          Create an explicit course container first, then attach midterm/final
          exams and topics.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open ? (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            New Course
          </Button>
        ) : (
          <div className="space-y-3 rounded-xl border border-border/70 bg-background px-3 py-3">
            <div className="space-y-2">
              <label
                htmlFor="course-name"
                className="text-xs text-muted-foreground"
              >
                Course name
              </label>
              <Input
                id="course-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g., Physics II"
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="course-resource-link"
                className="text-xs text-muted-foreground"
              >
                Resource link (optional)
              </label>
              <Input
                id="course-resource-link"
                value={resourceLink}
                onChange={(event) => setResourceLink(event.target.value)}
                placeholder="https://course-home"
                disabled={isPending}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="course-cfu"
                  className="text-xs text-muted-foreground"
                >
                  CFU
                </label>
                <Input
                  id="course-cfu"
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={cfu}
                  onChange={(event) => setCfu(event.target.value)}
                  placeholder="6"
                  disabled={isPending}
                />
              </div>

              <div className="flex items-end">
                <label
                  htmlFor="course-pass-fail"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border/70 bg-card px-3 text-sm"
                >
                  <Checkbox
                    id="course-pass-fail"
                    checked={isPassFail}
                    onCheckedChange={(checked) =>
                      setIsPassFail(checked === true)
                    }
                    disabled={isPending}
                  />
                  <span>Idoneita (Pass/Fail)</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={submit} disabled={isPending}>
                {isPending ? "Creating..." : "Create Course"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Close
              </Button>
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-400">{success}</p> : null}
        {createdCourseId ? (
          <div>
            <Button asChild variant="link" className="h-auto p-0 text-sky-300">
              <Link href={`/courses/${createdCourseId}`}>
                Open course detail
              </Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
