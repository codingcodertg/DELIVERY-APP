"use server";
import { createClient } from "@/lib/erp/supabase/server";
import { getSessionInfo } from "@/lib/erp/auth";
import { revalidatePath } from "next/cache";

// Manager/admin confirm or reject of a Daltile external-ref match. The RPCs
// enforce the role gate themselves (search_path='' definer); we also check the
// session here (defense in depth) and revalidate the affected pages.
async function ensureManager() {
  const s = await getSessionInfo();
  if (!s || (s.role !== "admin" && s.role !== "manager")) throw new Error("Not authorized");
}

export async function confirmDaltileMatch(refId: number) {
  await ensureManager();
  const sb = await createClient();
  // confirm_external_match also backfills products.mpn from the Daltile code
  // (only when empty) via the audited update_product path.
  const { error } = await sb.rpc("confirm_external_match", { p_ref_id: refId });
  if (error) throw new Error(error.message);
  revalidatePath("/erp/review/daltile");
}

export async function rejectDaltileMatch(refId: number) {
  await ensureManager();
  const sb = await createClient();
  const { error } = await sb.rpc("reject_external_match", { p_ref_id: refId });
  if (error) throw new Error(error.message);
  revalidatePath("/erp/review/daltile");
}
