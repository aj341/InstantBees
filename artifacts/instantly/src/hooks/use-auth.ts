import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface MeResponse {
  username: string;
  usingDefaultCredentials: boolean;
}

const ME_KEY = ["auth", "me"] as const;

async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to load session");
  return (await res.json()) as MeResponse;
}

export function useAuth() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { username: string; password: string }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Login failed");
      }
      return (await res.json()) as MeResponse;
    },
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, data);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    },
    onSuccess: () => {
      qc.setQueryData(ME_KEY, null);
      qc.clear();
    },
  });
}
