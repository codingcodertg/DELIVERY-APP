"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/erp/ui/button";
import { cn } from "@/lib/erp/utils";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import type { Cliente } from "@/lib/customers/reglas";
import { gruposPorIniciales, idsParaAsignar, vendedoresEnOrden, type Vendedor } from "@/lib/customers/vendedores";
import { selCls } from "./FichaDeCliente";

type T = (en: string, es: string) => string;

/**
 * Asignar vendedores de golpe (D-684), solo el admin. El dueño, 2026-10-26: «aún no me sale una quick way para admin only
 * para asignar vendedores». Una fila por iniciales de QuickBooks (`rep_store`, o `rep_qb` si falta): cuántos clientes, cuántos
 * sin vendedor, quién los tiene hoy, y un desplegable con los vendedores. «Asignar» se lo pone a los SIN vendedor de esas
 * iniciales; con «También los que ya tienen», a todos. La base vuelve a exigir quién escribe (198).
 */
export function AsignarVendedores({ lista, almacen, onAsignados, onClose, t }: {
  lista: readonly Cliente[];
  almacen: AlmacenDeClientes;
  /** Los ids tocados y el vendedor nuevo (null = libre), para pintar la lista sin releerla. */
  onAsignados: (ids: number[], vendedor: Vendedor | null) => void;
  onClose: () => void;
  t: T;
}) {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  useEffect(() => {
    let cancelado = false;
    void almacen.vendedores().then((r) => { if (!cancelado && r.ok) setVendedores(vendedoresEnOrden(r.valor)); });
    return () => { cancelado = true; };
  }, [almacen]);
  const grupos = useMemo(() => gruposPorIniciales(lista), [lista]);
  const [elegido, setElegido] = useState<Record<string, string>>({});
  const [todos, setTodos] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const asignar = async (ini: string) => {
    const repId = elegido[ini] ?? "";
    const g = grupos.find((x) => x.iniciales === ini);
    if (!g) return;
    const ids = idsParaAsignar(g, todos);
    if (!ids.length) return;
    setOcupado(ini);
    setAviso(null);
    const r = await almacen.asignarVendedor(ids, repId || null);
    setOcupado(null);
    if (!r.ok) { setAviso({ ok: false, texto: t("Not saved: ", "No se guardó: ") + r.error }); return; }
    const v = vendedores.find((x) => x.id === repId) ?? null;
    onAsignados(ids, v);
    setAviso({ ok: true, texto: `${ini}: ${r.valor} ${t("customers →", "clientes →")} ${v?.full_name ?? t("free", "libre")}` });
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-asignar-vendedores>
      <div className="modal" style={{ maxWidth: 860 }} role="dialog" aria-modal="true" aria-label={t("Assign sales reps", "Asignar vendedores")}>
        <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">👤 {t("Assign sales reps", "Asignar vendedores")}</h2>
            <p className="text-xs text-slate-500">{t("By QuickBooks initials. Pick the rep and press Assign: it goes to every customer with those initials.", "Por iniciales de QuickBooks. Elige el vendedor y pulsa Asignar: se pone a todos los clientes con esas iniciales.")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 text-lg text-slate-400 hover:bg-slate-100" aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} data-tambien-con-vendedor />
          {t("Also the ones that already have a rep (reassign)", "También los que ya tienen vendedor (reasignar)")}
        </label>
        {aviso && <p className={cn("mt-2 rounded-md p-2 text-sm", aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")} role="status">{aviso.texto}</p>}
        <div className="mt-3 max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-white text-left text-xs uppercase text-slate-400">
              <tr><th className="py-1.5">{t("Initials", "Iniciales")}</th><th>{t("Customers", "Clientes")}</th><th>{t("No rep", "Sin vendedor")}</th><th>{t("Rep today", "Vendedor hoy")}</th><th className="w-56">{t("Assign to", "Asignar a")}</th><th /></tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const n = idsParaAsignar(g, todos).length;
                return (
                  <tr key={g.iniciales} className="border-t border-slate-100" data-grupo-de-iniciales={g.iniciales}>
                    <td className="py-1.5 font-mono font-medium text-slate-900">{g.iniciales}</td>
                    <td>{g.total}</td>
                    <td className={g.sinVendedor ? "font-medium text-amber-700" : "text-slate-400"}>{g.sinVendedor}</td>
                    <td className="text-xs text-slate-600">{g.vendedores.length ? g.vendedores.map((v) => `${v.nombre} (${v.n})`).join(", ") : "—"}</td>
                    <td>
                      <select className={cn(selCls, "w-full")} value={elegido[g.iniciales] ?? ""} onChange={(e) => setElegido((x) => ({ ...x, [g.iniciales]: e.target.value }))} data-vendedor-para={g.iniciales}>
                        <option value="">{t("— free (no rep)", "— libre (sin vendedor)")}</option>
                        {vendedores.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                      </select>
                    </td>
                    <td className="pl-2 text-right">
                      <Button size="sm" disabled={!n || ocupado !== null} onClick={() => void asignar(g.iniciales)} data-asignar={g.iniciales}>
                        {ocupado === g.iniciales ? "…" : `${t("Assign", "Asignar")} ${n}`}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
