/**
 * App Draft · Comp Floor: el reductor del estado (puro) y el guardado en este navegador. El stock se mueve SOLO aquí:
 * enviar un pedido, vender en mostrador, mandar/recibir un traslado y recibir un pedido especial.
 */
import { convertirAPedido, r2 } from "./logica";
import { generarMuestra } from "./muestra";
import type { Alerta, EstadoCf, Existencia, NivelDePrecio, OrdenEspecial, Pedido, Tienda, Traslado, VentaMostrador } from "./tipos";

export type AccionCf =
  | { tipo: "reset"; hoy: string }
  | { tipo: "cargar"; estado: EstadoCf }
  | { tipo: "guardarPedido"; pedido: Pedido; especiales?: OrdenEspecial[] }
  | { tipo: "aPedido"; id: string }
  | { tipo: "enviar"; id: string; envioId: string; numero: string; fecha: string }
  | { tipo: "surtir"; existenciaId: string; asignaciones: { pedidoId: string; lineaId: string; cajas: number }[] }
  | { tipo: "cerrarPedido"; id: string }
  | { tipo: "venta"; venta: VentaMostrador }
  | { tipo: "recibirEspecial"; ocId: string; existenciaId: string; lote: string; tono: string; bin: string; alertaId: string; fecha: string }
  | { tipo: "leerAlerta"; id: string }
  | { tipo: "guardarNivel"; nivel: NivelDePrecio }
  | { tipo: "remanente"; existenciaId: string; pct: number | null }
  | { tipo: "moverBin"; existenciaId: string; bin: string }
  | { tipo: "agregarBin"; tienda: Tienda; bin: string }
  | { tipo: "mandarTraslado"; traslado: Traslado }
  | { tipo: "recibirTraslado"; id: string; nuevoId: string };

function upsert<T extends { id: string }>(xs: readonly T[], x: T): T[] {
  return xs.some((y) => y.id === x.id) ? xs.map((y) => (y.id === x.id ? x : y)) : [...xs, x];
}

const cambiaCajas = (xs: Existencia[], id: string, delta: number) => xs.map((x) => (x.id === id ? { ...x, cajas: Math.max(0, x.cajas + delta) } : x));

