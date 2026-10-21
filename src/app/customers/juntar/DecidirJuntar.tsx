"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/erp/supabase/client";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { cn } from "@/lib/erp/utils";
import { almacenDeLaBase, type AlmacenDeClientes } from "@/lib/customers/almacen";
import { almacenDemo } from "@/lib/customers/demo";
import { EVENTO_DE_LA_COLA, filasDeLaEmpresa, motivoDeSospechaLabel, paresParaDecidir, vistaPreviaDeJuntar, type ParParaDecidir, type Sugerencia } from "@/lib/customers/empresas";
import { CAMPOS, dinero, estadoClase, estadoLabel, nombreDeTienda, type Cliente } from "@/lib/customers/reglas";

type Estado = { tipo: "cargando" } | { tipo: "sinTabla" } | { tipo: "error"; texto: string } | { tipo: "listo" };
const TANDA = 25;

/**
 * La cola «Decidir si se juntan» (189): cada par sospechoso, lado a lado, con por qué se sospecha y qué pasará al
 * juntarlo. «✅ Juntar» llama a `erp.junta_clientes` (una llamada, todo o nada) y relee; «✖ No son la misma» la marca
 * rechazada y no se vuelve a proponer. Lo que se pinta después es lo que devolvió la base.
 */
export function DecidirJuntar({ demo, puedeEditar }: { demo: boolean; puedeEditar: boolean }) {
  const { t } = usePrefs();
  const almacen: AlmacenDeClientes = useMemo(() => (demo ? almacenDemo() : almacenDeLaBase(createClient())), [demo]);
  const [lista, setLista] = useState<Cliente[]>([]);
  const [sugs, setSugs] = useState<Sugerencia[]>([]);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [cuantos, setCuantos] = useState(TANDA);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ tono: "rojo" | "verde"; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const [l, s] = await Promise.all([almacen.leer(), almacen.sugerencias()]);
    if (!l.ok) { setEstado(l.sinTabla ? { tipo: "sinTabla" } : { tipo: "error", texto: l.error }); return; }
    if (!s.ok) { setEstado(s.sinTabla ? { tipo: "sinTabla" } : { tipo: "error", texto: s.error }); return; }
    setLista(l.valor);
    setSugs(s.valor);
    setEstado({ tipo: "listo" });
  }, [almacen]);
  useEffect(() => { void cargar(); }, [cargar]);

  const pares = useMemo(() => paresParaDecidir(sugs, lista), [sugs, lista]);

  const juntar = async (p: ParParaDecidir) => {
    setOcupado(p.sugerencia.id);
    setAviso(null);
    const r = await almacen.juntar(p.a.id, p.b.id);
    if (!r.ok) {
      setOcupado(null);
      setAviso({ tono: "rojo", texto: (r.sinPermiso ? t("Not merged (no permission): ", "No se juntaron (sin permiso): ") : t("Not merged: ", "No se juntaron: ")) + r.error });
      return;
    }
    await cargar();
    window.dispatchEvent(new Event(EVENTO_DE_LA_COLA));
    setOcupado(null);
    setAviso({ tono: "verde", texto: t(`Merged: ${p.a.account} + ${p.b.account} ✓`, `Juntados: ${p.a.account} + ${p.b.account} ✓`) });
  };
  const rechazar = async (p: ParParaDecidir) => {
    setOcupado(p.sugerencia.id);
    setAviso(null);
    const r = await almacen.rechazar(p.sugerencia.id);
    setOcupado(null);
    if (!r.ok) { setAviso({ tono: "rojo", texto: t("Not saved: ", "No se guardó: ") + r.error }); return; }
    setSugs((s) => s.filter((x) => x.id !== p.sugerencia.id));
    window.dispatchEvent(new Event(EVENTO_DE_LA_COLA));
    setAviso({ tono: "verde", texto: t("Marked as not the same ✓", "Marcados como distintos ✓") });
  };

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6">
      <div className="mb-4">
        <Link href="/customers" className="text-sm text-clay-600 hover:underline">{t("← Customers", "← Clientes")}</Link>
        <h1 className="mt-1 text-2xl font-semibold">{t("Decide to merge", "Decidir si se juntan")}</h1>
        <p className="text-sm text-slate-500">
          {t(
            "Customers that look like the same company but are not obviously the same. Merge them, or mark them as not the same (they won't be suggested again).",
            "Clientes que parecen la misma compañía pero no lo son a simple vista. Júntalos, o márcalos como distintos (no se vuelven a proponer).",
          )}
        </p>
      </div>

      {aviso && (
        <p className={cn("mb-3 rounded-md border p-2 text-sm", aviso.tono === "verde" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")} role="status">
          {aviso.texto}
        </p>
      )}
      {!puedeEditar && (
        <p className="mb-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">{t("Read-only — admins and managers decide.", "Solo lectura — deciden los admins y los managers.")}</p>
      )}
      {estado.tipo === "cargando" && <p className="text-sm text-slate-500">{t("Loading…", "Cargando…")}</p>}
      {estado.tipo === "sinTabla" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t("The merge queue does not exist yet (migration 189 is not applied).", "La cola para juntar aún no existe (la migración 189 no está aplicada).")}
        </p>
      )}
      {estado.tipo === "error" && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t("Could not load: ", "No se pudo cargar: ")}{estado.texto}</p>}

      {estado.tipo === "listo" && (
        <>
          <p className="mb-3 text-sm text-slate-500" data-pendientes={pares.length}>
            {pares.length === 0
              ? t("Nothing left to decide.", "No queda nada por decidir.")
              : t(`${pares.length} pairs to decide`, `${pares.length} pares por decidir`)}
          </p>
          <div className="space-y-4">
            {pares.slice(0, cuantos).map((p) => {
              const previa = vistaPreviaDeJuntar(lista, p.a.id, p.b.id);
              return (
                <section key={p.sugerencia.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-sugerencia={p.sugerencia.id}>
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    {p.motivos.map((m) => (
                      <Badge key={m} className="border-amber-200 bg-amber-50 text-amber-800">{motivoDeSospechaLabel(m, t)}</Badge>
                    ))}
                    {p.sugerencia.score !== null && p.sugerencia.score > 0 && (
                      <span className="text-xs text-slate-400">{t("name similarity", "parecido del nombre")} {Math.round(p.sugerencia.score * 100)}%</span>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Lado c={p.a} lista={lista} t={t} />
                    <Lado c={p.b} lista={lista} t={t} />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {t("If merged: one company in ", "Si se juntan: una empresa en ")}
                    {previa.tiendas.map(nombreDeTienda).join(", ")}
                    {previa.pasos.length > 0 && (
                      <>
                        {". "}
                        {previa.pasos.map((x) => t(
                          `Same store: #${x.archivada} joins #${x.sobrevive} (kept) and is archived, its differing data go to the notes`,
                          `Misma tienda: #${x.archivada} se une a #${x.sobrevive} (se queda) y se archiva; lo distinto va a las notas`,
                        )).join(" · ")}
                      </>
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={() => rechazar(p)} disabled={!puedeEditar || ocupado !== null}>
                      ✖ {t("Not the same", "No son la misma")}
                    </Button>
                    <Button onClick={() => juntar(p)} disabled={!puedeEditar || ocupado !== null}>
                      {ocupado === p.sugerencia.id ? t("Saving…", "Guardando…") : `✅ ${t("Merge", "Juntar")}`}
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
          {pares.length > cuantos && (
            <div className="mt-4 text-center">
              <Button variant="outline" size="sm" onClick={() => setCuantos((n) => n + TANDA)}>
                {t(`Show more (${pares.length - cuantos} left)`, `Ver más (quedan ${pares.length - cuantos})`)}
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

/** Lo que se compara de cada lado, con las etiquetas de la ficha (`CAMPOS`). */
const LADO = ["unified_account", "contact_name", "phone", "email", "rep_store", "address", "credit_limit"] as const;

/** Un lado del par: la fila, y las otras tiendas de su empresa si las tiene. */
function Lado({ c, lista, t }: { c: Cliente; lista: Cliente[]; t: (en: string, es: string) => string }) {
  const otras = filasDeLaEmpresa(lista, c).filter((x) => x.id !== c.id);
  const fila = (etiqueta: string, valor: string | null) => (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 text-sm last:border-0">
      <span className="text-slate-500">{etiqueta}</span>
      <span className="min-w-0 break-words text-right font-medium text-slate-900">{valor && valor.trim() !== "" ? valor : "—"}</span>
    </div>
  );
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 p-3" data-lado={c.id}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-clay-200 bg-clay-50 px-2 py-0.5 text-xs font-medium text-clay-700">{nombreDeTienda(c.store)}</span>
        <Badge className={estadoClase(c.status_store)}>{estadoLabel(c.status_store, t)}</Badge>
        <Link href={`/customers/${c.id}`} className="ml-auto text-xs text-clay-600 hover:underline">#{c.id} {t("details", "ficha")}</Link>
      </div>
      <div className="mb-2 break-words text-base font-semibold text-slate-900">{c.account}</div>
      {LADO.map((k) => {
        const campo = CAMPOS.find((x) => x.key === k)!;
        const v = c[k];
        return <div key={k}>{fila(t(campo.en, campo.es), v === null || v === undefined ? null : k === "credit_limit" ? dinero(v as number) : String(v))}</div>;
      })}
      {otras.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {t("Same company in: ", "Misma empresa en: ")}{otras.map((x) => nombreDeTienda(x.store)).join(", ")}
        </p>
      )}
    </div>
  );
}
