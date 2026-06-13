import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { profileRepository } from "@/lib/repositories/profile.repository";
import { ROUTES } from "@/lib/constants/routes";
import { DashboardSidebar } from "@/components/features/dashboard/DashboardSidebar";

export const metadata: Metadata = {
  title: "Dashboard — UPSC Prep",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(ROUTES.LOGIN);
  }

  // Check onboarding status
  const profile = await profileRepository.findById(user.id);
  if (profile && !profile.onboardingCompleted) {
    redirect(ROUTES.ONBOARDING);
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-8 pt-16 lg:px-8 lg:pt-8 xl:px-12">
          {children}
        </div>
      </main>
    </div>
  );
}
