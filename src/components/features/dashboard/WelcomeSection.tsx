import { Card, CardContent } from "@/components/ui/card";

interface WelcomeSectionProps {
  fullName: string;
}

export function WelcomeSection({ fullName }: WelcomeSectionProps) {
  const firstName = fullName.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <Card className="border-none bg-primary/5">
      <CardContent className="py-6">
        <h2 className="text-xl font-semibold tracking-tight">
          {greeting}, {firstName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Stay consistent. Every session counts toward your goal.
        </p>
      </CardContent>
    </Card>
  );
}
