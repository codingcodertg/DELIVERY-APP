"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { hoyIso } from "@/lib/app-draft/qbo/contabilidad";
import { deBase } from "@/lib/app-draft/qbd/inventario";
import { guardarQbd, leerGuardadoQbd, reductorQbd, type AccionQbd } from "@/lib/app-draft/qbd/estado";
import { generarMuestraQbd } from "@/lib/app-draft/qbd/muestra";
import type { EstadoQbd, JuegoDeUnidades } from "@/lib/app-draft/qbd/tipos";

interface CtxQbd {
  e: EstadoQbd;
  d: (a: AccionQbd) => void;
  hoy: string;
}

const Ctx = createContext<CtxQbd | null>(null);

export function useQbd(): CtxQbd {
  const c = useContext(Ctx);
  if (!c) throw new Error("useQbd fuera de ProveedorQbd");
  return c;
}

/** El estado del prototipo: lo guardado en este navegador o la muestra; se guarda en cada cambio. */
export function ProveedorQbd({ children }: { children: ReactNode }) {
  const hoy = useMemo(() => hoyIso(), []);
  const [e, d] = useReducer(reductorQbd, null as unknown as EstadoQbd);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    d({ tipo: "cargar", estado: leerGuardadoQbd() ?? generarMuestraQbd(hoy) });
    setListo(true);
  }, [hoy]);
  useEffect(() => { if (listo && e) guardarQbd(e); }, [e, listo]);
  if (!listo || !e) return <Cargando />;
  return <Ctx.Provider value={{ e, d, hoy }}>{children}</Ctx.Provider>;
}

function Cargando() {
  const { t } = usePrefs();
  return <p className="qbo-gris" role="status">{t("Loading sample data…", "Cargando datos de ejemplo…")}</p>;
}

const UNIDADES: Record<string, string> = { box: "caja", "sq ft": "ft²", piece: "pieza", pallet: "tarima", bag: "bolsa", bucket: "cubeta", bundle: "atado" };
const PLURAL_ES: Record<string, string> = { caja: "cajas", pieza: "piezas", tarima: "tarimas", bolsa: "bolsas", cubeta: "cubetas", atado: "atados" };

/** Nombres y formatos que todas las pestañas usan. */
export function useN() {
  const { e } = useQbd();
  const { t, lang } = usePrefs();
  return useMemo(() => {
    const juego = (articuloId: string): JuegoDeUnidades | undefined => e.juegos.find((j) => j.id === e.fichas.find((f) => f.articuloId === articuloId)?.juegoId);
    const unidad = (u: string, cantidad = 2) => {
      if (lang !== "es") return u;
      const es = UNIDADES[u] ?? u;
      return cantidad === 1 ? es : (PLURAL_ES[es] ?? es);
    };
    const articulo = (id: string) => e.articulos.find((a) => a.id === id)?.nombre ?? e.kits.find((k) => k.id === id)?.nombre ?? "—";
    const sku = (id: string) => e.articulos.find((a) => a.id === id)?.sku ?? e.kits.find((k) => k.id === id)?.sku ?? "";
    const base = (id: string) => juego(id)?.base ?? (e.kits.some((k) => k.id === id) ? "kit" : "unit");
    /** «13 cajas (201.5 ft²)»: la base y, si el juego tiene ft², su equivalente. */
    const cant = (articuloId: string, q: number, en?: string) => {
      const j = juego(articuloId);
      const u = en ?? j?.base ?? base(articuloId);
      const v = j ? deBase(q, u, j) : q;
      const principal = `${v.toLocaleString("en-US")} ${unidad(u, v)}`;
      if (!en && j?.unidades.some((x) => x.u === "sq ft")) return `${principal} (${deBase(q, "sq ft", j).toLocaleString("en-US")} ${unidad("sq ft")})`;
      return principal;
    };
    return {
      juego, unidad, articulo, sku, base, cant,
      sitio: (id: string) => e.sitios.find((s) => s.id === id)?.nombre ?? "—",
      bin: (id: string | null) => (id ? e.bins.find((b) => b.id === id)?.codigo ?? "—" : t("Dock (not put away)", "Andén (sin acomodar)")),
      cliente: (id: string) => {
        const c = e.clientes.find((x) => x.id === id);
        return c ? (c.empresa ? `${c.empresa} (${c.nombre})` : c.nombre) : "—";
      },
      proveedor: (id: string) => e.proveedores.find((p) => p.id === id)?.nombre ?? "—",
      ficha: (id: string) => e.fichas.find((f) => f.articuloId === id),
      inventariables: e.fichas.map((f) => f.articuloId),
    };
  }, [e, t, lang]);
}

/** Etiqueta de estado con las clases del prototipo. */
const ESTADOS: Record<string, [string, string, string]> = {
  in_transit: ["In transit", "En camino", "partial"],
  received: ["Received", "Recibido", "paid"],
  open: ["Open", "Abierta", "open"],
  partial: ["Partly filled · rest on backorder", "Surtida en parte · resto pendiente", "partial"],
  shipped: ["Shipped", "Enviada", "paid"],
  cancelled: ["Cancelled", "Cancelada", "draft"],
  picking: ["To pick", "Por surtir", "new"],
  picked: ["Picked", "Surtido", "open"],
  packed: ["Packed", "Empacado", "sent"],
  expired: ["Expired", "Caducado", "overdue"],
  d30: ["Within 30 days", "En 30 días", "overdue"],
  d60: ["31–60 days", "31 a 60 días", "partial"],
  d90: ["61–90 days", "61 a 90 días", "open"],
};

export function etiqueta(estado: string, t: (en: string, es: string) => string): string {
  const x = ESTADOS[estado];
  return x ? t(x[0], x[1]) : estado;
}

export function Insignia({ estado }: { estado: string }) {
  const { t } = usePrefs();
  return <span className={`badge qbo-estado qbo-estado-${ESTADOS[estado]?.[2] ?? "draft"}`} data-estado={estado}>{etiqueta(estado, t)}</span>;
}

/** Traduce los errores de `inventario.ts` a palabras llanas. */
export function useError() {
  const { t } = usePrefs();
  const n = useN();
  return (codigo: string) => {
    const [k, art, hay] = codigo.split(":");
    switch (k) {
      case "same-site": return t("Choose two different sites.", "Elige dos sitios distintos.");
      case "no-lines": return t("Add at least one product with a quantity.", "Agrega al menos un producto con cantidad.");
      case "short": return t(`Not enough ${n.articulo(art)}: only ${n.cant(art, Number(hay))} free.`, `No alcanza ${n.articulo(art)}: solo hay ${n.cant(art, Number(hay))} libres.`);
      case "over-order": return t(`More ${n.articulo(art)} than the order still needs.`, `Más ${n.articulo(art)} de lo que la orden necesita.`);
      case "not-scanned": return t("Scan every line before marking it picked.", "Escanea todos los renglones antes de marcarlo surtido.");
      case "qty": return t("Check the quantity.", "Revisa la cantidad.");
      case "other-site": return t("That bin belongs to another site.", "Esa ubicación es de otro sitio.");
      case "same-bin": return t("It is already in that bin.", "Ya está en esa ubicación.");
      default: return t("Something didn't add up.", "Algo no cuadró.");
    }
  };
}

export function Proximamente({ en, es }: { en: string; es: string }) {
  const { t } = usePrefs();
  return <p className="qbo-nota">{t(en, es)}</p>;
}
