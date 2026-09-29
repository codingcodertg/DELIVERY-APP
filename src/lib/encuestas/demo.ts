import type { AlmacenDeEncuestas } from "./almacen";
import type { RespuestaEncuesta } from "./resumen";

/**
 * Respuestas inventadas para el modo demo (`NEXT_PUBLIC_LOCAL_MODE`), que no tiene base. Fijas —no al azar— para que
 * una captura de hoy y otra de mañana enseñen lo mismo; las fechas cuelgan de `ahora` para que el filtro de «últimos
 * 30 días» tenga algo que enseñar. Nombres y teléfonos claramente de ejemplo (555-01xx, example.com).
 */
export function respuestasDemo(ahora: Date = new Date()): RespuestaEncuesta[] {
  const hace = (dias: number, horas = 15) => {
    const d = new Date(ahora.getTime() - dias * 86400000);
    d.setUTCHours(horas, 12, 0, 0);
    return d.toISOString();
  };
  const base = { other_text: null, contact_name: null, contact_phone: null, contact_email: null, contacted: false, contacted_at: null };
  return [
    { ...base, id: "demo-01", created_at: hace(0), nothing_to_improve: true, selected_areas: [], ratings: {}, wants_contact: false },
    { ...base, id: "demo-02", created_at: hace(1), nothing_to_improve: false, selected_areas: ["wait_time", "staff_service"], ratings: { wait_time: 2, staff_service: 4 }, wants_contact: true, contact_name: "Cliente Ejemplo", contact_phone: "(956) 555-0101" },
    { ...base, id: "demo-03", created_at: hace(2), nothing_to_improve: false, selected_areas: ["other"], other_text: "Más estacionamiento / More parking", ratings: { other: 3 }, wants_contact: false },
    { ...base, id: "demo-04", created_at: hace(3), nothing_to_improve: true, selected_areas: [], ratings: {}, wants_contact: false },
    { ...base, id: "demo-05", created_at: hace(5), nothing_to_improve: false, selected_areas: ["pricing", "product_availability"], ratings: { pricing: 3, product_availability: 2 }, wants_contact: true, contact_name: "Example Customer", contact_email: "customer@example.com", contacted: true, contacted_at: hace(4) },
    { ...base, id: "demo-06", created_at: hace(8), nothing_to_improve: false, selected_areas: ["delivery_pickup"], ratings: { delivery_pickup: 5 }, wants_contact: false },
    { ...base, id: "demo-07", created_at: hace(12), nothing_to_improve: false, selected_areas: ["returns_exchanges", "other"], other_text: "Horario de fin de semana", ratings: { returns_exchanges: 1, other: 2 }, wants_contact: true, contact_name: "Otro Ejemplo", contact_phone: "956-555-0102", contact_email: "otro@example.com" },
    { ...base, id: "demo-08", created_at: hace(20), nothing_to_improve: false, selected_areas: ["product_quality"], ratings: { product_quality: 4 }, wants_contact: false },
    { ...base, id: "demo-09", created_at: hace(40), nothing_to_improve: true, selected_areas: [], ratings: {}, wants_contact: false },
  ];
}

/** El almacén del demo: en memoria, se pierde al recargar. Marcar contactado pone la hora de ahora, como la base. */
export function almacenDemo(): AlmacenDeEncuestas {
  let filas = respuestasDemo();
  return {
    async leer() {
      return { ok: true, valor: filas.map((f) => ({ ...f })) };
    },
    async marcarContactado(id, valor) {
      const f = filas.find((x) => x.id === id);
      if (!f || !f.wants_contact) return { ok: false, sinTabla: false, error: "no response with that id asked to be contacted" };
      const at = valor ? (f.contacted ? f.contacted_at : new Date().toISOString()) : null;
      filas = filas.map((x) => (x.id === id ? { ...x, contacted: valor, contacted_at: at } : x));
      return { ok: true, valor: at };
    },
  };
}
