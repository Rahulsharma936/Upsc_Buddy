import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — UPSC Prep",
};

/**
 * Auth layout: centered card layout for login/signup.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">UPSC Prep</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Intelligent preparation platform
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
