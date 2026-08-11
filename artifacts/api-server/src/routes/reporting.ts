/**
 * Reporting API — downloadable CSV & Excel exports for all 19 report types.
 * Every export is logged to the export_audit_log table.
 * Role-restricted: only authorised roles may download sensitive reports.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  volunteersTable, supportersTable, contributionsTable,
  expenditureRequestsTable, pollingAgentsTable, pollingStationsTable,
  resultSubmissionsTable, submissionCandidateVotesTable, auditLogsTable,
  electionDisputesTable, electionIncidentReportsTable,
  agentTrainingEnrollmentsTable,
  exportAuditLogTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, count, sum, sql } from "drizzle-orm";
import { requireRoles, resolveActor } from "../middlewares/rbac";
import { requirePlanFeatureWhen } from "../middlewares/requirePlan";
import ExcelJS from "exceljs";
import { validate } from "../lib/validate";
import { tenantFilter, assertTenant } from '../lib/withTenant';

// ─── VALIDATION SCHEMAS ───────────────────────────────────────────────────────

const VALID_REPORT_IDS = [
  "volunteers", "supporters", "donations", "expenditure",
  "polling-agents", "polling-stations", "result-submissions", "tally-summary",
  "incidents", "disputes", "training-completions", "audit-log", "export-log",
  "county-coverage", "agent-allowances", "donor-summary",
  "event-attendance", "comms-reach", "rapid-response",
] as const;

const exportSchema = z.object({
  reportId: z.enum(VALID_REPORT_IDS),
  format: z.enum(["csv", "excel"]).optional().default("csv"),
  filters: z.record(z.unknown()).optional().default({}),
});

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canExport = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "finance-manager", "county-coordinator", "data-officer",
]);

// ── Helper: resolve actor UUID ─────────────────────────────────────────────
async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  return row?.id ?? null;
}

// ── Helper: log export (fail-closed — audit must succeed before sending data) ──
async function logExport(
  actorId: string | null,
  reportType: string,
  format: string,
  filters: object,
  rowCount: number,
  req: any,
  tenantId: string,
): Promise<void> {
  if (!actorId) throw new Error("Export aborted: actor identity could not be resolved for audit log.");
  // Intentionally NOT catching — a failed audit insert must block the download.
  await db.insert(exportAuditLogTable).values({
    tenantId,
    exportedBy: actorId,
    reportType,
    format,
    filters,
    rowCount,
    ipAddress: (req.ip ?? req.headers["x-forwarded-for"]) as string,
    userAgent: req.headers["user-agent"] as string,
  });
}

// ── Helper: rows to CSV ────────────────────────────────────────────────────
function toCSV(rows: object[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers.map((h) => {
        const val = (row as any)[h];
        if (val == null) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str}"` : str;
      }).join(",")
    );
  }
  return lines.join("\n");
}

function sendCSV(res: any, filename: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

async function sendExcel(res: any, filename: string, sheetName: string, rows: object[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  if (rows.length) {
    const headers = Object.keys(rows[0]);
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    for (const row of rows) ws.addRow(headers.map((h) => (row as any)[h] ?? ""));
    headers.forEach((_, i) => { ws.getColumn(i + 1).width = 20; });
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

// ── GET /api/reporting/list ────────────────────────────────────────────────
router.get("/list", requireAuth, (_req, res) => {
  res.json({
    reports: [
      { id: "volunteers", label: "Volunteers Register", formats: ["csv", "excel"] },
      { id: "supporters", label: "Supporters Register", formats: ["csv", "excel"] },
      { id: "donations", label: "Donations & Contributions", formats: ["csv", "excel"] },
      { id: "expenditure", label: "Expenditure Requests", formats: ["csv", "excel"] },
      { id: "polling-agents", label: "Polling Agents Register", formats: ["csv", "excel"] },
      { id: "polling-stations", label: "Polling Stations", formats: ["csv", "excel"] },
      { id: "result-submissions", label: "Result Submissions Log", formats: ["csv", "excel"] },
      { id: "tally-summary", label: "Tally Summary", formats: ["csv", "excel"] },
      { id: "incidents", label: "Election Incidents", formats: ["csv", "excel"] },
      { id: "disputes", label: "Election Disputes", formats: ["csv", "excel"] },
      { id: "training-completions", label: "Training Completions", formats: ["csv", "excel"] },
      { id: "audit-log", label: "Audit Log", formats: ["csv", "excel"] },
      { id: "export-log", label: "Export Audit Trail", formats: ["csv", "excel"] },
      { id: "county-coverage", label: "County Coverage Report", formats: ["csv", "excel"] },
      { id: "agent-allowances", label: "Polling Agent Summary", formats: ["csv", "excel"] },
      { id: "donor-summary", label: "Donor Summary", formats: ["csv", "excel"] },
      { id: "event-attendance", label: "Event Attendance", formats: ["csv"] },
      { id: "comms-reach", label: "Communications Reach", formats: ["csv"] },
      { id: "rapid-response", label: "Rapid Response Claims", formats: ["csv", "excel"] },
    ],
  });
});

// Excel is a paid format. CSV stays available on every plan, so the gate only
// trips on the requests that actually ask for a workbook — a Free campaign can
// still get all 19 reports, just not formatted.
const requireExcelPlan = requirePlanFeatureWhen(
  "excelExport",
  (req) => (req.body as any)?.format === "excel",
);

// ── POST /api/reporting/export ─────────────────────────────────────────────
router.post("/export", requireAuth, resolveActor, canExport, requireExcelPlan, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(exportSchema, req.body, res);
    if (!parsed) return;
    const { reportId, format, filters } = parsed;
    const actorId = await resolveActorUUID(req.clerkId);

    let rows: object[] = [];
    const filename = `${reportId}-${Date.now()}`;

    switch (reportId) {
      case "volunteers": {
        rows = await db.select({
          id: volunteersTable.id,
          fullName: volunteersTable.fullName,
          phoneNumber: volunteersTable.phoneNumber,
          email: volunteersTable.email,
          countyId: volunteersTable.countyId,
          constituencyId: volunteersTable.constituencyId,
          preferredRole: volunteersTable.preferredRole,
          status: volunteersTable.status,
          consentGiven: volunteersTable.consentGiven,
          createdAt: volunteersTable.createdAt,
        }).from(volunteersTable).where(tenantFilter(volunteersTable, t.id)).orderBy(desc(volunteersTable.createdAt)).limit(50000);
        break;
      }
      case "supporters": {
        rows = await db.select({
          id: supportersTable.id,
          fullName: supportersTable.fullName,
          email: supportersTable.email,
          phoneNumber: supportersTable.phoneNumber,
          countyId: supportersTable.countyId,
          constituencyId: supportersTable.constituencyId,
          membershipStatus: supportersTable.membershipStatus,
          consentMarketing: supportersTable.consentMarketing,
          consentSms: supportersTable.consentSms,
          consentEmail: supportersTable.consentEmail,
          createdAt: supportersTable.createdAt,
        }).from(supportersTable).where(tenantFilter(supportersTable, t.id)).orderBy(desc(supportersTable.createdAt)).limit(50000);
        break;
      }
      case "donations":
      case "donor-summary": {
        rows = await db.select({
          id: contributionsTable.id,
          referenceNumber: contributionsTable.referenceNumber,
          donorFullName: contributionsTable.donorFullName,
          donorEmail: contributionsTable.donorEmail,
          donorPhone: contributionsTable.donorPhone,
          amount: contributionsTable.amount,
          currency: contributionsTable.currency,
          channel: contributionsTable.channel,
          verificationStatus: contributionsTable.verificationStatus,
          mpesaReceiptNumber: contributionsTable.mpesaReceiptNumber,
          createdAt: contributionsTable.createdAt,
        }).from(contributionsTable).where(tenantFilter(contributionsTable, t.id)).orderBy(desc(contributionsTable.createdAt)).limit(50000);
        break;
      }
      case "expenditure": {
        rows = await db.select({
          id: expenditureRequestsTable.id,
          title: expenditureRequestsTable.title,
          requestedAmountKes: expenditureRequestsTable.requestedAmountKes,
          approvedAmountKes: expenditureRequestsTable.approvedAmountKes,
          status: expenditureRequestsTable.status,
          createdAt: expenditureRequestsTable.createdAt,
        }).from(expenditureRequestsTable).where(tenantFilter(expenditureRequestsTable, t.id)).orderBy(desc(expenditureRequestsTable.createdAt)).limit(50000);
        break;
      }
      case "polling-agents":
      case "agent-allowances": {
        rows = await db.select({
          id: pollingAgentsTable.id,
          fullName: pollingAgentsTable.fullName,
          phoneNumber: pollingAgentsTable.phoneNumber,
          nationalId: pollingAgentsTable.nationalId,
          pollingStationId: pollingAgentsTable.pollingStationId,
          isBackup: pollingAgentsTable.isBackup,
          status: pollingAgentsTable.status,
          trainingStatus: pollingAgentsTable.trainingStatus,
          accreditationStatus: pollingAgentsTable.accreditationStatus,
          codeOfConductAccepted: pollingAgentsTable.codeOfConductAccepted,
          allowancePaid: pollingAgentsTable.allowancePaid,
          createdAt: pollingAgentsTable.createdAt,
        }).from(pollingAgentsTable).where(tenantFilter(pollingAgentsTable, t.id)).orderBy(desc(pollingAgentsTable.createdAt)).limit(50000);
        break;
      }
      case "polling-stations":
      case "county-coverage": {
        // Scope to stations where this campaign has deployed agents (pollingAgentsTable has tenantId)
        rows = await db.select({
          id: pollingStationsTable.id,
          name: pollingStationsTable.name,
          code: pollingStationsTable.code,
          countyId: pollingStationsTable.countyId,
          constituencyId: pollingStationsTable.constituencyId,
          wardId: pollingStationsTable.wardId,
          registeredVoters: pollingStationsTable.registeredVoters,
          accreditationStatus: pollingStationsTable.accreditationStatus,
          trainingStatus: pollingStationsTable.trainingStatus,
          reportingStatus: pollingStationsTable.reportingStatus,
        }).from(pollingStationsTable)
          .innerJoin(pollingAgentsTable, and(
            eq(pollingAgentsTable.pollingStationId, pollingStationsTable.id),
            tenantFilter(pollingAgentsTable, t.id),
          )).limit(50000);
        break;
      }
      case "result-submissions": {
        rows = await db.select({
          id: resultSubmissionsTable.id,
          pollingStationId: resultSubmissionsTable.pollingStationId,
          electionId: resultSubmissionsTable.electionId,
          status: resultSubmissionsTable.status,
          version: resultSubmissionsTable.version,
          totalVotesCast: resultSubmissionsTable.totalVotesCast,
          totalValidVotes: resultSubmissionsTable.totalValidVotes,
          rejectedBallots: resultSubmissionsTable.rejectedBallots,
          submittedAt: resultSubmissionsTable.submittedAt,
          createdAt: resultSubmissionsTable.createdAt,
        }).from(resultSubmissionsTable).where(tenantFilter(resultSubmissionsTable, t.id)).orderBy(desc(resultSubmissionsTable.createdAt)).limit(50000);
        break;
      }
      case "tally-summary": {
        // Scope to tenant via inner join on resultSubmissionsTable (which has tenantId)
        rows = await db
          .select({
            candidateId: submissionCandidateVotesTable.candidateId,
            candidateName: submissionCandidateVotesTable.candidateName,
            partyAbbreviation: submissionCandidateVotesTable.partyAbbreviation,
            totalVotes: sum(submissionCandidateVotesTable.voteCount),
          })
          .from(submissionCandidateVotesTable)
          .innerJoin(resultSubmissionsTable, and(
            eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id),
            tenantFilter(resultSubmissionsTable, t.id),
          ))
          .groupBy(
            submissionCandidateVotesTable.candidateId,
            submissionCandidateVotesTable.candidateName,
            submissionCandidateVotesTable.partyAbbreviation,
          )
          .orderBy(desc(sum(submissionCandidateVotesTable.voteCount)));
        break;
      }
      case "incidents": {
        rows = await db.select({
          id: electionIncidentReportsTable.id,
          title: electionIncidentReportsTable.title,
          incidentType: electionIncidentReportsTable.incidentType,
          severity: electionIncidentReportsTable.severity,
          status: electionIncidentReportsTable.status,
          countyId: electionIncidentReportsTable.countyId,
          occurredAt: electionIncidentReportsTable.occurredAt,
          createdAt: electionIncidentReportsTable.createdAt,
        }).from(electionIncidentReportsTable)
          .where(tenantFilter(electionIncidentReportsTable, t.id)).orderBy(desc(electionIncidentReportsTable.createdAt)).limit(50000);
        break;
      }
      case "disputes": {
        rows = await db.select({
          id: electionDisputesTable.id,
          title: electionDisputesTable.title,
          disputeType: electionDisputesTable.disputeType,
          status: electionDisputesTable.status,
          priority: electionDisputesTable.priority,
          electionId: electionDisputesTable.electionId,
          createdAt: electionDisputesTable.createdAt,
        }).from(electionDisputesTable)
          .where(tenantFilter(electionDisputesTable, t.id)).orderBy(desc(electionDisputesTable.createdAt)).limit(50000);
        break;
      }
      case "training-completions": {
        rows = await db.select({
          id: agentTrainingEnrollmentsTable.id,
          agentId: agentTrainingEnrollmentsTable.agentId,
          courseId: agentTrainingEnrollmentsTable.courseId,
          status: agentTrainingEnrollmentsTable.status,
          score: agentTrainingEnrollmentsTable.score,
          completedAt: agentTrainingEnrollmentsTable.completedAt,
        }).from(agentTrainingEnrollmentsTable)
          .where(and(tenantFilter(agentTrainingEnrollmentsTable, t.id), eq(agentTrainingEnrollmentsTable.status, "passed")))
          .orderBy(desc(agentTrainingEnrollmentsTable.completedAt)).limit(50000);
        break;
      }
      case "audit-log": {
        rows = await db.select({
          id: auditLogsTable.id,
          action: auditLogsTable.action,
          resource: auditLogsTable.resource,
          resourceId: auditLogsTable.resourceId,
          userId: auditLogsTable.userId,
          userEmail: auditLogsTable.userEmail,
          ipAddress: auditLogsTable.ipAddress,
          createdAt: auditLogsTable.createdAt,
        }).from(auditLogsTable).where(tenantFilter(auditLogsTable, t.id)).orderBy(desc(auditLogsTable.createdAt)).limit(50000);
        break;
      }
      case "export-log": {
        rows = await db.select().from(exportAuditLogTable)
          .where(tenantFilter(exportAuditLogTable, t.id))
          .orderBy(desc(exportAuditLogTable.downloadedAt)).limit(50000);
        break;
      }
      // Placeholder reports — return empty for now (no dedicated tables yet)
      case "event-attendance":
      case "comms-reach":
      case "rapid-response": {
        rows = [];
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown reportId: ${reportId}` });
    }

    await logExport(actorId, reportId, format, filters, rows.length, req, t.id);

    if (format === "excel") {
      await sendExcel(res, `${filename}.xlsx`, reportId, rows);
    } else {
      sendCSV(res, `${filename}.csv`, toCSV(rows));
    }
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── GET /api/reporting/export-log ─────────────────────────────────────────
router.get("/export-log", requireAuth, resolveActor, canExport, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(exportAuditLogTable)
        .where(tenantFilter(exportAuditLogTable, t.id))
        .orderBy(desc(exportAuditLogTable.downloadedAt))
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(exportAuditLogTable)
        .where(tenantFilter(exportAuditLogTable, t.id)),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
