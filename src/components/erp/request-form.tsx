"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { cn } from "@/lib/erp/utils";
import { statusLabel } from "@/lib/erp/status";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/erp/supabase/client";
import { unwrap, dbErrorMessage } from "@/lib/erp/db-result";
import { submitNewItem, submitRequest } from "@/lib/erp/actions";
import { failText } from "@/lib/erp/messages";
import {
  CAMPOS_DEL_ARTICULO, CAMPOS_DE_EDICION, TIPOS_DE_SOLICITUD, MODOS_DE_PRECIO, ESTADOS_DEL_SOLICITANTE,
  articuloDesdeElFormulario, articuloCompleto, cambiosPropuestos, camposVisibles, puedeDesactivar,
  type TipoDeSolicitud, type EstadoDelSolicitante, type OrigenDeCopia, type CampoDeArticulo,
} from "@/lib/erp/solicitud-campos";

// La hoja de solicitudes del dueño (2026-09-30), columna por columna: el mapa y el orden están en
// solicitud-campos.ts; aquí solo se pinta. Seis tipos (new, copy, edit, reactivate, deactivate,
// discontinue), Location (tienda), REQUESTER STATUS (lista / no lista), y en «copy» el origen
// (tienda + código de artículo) que precarga el formulario.

const PRODUCT_TYPES = ["tile", "trim", "setting_material", "tool", "accessory", "other"];
const STATUSES = ["active", "special_order", "discontinued", "inactive"];

type T = (en: string, es: string) => string;
// G-10 (D-204): texto de pantalla por pares inline (usePrefs). Las claves de campo son las que
// viajan al servidor y no cambian; solo la etiqueta. Tipos de producto, estados y tipos de
// solicitud son enumerados fijos: su etiqueta sale de statusLabel (status.ts) y se elige con t().
const LOOKUP_COLS = "id,sku,name,status,qoh,product_type,category_id,vendor_id," + CAMPOS_DE_EDICION.map((f) => f.key).filter((k) => k !== "name").join(",");

type Cat = { id: number; path: string };
type Vendor = { id: number; name: string };
type Store = { id: string; name: string };
export type Vocabulario = { base_unit: string[]; material: string[]; finish: string[]; style: string[]; color: string[] };
type Match = { id: number; sku: string; name: string; status: string; qoh?: number | null; [k: string]: unknown };

const sel =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

function Field({ label: text, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">
        {text} {required && <span className="text-clay-600">*</span>}
      </span>
      {children}
    </label>
  );
}

