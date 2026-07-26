/**
 * Finance API: M-Pesa STK Push, Contributions, Budget, Vouchers, Alerts, Dashboards
 */
import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  mpesaTransactionsTable, contributionsTable, inKindContributionsTable,
  donorAlertsTable, budgetCategoriesTable, budgetLinesTable,
  expenditureRequestsTable, paymentVouchersTable, financeAuditLogTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, or, ilike, count, sum, gte, lte, ne } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { createMpesaAdapter, parseStkCallback } from "../lib/mpesa";
import { validate } from "../lib/validate";

const router = Router();
const mpesa = createMpesaAdapter();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  return row?.id ?? null;
}

async function logFinance(entityType: string, entityId: string, action: string, actorId: string | null, extra?: object) {
  await db.insert(financeAuditLogTable).values({
    entityType, entityId, action, actorId,
    changeSnapshot: extra ?? null,
  }).catch((err: any) => console.warn("[finance-audit]", err?.message));
}

function generateRef(prefix: string) {
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 90000 + 10000);
  return `${prefix}-${datePart}-${rand}`;
}

// RBAC groups
const canViewFinance = requireRoles(["campaign-exec-director","national-campaign-manager","finance-manager","campaign-treasurer","data-protection-officer"]);
const canManageFinance = requireRoles(["campaign-exec-director","finance-manager","campaign-treasurer"]);
const canApproveExpenditure = requireRoles(["campaign-exec-director","national-campaign-manager","finance-manager"]);
const canExportFinance = requireRoles(["campaign-exec-director","finance-manager","campaign-treasurer","data-protection-officer"]);

// ─── Schemas ──────────────────────────────────────────────────────────────────

/** Drizzle `numeric` columns accept only string values, not numbers. */
const numericStr = z.union([z.string(), z.number()]).transform((v) => String(v));

const StkPushSchema = z.object({
  phoneNumber: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  accountReference: z.string().optional(),
  transactionDesc: z.string().optional(),
  donorFullName: z.string().optional(),
  donorEmail: z.string().email().optional(),
});

const ContributionSchema = z.object({
  donorFullName: z.string().min(1),
  donorPhone: z.string().optional(),
  donorEmail: z.string().email().optional(),
  amount: numericStr,
  channel: z.string().min(1),
  ledger: z.string().optional(),
  mpesaTransactionId: z.string().uuid().optional(),
  mpesaReceiptNumber: z.string().optional(),
  verificationStatus: z.string().optional(),
  inKind: z.array(z.record(z.unknown())).optional(),
});

const ContributionVerifySchema = z.object({
  status: z.enum(["verified", "rejected"]),
  rejectionReason: z.string().optional(),
});

const AlertResolveSchema = z.object({
  status: z.string().optional(),
  resolutionNotes: z.string().optional(),
});

const BudgetCategorySchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  description: z.string().optional(),
  ledger: z.string().optional(),
  totalAllocatedKes: numericStr.optional(),
});

const BudgetLineSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().min(1),
  fiscalPeriod: z.string().min(1),
  allocatedAmountKes: numericStr,
  ledger: z.string().optional(),
  description: z.string().optional(),
  countyId: z.string().uuid().optional(),
  status: z.string().optional(),
});

const ExpenditureRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  requestedAmountKes: numericStr,
  categoryId: z.string().uuid(),
  payeeName: z.string().min(1),
  ledger: z.string().optional(),
  budgetLineId: z.string().uuid().optional(),
  payeeBank: z.string().optional(),
  payeeAccountNumber: z.string().optional(),
  payeePhone: z.string().optional(),
  notes: z.string().optional(),
});

const FirstApproveSchema = z.object({
  approvedAmount: z.union([z.string(), z.number()]).optional(),
});

const FinalApproveSchema = z.object({
  paymentMethod: z.string().optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(1),
});

// ─── M-PESA ──────────────────────────────────────────────────────────────────

