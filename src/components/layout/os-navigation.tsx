"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  BookOpenCheck,
  CalendarDays,
  GraduationCap,
  Home,
  LibraryBig,
  Search,
  Settings,
  Timer,
} from "lucide-react";
import type { ComponentType } from "react";

import { useCommandPalette } from "@/components/providers/command-palette-provider";
import { useFocusLock } from "@/components/providers/focus-lock-provider";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/courses", label: "Corsi", icon: LibraryBig },
  { href: "/exams", label: "Esami", icon: BookOpenCheck },
  { href: "/focus", label: "Focus", icon: Timer },
  { href: "/calendar", label: "Calendario", icon: CalendarDays },
  { href: "/libretto", label: "Libretto", icon: GraduationCap },
  { href: "/archive", label: "Archivio", icon: Archive },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/" || pathname === "/dashboard";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OSNavigation() {
  const pathname = usePathname();
  const { openPalette } = useCommandPalette();
  const { isLocked } = useFocusLock();

  const isZenRoute = pathname.startsWith("/focus/");
  if (isZenRoute || isLocked) {
    return null;
  }

  return (
    <>
      <aside className="hidden w-64 shrink-0 self-stretch border-r border-zinc-800 bg-zinc-900 lg:block">
        <div className="sticky top-0 flex h-screen flex-col px-4 py-5">
          <div className="space-y-2 px-1">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              StudyScheduler OS
            </p>
            <button
              type="button"
              onClick={openPalette}
              className="inline-flex h-10 w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Search className="h-4 w-4" />
              Cerca (Cmd/Ctrl + K)
            </button>
          </div>

          <nav className="mt-5 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
                    active
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur lg:hidden">
        <ul className="flex gap-1 overflow-x-auto px-2 pb-[calc(0.6rem+env(safe-area-inset-bottom))] pt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);

            return (
              <li key={item.href} className="min-w-[4.25rem] shrink-0">
                <Link
                  href={item.href}
                  className={cn(
                    "inline-flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium",
                    active
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
