import { GlobalCareerDashboard } from "@/components/global-career-dashboard";
import { calculateGlobalStats } from "@/lib/global-career-stats";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function LibrettoPage() {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      name: true,
    },
  });

  if (!user) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-6 py-8 text-zinc-300">
        User profile not found. Create a profile to unlock the libretto
        dashboard.
      </div>
    );
  }

  const stats = await calculateGlobalStats(user.id);

  return <GlobalCareerDashboard stats={stats} userName={user.name} />;
}
