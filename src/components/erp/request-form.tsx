"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { cn } from "@/lib/erp/utils";
import { label } from "@/lib/erp/status";
import { createClient } from "@/lib/erp/supabase/client";
import { unwrap, dbErrorMessage } from "@/lib/erp/db-result";
import { submitNewItem, submitRequest, type NewItemInput } from "@/lib/erp/actions";

const PRODUCT_TYPES = ["tile", "trim", "setting_material", "tool", "accessory", "other"];
const STATUSES = ["active", "special_order", "discontinued", "inactive"];
const REQ_TYPES = ["new", "edit", "reactivate", "deactivate"] as const;
type ReqType = (typeof REQ_TYPES)[number];

const EDIT_FIELDS: { key: string; label: string; cost?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "price", label: "Price" },
  { key: "cost", label: "Cost", cost: true },
  { key: "base_unit", label: "Base unit" },
  { key: "sf_per_box", label: "SF / box" },
  { key: "pieces_per_box", label: "Pieces / box" },
  { key: "size_in", label: "Size (in)" },
  { key: "size_cm", label: "Size (cm)" },
  { key: "material", label: "Material" },
  { key: "finish", label: "Finish" },
  { key: "mpn", label: "MPN" },
];
const LOOKUP_COLS = "id,sku,name,status," + EDIT_FIELDS.map((f) => f.key).filter((k) => k !== "name").join(",");

