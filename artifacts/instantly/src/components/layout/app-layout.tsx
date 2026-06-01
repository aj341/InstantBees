import { Link, useLocation } from "wouter";
import { LayoutDashboard, Megaphone, Users, Mail, Inbox, BarChart, FileText, LogOut, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/accounts", label: "Accounts", icon: Mail },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/analytics", label: "Analytics", icon: BarChart },
  { href: "/growth", label: "Growth", icon: Rocket },
  { href: "/templates", label: "Templates", icon: FileText },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: me } = useAuth();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex">
        <div className="flex items-center border-b border-border px-3 py-5">
          <img
            src="/instant-bees-logo.png"
            alt="Instant Bees"
            className="h-auto w-full rounded-md bg-white px-4 py-3"
          />
        </div>
        <nav className="flex-1 py-4 px-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="mr-3 h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3 space-y-2">
          {me && (
            <div className="px-1 text-xs text-muted-foreground truncate" data-testid="text-current-user">
              Signed in as <span className="text-foreground font-medium">{me.username}</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            data-testid="button-logout"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-muted/20">
        {children}
      </main>
    </div>
  );
}
