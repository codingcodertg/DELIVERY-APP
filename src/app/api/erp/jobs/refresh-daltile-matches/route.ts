// Weekly Daltile match-refresh job (away-sprint, PR-only — CRON IS NOT ENABLED).
// Pulls the matched-slice export from the standalone Daltile warehouse and writes
// suggestions into product_external_refs via the service-role RPC (which writes
// 'auto' and never touches 'confirmed'/'rejected'). NEVER auto-confirms.
//
// Match ladder (lib/daltile-match): sku → mpn → name_code → name_size.
// Guarded by JOBS_SECRET (Bearer). Enable the weekly cron only after J reviews.
// Env: WAREHOUSE_CATALOG_URL, WAREHOUSE_READ_TOKEN, JOBS_SECRET.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/erp/supabase/admin';
import { matchAll, type WareRow, type ErpProduct } from '@/lib/erp/daltile-match';
import { errorResponse } from '@/lib/erp/api-error';
import { unwrap } from '@/lib/erp/db-result';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function fetchExport(base: string, token: string): Promise<WareRow[]> {
  const out: WareRow[] = [];
  let offset = 0;
  for (;;) {
    const u = new URL(base);
    u.searchParams.set('manufacturer', 'daltile');
    u.searchParams.set('active', 'true');
    u.searchParams.set('limit', '1000');
    u.searchParams.set('offset', String(offset));
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`warehouse export ${res.status}`);
    const body = (await res.json()) as { products: WareRow[]; next_offset: number | null };
    out.push(...(body.products || []));
    if (body.next_offset == null) break;
    offset = body.next_offset;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const secret = process.env.JOBS_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const base = process.env.WAREHOUSE_CATALOG_URL;
  const token = process.env.WAREHOUSE_READ_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: 'Missing WAREHOUSE_CATALOG_URL / WAREHOUSE_READ_TOKEN' }, { status: 500 });
  }
  const dryRun = req.nextUrl.searchParams.get('dry') === '1';
  const allProducts = req.nextUrl.searchParams.get('all') === '1';
  const admin = createAdminClient();

  try {
    const ware = await fetchExport(base, token);

    // ERP products: Daltile-vendor by default (the relevant set), or all published.
    let q = admin.from('products').select('id, name, mpn, size_in').eq('record_status', 'published');
    if (!allProducts) {
      // ARC-02: a swallowed error here left ids=[] -> vendor_id in (-1) -> 0 products,
      // and the job reported ok:true with "matched: 0". It now fails the run.
      const vendors = unwrap(await admin.from('vendors').select('id').ilike('name', '%daltile%'), 'refresh-daltile: vendors');
      const ids = (vendors ?? []).map(v => v.id);
      q = q.in('vendor_id', ids.length ? ids : [-1]);
    }
    const { data: products, error } = await q;
    if (error) throw new Error(`erp products: ${error.message}`);

    const { refs, counts } = matchAll(ware, (products ?? []) as ErpProduct[]);

    let written = 0;
    const errors: string[] = [];
    if (!dryRun) {
      for (const r of refs) {
        const { error: e } = await admin.rpc('upsert_external_ref', { p_ref: r });
        if (e) errors.push(`${r.product_id}: ${e.message}`);
        else written++;
      }
    }
    return NextResponse.json({
      ok: true, dryRun, scope: allProducts ? 'all_published' : 'daltile_vendor',
      warehouse_products: ware.length, erp_products: products?.length ?? 0,
      matched: counts, written, errors: errors.slice(0, 10),
    });
  } catch (e) {
    console.error('[refresh-daltile-matches]', e);
    // Full detail → Sentry (scrubbed); only the safe { code, message, ref } shape to the client.
    return errorResponse(e);
  }
}
