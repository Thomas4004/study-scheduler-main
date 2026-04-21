"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useState, useTransition } from "react";
import {
  Archive,
  EllipsisVertical,
  ExternalLink,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import { archiveCourse, updateCourse } from "@/app/courses/actions";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { MobileActionDrawer } from "@/components/mobile-action-drawer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type CourseCardProps = {
  id: string;
  name: string;
  cfu: number;
  isPassFail: boolean;
  resourceLink: string | null;
  topicCount: number;
  examCount: number;
  completedWeightPercent: number;
  projectedFinalGrade: number | null;
  nextExam: {
    id: string;
    name: string;
    examDate: string;
  } | null;
};

export function CourseCard({
  id,
  name,
  cfu,
  isPassFail,
  resourceLink,
  topicCount,
  examCount,
  completedWeightPercent,
  projectedFinalGrade,
  nextExam,
}: CourseCardProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, startArchiveTransition] = useTransition();
  const [isUpdating, startUpdateTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [editCfu, setEditCfu] = useState(String(cfu));
  const [editPassFail, setEditPassFail] = useState(isPassFail);
  const [editResourceLink, setEditResourceLink] = useState(resourceLink ?? "");
  const [editError, setEditError] = useState<string | null>(null);

  const hydrateEditForm = () => {
    setEditName(name);
    setEditCfu(String(cfu));
    setEditPassFail(isPassFail);
    setEditResourceLink(resourceLink ?? "");
  };

  const openEditModal = () => {
    if (isDeleting || isArchiving || isUpdating) return;
    hydrateEditForm();
    setEditError(null);
    setIsEditing(true);
  };

  const closeEditModal = () => {
    if (isUpdating) return;
    setIsEditing(false);
    setEditError(null);
  };

  const submitCourseUpdate = () => {
    if (isUpdating) return;

    const parsedCfu = Number(editCfu);
    if (!Number.isInteger(parsedCfu) || parsedCfu < 1 || parsedCfu > 60) {
      setEditError("CFU must be an integer between 1 and 60.");
      return;
    }

    setEditError(null);

    startUpdateTransition(() => {
      void updateCourse({
        courseId: id,
        name: editName,
        cfu: parsedCfu,
        isPassFail: editPassFail,
        resourceLink: editResourceLink,
      })
        .then(() => {
          setIsEditing(false);
          router.refresh();
        })
        .catch((error) => {
          setEditError(
            error instanceof Error ? error.message : "Unable to update course.",
          );
        });
    });
  };

  const archiveCurrentCourse = () => {
    if (isDeleting || isArchiving || isUpdating) return;

    const shouldArchive = window.confirm(
      `Archive course "${name}"? Related exams will move to archive, while course topics stay active and editable.`,
    );

    if (!shouldArchive) return;

    startArchiveTransition(() => {
      void archiveCourse(id)
        .then(() => {
          router.refresh();
        })
        .catch((error) => {
          window.alert(
            error instanceof Error
              ? error.message
              : "Unable to archive course.",
          );
        });
    });
  };

  const deleteCourse = async () => {
    if (isDeleting || isUpdating) return;

    const shouldDelete = window.confirm(
      `Delete course \"${name}\"? This will also delete all linked exams and topics.`,
    );
    if (!shouldDelete) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/courses/${id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete course.");
      }

      router.refresh();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to delete course.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <article className="group flex h-full min-h-[12rem] flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/95 p-4 text-zinc-100 shadow-[0_22px_45px_-32px_rgba(0,0,0,0.95)]">
        <header className="space-y-3">
          <div className="min-w-0 space-y-1.5">
            <h3 className="text-balance break-words text-base font-semibold leading-tight">
              {name}
            </h3>
            <p className="text-balance break-words text-xs text-zinc-400">
              {nextExam
                ? `Next exam: ${nextExam.name} • ${format(new Date(nextExam.examDate), "dd/MM/yyyy")}`
                : "No active exams yet"}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
              {examCount} exam(s)
            </span>

            <div className="hidden items-center gap-2 opacity-0 transition duration-200 md:flex md:translate-y-1 md:group-hover:translate-y-0 md:group-hover:opacity-100">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-zinc-200 hover:bg-zinc-800"
                onClick={openEditModal}
                disabled={isUpdating || isArchiving || isDeleting}
              >
                <Pencil className="h-4 w-4" />
                {isUpdating ? "Salvataggio..." : "Modifica"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-zinc-200 hover:bg-zinc-800"
                onClick={archiveCurrentCourse}
                disabled={isArchiving || isDeleting || isUpdating}
              >
                <Archive className="h-4 w-4" />
                {isArchiving ? "Archiviazione..." : "Archivia"}
              </Button>
              <DeleteEntityButton
                endpoint={`/api/courses/${id}`}
                entityLabel="course"
                buttonLabel="Elimina"
                size="sm"
                disabled={isUpdating || isArchiving}
                className="w-full"
                confirmMessage={`Delete course \"${name}\"? This will also delete all linked exams and topics.`}
              />
            </div>

            <div className="md:hidden">
              <MobileActionDrawer
                title={name}
                description="Quick Actions"
                trigger={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="border-zinc-700 bg-zinc-950 text-zinc-200"
                    aria-label={`Open quick actions for ${name}`}
                  >
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                }
                actions={[
                  {
                    label: "Modifica",
                    icon: <Pencil className="h-4 w-4" />,
                    onSelect: openEditModal,
                    disabled: isUpdating || isArchiving || isDeleting,
                  },
                  ...(resourceLink
                    ? [
                        {
                          label: "Resource Hub",
                          icon: <ExternalLink className="h-4 w-4" />,
                          href: resourceLink,
                        },
                      ]
                    : []),
                  {
                    label: isArchiving ? "Archiviazione..." : "Archivia",
                    icon: <Archive className="h-4 w-4" />,
                    onSelect: archiveCurrentCourse,
                    disabled: isArchiving || isDeleting || isUpdating,
                  },
                  {
                    label: isDeleting ? "Eliminazione..." : "Elimina",
                    icon: <Trash2 className="h-4 w-4" />,
                    onSelect: () => {
                      void deleteCourse();
                    },
                    destructive: true,
                    disabled: isDeleting || isUpdating,
                  },
                ]}
              />
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
            <p className="text-zinc-400">Topics</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">
              {topicCount}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
            <p className="text-zinc-400">Completed weight</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">
              {completedWeightPercent.toFixed(0)}%
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-xs text-zinc-300">
          Weighted projection:{" "}
          <span className="font-semibold text-zinc-100">
            {projectedFinalGrade !== null
              ? projectedFinalGrade.toFixed(2)
              : "N/A"}
          </span>
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <Button
            asChild
            className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
          >
            <Link href={`/courses/${id}`}>Apri Corso</Link>
          </Button>

          {resourceLink ? (
            <Button
              asChild
              variant="ghost"
              className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <a href={resourceLink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Resource
              </a>
            </Button>
          ) : null}
        </footer>
      </article>

      {isEditing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-background/85 backdrop-blur-sm"
            aria-label="Close edit course modal"
            onClick={closeEditModal}
          />

          <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h4 className="text-base font-semibold text-zinc-100">
                  Modifica Corso
                </h4>
                <p className="text-xs text-zinc-400">
                  Aggiorna nome, CFU, idoneita e resource link.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={closeEditModal}
                disabled={isUpdating}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor={`course-name-${id}`}
                  className="text-xs text-zinc-400"
                >
                  Nome corso
                </label>
                <Input
                  id={`course-name-${id}`}
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  disabled={isUpdating}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={`course-cfu-${id}`}
                  className="text-xs text-zinc-400"
                >
                  CFU
                </label>
                <Input
                  id={`course-cfu-${id}`}
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={editCfu}
                  onChange={(event) => setEditCfu(event.target.value)}
                  disabled={isUpdating}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={`course-resource-${id}`}
                  className="text-xs text-zinc-400"
                >
                  Resource link (opzionale)
                </label>
                <Input
                  id={`course-resource-${id}`}
                  value={editResourceLink}
                  onChange={(event) => setEditResourceLink(event.target.value)}
                  disabled={isUpdating}
                  placeholder="https://..."
                />
              </div>

              <label
                htmlFor={`course-passfail-${id}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200"
              >
                <Checkbox
                  id={`course-passfail-${id}`}
                  checked={editPassFail}
                  onCheckedChange={(checked) =>
                    setEditPassFail(checked === true)
                  }
                  disabled={isUpdating}
                />
                <span>Idoneita (Pass/Fail)</span>
              </label>

              {editError ? (
                <p className="text-sm text-destructive">{editError}</p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  onClick={submitCourseUpdate}
                  disabled={isUpdating}
                >
                  {isUpdating ? "Salvataggio..." : "Salva Modifiche"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditModal}
                  disabled={isUpdating}
                >
                  Annulla
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