export function reductorCf(e: EstadoCf, a: AccionCf): EstadoCf {
  switch (a.tipo) {
    case "reset": return generarMuestra(a.hoy);
    case "cargar": return a.estado;
    case "guardarPedido": return { ...e, pedidos: upsert(e.pedidos, a.pedido), especiales: [...e.especiales, ...(a.especiales ?? [])] };
    case "aPedido": {
      const p = e.pedidos.find((x) => x.id === a.id);
      if (!p || p.etapa !== "quote") return e;
      return { ...e, pedidos: upsert(e.pedidos, convertirAPedido(e, p)) };
    }
    case "enviar": {
      const p = e.pedidos.find((x) => x.id === a.id);
      if (!p || p.etapa !== "order") return e;
      const salen = p.lineas.filter((l) => l.reservadas > 0);
      if (!salen.length) return e;
      let existencias = e.existencias;
      for (const l of salen) if (l.existenciaId) existencias = cambiaCajas(existencias, l.existenciaId, -l.reservadas);
      const lineas = p.lineas.map((l) => ({ ...l, enviadas: l.enviadas + l.reservadas, reservadas: 0 }));
      const completo = lineas.every((l) => l.enviadas >= l.cajas);
      const envio = {
        id: a.envioId, numero: a.numero, pedidoId: p.id, fecha: a.fecha,
        lineas: salen.map((l) => ({ articuloId: l.articuloId, existenciaId: l.existenciaId, cajas: l.reservadas, precioCaja: l.precioCaja })),
        total: r2(salen.reduce((s, l) => s + l.reservadas * l.precioCaja, 0)),
      };
      return { ...e, existencias, envios: [...e.envios, envio], pedidos: upsert(e.pedidos, { ...p, lineas, etapa: completo ? "closed" : "order" }) };
    }
    case "surtir":
      return {
        ...e,
        pedidos: e.pedidos.map((p) => {
          const mias = a.asignaciones.filter((s) => s.pedidoId === p.id);
          if (!mias.length) return p;
          return {
            ...p,
            lineas: p.lineas.map((l) => {
              const s = mias.find((m) => m.lineaId === l.id);
              if (!s || (l.existenciaId && l.existenciaId !== a.existenciaId)) return l;
              return { ...l, existenciaId: a.existenciaId, reservadas: Math.min(l.cajas - l.enviadas, l.reservadas + s.cajas) };
            }),
          };
        }),
      };
    case "cerrarPedido": return { ...e, pedidos: e.pedidos.map((p) => (p.id === a.id ? { ...p, etapa: "closed", lineas: p.lineas.map((l) => ({ ...l, reservadas: 0 })) } : p)) };
    case "venta": {
      let existencias = e.existencias;
      for (const l of a.venta.lineas) existencias = cambiaCajas(existencias, l.existenciaId, -l.cajas);
      const clientes = a.venta.pago === "account" && a.venta.clienteId
        ? e.clientes.map((c) => (c.id === a.venta.clienteId ? { ...c, saldo: r2(c.saldo + a.venta.total) } : c))
        : e.clientes;
      return { ...e, existencias, clientes, ventas: [...e.ventas, a.venta] };
    }
    case "recibirEspecial": {
      const oc = e.especiales.find((o) => o.id === a.ocId);
      const p = oc && e.pedidos.find((x) => x.id === oc.pedidoId);
      if (!oc || oc.recibida || !p) return e;
      const nueva: Existencia = { id: a.existenciaId, articuloId: oc.articuloId, tienda: p.tienda, lote: a.lote || "—", tono: a.tono || "—", bin: a.bin, cajas: oc.cajas, remanentePct: null, apartadoPara: p.clienteId };
      const cliente = e.clientes.find((c) => c.id === p.clienteId)?.nombre ?? "";
      const art = e.articulos.find((x) => x.id === oc.articuloId)?.nombre ?? "";
      const alerta: Alerta = {
        id: a.alertaId, fecha: a.fecha, pedidoId: p.id, leida: false,
        en: `${oc.numero} arrived: ${oc.cajas} boxes of ${art} for ${cliente} (${p.numero}). Set aside in bin ${a.bin}. Call the customer.`,
        es: `Llegó ${oc.numero}: ${oc.cajas} cajas de ${art} para ${cliente} (${p.numero}). Apartado en el bin ${a.bin}. Llama al cliente.`,
      };
      return {
        ...e,
        existencias: [...e.existencias, nueva],
        especiales: e.especiales.map((o) => (o.id === oc.id ? { ...o, recibida: true } : o)),
        alertas: [alerta, ...e.alertas],
        pedidos: upsert(e.pedidos, { ...p, lineas: p.lineas.map((l) => (l.id === oc.lineaId ? { ...l, existenciaId: nueva.id, reservadas: Math.min(oc.cajas, l.cajas - l.enviadas) } : l)) }),
      };
    }
    case "leerAlerta": return { ...e, alertas: e.alertas.map((x) => (x.id === a.id ? { ...x, leida: true } : x)) };
    case "guardarNivel": return { ...e, niveles: e.niveles.map((n) => (n.tipo === a.nivel.tipo ? a.nivel : n)) };
    case "remanente": return { ...e, existencias: e.existencias.map((x) => (x.id === a.existenciaId ? { ...x, remanentePct: a.pct && a.pct > 0 ? Math.min(90, a.pct) : null } : x)) };
    case "moverBin": return { ...e, existencias: e.existencias.map((x) => (x.id === a.existenciaId ? { ...x, bin: a.bin } : x)) };
    case "agregarBin": {
      const bin = a.bin.trim().toUpperCase();
      if (!bin || e.bins[a.tienda].includes(bin)) return e;
      return { ...e, bins: { ...e.bins, [a.tienda]: [...e.bins[a.tienda], bin] } };
    }
    case "mandarTraslado": {
      const t = a.traslado;
      const x = e.existencias.find((y) => y.id === t.existenciaOrigenId);
      if (!x || t.cajas <= 0 || t.cajas > x.cajas || t.desde === t.hacia) return e;
      return { ...e, existencias: cambiaCajas(e.existencias, x.id, -t.cajas), traslados: [...e.traslados, t] };
    }
    case "recibirTraslado": {
      const t = e.traslados.find((y) => y.id === a.id);
      if (!t || t.recibido) return e;
      const igual = e.existencias.find((x) => x.articuloId === t.articuloId && x.tienda === t.hacia && x.lote === t.lote && x.tono === t.tono && x.bin === t.binDestino && !x.apartadoPara && !x.remanentePct);
      const existencias = igual
        ? cambiaCajas(e.existencias, igual.id, t.cajas)
        : [...e.existencias, { id: a.nuevoId, articuloId: t.articuloId, tienda: t.hacia, lote: t.lote, tono: t.tono, bin: t.binDestino, cajas: t.cajas, remanentePct: null }];
      return { ...e, existencias, traslados: e.traslados.map((y) => (y.id === t.id ? { ...y, recibido: true } : y)) };
    }
    default: { const _x: never = a; return _x; }
  }
}

export const CLAVE_LOCAL = "rtg:app-draft:compfloor:v1";

export function leerGuardado(): EstadoCf | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_LOCAL);
    if (!crudo) return null;
    const e = JSON.parse(crudo) as EstadoCf;
    return e && e.version === 1 && Array.isArray(e.existencias) && Array.isArray(e.pedidos) ? e : null;
  } catch {
    return null;
  }
}

export function guardar(e: EstadoCf): void {
  try {
    window.localStorage.setItem(CLAVE_LOCAL, JSON.stringify(e));
  } catch {
    // Sin almacenamiento (ventana privada, cuota): el prototipo sigue en memoria.
  }
}
