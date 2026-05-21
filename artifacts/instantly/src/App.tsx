import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";
import Dashboard from "@/pages/dashboard";
import CampaignsList from "@/pages/campaigns/index";
import NewCampaign from "@/pages/campaigns/new";
import CampaignDetail from "@/pages/campaigns/detail";
import Leads from "@/pages/leads";
import Accounts from "@/pages/accounts";
import Inbox from "@/pages/inbox";
import Analytics from "@/pages/analytics";
import Templates from "@/pages/templates";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/campaigns/new" component={NewCampaign} />
        <Route path="/campaigns/:id" component={CampaignDetail} />
        <Route path="/campaigns" component={CampaignsList} />
        <Route path="/leads" component={Leads} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/templates" component={Templates} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
