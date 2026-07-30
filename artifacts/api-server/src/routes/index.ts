import { Router, type IRouter } from "express";
import { resolveTenant, resolveTenantPublic, resolveTenantMixed } from "../middlewares/resolveTenant";
import healthRouter from "./health";
import usersRouter from "./users";
import rolesRouter from "./roles";
import geographyRouter from "./geography";
import dashboardRouter from "./dashboard";
import configRouter from "./config";
import auditRouter from "./audit";
import volunteersRouter from "./volunteers";
import supportersRouter from "./supporters";
import trainingRouter from "./training";
import publicPortalRouter from "./publicPortal";
import dataRequestsRouter from "./dataRequests";
import coordinatorRouter from "./coordinator";
import financeRouter from "./finance";
import communicationsRouter from "./communications";
import contentLibraryRouter from "./contentLibrary";
import eventsMgmtRouter from "./eventsMgmt";
import rapidResponseRouter from "./rapidResponse";
import storageRouter from "./storage";
import electionAdminRouter from "./electionAdmin";
import pollingStationsMgmtRouter from "./pollingStationsMgmt";
import pollingAgentsMgmtRouter from "./pollingAgentsMgmt";
import electionResultsRouter from "./electionResults";
import tallyRouter from "./tally";
import electionIncidentsRouter from "./electionIncidents";
import electionDisputesRouter from "./electionDisputes";
import transparencyPortalRouter from "./transparencyPortal";
import commandCentreRouter from "./commandCentre";
import reportingRouter from "./reporting";
import complianceRouter from "./compliance";
import privilegedAccessRouter from "./privilegedAccess";
import aspirantsRouter from "./aspirants";
import contactMessagesRouter from "./contactMessages";
import platformRouter from "./platform";
import enquiriesRouter from "./enquiries";

const router: IRouter = Router();

router.use(healthRouter);
// Storage routes use their own full /storage/... path prefixes internally.
// Scope resolveTenantMixed to /storage only so it doesn't run on every request
// (which would block platform-admin users who have no orgId in their JWT).
router.use("/storage", resolveTenantMixed);
router.use(storageRouter);

// Resolve tenant for all public-portal routes (unauthenticated; reads X-Tenant-Slug or ?tenant=)
router.use("/public", resolveTenantPublic);

// Helper: mount a sub-router with resolveTenant applied first (authenticated routes).
// This avoids needing to call resolveTenant inside every individual route handler.
function withTenant(subrouter: IRouter) {
  const r = Router();
  r.use(resolveTenant, subrouter);
  return r;
}

// Helper: mount a sub-router with resolveTenantMixed — for routers that contain
// BOTH public (unauthenticated) and authenticated endpoints.
// Authenticated requests resolve tenant from the Clerk JWT org (authoritative).
// Unauthenticated requests resolve tenant from X-Tenant-Slug / ?tenant= header.
// Authenticated routes inside still call assertTenant(req) / requireAuth.
function withTenantMixed(subrouter: IRouter) {
  const r = Router();
  r.use(resolveTenantMixed, subrouter);
  return r;
}

router.use("/users", withTenant(usersRouter));
router.use("/roles", withTenant(rolesRouter));
router.use("/geography", geographyRouter); // geography is global/shared — no tenant filter needed
router.use("/dashboard", withTenant(dashboardRouter));
router.use("/config", configRouter); // GET /branding is public; mutations use requireAuth+resolveTenant internally
router.use("/audit", withTenant(auditRouter));
router.use("/volunteers", withTenant(volunteersRouter));
router.use("/supporters", withTenant(supportersRouter));
router.use("/training", withTenant(trainingRouter));
router.use("/public", publicPortalRouter); // already has resolveTenantPublic above
router.use("/data-requests", withTenantMixed(dataRequestsRouter)); // POST / is unauthenticated public submission
router.use("/coordinator", withTenant(coordinatorRouter));
router.use("/finance", withTenantMixed(financeRouter)); // M-Pesa callbacks are unauthenticated
router.use("/communications", withTenant(communicationsRouter));
router.use("/content", withTenant(contentLibraryRouter));
router.use("/events-mgmt", withTenantMixed(eventsMgmtRouter)); // public registration & media-accreditation endpoints
router.use("/rapid-response", withTenant(rapidResponseRouter));
router.use("/election-admin", withTenant(electionAdminRouter));
router.use("/polling-stations-mgmt", withTenant(pollingStationsMgmtRouter));
router.use("/polling-agents", withTenant(pollingAgentsMgmtRouter));
router.use("/election-results", withTenant(electionResultsRouter));
router.use("/tally", withTenant(tallyRouter));
router.use("/election-incidents", withTenant(electionIncidentsRouter));
router.use("/election-disputes", withTenant(electionDisputesRouter));
router.use("/transparency", withTenantMixed(transparencyPortalRouter)); // GET /publications/:id is public
router.use("/command-centre", withTenant(commandCentreRouter));
router.use("/reporting", withTenant(reportingRouter));
router.use("/compliance", withTenant(complianceRouter));
router.use("/privileged-access", withTenant(privilegedAccessRouter));
router.use("/aspirants", withTenant(aspirantsRouter));
router.use("/contact-messages", withTenant(contactMessagesRouter));

// Platform admin routes — cross-tenant; no resolveTenant wrapper.
// requireLevel(0) inside the router gates access to platform_admin holders only.
router.use("/platform", platformRouter);

// Platform enquiry form — public, unauthenticated, no tenant context.
router.use("/enquiries", enquiriesRouter);

export default router;
