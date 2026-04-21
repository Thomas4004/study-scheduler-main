import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CopilotSidebar } from "@/components/CopilotSidebar";
import { OSNavigation } from "@/components/layout/os-navigation";
import { AppProviders } from "@/components/providers/app-providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StudyScheduler",
  description: "Intelligent university study planner",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen touch-pan-y overscroll-none bg-zinc-950 text-zinc-100">
        <AppProviders>
          <div className="flex min-h-screen w-full">
            <OSNavigation />

            <div className="flex min-h-screen flex-1 flex-col">
              <main className="mx-auto w-full max-w-6xl flex-1 touch-pan-y px-4 py-5 pb-[calc(10rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 md:pb-[calc(9rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8 lg:pb-8">
                {children}
              </main>
            </div>

            <CopilotSidebar />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
