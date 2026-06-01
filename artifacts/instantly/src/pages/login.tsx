import { useState, type FormEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-auth";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ username, password });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-3 rounded-md bg-white px-4 py-3">
            <img src="/instant-bees-logo.png" alt="Instant Bees" className="h-auto w-full" />
          </div>
          <CardDescription>Sign in to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                data-testid="input-username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password"
                required
              />
            </div>
            {login.error && (
              <p className="text-sm text-destructive" data-testid="text-login-error">
                {login.error instanceof Error ? login.error.message : "Login failed"}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={login.isPending} data-testid="button-login">
              {login.isPending ? "Signing in..." : "Sign in"}
            </Button>
            {login.data?.usingDefaultCredentials && (
              <p className="text-xs text-amber-500/80">
                Default credentials are in use. Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> secrets to secure this app.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
