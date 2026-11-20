/**
 * App Draft · QuickBooks Desktop: el reductor (puro) y el guardado en este navegador. Las operaciones que mueven
 * mercancía se validan en `inventario.ts`; la pantalla las llama primero para enseñar el error, y el reductor las vuelve a
 * correr (si fallan, el estado no cambia).
 */
import { acomodar, armarKit, avanzarEnvio, cancelarEnvio, crearEnvio, crearTraspaso, recibirTraspaso } from "./inventario";
import { generarMuestraQbd } from "./muestra";
import type { CostoDeImportacion, EstadoQbd, OrdenDeVenta, ReglaDePrecio, Reorden } from "./tipos";

export type AccionQbd =
  | { tipo: "reset"; hoy: string }
  | { tipo: "cargar"; estado: EstadoQbd }
  | { tipo: "traspaso"; hoy: string; t: Parameters<typeof crearTraspaso>[1] }
  | { tipo: "recibirTraspaso"; id: string; fecha: string }
  | { tipo: "acomodar"; existenciaId: string; binId: string; cantidad: number; nuevoId: string }
  | { tipo: "nuevoBin"; id: string; sitioId: string; codigo: string }
  | { tipo: "guardarOrden"; orden: OrdenDeVenta }
  | { tipo: "cancelarOrden"; id: string }
  | { tipo: "crearEnvio"; hoy: string; p: Parameters<typeof crearEnvio>[1] }
  | { tipo: "reemplazar"; estado: EstadoQbd }
  | { tipo: "avanzarEnvio"; id: string }
  | { tipo: "cancelarEnvio"; id: string }
  | { tipo: "armar"; hoy: string; p: Parameters<typeof armarKit>[1] }
  | { tipo: "guardarRegla"; regla: ReglaDePrecio }
  | { tipo: "borrarRegla"; id: string }
  | { tipo: "nivel"; tipoCliente: EstadoQbd["niveles"][number]["tipo"]; porcentaje: number }
  | { tipo: "importacion"; costo: CostoDeImportacion }
  | { tipo: "reorden"; reorden: Reorden }
  | { tipo: "unidadPorDefecto"; juegoId: string; pantalla: "compra" | "venta" | "envio"; u: string };

export function reductorQbd(e: EstadoQbd, a: AccionQbd): EstadoQbd {
  const si = (r: { ok: true; e: EstadoQbd } | { ok: false }) => (r.ok ? r.e : e);
  switch (a.tipo) {
    case "reset": return generarMuestraQbd(a.hoy);
    case "cargar": return a.estado;
    case "reemplazar": return a.estado;
    case "traspaso": return si(crearTraspaso(e, a.t, a.hoy));
    case "recibirTraspaso": return recibirTraspaso(e, a.id, a.fecha);
    case "acomodar": return si(acomodar(e, a.existenciaId, a.binId, a.cantidad, a.nuevoId));
    case "nuevoBin":
      if (!a.codigo.trim() || e.bins.some((b) => b.sitioId === a.sitioId && b.codigo.toUpperCase() === a.codigo.trim().toUpperCase())) return e;
      return { ...e, bins: [...e.bins, { id: a.id, sitioId: a.sitioId, codigo: a.codigo.trim().toUpperCase() }] };
    case "guardarOrden": return { ...e, ordenes: e.ordenes.some((o) => o.id === a.orden.id) ? e.ordenes.map((o) => (o.id === a.orden.id ? a.orden : o)) : [...e.ordenes, a.orden] };
    case "cancelarOrden":
      if (e.envios.some((x) => x.ordenId === a.id && x.estado !== "shipped" && x.estado !== "picking")) return e;
      return { ...e, envios: e.envios.filter((x) => !(x.ordenId === a.id && x.estado === "picking")), ordenes: e.ordenes.map((o) => (o.id === a.id ? { ...o, cancelada: true } : o)) };
    case "crearEnvio": return si(crearEnvio(e, a.p, a.hoy));
    case "avanzarEnvio": return si(avanzarEnvio(e, a.id));
    case "cancelarEnvio": return cancelarEnvio(e, a.id);
    case "armar": return si(armarKit(e, a.p, a.hoy));
    case "guardarRegla": return { ...e, reglas: e.reglas.some((r) => r.id === a.regla.id) ? e.reglas.map((r) => (r.id === a.regla.id ? a.regla : r)) : [...e.reglas, a.regla] };
    case "borrarRegla": return { ...e, reglas: e.reglas.filter((r) => r.id !== a.id) };
    case "nivel": return { ...e, niveles: e.niveles.map((n) => (n.tipo === a.tipoCliente ? { ...n, porcentaje: a.porcentaje } : n)) };
    case "importacion": return { ...e, importaciones: [...e.importaciones, a.costo] };
    case "reorden": return { ...e, reordenes: [...e.reordenes, a.reorden] };
    case "unidadPorDefecto":
      return { ...e, juegos: e.juegos.map((j) => (j.id === a.juegoId && j.unidades.some((u) => u.u === a.u) ? { ...j, [a.pantalla]: a.u } : j)) };
    default: { const _x: never = a; return _x; }
  }
}

export const CLAVE_LOCAL_QBD = "rtg:app-draft:qbd:v1";

export function leerGuardadoQbd(): EstadoQbd | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_LOCAL_QBD);
    if (!crudo) return null;
    const e = JSON.parse(crudo) as EstadoQbd;
    return e && e.version === 1 && Array.isArray(e.existencias) && Array.isArray(e.envios) ? e : null;
  } catch {
    return null;
  }
}

export function guardarQbd(e: EstadoQbd): void {
  try {
    window.localStorage.setItem(CLAVE_LOCAL_QBD, JSON.stringify(e));
  } catch {
    // Sin almacenamiento (ventana privada, cuota): sigue en memoria.
  }
}
