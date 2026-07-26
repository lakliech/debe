import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient, QueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import AppLayout from "./components/layout/AppLayout";
import { LanguageProvider } from "./contexts/LanguageContext";
import { LowBandwidthProvider } from "./contexts/LowBandwidthContext";

// Existing admin pages
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Geography from "./pages/Geography";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import Roles from "./pages/Roles";
import AuditLog from "./pages/AuditLog";
import Branding from "./pages/Branding";
import SystemConfig from "./pages/SystemConfig";
import NotFound from "./pages/NotFound";

// Public portal pages
import AboutPage from "./pages/public/About";
import ManifestoPage from "./pages/public/Manifesto";
import ManifestoSectorPage from "./pages/public/ManifestoSector";
import CountyPrioritiesPage from "./pages/public/CountyPriorities";
import CountyDetailPage from "./pages/public/CountyDetail";
import EventsPage from "./pages/public/Events";
import NewsPage from "./pages/public/News";
import NewsArticlePage from "./pages/public/NewsArticle";
import FaqPage from "./pages/public/Faq";
import FactCheckPage from "./pages/public/FactCheck";
import MediaPage from "./pages/public/Media";
import ContactPage from "./pages/public/Contact";
import VolunteerRegisterPage from "./pages/public/VolunteerRegister";
import SupporterRegisterPage from "./pages/public/SupporterRegister";
import CrowdfundingPage from "./pages/public/Crowdfunding";
import DataRequestPage from "./pages/public/DataRequest";

// Admin pages — volunteers, supporters, training, coordinator, DSR
import VolunteersPage from "./pages/admin/Volunteers";
import VolunteerDetailPage from "./pages/admin/VolunteerDetail";
import SupportersPage from "./pages/admin/Supporters";
import SupporterDetailPage from "./pages/admin/SupporterDetail";
import TrainingPage from "./pages/admin/Training";
import TrainingCoursePage from "./pages/admin/TrainingCourse";
import CoordinatorPage from "./pages/admin/Coordinator";
import DataRequestsPage from "./pages/admin/DataRequests";

// Admin pages — Task 4: Election Operations
import PollingStationsPage from "./pages/admin/PollingStations";
import PollingStationDetailPage from "./pages/admin/PollingStationDetail";
import PollingAgentsPage from "./pages/admin/PollingAgents";
import PollingAgentDetailPage from "./pages/admin/PollingAgentDetail";
import ResultSubmissionsPage from "./pages/admin/ResultSubmissions";
import SubmissionDetailPage from "./pages/admin/SubmissionDetail";
import TallyDashboardPage from "./pages/admin/TallyDashboard";
import TallyDrilldownPage from "./pages/admin/TallyDrilldown";
import ElectionIncidentsPage from "./pages/admin/ElectionIncidents";
import ElectionDisputesPage from "./pages/admin/ElectionDisputes";
import CommandCentrePage from "./pages/admin/CommandCentre";
import TransparencyPortalPage from "./pages/admin/TransparencyPortal";
import ElectionAdminPage from "./pages/admin/ElectionAdmin";

// Admin pages — Task 3: Finance, Communications, Content Library, Events, Rapid Response
import FinanceDashboardPage from "./pages/admin/FinanceDashboard";
import ContributionsPage from "./pages/admin/Contributions";
import ContributionDetailPage from "./pages/admin/ContributionDetail";
import BudgetPage from "./pages/admin/Budget";
import ExpenditurePage from "./pages/admin/Expenditure";
import CommunicationsPage from "./pages/admin/Communications";
import MessageTemplatesPage from "./pages/admin/MessageTemplates";
import TemplateDetailPage from "./pages/admin/TemplateDetail";
import StatementsPage from "./pages/admin/Statements";
import StatementDetailPage from "./pages/admin/StatementDetail";
import ContentLibraryPage from "./pages/admin/ContentLibrary";
import ContentAssetDetailPage from "./pages/admin/ContentAssetDetail";
import EventsManagementPage from "./pages/admin/EventsManagement";
import EventDetailPage from "./pages/admin/EventDetail";
import RapidResponsePage from "./pages/admin/RapidResponse";
import ClaimDetailPage from "./pages/admin/ClaimDetail";

