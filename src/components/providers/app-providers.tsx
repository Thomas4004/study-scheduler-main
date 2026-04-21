"use client";

import type { PropsWithChildren } from "react";

import { CommandPaletteProvider } from "@/components/providers/command-palette-provider";
import { FocusLockProvider } from "@/components/providers/focus-lock-provider";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <CommandPaletteProvider>
      <FocusLockProvider>{children}</FocusLockProvider>
    </CommandPaletteProvider>
  );
}
