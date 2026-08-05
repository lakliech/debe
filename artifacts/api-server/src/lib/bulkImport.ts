/**
 * Bulk import helpers — CSV/Excel upload parsing and row-mapped bulk inserts.
 * Shared by the /import endpoints in pollingAgentsMgmt, volunteers,
 * supporters, and electionAdmin (candidates).
 *
 * Upload contract: multipart form field "file" (.csv, .xls, .xlsx), max 5 MB,
 * max 5000 data rows. The xlsx engine parses all three formats uniformly.
 *
 * Semantics: BEST-EFFORT, non-atomic. Valid rows are inserted in 500-row
 * chunks; a database failure mid-import can leave earlier chunks committed
 * while the endpoint returns 500. Imports are reported per-row so operators
 * can reconcile and re-run — do not treat an import as an all-or-nothing
 * transaction.
 */
import multer from "multer";
import * as XLSX from "xlsx";

/** Multipart upload middleware: single file field "file", memory storage. */
export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single("file");

/** Hard row cap so a pathological file cannot wedge the event loop. */
export const MAX_IMPORT_ROWS = 5000;

export class ImportParseError extends Error {}

/** Thrown by insertRows when a URL-scoped parent (e.g. election) is not found. */
export class ImportNotFoundError extends Error {}

/** Parse an uploaded CSV/Excel buffer into row objects keyed by header row. */
export function parseTabularFile(buffer: Buffer): Record<string, unknown>[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new ImportParseError("Could not parse the file. Upload a valid .csv, .xls, or .xlsx.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new ImportParseError("The file contains no sheets.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rows.length === 0) throw new ImportParseError("The file has a header row but no data rows.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportParseError(`Too many rows (${rows.length}). Split the file into batches of ${MAX_IMPORT_ROWS} or fewer.`);
  }
  return rows;
}

/** Normalise a header key: lowercase, strip spaces/underscores/hyphens. */
function normKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-]+/g, "");
}

/**
 * Remap a raw row's headers onto canonical field names via an alias map, e.g.
 * { fullName: ["name"], phoneNumber: ["phone", "msisdn"] }. Canonical keys
 * are also accepted after normalisation ("Full Name" → fullName).
 */
export function remapRow(raw: Record<string, unknown>, aliases: Record<string, string[]>): Record<string, unknown> {
  const lookup = new Map<string, string>();
  for (const [canonical, names] of Object.entries(aliases)) {
    lookup.set(normKey(canonical), canonical);
    for (const alias of names) lookup.set(normKey(alias), canonical);
  }
  const out: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(raw)) {
    const canonical = lookup.get(normKey(header));
    if (canonical !== undefined && out[canonical] === undefined) out[canonical] = value;
  }
  return out;
}

// ─── Cell coercion (spreadsheets type cells loosely) ─────────────────────────

export function cellString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

export function cellBool(v: unknown): boolean | undefined {
  const s = cellString(v)?.toLowerCase();
  if (s === undefined) return undefined;
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
}

export function cellInt(v: unknown): number | undefined {
  const s = cellString(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isInteger(n) ? n : undefined;
}

/** Split a delimited cell ("swahili, english" or "a;b") into a clean array. */
export function cellList(v: unknown): string[] | undefined {
  const s = cellString(v);
  if (!s) return undefined;
  return s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
}

// ─── Validation + handler factory ────────────────────────────────────────────

/** Structural zod-safeParse shape — version-proof across zod 3/4. */
export type ImportSchema<T> = {
  safeParse: (input: unknown) =>
    | { success: true; data: T }
    | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
};

export interface ImportRowError {
  row: number;
  error: string;
}

/**
 * Validate + map every row. Reported row numbers are 1-indexed with the
 * header as row 1, so the first data row is row 2 — matching Excel.
 */
export function validateImportRows<T>(
  rawRows: Record<string, unknown>[],
  schema: ImportSchema<T>,
  aliases: Record<string, string[]>,
): { valid: T[]; errors: ImportRowError[] } {
  const valid: T[] = [];
  const errors: ImportRowError[] = [];
  rawRows.forEach((raw, i) => {
    const parsed = schema.safeParse(remapRow(raw, aliases));
    if (parsed.success) valid.push(parsed.data);
    else {
      const issue = parsed.error.issues[0];
      errors.push({ row: i + 2, error: `${issue.path.join(".") || "row"}: ${issue.message}` });
    }
  });
  return { valid, errors };
}

export function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface ImportHandlerOptions<T> {
  schema: ImportSchema<T>;
  aliases: Record<string, string[]>;
  /** Resolve the tenant — assertTenant(req).id at call sites. */
  getTenantId: (req: any) => string;
  /** Insert the validated rows; returns the number created. */
  insertRows: (rows: T[], tenantId: string, req: any) => Promise<number>;
  logger: { error: (obj: unknown, msg: string) => void };
}

/**
 * Uniform /import endpoint body: multer → parse → per-row validate → insert
 * valid rows → report. Partial success returns 201 with per-row errors;
 * zero created rows returns 400 so the client knows nothing was imported.
 */
export function makeImportHandler<T>(opts: ImportHandlerOptions<T>) {
  return (req: any, res: any) => {
    importUpload(req, res, async (uploadErr: any) => {
      if (uploadErr) {
        return res.status(400).json({
          error: uploadErr.code === "LIMIT_FILE_SIZE" ? "File too large — maximum 5 MB." : "File upload failed.",
        });
      }
      try {
        const tenantId = opts.getTenantId(req);
        if (!req.file?.buffer) {
          return res.status(400).json({ error: 'Attach the file as multipart form field "file" (.csv, .xls, or .xlsx).' });
        }
        const rawRows = parseTabularFile(req.file.buffer);
        const { valid, errors } = validateImportRows(rawRows, opts.schema, opts.aliases);
        const created = valid.length > 0 ? await opts.insertRows(valid, tenantId, req) : 0;
        res.status(created === 0 ? 400 : 201).json({ created, failed: errors.length, errors });
      } catch (err: any) {
        if (err instanceof ImportParseError) return res.status(400).json({ error: err.message });
        if (err instanceof ImportNotFoundError) return res.status(404).json({ error: err.message });
        opts.logger.error({ err }, "bulk import failed");
        res.status(500).json({ error: "Something went wrong. Please try again." });
      }
    });
  };
}