// Agent PWA — offline-first result submission (no AppLayout, standalone)
import AgentResultFormPage from "./pages/agent/AgentResultForm";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(209, 88%, 50%)",
    colorForeground: "hsl(0, 0%, 10%)",
    colorMutedForeground: "hsl(0, 0%, 40%)",
    colorDanger: "hsl(0, 84%, 45%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInput: "hsl(0, 0%, 100%)",
    colorInputForeground: "hsl(0, 0%, 10%)",
    colorNeutral: "hsl(0, 0%, 88%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-md w-[440px] max-w-full overflow-hidden border border-border shadow-md",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none bg-gray-50 border-t border-border mt-4",
    headerTitle: "text-2xl font-bold tracking-tight text-foreground",
    headerSubtitle: "text-sm text-muted-foreground",
    socialButtonsBlockButtonText: "font-medium",
    formFieldLabel: "font-semibold text-sm",
    footerActionLink: "font-bold text-primary hover:text-primary/90",
    footerActionText: "text-sm text-muted-foreground",
    dividerText: "text-xs font-semibold text-muted-foreground uppercase tracking-widest",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm font-semibold h-10",
    formFieldInput: "rounded-sm border-input flex h-10 w-full px-3 py-2 text-sm",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 relative">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1590483863450-482c3c6f2df6?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center opacity-5"></div>
      <div className="z-10 w-full flex justify-center flex-col items-center gap-6">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 relative">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1590483863450-482c3c6f2df6?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center opacity-5"></div>
      <div className="z-10 w-full flex justify-center flex-col items-center gap-6">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <AppLayout>
          <Component />
        </AppLayout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Linda Mwananchi",
            subtitle: "Sign in to access the Command Centre",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            {/* Root — redirect to dashboard if signed in, show landing if not */}
            <Route path="/" component={HomeRedirect} />

            {/* Auth */}
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            {/* ── Public portal (no auth required) ── */}
            <Route path="/about" component={AboutPage} />
            <Route path="/manifesto" component={ManifestoPage} />
            <Route path="/manifesto/:slug" component={ManifestoSectorPage} />
            <Route path="/county-priorities" component={CountyPrioritiesPage} />
            <Route path="/county-priorities/:code" component={CountyDetailPage} />
            <Route path="/events" component={EventsPage} />
            <Route path="/news" component={NewsPage} />
            <Route path="/news/:slug" component={NewsArticlePage} />
            <Route path="/faq" component={FaqPage} />
            <Route path="/fact-check" component={FactCheckPage} />
            <Route path="/media" component={MediaPage} />
            <Route path="/contact" component={ContactPage} />
            <Route path="/volunteer-register" component={VolunteerRegisterPage} />
            <Route path="/supporter-register" component={SupporterRegisterPage} />
            <Route path="/crowdfunding" component={CrowdfundingPage} />
            <Route path="/data-request" component={DataRequestPage} />

            {/* ── Admin (protected) — original ── */}
            <Route path="/dashboard">
              <ProtectedRoute component={Dashboard} />
            </Route>
            <Route path="/geography">
              <ProtectedRoute component={Geography} />
            </Route>
            <Route path="/users">
              <ProtectedRoute component={Users} />
            </Route>
            <Route path="/users/:id">
              <ProtectedRoute component={UserDetail} />
            </Route>
            <Route path="/roles">
              <ProtectedRoute component={Roles} />
            </Route>
            <Route path="/audit">
              <ProtectedRoute component={AuditLog} />
            </Route>
            <Route path="/settings/branding">
              <ProtectedRoute component={Branding} />
            </Route>
            <Route path="/settings/system">
              <ProtectedRoute component={SystemConfig} />
            </Route>

            {/* ── Admin (protected) — Task 2 new ── */}
            <Route path="/volunteers">
              <ProtectedRoute component={VolunteersPage} />
            </Route>
            <Route path="/volunteers/:id">
              <ProtectedRoute component={VolunteerDetailPage} />
            </Route>
            <Route path="/supporters">
              <ProtectedRoute component={SupportersPage} />
            </Route>
            <Route path="/supporters/:id">
              <ProtectedRoute component={SupporterDetailPage} />
            </Route>
            <Route path="/training">
              <ProtectedRoute component={TrainingPage} />
            </Route>
            <Route path="/training/courses/:id">
              <ProtectedRoute component={TrainingCoursePage} />
            </Route>
            <Route path="/coordinator">
              <ProtectedRoute component={CoordinatorPage} />
            </Route>
            <Route path="/data-requests">
              <ProtectedRoute component={DataRequestsPage} />
            </Route>

            {/* ── Admin (protected) — Task 3: Finance, Comms, Events ── */}
            <Route path="/finance">
              <ProtectedRoute component={FinanceDashboardPage} />
            </Route>
            <Route path="/finance/contributions">
              <ProtectedRoute component={ContributionsPage} />
            </Route>
            <Route path="/finance/contributions/:id">
              <ProtectedRoute component={ContributionDetailPage} />
            </Route>
            <Route path="/finance/budget">
              <ProtectedRoute component={BudgetPage} />
            </Route>
            <Route path="/finance/expenditure">
              <ProtectedRoute component={ExpenditurePage} />
            </Route>
            <Route path="/communications">
              <ProtectedRoute component={CommunicationsPage} />
            </Route>
            <Route path="/communications/templates">
              <ProtectedRoute component={MessageTemplatesPage} />
            </Route>
            <Route path="/communications/templates/:id">
              <ProtectedRoute component={TemplateDetailPage} />
            </Route>
            <Route path="/communications/statements">
              <ProtectedRoute component={StatementsPage} />
            </Route>
            <Route path="/communications/statements/:id">
              <ProtectedRoute component={StatementDetailPage} />
            </Route>
            <Route path="/content-library">
              <ProtectedRoute component={ContentLibraryPage} />
            </Route>
            <Route path="/content-library/:id">
              <ProtectedRoute component={ContentAssetDetailPage} />
            </Route>
            <Route path="/events-management">
              <ProtectedRoute component={EventsManagementPage} />
            </Route>
            <Route path="/events-management/:id">
              <ProtectedRoute component={EventDetailPage} />
            </Route>
            <Route path="/rapid-response">
              <ProtectedRoute component={RapidResponsePage} />
            </Route>
            <Route path="/rapid-response/:id">
              <ProtectedRoute component={ClaimDetailPage} />
            </Route>

            {/* ── Admin (protected) — Task 4: Election Operations ── */}
            <Route path="/election-admin">
              <ProtectedRoute component={ElectionAdminPage} />
            </Route>
            <Route path="/polling-stations">
              <ProtectedRoute component={PollingStationsPage} />
            </Route>
            <Route path="/polling-stations/:id">
              <ProtectedRoute component={PollingStationDetailPage} />
            </Route>
            <Route path="/polling-agents">
              <ProtectedRoute component={PollingAgentsPage} />
            </Route>
            <Route path="/polling-agents/:id">
              <ProtectedRoute component={PollingAgentDetailPage} />
            </Route>
            <Route path="/election-results">
              <ProtectedRoute component={ResultSubmissionsPage} />
            </Route>
            <Route path="/election-results/:id">
              <ProtectedRoute component={SubmissionDetailPage} />
            </Route>
            <Route path="/tally">
              <ProtectedRoute component={TallyDashboardPage} />
            </Route>
            <Route path="/tally/:level/:entityId">
              <ProtectedRoute component={TallyDrilldownPage} />
            </Route>
            <Route path="/election-incidents">
              <ProtectedRoute component={ElectionIncidentsPage} />
            </Route>
            <Route path="/election-disputes">
              <ProtectedRoute component={ElectionDisputesPage} />
            </Route>
            <Route path="/command-centre">
              <ProtectedRoute component={CommandCentrePage} />
            </Route>
            <Route path="/transparency-portal">
              <ProtectedRoute component={TransparencyPortalPage} />
            </Route>

            {/* ── Agent PWA — standalone, no AppLayout ── */}
            <Route path="/agent/results" component={AgentResultFormPage} />

            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <LanguageProvider>
        <LowBandwidthProvider>
          <ClerkProviderWithRoutes />
        </LowBandwidthProvider>
      </LanguageProvider>
    </WouterRouter>
  );
}
