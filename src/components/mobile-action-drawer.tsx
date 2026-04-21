"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Drawer } from "vaul";

import { cn } from "@/lib/utils";

type MobileActionDrawerAction = {
  label: string;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

type MobileActionDrawerProps = {
  title: string;
  description?: string;
  trigger?: ReactNode;
  actions: MobileActionDrawerAction[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function MobileActionDrawer({
  title,
  description,
  trigger,
  actions,
  open,
  onOpenChange,
}: MobileActionDrawerProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="bottom">
      {trigger ? <Drawer.Trigger asChild>{trigger}</Drawer.Trigger> : null}

      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />

        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted" />

          <Drawer.Title className="text-base font-semibold">
            {title}
          </Drawer.Title>
          {description ? (
            <Drawer.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </Drawer.Description>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            {actions.map((action) => {
              const sharedClassName = cn(
                "inline-flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 text-sm font-medium",
                action.destructive
                  ? "border-destructive/45 bg-destructive/10 text-destructive"
                  : "border-border bg-background text-foreground",
                action.disabled && "pointer-events-none opacity-50",
              );

              if (action.href) {
                const isExternal = /^https?:\/\//i.test(action.href);

                if (isExternal) {
                  return (
                    <Drawer.Close
                      asChild
                      key={`${action.label}-${action.href}`}
                    >
                      <a
                        href={action.href}
                        target="_blank"
                        rel="noreferrer"
                        className={sharedClassName}
                      >
                        {action.icon}
                        <span>{action.label}</span>
                      </a>
                    </Drawer.Close>
                  );
                }

                return (
                  <Drawer.Close asChild key={`${action.label}-${action.href}`}>
                    <Link href={action.href} className={sharedClassName}>
                      {action.icon}
                      <span>{action.label}</span>
                    </Link>
                  </Drawer.Close>
                );
              }

              return (
                <Drawer.Close asChild key={action.label}>
                  <button
                    type="button"
                    className={sharedClassName}
                    onClick={() => action.onSelect?.()}
                    disabled={action.disabled}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                </Drawer.Close>
              );
            })}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