export function RequestForm({
  categories,
  vendors,
  stores,
  vocab,
  canSeeCost,
}: {
  categories: Cat[];
  vendors: Vendor[];
  stores: Store[];
  vocab: Vocabulario;
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const { t } = usePrefs();
  const sl = (v: string) => t(statusLabel(v).en, statusLabel(v).es);
  const [reqType, setReqType] = useState<TipoDeSolicitud>("new");
  const [f, setF] = useState<Record<string, string>>({ product_type: "tile", status: "active" });
  const [store, setStore] = useState("");
  const [ready, setReady] = useState<EstadoDelSolicitante>("ready");
  const [dups, setDups] = useState<Match[] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // copy: de dónde se copia
  const [copyStore, setCopyStore] = useState("");
  const [copyCode, setCopyCode] = useState("");
  const [copySource, setCopySource] = useState<OrigenDeCopia | null>(null);

  // edit/reactivate/deactivate/discontinue target + edit-field state
  const [lookupSku, setLookupSku] = useState("");
  const [target, setTarget] = useState<Match | null>(null);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const isTile = f.product_type === "tile";
  const creaBorrador = reqType === "new" || reqType === "copy";
  const requiredOk = articuloCompleto(f) && (reqType !== "copy" || !!copySource);
  const camposArticulo = camposVisibles(CAMPOS_DEL_ARTICULO, canSeeCost);
  const camposEdicion = camposVisibles(CAMPOS_DE_EDICION, canSeeCost);

  function resetNonNew() {
    setTarget(null);
    setLookupSku("");
    setReason("");
    setOriginal({});
    setEditForm({});
    setCopySource(null);
    setCopyCode("");
  }

  async function checkDups(): Promise<Match[]> {
    const sb = createClient();
    const sku = (f.sku ?? "").trim().toUpperCase();
    const name = (f.name ?? "").trim();
    // ARC-02: this is the pre-submit duplicate check. A swallowed error used to read as
    // "no duplicates" and wave a duplicate product straight through, so it now raises and
    // submitNew() reports it instead of submitting blind.
    const empty = { data: [] as Match[], error: null };
    const [a, b, c] = await Promise.all([
      sku ? sb.from("app_products").select("id,sku,name,status").eq("sku", sku) : Promise.resolve(empty),
      f.mpn ? sb.from("app_products").select("id,sku,name,status").eq("mpn", f.mpn.trim()) : Promise.resolve(empty),
      name ? sb.from("app_products").select("id,sku,name,status").ilike("name", `%${name}%`).limit(5) : Promise.resolve(empty),
    ]);
    const rows = [
      ...(unwrap(a, "request-form: dup check by sku") ?? []),
      ...(unwrap(b, "request-form: dup check by mpn") ?? []),
      ...(unwrap(c, "request-form: dup check by name") ?? []),
    ] as Match[];
    const map = new Map<number, Match>();
    for (const r of rows) map.set(r.id, r);
    // En una copia, el origen no es un duplicado: es de donde se copia.
    if (copySource) map.delete(copySource.product_id);
    return [...map.values()];
  }

  function submitNew(force: boolean) {
    setErr(null);
    setDone(null);
    if (!requiredOk) return setErr(t("Fill the required fields.", "Rellena los campos obligatorios."));
    startTransition(async () => {
      if (!force) {
        let matches: Match[];
        try {
          matches = await checkDups();
        } catch (e) {
          return setErr(t(`Could not run the duplicate check: ${dbErrorMessage(e)}`, `No se pudo comprobar duplicados: ${dbErrorMessage(e)}`));
        }
        if (matches.length > 0) return setDups(matches);
      }
      setDups(null);
      const input = articuloDesdeElFormulario(f, { canSeeCost, store, requesterStatus: ready, copySource: reqType === "copy" ? copySource : null });
      const res = await submitNewItem(input);
      if (!res.ok) setErr(failText(res, t));
      else {
        setDone(
          ready === "ready"
            ? t(`Submitted draft ${res.sku} — pending admin publish.`, `Borrador ${res.sku} enviado — pendiente de que un admin lo publique.`)
            : t(`Saved draft ${res.sku} as NOT READY — mark it ready below when it is complete.`, `Borrador ${res.sku} guardado como NO LISTA — márcala lista abajo cuando esté completa.`),
        );
        setF({ product_type: "tile", status: "active" });
        setCopySource(null);
        setCopyCode("");
        router.refresh();
      }
    });
  }

  /** Lee un producto publicado por SKU, o por el código de artículo de una tienda (store_products.qb_code). */
  async function buscarProducto(code: string, storeId: string): Promise<Match | null> {
    const sb = createClient();
    const sku = code.trim().toUpperCase();
    let data = unwrap(await sb.from("app_products").select(LOOKUP_COLS).eq("sku", sku).maybeSingle(), "request-form: sku lookup");
    if (!data && storeId) {
      const sp = unwrap(
        await sb.from("app_store_products").select("product_id").eq("store_id", storeId).eq("qb_code", code.trim()).maybeSingle(),
        "request-form: store item code lookup",
      ) as { product_id: number } | null;
      if (sp?.product_id) {
        data = unwrap(await sb.from("app_products").select(LOOKUP_COLS).eq("id", sp.product_id).maybeSingle(), "request-form: product by id");
      }
    }
    return (data as unknown as Match | null) ?? null;
  }

  function cargarOrigen() {
    setErr(null);
    setCopySource(null);
    startTransition(async () => {
      let m: Match | null;
      try {
        m = await buscarProducto(copyCode, copyStore);
      } catch (e) {
        return setErr(t(`Lookup failed: ${dbErrorMessage(e)}`, `La búsqueda falló: ${dbErrorMessage(e)}`));
      }
      if (!m) return setErr(t(`No published product with code ${copyCode.trim()}${copyStore ? ` in ${copyStore}` : ""}.`, `No hay producto publicado con código ${copyCode.trim()}${copyStore ? ` en ${copyStore}` : ""}.`));
      // Precarga: todo menos el SKU (la copia es un artículo nuevo).
      const seed: Record<string, string> = {};
      for (const c of CAMPOS_DEL_ARTICULO) {
        if (c.key === "sku") continue;
        const v = m[c.key];
        seed[c.key] = v === null || v === undefined ? "" : String(v);
      }
      setF(seed);
      setCopySource({ store: copyStore, item_code: copyCode.trim(), product_id: m.id, sku: m.sku });
    });
  }

  function lookup() {
    setErr(null);
    setTarget(null);
    startTransition(async () => {
      // ARC-02: a failed lookup used to report the honest-looking "No published product…".
      let m: Match | null;
      try {
        m = await buscarProducto(lookupSku, "");
      } catch (e) {
        return setErr(t(`Lookup failed: ${dbErrorMessage(e)}`, `La búsqueda falló: ${dbErrorMessage(e)}`));
      }
      if (!m) return setErr(t(`No published product with SKU ${lookupSku.trim().toUpperCase()}.`, `No hay producto publicado con SKU ${lookupSku.trim().toUpperCase()}.`));
      setTarget(m);
      const seed: Record<string, string> = {};
      for (const fld of CAMPOS_DE_EDICION) {
        const v = m[fld.key];
        seed[fld.key] = v === null || v === undefined ? "" : String(v);
      }
      setOriginal(seed);
      setEditForm(seed);
    });
  }

  const bloqueoDesactivar = reqType === "deactivate" && target && !puedeDesactivar(target.qoh);

  function submitChange() {
    if (!target) return;
    setErr(null);
    setDone(null);
    let payload: Record<string, string> | undefined;
    if (reqType === "edit") {
      payload = cambiosPropuestos(editForm, original, canSeeCost);
      if (Object.keys(payload).length === 0) return setErr(t("Change at least one field for a change request.", "Cambia al menos un campo para una solicitud de cambio."));
    }
    if (bloqueoDesactivar) return setErr(t("Deactivate needs QOH = 0 — use Discontinue instead.", "Desactivar exige QOH = 0 — usa Descontinuar."));
    startTransition(async () => {
      const res = await submitRequest({
        type: reqType as "edit" | "reactivate" | "deactivate" | "discontinue",
        product_id: target.id,
        reason,
        payload,
        store: store || undefined,
        requester_status: ready,
      });
      if (!res.ok) setErr(failText(res, t));
      else {
        setDone(t(`${statusLabel(reqType).en} request submitted for ${target.sku}.`, `Solicitud «${statusLabel(reqType).es}» enviada para ${target.sku}.`));
        resetNonNew();
        router.refresh();
      }
    });
  }

  function pintaCampo(c: CampoDeArticulo) {
    const label = t(c.en, c.es);
    const required = c.required === "always" || (c.required === "tile" && isTile);
    const v = f[c.key] ?? "";
    const on = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(c.key, e.target.value);
    const opciones = (lista: string[]) => (
      <>
        <option value="">{t("— select —", "— elegir —")}</option>
        {lista.map((x) => (<option key={x} value={x}>{x}</option>))}
      </>
    );
    let control: React.ReactNode;
    if (c.key === "category_id") {
      control = (
        <select className={sel} value={v} onChange={on}>
          <option value="">{t("— select —", "— elegir —")}</option>
          {categories.map((x) => (<option key={x.id} value={x.id}>{x.path}</option>))}
        </select>
      );
    } else if (c.key === "vendor_id") {
      control = (
        <select className={sel} value={v} onChange={on}>
          <option value="">{t("— select —", "— elegir —")}</option>
          {vendors.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
        </select>
      );
    } else if (c.key === "product_type") {
      control = <select className={sel} value={v} onChange={on}>{PRODUCT_TYPES.map((pt) => (<option key={pt} value={pt}>{sl(pt)}</option>))}</select>;
    } else if (c.key === "status") {
      control = <select className={sel} value={v} onChange={on}>{STATUSES.map((s) => (<option key={s} value={s}>{sl(s)}</option>))}</select>;
    } else if (c.key === "price_mode") {
      control = (
        <select className={sel} value={v} onChange={on}>
          <option value="">{t("— select —", "— elegir —")}</option>
          {MODOS_DE_PRECIO.map((m) => (<option key={m} value={m}>{m === "fixed" ? t("Fixed price", "Precio fijo") : t("Levels", "Niveles")}</option>))}
        </select>
      );
    } else if (c.kind === "suggest") {
      const lista = c.key === "base_unit" ? vocab.base_unit : c.key === "material" ? vocab.material : c.key === "finish" ? vocab.finish : c.key === "style" ? vocab.style : vocab.color;
      control = (
        <>
          <Input value={v} onChange={on} list={`sug-${c.key}`} />
          <datalist id={`sug-${c.key}`}>{opciones(lista)}</datalist>
        </>
      );
    } else if (c.kind === "number") {
      control = <Input value={v} onChange={on} inputMode="decimal" />;
    } else {
      control = <Input value={v} onChange={on} placeholder={c.key === "sku" ? t("e.g. PLG2163 — leave blank if unknown", "p. ej. PLG2163 — en blanco si no se sabe") : c.key === "size_in" ? t("e.g. 24X24", "p. ej. 24X24") : undefined} />;
    }
    return <Field key={c.key} label={label} required={required}>{control}</Field>;
  }

  const cabecera = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={t("Location (store)", "Ubicación (tienda)")}>
        <select className={sel} value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">{t("— select —", "— elegir —")}</option>
          {stores.map((s) => (<option key={s.id} value={s.id}>{s.id} — {s.name}</option>))}
        </select>
      </Field>
      <Field label={t("Requester status", "Estado del solicitante")}>
        <select className={sel} value={ready} onChange={(e) => setReady(e.target.value as EstadoDelSolicitante)}>
          {ESTADOS_DEL_SOLICITANTE.map((s) => (<option key={s} value={s}>{sl(s)}</option>))}
        </select>
      </Field>
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-1">
        {TIPOS_DE_SOLICITUD.map((rt) => (
          <button
            key={rt}
            type="button"
            onClick={() => {
              setReqType(rt);
              setErr(null);
              setDone(null);
              setDups(null);
              resetNonNew();
            }}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              reqType === rt ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {sl(rt)}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {reqType === "deactivate" && t("Deactivate: only if QOH = 0.", "Desactivar: solo si QOH = 0.")}
        {reqType === "discontinue" && t("Discontinue: same as deactivate, but the item can still have QOH.", "Descontinuar: como desactivar, pero el artículo puede seguir con existencia.")}
        {reqType === "copy" && t("Create copy: pick the source store and item code, load it, then change what differs.", "Crear copia: elige la tienda y el código de origen, cárgalo y cambia lo que sea distinto.")}
      </p>

      {done && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{done}</p>}
      {err && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {creaBorrador ? (
        <div className="space-y-4">
          {cabecera}
          {reqType === "copy" && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-sm font-medium">{t("Copy source: store & item code", "Origen de la copia: tienda y código de artículo")}</div>
              <div className="flex flex-wrap gap-2">
                <select className={cn(sel, "w-auto")} value={copyStore} onChange={(e) => setCopyStore(e.target.value)}>
                  <option value="">{t("— any store —", "— cualquier tienda —")}</option>
                  {stores.map((s) => (<option key={s.id} value={s.id}>{s.id} — {s.name}</option>))}
                </select>
                <Input className="w-56" value={copyCode} onChange={(e) => setCopyCode(e.target.value)} placeholder={t("SKU or store item code", "SKU o código de la tienda")} />
                <Button variant="outline" onClick={cargarOrigen} disabled={pending || !copyCode.trim()}>{t("Load", "Cargar")}</Button>
              </div>
              {copySource && (
                <p className="mt-2 text-sm text-slate-600">
                  {t("Copying from", "Copiando de")} <span className="font-mono">{copySource.sku}</span>{copySource.store ? ` · ${copySource.store}` : ""}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {camposArticulo.map(pintaCampo)}
          </div>
          <Field label={t("Requester comments", "Comentarios del solicitante")}>
            <Input value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} />
          </Field>

          {dups && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <div className="mb-1 font-medium text-amber-800">{t("Possible duplicates — are you sure this is new?", "Posibles duplicados — ¿seguro que es nuevo?")}</div>
              <ul className="mb-2 list-disc pl-5 text-amber-700">
                {dups.map((d) => (
                  <li key={d.id}><span className="font-mono">{d.sku}</span> — {d.name} ({sl(d.status)})</li>
                ))}
              </ul>
              <Button size="sm" onClick={() => submitNew(true)} disabled={pending}>{t("Submit anyway", "Enviar de todas formas")}</Button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={() => submitNew(false)} disabled={pending || !requiredOk}>
              {pending ? t("Checking…", "Comprobando…") : t("Submit (dup-check)", "Enviar (comprueba duplicados)")}
            </Button>
            <span className="text-xs text-slate-400">{t("Lands as a draft; an admin publishes it from the catalog.", "Entra como borrador; un admin lo publica desde el catálogo.")}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {cabecera}
          <Field label={t("Find product by SKU", "Buscar producto por SKU")}>
            <div className="flex gap-2">
              <Input value={lookupSku} onChange={(e) => setLookupSku(e.target.value)} placeholder={t("e.g. PLG2163", "p. ej. PLG2163")} />
              <Button variant="outline" onClick={lookup} disabled={pending || !lookupSku.trim()}>{t("Find", "Buscar")}</Button>
            </div>
          </Field>
          {target && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <span className="font-mono">{target.sku}</span> — {target.name} ({sl(target.status)}) · QOH {target.qoh ?? 0}
            </div>
          )}
          {bloqueoDesactivar && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {t(`QOH is ${target?.qoh}: Deactivate needs QOH = 0. Use Discontinue instead.`, `QOH es ${target?.qoh}: Desactivar exige QOH = 0. Usa Descontinuar.`)}
            </p>
          )}
          {target && reqType === "edit" && (
            <div>
              <div className="mb-1 text-sm font-medium">{t("Proposed changes", "Cambios propuestos")}</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {camposEdicion.map((fld) => (
                  <label key={fld.key} className="space-y-1">
                    <span className="text-xs text-slate-500">{t(fld.en, fld.es)}</span>
                    {fld.key === "price_mode" ? (
                      <select className={sel} value={editForm[fld.key] ?? ""} onChange={(e) => setEditForm({ ...editForm, [fld.key]: e.target.value })}>
                        <option value="">{t("— select —", "— elegir —")}</option>
                        {MODOS_DE_PRECIO.map((m) => (<option key={m} value={m}>{m === "fixed" ? t("Fixed price", "Precio fijo") : t("Levels", "Niveles")}</option>))}
                      </select>
                    ) : (
                      <Input
                        value={editForm[fld.key] ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, [fld.key]: e.target.value })}
                        className={editForm[fld.key] !== original[fld.key] ? "border-clay-400" : ""}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Field label={t("Requester comments", "Comentarios del solicitante")} required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(`Why ${statusLabel(reqType).en.toLowerCase()}?`, `¿Por qué ${statusLabel(reqType).es.toLowerCase()}?`)} />
          </Field>
          <Button onClick={submitChange} disabled={pending || !target || !reason.trim() || !!bloqueoDesactivar}>
            {pending ? t("Submitting…", "Enviando…") : t(`Submit: ${statusLabel(reqType).en}`, `Enviar: ${statusLabel(reqType).es}`)}
          </Button>
        </div>
      )}
    </div>
  );
}
