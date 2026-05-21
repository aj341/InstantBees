import { type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import Login from "@/pages/login";

export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!data) {
    return <Login />;
  }

  return <>{children}</>;
}
