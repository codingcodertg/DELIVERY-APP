import type { EventoLead } from "./reglas";

// ============================================================
// Estadísticas de uso de Leads por vendedor (puro, sin I/O). Cuenta, por persona y en un rango de fechas, lo que hizo
// en la app (con el historial que ya existe, `lead_events`) y las llamadas que RingCentral le atribuye por nombre.
// Lo usa la pestaña de estadísticas (Estadisticas.tsx) y su prueba (estadisticas.test.ts).
//
// Definiciones (para que el gerente sepa qué cuenta cada columna):
//   · Leads: leads distintos donde la persona anotó, puso un teléfono, tomó o cerró algo.
//   · Notas: todas sus notas de avance (con o sin etapa).
//   · Cambios de etapa: las notas que traen una etapa (la etapa del lead cambia con cada una).
//   · Cotizaciones: notas con etapa «quote». Ventas: cierres con resultado «sale».
//   · Llamadas: las de RingCentral a teléfonos de leads cuyo nombre de vendedor es el suyo (sin distinguir mayúsculas
//     ni acentos). No hay tabla que enlace extensión y persona: si el nombre de RingCentral no es el de la app, esas
//     llamadas quedan en «sin vendedor» (`llamadasSinVendedor`).
//   · Última actividad: el último movimiento suyo dentro del rango.
// ============================================================

export interface Periodo {
  /** Inicio, incluido. */
  desde: Date;
  /** Fin, NO incluido. */
  hasta: Date;
}


/** Los últimos `dias` días, hoy incluido (hora local). */
export function periodoDeDias(dias: number, ahora: Date): Periodo {
  const hoy = new Date(ahora);
  hoy.setHours(0, 0, 0, 0);
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - (dias - 1));
  return { desde, hasta: manana };
}

function diaLocal(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? null : d;
}

/** Un rango de días elegidos a mano («AAAA-MM-DD», ambos incluidos). Null si una fecha no vale o el inicio va después. */
export function periodoPersonalizado(desde: string, hasta: string): Periodo | null {
  const inicio = diaLocal(desde);
  const ultimo = diaLocal(hasta);
  if (!inicio || !ultimo) return null;
  const fin = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate() + 1);
  if (fin.getTime() <= inicio.getTime()) return null;
  return { desde: inicio, hasta: fin };
}

/** Nombre para emparejar: sin acentos, en minúsculas y con espacios colapsados. Vacío → null. */
export function normalizaNombre(v: string | null | undefined): string | null {
  const n = (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return n || null;
}

/** Una llamada agregada por vendedor, como la devuelve `leads_estadisticas_de_llamadas` (nombre de RingCentral). */
export interface LlamadasDeVendedor {
  rep_name: string | null;
  llamadas: number;
}

export interface FilaDeUso {
  id: string;
  nombre: string;
  leads: number;
  notas: number;
  cambiosDeEtapa: number;
  cotizaciones: number;
  ventas: number;
  llamadas: number;
  ultima: string | null;
}

export interface ResumenDeUso {
  filas: FilaDeUso[];
  totales: { leads: number; notas: number; cambiosDeEtapa: number; cotizaciones: number; ventas: number; llamadas: number; ultima: string | null };
  /** Llamadas del rango que no se pudieron atribuir a ninguna persona de la tabla. */
  llamadasSinVendedor: number;
}

const enRango = (at: string, p: Periodo): boolean => {
  const t = Date.parse(at);
  return Number.isFinite(t) && t >= p.desde.getTime() && t < p.hasta.getTime();
};

/**
 * Las estadísticas de uso del rango. `eventos` es el historial completo (se filtra aquí). `llamadas` son las de
 * RingCentral ya agregadas por nombre; `totalLlamadas` es el total del rango (incluye las que no tienen nombre).
 */
export function estadisticasDeUso(
  eventos: readonly EventoLead[],
  periodo: Periodo,
  llamadas: readonly LlamadasDeVendedor[],
  totalLlamadas: number,
): ResumenDeUso {
  const porPersona = new Map<string, FilaDeUso & { _leads: Set<string> }>();
  const todosLosLeads = new Set<string>();
  let ultimaGlobal: string | null = null;
  const maxIso = (a: string | null, b: string): string => (a == null || Date.parse(b) > Date.parse(a) ? b : a);

  for (const e of eventos) {
    if (!e.actor || !enRango(e.at, periodo)) continue;
    const f = porPersona.get(e.actor) ?? {
      id: e.actor, nombre: "—", leads: 0, notas: 0, cambiosDeEtapa: 0, cotizaciones: 0, ventas: 0, llamadas: 0, ultima: null, _leads: new Set<string>(),
    };
    if (e.actor_name && f.nombre === "—") f.nombre = e.actor_name;
    f.ultima = maxIso(f.ultima, e.at);
    ultimaGlobal = maxIso(ultimaGlobal, e.at);

    if (e.kind === "progress" || e.kind === "closed" || e.kind === "phone" || e.kind === "taken") {
      f._leads.add(e.lead_id);
      todosLosLeads.add(e.lead_id);
    }
    if (e.kind === "progress") {
      f.notas++;
      if (e.action) f.cambiosDeEtapa++;
      if (e.action === "quote") f.cotizaciones++;
      if (e.action === "closed") f.ventas++;
    } else if (e.kind === "closed" && e.outcome === "sale") {
      f.ventas++;
    }
    porPersona.set(e.actor, f);
  }

  // Las llamadas, por nombre normalizado. Una persona sin ninguna llamada de ese nombre tiene 0.
  const llamadasPorNombre = new Map<string, number>();
  for (const l of llamadas) {
    const n = normalizaNombre(l.rep_name);
    if (n) llamadasPorNombre.set(n, (llamadasPorNombre.get(n) ?? 0) + l.llamadas);
  }

  let atribuidas = 0;
  const filas: FilaDeUso[] = [...porPersona.values()].map(({ _leads, ...f }) => {
    f.leads = _leads.size;
    f.llamadas = llamadasPorNombre.get(normalizaNombre(f.nombre) ?? "") ?? 0;
    atribuidas += f.llamadas;
    return f;
  });
  filas.sort((a, b) => (b.notas + b.llamadas) - (a.notas + a.llamadas) || a.nombre.localeCompare(b.nombre));

  const totales = filas.reduce(
    (t, f) => ({
      ...t,
      notas: t.notas + f.notas,
      cambiosDeEtapa: t.cambiosDeEtapa + f.cambiosDeEtapa,
      cotizaciones: t.cotizaciones + f.cotizaciones,
      ventas: t.ventas + f.ventas,
      llamadas: t.llamadas + f.llamadas,
    }),
    { leads: todosLosLeads.size, notas: 0, cambiosDeEtapa: 0, cotizaciones: 0, ventas: 0, llamadas: 0, ultima: ultimaGlobal },
  );

  return { filas, totales, llamadasSinVendedor: Math.max(0, totalLlamadas - atribuidas) };
}
