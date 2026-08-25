"use server";

// Server actions for the Excel round-trip import (excel-round-trip-mirror-spec.md §Import → write).
// Both call the audited, manager/admin-gated apply_master_import RPC (v4_57): preview (dry_run) computes
// the per-field diff + staleness/validation quarantine without writing; apply commits the approved rows
// through the same path (audit + price_history fire; only changed fields write; #29 enforced on cost).
// Rows are chunked ≤1000 so any catalog size works with no PostgREST row cap. The owner's master-Excel
// ingest points at THIS same path (spec §5) — unknown SKUs route to drafts, known SKUs diff.

import { createClient } from "@/lib/erp/supabase/server";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { revalidatePath } from "next/cache";

/** One import row: canonical field keys → string values, plus `sku` and the hidden `__row_version`. */
export type MasterImportRow = Record<string, string>;

export type MasterChange = { field: string; from: unknown; to: unknown };
export type MasterRowAction = "preview" | "applied" | "skip" | "error" | "stale" | "new_draft";
export type MasterRowResult = {
  sku: string | null;
  action: MasterRowAction;
  reason?: string;
  changes?: MasterChange[];
};
export type MasterImportResult = {
  dry_run: boolean;
  total: number;
  applied: number;
  skipped: number;
  errored: number;
  will_apply: number;
  stale: number;
  drafts: number;
  rows: MasterRowResult[];
};

const CHUNK = 1000;

const empty = (dryRun: boolean): MasterImportResult => ({
  dry_run: dryRun, total: 0, applied: 0, skipped: 0, errored: 0, will_apply: 0, stale: 0, drafts: 0, rows: [],
});

async function run(
  rows: MasterImportRow[],
  dryRun: boolean
): Promise<{ ok: true; result: MasterImportResult } | { ok: false; error: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!canSeeCost(session.role)) return { ok: false, error: "Manager/admin only" }; // RPC also fails closed
  const supabase = await createClient();
  const merged = empty(dryRun);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabase.rpc("apply_master_import", {
      p_rows: rows.slice(i, i + CHUNK),
      p_dry_run: dryRun,
    });
    if (error) return { ok: false, error: error.message };
    const r = data as MasterImportResult;
    merged.total += r.total;
    merged.applied += r.applied;
    merged.skipped += r.skipped;
    merged.errored += r.errored;
    merged.will_apply += r.will_apply;
    merged.stale += r.stale;
    merged.drafts += r.drafts;
    merged.rows.push(...r.rows);
  }
  if (!dryRun) {
    revalidatePath("/catalog");
    revalidatePath("/requests");
    revalidatePath("/review");
  }
  return { ok: true, result: merged };
}

/** Dry-run: per-field diff + staleness/validation quarantine, nothing written. */
export async function previewMasterImport(
  rows: MasterImportRow[]
): Promise<{ ok: true; result: MasterImportResult } | { ok: false; error: string }> {
  return run(rows, true);
}

/** Commit the approved rows (the client sends only the rows the manager kept). */
export async function applyMasterImport(
  rows: MasterImportRow[]
): Promise<{ ok: true; result: MasterImportResult } | { ok: false; error: string }> {
  return run(rows, false);
}
