"use client";

import { useMemo, useState } from "react";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { rotulo } from "@/components/erp/rotulo";
import { CountListDetail } from "@/components/erp/count-list-detail";
import type { StoreOption } from "@/components/erp/inventory-console";
import { createCountList, listCountLists, type ListaDeConteo } from "@/lib/erp/actions";
import { failText } from "@/lib/erp/messages";
import { nombreDeLista } from "@/lib/erp/listas-de-conteo";
import { cn } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";

// Sección «Listas de conteo» del Inventario: crear una lista para una tienda, ver todas (abiertas primero) y abrir
// una para seguir contando. Al abrir una, la sección muestra su detalle (count-list-detail.tsx) en el mismo lugar.

const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export function CountListsSection({ stores, initialLists }: { stores: StoreOption[]; initialLists: ListaDeConteo[] }) {
  const { t } = usePrefs();
  const [listas, setListas] = useState<ListaDeConteo[]>(initialLists);
  const [abierta, setAbierta] = useState<number | null>(null);

  async function refrescar() {
    setListas(await listCountLists());
  }

  const columnas = useMemo<ColumnaEstandar<ListaDeConteo>[]>(() => [
    { key: "nombre", ...rotulo(t("List", "Lista")), ancho: 260, fija: true, valor: (l) => l.name,
      celda: (l) => <span className="font-medium text-clay-700">{l.name}</span> },
    { key: "tienda", ...rotulo(t("Store", "Tienda")), ancho: 150, valor: (l) => l.store_name ?? l.store_id },
    { key: "estado", ...rotulo(t("Status", "Estado")), ancho: 120, valor: (l) => l.status,
      celda: (l) => (
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium",
          l.status === "open" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-100 text-slate-700")}>
          {l.status === "open" ? t("Open", "Abierta") : t("Submitted", "Enviada")}
        </span>
      ) },
    { key: "lineas", ...rotulo(t("Lines", "Renglones")), ancho: 100, numerico: true, valor: (l) => l.lines },
    { key: "contados", ...rotulo(t("Counted", "Contados")), ancho: 110, numerico: true, valor: (l) => l.counted },
    { key: "creo", ...rotulo(t("Created by", "Creó")), ancho: 160, valor: (l) => l.created_by_name ?? "—" },
    { key: "cambio", ...rotulo(t("Last change", "Último cambio")), ancho: 180, valor: (l) => l.updated_at,
      celda: (l) => fecha(l.updated_at) },
  ], [t]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{t("Count lists", "Listas de conteo")}</h2>
        <p className="text-xs text-slate-500">
          {t("Make a list of the products you have in a store, then enter how much of each you counted. Search by supplier, SKU, name or category.",
             "Haz una lista de los productos que tienes en una tienda y luego anota cuánto contaste de cada uno. Busca por proveedor, SKU, nombre o categoría.")}
        </p>
      </div>

      {abierta !== null ? (
        <CountListDetail
          key={abierta}
          listId={abierta}
          onVolver={() => { setAbierta(null); void refrescar(); }}
        />
      ) : (
        <div className="space-y-4 p-4">
          <NuevaLista stores={stores} onCreada={(id) => { setAbierta(id); void refrescar(); }} />
          {listas.length === 0 ? (
            <p className="text-sm text-slate-500">{t("No count lists yet.", "Aún no hay listas de conteo.")}</p>
          ) : (
            <div className="-mx-1">
              <TablaEstandar
                id="erp-listas-de-conteo"
                filas={listas}
                claveDe={(l) => String(l.id)}
                columnas={columnas}
                onFila={(l) => setAbierta(l.id)}
                sinCaja
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function NuevaLista({ stores, onCreada }: { stores: StoreOption[]; onCreada: (id: number) => void }) {
  const { t } = usePrefs();
  const [tienda, setTienda] = useState(stores[0]?.id ?? "");
  const nombreTienda = stores.find((s) => s.id === tienda)?.name ?? tienda;
  // El nombre sugerido sigue a la tienda hasta que la persona lo escribe a mano.
  const [nombre, setNombre] = useState(() => nombreDeLista(nombreTienda, new Date()));
  const [editado, setEditado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cambiaTienda(id: string) {
    setTienda(id);
    if (!editado) setNombre(nombreDeLista(stores.find((s) => s.id === id)?.name ?? id, new Date()));
  }

  async function crear() {
    setBusy(true); setError(null);
    const res = await createCountList({ storeId: tienda, name: nombre.trim() || nombreDeLista(nombreTienda, new Date()) });
    setBusy(false);
    if (!res.ok) {
      setError("code" in res ? failText(res, t) : res.error);
      return;
    }
    onCreada(res.value);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">{t("Store", "Tienda")}</span>
          <select value={tienda} onChange={(e) => cambiaTienda(e.target.value)} className="h-11 w-full rounded-md border border-slate-300 bg-white px-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">{t("List name", "Nombre de la lista")}</span>
          <input
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); setEditado(true); }}
            maxLength={120}
            className="h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
          />
        </label>
        <button type="button" onClick={crear} disabled={busy || !tienda} className="h-11 rounded-lg bg-clay-600 px-4 text-sm font-medium text-white hover:bg-clay-700 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? t("Creating…", "Creando…") : t("Create list", "Crear lista")}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