// POST /api/finance/mpesa/stk-push  (public — donor initiates payment)
router.post("/mpesa/stk-push", async (req: any, res: any) => {
  try {
    const body = validate(StkPushSchema, req.body, res);
    if (!body) return;

    const { phoneNumber, amount, accountReference, transactionDesc, donorFullName, donorEmail } = body;

    const stkRes = await mpesa.initiateStkPush({
      phoneNumber, amount: Number(amount),
      accountReference: accountReference ?? "LINDA-MWANANCHI",
      transactionDesc: transactionDesc ?? "Campaign Contribution",
    });

    if (!stkRes.success) return res.status(400).json({ error: stkRes.error });

    // Persist transaction record
    const [txn] = await db.insert(mpesaTransactionsTable).values({
      merchantRequestId: stkRes.merchantRequestId,
      checkoutRequestId: stkRes.checkoutRequestId,
      phoneNumber, amount: String(amount),
      accountReference: accountReference ?? "LINDA-MWANANCHI",
      transactionDesc: transactionDesc ?? "Campaign Contribution",
      status: "pending",
    }).returning();

    res.json({ success: true, checkoutRequestId: stkRes.checkoutRequestId, transactionId: txn.id, customerMessage: stkRes.customerMessage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finance/mpesa/callback  (Safaricom calls this — no Zod, must always 200)
router.post("/mpesa/callback", async (req: any, res: any) => {
  try {
    const parsed = parseStkCallback(req.body);
    const [txn] = await db.select().from(mpesaTransactionsTable)
      .where(eq(mpesaTransactionsTable.checkoutRequestId, parsed.checkoutRequestId)).limit(1);

    if (!txn) return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

    await db.update(mpesaTransactionsTable).set({
      status: parsed.success ? "completed" : "failed",
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
      mpesaReceiptNumber: parsed.mpesaReceiptNumber,
      transactionDate: parsed.transactionDate,
      callbackPayload: req.body,
      completedAt: new Date(),
    }).where(eq(mpesaTransactionsTable.id, txn.id));

    // Auto-create contribution record if successful
    if (parsed.success && txn.accountReference) {
      const ref = generateRef("LIND");
      const [contribution] = await db.insert(contributionsTable).values({
        referenceNumber: ref,
        donorFullName: "M-Pesa Donor",
        donorPhone: parsed.phoneNumber ?? txn.phoneNumber,
        amount: String(parsed.amount ?? txn.amount),
        channel: "mpesa",
        mpesaTransactionId: txn.id,
        mpesaReceiptNumber: parsed.mpesaReceiptNumber,
        verificationStatus: "verified",
        ledger: "candidate",
      }).returning();

      await logFinance("contribution", contribution.id, "created", null, { channel: "mpesa", receipt: parsed.mpesaReceiptNumber });
    }

    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err: any) {
    console.error("[mpesa-callback]", err.message);
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" }); // always 200 to Safaricom
  }
});

// GET /api/finance/mpesa/transactions
router.get("/mpesa/transactions", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const { status, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const where = status ? eq(mpesaTransactionsTable.status, status) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(mpesaTransactionsTable).where(where).orderBy(desc(mpesaTransactionsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(mpesaTransactionsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CONTRIBUTIONS ────────────────────────────────────────────────────────────

// POST /api/finance/contributions  (record any-channel contribution)
router.post("/contributions", requireAuth, canManageFinance, async (req: any, res: any) => {
  try {
    const body = validate(ContributionSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const ref = generateRef("LIND");

    const { inKind, ...rest } = body;
    const [contribution] = await db.insert(contributionsTable).values({
      ...rest,
      referenceNumber: ref,
      recordedBy: actorId ?? undefined,
    }).returning();

    if (inKind && Array.isArray(inKind)) {
      await db.insert(inKindContributionsTable).values(
        inKind.map((item: any) => ({ ...item, contributionId: contribution.id, valuedBy: actorId ?? undefined }))
      );
    }

    // Duplicate detection: same phone + amount within 10 min
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (rest.donorPhone) {
      const [dup] = await db.select({ id: contributionsTable.id }).from(contributionsTable)
        .where(and(
          eq(contributionsTable.donorPhone, rest.donorPhone),
          eq(contributionsTable.amount, String(rest.amount)),
          gte(contributionsTable.createdAt, tenMinAgo),
          ne(contributionsTable.id, contribution.id),
        )).limit(1);
      if (dup) {
        await db.insert(donorAlertsTable).values({
          alertType: "duplicate",
          severity: "high",
          contributionId: contribution.id,
          donorPhone: rest.donorPhone,
          description: `Possible duplicate contribution from ${rest.donorPhone} — same amount KES ${rest.amount} within 10 minutes`,
          metadata: { duplicateOf: dup.id },
        });
        await db.update(contributionsTable).set({ complianceFlag: "duplicate" }).where(eq(contributionsTable.id, contribution.id));
      }
    }

    await logFinance("contribution", contribution.id, "created", actorId, { channel: rest.channel, amount: rest.amount });
    res.status(201).json(contribution);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/contributions
router.get("/contributions", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const { channel, verificationStatus, complianceFlag, ledger, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [];
    if (channel) conditions.push(eq(contributionsTable.channel, channel));
    if (verificationStatus) conditions.push(eq(contributionsTable.verificationStatus, verificationStatus));
    if (complianceFlag) conditions.push(eq(contributionsTable.complianceFlag, complianceFlag));
    if (ledger) conditions.push(eq(contributionsTable.ledger, ledger));
    if (search) conditions.push(or(
      ilike(contributionsTable.donorFullName, `%${search}%`),
      ilike(contributionsTable.donorPhone, `%${search}%`),
      ilike(contributionsTable.referenceNumber, `%${search}%`),
    ));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(contributionsTable).where(where).orderBy(desc(contributionsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(contributionsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/contributions/:id
router.get("/contributions/:id", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const [contribution] = await db.select().from(contributionsTable).where(eq(contributionsTable.id, req.params.id)).limit(1);
    if (!contribution) return res.status(404).json({ error: "Contribution not found" });
    const inKind = await db.select().from(inKindContributionsTable).where(eq(inKindContributionsTable.contributionId, req.params.id));
    res.json({ ...contribution, inKind });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/finance/contributions/:id/verify
router.patch("/contributions/:id/verify", requireAuth, canManageFinance, async (req: any, res: any) => {
  try {
    const body = validate(ContributionVerifySchema, req.body, res);
    if (!body) return;

    const { status, rejectionReason } = body;
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(contributionsTable).set({
      verificationStatus: status,
      verifiedBy: actorId ?? undefined,
      verifiedAt: new Date(),
      rejectionReason: rejectionReason ?? null,
    }).where(eq(contributionsTable.id, req.params.id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    await logFinance("contribution", updated.id, status === "verified" ? "verified" : "rejected", actorId);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/dashboard  — summary stats
router.get("/dashboard", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [totals, todayTotals, byChannel, alerts, pendingVerification] = await Promise.all([
      db.select({ total: sum(contributionsTable.amount), count: count() }).from(contributionsTable)
        .where(eq(contributionsTable.verificationStatus, "verified")),
      db.select({ total: sum(contributionsTable.amount), count: count() }).from(contributionsTable)
        .where(and(eq(contributionsTable.verificationStatus, "verified"), gte(contributionsTable.createdAt, today))),
      db.select({ channel: contributionsTable.channel, total: sum(contributionsTable.amount), count: count() })
        .from(contributionsTable).where(eq(contributionsTable.verificationStatus, "verified"))
        .groupBy(contributionsTable.channel),
      db.select({ count: count() }).from(donorAlertsTable).where(eq(donorAlertsTable.status, "open")),
      db.select({ count: count() }).from(contributionsTable).where(eq(contributionsTable.verificationStatus, "pending")),
    ]);
    res.json({
      totalRaisedKes: totals[0]?.total ?? "0",
      totalContributions: Number(totals[0]?.count ?? 0),
      todayRaisedKes: todayTotals[0]?.total ?? "0",
      todayContributions: Number(todayTotals[0]?.count ?? 0),
      byChannel,
      openAlerts: Number(alerts[0]?.count ?? 0),
      pendingVerification: Number(pendingVerification[0]?.count ?? 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DONOR ALERTS ─────────────────────────────────────────────────────────────

router.get("/alerts", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const { status } = req.query;
    const where = status ? eq(donorAlertsTable.status, status) : undefined;
    const rows = await db.select().from(donorAlertsTable).where(where).orderBy(desc(donorAlertsTable.createdAt)).limit(50);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/alerts/:id/resolve", requireAuth, canManageFinance, async (req: any, res: any) => {
  try {
    const body = validate(AlertResolveSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const { status, resolutionNotes } = body;
    const [updated] = await db.update(donorAlertsTable).set({
      status: status ?? "resolved", resolutionNotes, resolvedBy: actorId ?? undefined, resolvedAt: new Date(),
    }).where(eq(donorAlertsTable.id, req.params.id)).returning();
    if (!updated) return res.status(404).json({ error: "Alert not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BUDGET CATEGORIES ────────────────────────────────────────────────────────

router.get("/budget-categories", requireAuth, canViewFinance, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(budgetCategoriesTable).orderBy(budgetCategoriesTable.name);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/budget-categories", requireAuth, canManageFinance, async (req: any, res: any) => {
  try {
    const body = validate(BudgetCategorySchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(budgetCategoriesTable).values({ ...body, createdBy: actorId ?? undefined }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BUDGET LINES ─────────────────────────────────────────────────────────────

router.get("/budget-lines", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const { categoryId, fiscalPeriod } = req.query;
    const conditions: any[] = [];
    if (categoryId) conditions.push(eq(budgetLinesTable.categoryId, categoryId));
    if (fiscalPeriod) conditions.push(eq(budgetLinesTable.fiscalPeriod, fiscalPeriod));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(budgetLinesTable).where(where).orderBy(budgetLinesTable.fiscalPeriod);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/budget-lines", requireAuth, canManageFinance, async (req: any, res: any) => {
  try {
    const body = validate(BudgetLineSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(budgetLinesTable).values({ ...body, createdBy: actorId ?? undefined }).returning();
    await logFinance("budget_line", row.id, "created", actorId);
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── EXPENDITURE REQUESTS ─────────────────────────────────────────────────────

router.get("/expenditure-requests", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const { status, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1; const pageSize = Math.min(parseInt(limit) || 20, 50);
    const where = status ? eq(expenditureRequestsTable.status, status) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(expenditureRequestsTable).where(where).orderBy(desc(expenditureRequestsTable.createdAt)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(expenditureRequestsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/expenditure-requests", requireAuth, canManageFinance, async (req: any, res: any) => {
  try {
    const body = validate(ExpenditureRequestSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const ref = generateRef("EXP");
    const [row] = await db.insert(expenditureRequestsTable).values({
      ...body, referenceNumber: ref, requestedBy: actorId, status: "pending_first",
    }).returning();
    await logFinance("expenditure", row.id, "created", actorId);
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/expenditure-requests/:id", requireAuth, canViewFinance, async (req: any, res: any) => {
  try {
    const [row] = await db.select().from(expenditureRequestsTable).where(eq(expenditureRequestsTable.id, req.params.id)).limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// First approval
router.post("/expenditure-requests/:id/first-approve", requireAuth, canApproveExpenditure, async (req: any, res: any) => {
  try {
    const body = validate(FirstApproveSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const { approvedAmount } = body;
    const [row] = await db.update(expenditureRequestsTable).set({
      status: "pending_final",
      firstApproverId: actorId ?? undefined,
      firstApprovedAt: new Date(),
      approvedAmountKes: approvedAmount ? String(approvedAmount) : undefined,
    }).where(and(eq(expenditureRequestsTable.id, req.params.id), eq(expenditureRequestsTable.status, "pending_first"))).returning();
    if (!row) return res.status(400).json({ error: "Cannot first-approve — wrong status or not found" });
    await logFinance("expenditure", row.id, "first_approved", actorId);
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Final approval — generates payment voucher
router.post("/expenditure-requests/:id/final-approve", requireAuth, canApproveExpenditure, async (req: any, res: any) => {
  try {
    const body = validate(FinalApproveSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const [expReq] = await db.select().from(expenditureRequestsTable).where(eq(expenditureRequestsTable.id, req.params.id)).limit(1);
    if (!expReq || expReq.status !== "pending_final") return res.status(400).json({ error: "Cannot final-approve — wrong status" });

    const voucherNum = `PV-${generateRef("").split("-").slice(1).join("-")}`;
    const [voucher] = await db.insert(paymentVouchersTable).values({
      voucherNumber: voucherNum,
      expenditureRequestId: expReq.id,
      amountKes: expReq.approvedAmountKes ?? expReq.requestedAmountKes,
      paymentMethod: body.paymentMethod ?? "bank_transfer",
      payeeSnapshot: { name: expReq.payeeName, bank: expReq.payeeBank, account: expReq.payeeAccountNumber, phone: expReq.payeePhone },
      ledger: expReq.ledger,
      issuedBy: actorId ?? expReq.requestedBy,
    }).returning();

    const [updated] = await db.update(expenditureRequestsTable).set({
      status: "approved", finalApproverId: actorId ?? undefined, finalApprovedAt: new Date(), paymentVoucherId: voucher.id,
    }).where(eq(expenditureRequestsTable.id, expReq.id)).returning();

    await logFinance("expenditure", expReq.id, "final_approved", actorId, { voucherId: voucher.id });
    res.json({ expenditure: updated, voucher });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reject
router.post("/expenditure-requests/:id/reject", requireAuth, canApproveExpenditure, async (req: any, res: any) => {
  try {
    const body = validate(RejectSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(expenditureRequestsTable).set({
      status: "rejected", rejectionReason: body.reason,
    }).where(eq(expenditureRequestsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await logFinance("expenditure", row.id, "rejected", actorId, { reason: body.reason });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/vouchers
router.get("/vouchers", requireAuth, canViewFinance, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(paymentVouchersTable).orderBy(desc(paymentVouchersTable.createdAt)).limit(100);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