type Cat = { id: number; path: string };
type Vendor = { id: number; name: string };
type Match = { id: number; sku: string; name: string; status: string; [k: string]: unknown };

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
  baseUnits,
  materials,
  finishes,
  canSeeCost,
}: {
  categories: Cat[];
  vendors: Vendor[];
  baseUnits: string[];
  materials: string[];
  finishes: string[];
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const [reqType, setReqType] = useState<ReqType>("new");
  const [f, setF] = useState<Record<string, string>>({ product_type: "tile", status: "active" });
  const [dups, setDups] = useState<Match[] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // edit/reactivate/deactivate target + edit-field state
  const [lookupSku, setLookupSku] = useState("");
  const [target, setTarget] = useState<Match | null>(null);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const isTile = f.product_type === "tile";
  const requiredOk =
    f.sku?.trim() && f.name?.trim() && f.product_type && f.status && f.category_id &&
    (!isTile || (f.size_in?.trim() && f.sf_per_box?.trim() && f.base_unit));

  function resetNonNew() {
    setTarget(null);
    setLookupSku("");
    setReason("");
    setOriginal({});
    setEditForm({});
  }

  async function checkDups(): Promise<Match[]> {
    const sb = createClient();
    const sku = f.sku.trim().toUpperCase();
    const name = f.name.trim();
    // ARC-02: this is the pre-submit duplicate check. A swallowed error used to read as
    // "no duplicates" and wave a duplicate product straight through, so it now raises and
    // submitNew() reports it instead of submitting blind.
    const empty = { data: [] as Match[], error: null };
    const [a, b, c] = await Promise.all([
      sb.from("app_products").select("id,sku,name,status").eq("sku", sku),
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
    return [...map.values()];
  }

  function submitNew(force: boolean) {
    setErr(null);
    setDone(null);
    if (!requiredOk) return setErr("Fill the required fields.");
    startTransition(async () => {
      if (!force) {
        let matches: Match[];
        try {
          matches = await checkDups();
        } catch (e) {
          return setErr(`Could not run the duplicate check: ${dbErrorMessage(e)}`);
        }
        if (matches.length > 0) return setDups(matches);
      }
      setDups(null);
      const input: NewItemInput = {
        sku: f.sku, name: f.name, product_type: f.product_type, status: f.status,
        category_id: f.category_id ? Number(f.category_id) : null,
        vendor_id: f.vendor_id ? Number(f.vendor_id) : null,
        mpn: f.mpn, material: f.material, finish: f.finish, size_in: f.size_in,
        base_unit: f.base_unit, sf_per_box: f.sf_per_box, reason: f.reason,
      };
      const res = await submitNewItem(input);
      if (!res.ok) setErr(res.error);
      else {
        setDone(`Submitted draft ${res.sku} — pending admin publish.`);
        setF({ product_type: "tile", status: "active" });
        router.refresh();
      }
    });
  }

  function lookup() {
    setErr(null);
    setTarget(null);
    startTransition(async () => {
      const sb = createClient();
      // ARC-02: a failed lookup used to report the honest-looking "No published product…".
      let data;
      try {
        data = unwrap(
          await sb.from("app_products").select(LOOKUP_COLS).eq("sku", lookupSku.trim().toUpperCase()).maybeSingle(),
          "request-form: sku lookup",
        );
      } catch (e) {
        return setErr(`Lookup failed: ${dbErrorMessage(e)}`);
      }
      if (!data) return setErr(`No published product with SKU ${lookupSku.trim().toUpperCase()}.`);
      const m = data as unknown as Match;
      setTarget(m);
      const seed: Record<string, string> = {};
      for (const fld of EDIT_FIELDS) {
        const v = m[fld.key];
        seed[fld.key] = v === null || v === undefined ? "" : String(v);
      }
      setOriginal(seed);
      setEditForm(seed);
    });
  }

  function submitChange() {
    if (!target) return;
    setErr(null);
    setDone(null);
    let payload: Record<string, string> | undefined;
    if (reqType === "edit") {
      payload = {};
      for (const fld of EDIT_FIELDS) {
        if (fld.cost && !canSeeCost) continue;
        if (editForm[fld.key] !== original[fld.key]) payload[fld.key] = editForm[fld.key];
      }
      if (Object.keys(payload).length === 0) return setErr("Change at least one field for an edit request.");
    }
    startTransition(async () => {
      const res = await submitRequest({
        type: reqType as "edit" | "reactivate" | "deactivate",
        product_id: target.id,
        reason,
        payload,
      });
      if (!res.ok) setErr(res.error);
      else {
        setDone(`${label(reqType)} request submitted for ${target.sku}.`);
        resetNonNew();
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        {REQ_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setReqType(t);
              setErr(null);
              setDone(null);
              setDups(null);
              resetNonNew();
            }}
            className={cn(
              "rounded-md px-3 py-1 text-sm capitalize transition-colors",
              reqType === t ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {done && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{done}</p>}
      {err && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {reqType === "new" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="SKU (unified code)" required>
              <Input value={f.sku ?? ""} onChange={(e) => set("sku", e.target.value)} placeholder="e.g. PLG2163" />
            </Field>
            <Field label="Name" required>
              <Input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Product type" required>
              <select className={sel} value={f.product_type} onChange={(e) => set("product_type", e.target.value)}>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>{label(t)}</option>
                ))}
              </select>
            </Field>
            <Field label="Commercial status" required>
              <select className={sel} value={f.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{label(s)}</option>
                ))}
              </select>
            </Field>
            <Field label="Category" required>
              <select className={sel} value={f.category_id ?? ""} onChange={(e) => set("category_id", e.target.value)}>
                <option value="">— select —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.path}</option>
                ))}
              </select>
            </Field>
            <Field label="Vendor">
              <select className={sel} value={f.vendor_id ?? ""} onChange={(e) => set("vendor_id", e.target.value)}>
                <option value="">— select —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </Field>
            <Field label="MPN">
              <Input value={f.mpn ?? ""} onChange={(e) => set("mpn", e.target.value)} />
            </Field>
            <Field label="Material">
              <select className={sel} value={f.material ?? ""} onChange={(e) => set("material", e.target.value)}>
                <option value="">— select —</option>
                {materials.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </Field>
            <Field label="Finish">
              <select className={sel} value={f.finish ?? ""} onChange={(e) => set("finish", e.target.value)}>
                <option value="">— select —</option>
                {finishes.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </Field>
            <Field label="Size (in)" required={isTile}>
              <Input value={f.size_in ?? ""} onChange={(e) => set("size_in", e.target.value)} placeholder="e.g. 24X24" />
            </Field>
            <Field label="SF / box" required={isTile}>
              <Input value={f.sf_per_box ?? ""} onChange={(e) => set("sf_per_box", e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Base unit" required={isTile}>
              <select className={sel} value={f.base_unit ?? ""} onChange={(e) => set("base_unit", e.target.value)}>
                <option value="">— select —</option>
                {baseUnits.map((u) => (<option key={u} value={u}>{u}</option>))}
              </select>
            </Field>
          </div>
          <Field label="Reason / note">
            <Input value={f.reason ?? ""} onChange={(e) => set("reason", e.target.value)} />
          </Field>

          {dups && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <div className="mb-1 font-medium text-amber-800">Possible duplicates — are you sure this is new?</div>
              <ul className="mb-2 list-disc pl-5 text-amber-700">
                {dups.map((d) => (
                  <li key={d.id}><span className="font-mono">{d.sku}</span> — {d.name} ({label(d.status)})</li>
                ))}
              </ul>
              <Button size="sm" onClick={() => submitNew(true)} disabled={pending}>Submit anyway</Button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={() => submitNew(false)} disabled={pending || !requiredOk}>
              {pending ? "Checking…" : "Submit (dup-check)"}
            </Button>
            <span className="text-xs text-slate-400">Lands as a draft; an admin publishes it from the catalog.</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Find product by SKU">
            <div className="flex gap-2">
              <Input value={lookupSku} onChange={(e) => setLookupSku(e.target.value)} placeholder="e.g. PLG2163" />
              <Button variant="outline" onClick={lookup} disabled={pending || !lookupSku.trim()}>Find</Button>
            </div>
          </Field>
          {target && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <span className="font-mono">{target.sku}</span> — {target.name} ({label(target.status)})
            </div>
          )}
          {target && reqType === "edit" && (
            <div>
              <div className="mb-1 text-sm font-medium">Proposed changes</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {EDIT_FIELDS.filter((fld) => !fld.cost || canSeeCost).map((fld) => (
                  <label key={fld.key} className="space-y-1">
                    <span className="text-xs text-slate-500">{fld.label}</span>
                    <Input
                      value={editForm[fld.key] ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, [fld.key]: e.target.value })}
                      className={editForm[fld.key] !== original[fld.key] ? "border-clay-400" : ""}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <Field label="Reason" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Why ${reqType}?`} />
          </Field>
          <Button onClick={submitChange} disabled={pending || !target || !reason.trim()}>
            {pending ? "Submitting…" : `Submit ${reqType} request`}
          </Button>
        </div>
      )}
    </div>
  );
}
