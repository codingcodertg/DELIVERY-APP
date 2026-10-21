import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-NEXT (2026-10-20) · El dueño: «FV115 le di que tenía que redeliver porque no se entregó completo hoy y no me creó la orden
// como FV115 A y B». La reentrega es una carga más de la misma orden (185), no una orden con código nuevo.

const leer = (p: string) => readFileSync(new URL(p, new URL("../../", import.meta.url)), "utf8");

describe("la reentrega como carga de la misma orden", () => {
  const sql = leer("supabase/migrations/185_reentrega_como_carga.sql");
  it("la 185 trae la función con sus guardas: solo una orden entregada, pallets > 0, razón obligatoria, letra siguiente, madre a «a»", () => {
    expect(sql).toContain("create or replace function public.reentrega_como_carga(p_id uuid, p_pallets numeric, p_motivo text, p_cargo numeric default 0)");
    expect(sql).toContain("if madre.stage <> 'delivered' then");
    expect(sql).toContain("if p_pallets is null or p_pallets <= 0 then");
    expect(sql).toContain("if coalesce(btrim(p_motivo), '') = '' then");
    expect(sql).toContain("'redelivery_of', madre.id, 'redelivery_reason', btrim(p_motivo), 'delivery_fee', coalesce(p_cargo, 0),");
    expect(sql).toContain("'order_suffix', nueva, 'stage', 'approved',");
    expect(sql).toContain("update public.deliveries set order_suffix = letra where id = p_id;");
    // Sin sellos ni puesto en la carga nueva.
    expect(sql).toContain("'pod_delivered_at', null");
    expect(sql).toContain("'route_seq', null, 'pickup_seq', null");
  });
  it("la 185 lleva el guard vivo con la exención de la letra (solo `order_suffix` cambia) y el checksum puesto", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.guard_delivery_stage()");
    expect(sql).toContain("La letra de una carga es un nombre, no historia (185, D-NEXT)");
    expect(sql).toContain("probe.order_suffix := OLD.order_suffix;");
    expect(sql).toContain("if probe is not distinct from OLD then return NEW; end if;");
    expect(sql).not.toContain("'PENDIENTE'");
  });
  it("puerta: la ficha pide los pallets que faltan y llama a la base; el proveedor expone la función; el modo local no la tiene", () => {
    const modal = leer("src/components/OrderModal.tsx");
    expect(modal).toContain("id = await reentregaComoCarga(src.id, pallets, redeliverReason.trim(), chg);");
    expect(modal).toContain("data-pallets-reentrega");
    expect(modal).toContain("disabled={busy || !redeliverReason.trim() || !(Number(redeliverPallets) > 0)}");
    // En enseñanza (sin base), la copia de siempre.
    expect(modal).toContain("const row = await addDelivery(borradorDeReentrega(src, { cargo: redeliverCharge, motivo: redeliverReason }));");
    const provider = leer("src/lib/data-provider.tsx");
    expect(provider).toContain('supabase.rpc("reentrega_como_carga", { p_id: id, p_pallets: pallets, p_motivo: motivo, p_cargo: cargo })');
    expect(leer("src/lib/local-data-provider.tsx")).toContain('useCallback<DataState["reentregaComoCarga"]>(async () => null, [])');
  });
});
