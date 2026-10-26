"use client";

import { useState } from "react";
import { Button } from "@/components/erp/ui/button";
import { cn } from "@/lib/erp/utils";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { MOTIVOS_DE_ARCHIVO, motivoLabel, parcheArchivar, type Parche } from "@/lib/customers/reglas";
import type { Vendedor } from "@/lib/customers/vendedores";
import { selCls } from "./FichaDeCliente";

type T = (en: string, es: string) => string;

/**
 * La barra de lo elegido (D-NEXT), encima de la tabla, solo el admin: cuántos hay, asignar vendedor (o dejarlos libres) y
 * archivar con su motivo, a todos de golpe (`guardarVarios`, tandas de 200). Lo que la base devuelve se pinta en la lista
 * sin releerla (`onGuardados`) y la elección se vacía.
 */
export function BarraDeSeleccion({ ids, empresas, totalVisibles, vendedores, almacen, onGuardados, onTodas, onLimpia, t }: {
  ids: readonly number[];
  empresas: number;
  totalVisibles: number;
  vendedores: readonly Vendedor[];
  almacen: AlmacenDeClientes;
  onGuardados: (ids: readonly number[], parche: Parche) => void;
  onTodas: () => void;
  onLimpia: () => void;
  t: T;
}) {
  const [rep, setRep] = useState("");
  const [motivo, setMotivo] = useState<string>(MOTIVOS_DE_ARCHIVO[0]);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const aplicar = async (parche: Parche, hecho: (n: number) => string) => {
    setOcupado(true);
    setAviso(null);
    const r = await almacen.guardarVarios(ids, parche);
    setOcupado(false);
    if (!r.ok) { setAviso({ ok: false, texto: t("Not saved: ", "No se guardó: ") + r.error }); return; }
    onGuardados(ids, parche);
    setAviso({ ok: true, texto: hecho(r.valor) });
  };
  const nombre = vendedores.find((v) => v.id === rep)?.full_name ?? t("free (no rep)", "libre (sin vendedor)");

  return (
    <div className="mb-2 rounded-lg border border-clay-200 bg-clay-50 px-3 py-2 text-sm" data-barra-de-seleccion={ids.length}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-clay-800" data-elegidas={empresas}>
          ☑ {empresas} {t(empresas === 1 ? "customer selected" : "customers selected", empresas === 1 ? "cliente elegido" : "clientes elegidos")}
        </span>
        {empresas < totalVisibles && (
          <button type="button" className="text-xs text-clay-700 underline" onClick={onTodas} data-elegir-todas>{t(`Select all ${totalVisibles} shown`, `Elegir los ${totalVisibles} visibles`)}</button>
        )}
        <button type="button" className="text-xs text-slate-500 underline" onClick={() => { onLimpia(); setAviso(null); }} data-limpiar-seleccion>{t("Clear", "Quitar elección")}</button>
        <span className="mx-1 h-5 w-px bg-clay-200" />
        <select className={cn(selCls, "w-48")} value={rep} onChange={(e) => setRep(e.target.value)} data-vendedor-en-lote>
          <option value="">{t("— free (no rep)", "— libre (sin vendedor)")}</option>
          {vendedores.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
        </select>
        <Button size="sm" disabled={ocupado} onClick={() => void aplicar({ rep_id: rep || null }, (n) => `${n} ${t("rows →", "filas →")} ${nombre}`)} data-asignar-en-lote>
          👤 {t("Assign rep", "Asignar vendedor")}
        </Button>
        <span className="mx-1 h-5 w-px bg-clay-200" />
        <select className={cn(selCls, "w-52")} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-motivo-en-lote>
          {MOTIVOS_DE_ARCHIVO.map((m) => <option key={m} value={m}>{motivoLabel(m, t)}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={ocupado}
          onClick={() => { if (window.confirm(t(`Archive ${empresas} customers?`, `¿Archivar ${empresas} clientes?`))) void aplicar(parcheArchivar(motivo), (n) => `${n} ${t("rows archived", "filas archivadas")}`); }}
          data-archivar-en-lote>
          🗄 {t("Archive", "Archivar")}
        </Button>
      </div>
      {aviso && <p className={cn("mt-1.5 text-xs", aviso.ok ? "text-emerald-700" : "text-red-700")} role="status">{aviso.texto}</p>}
    </div>
  );
}
