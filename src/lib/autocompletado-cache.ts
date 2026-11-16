// ============================================================
// Piezas del autocompletado de direcciones que corren en el navegador (y, la validación,
// también en el servidor): una caché LRU pequeña por pestaña y el formato de la sesión
// de Google Places. Sin nada de servidor: se puede importar desde un componente cliente.
// ============================================================

/** Caché LRU mínima: al pasar `max` entradas, se olvida la que hace más que no se usa. */
export class LRUSugerencias<V> {
  private readonly mapa = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(clave: string): V | undefined {
    if (!this.mapa.has(clave)) return undefined;
    const valor = this.mapa.get(clave) as V;
    // Se reinserta para que pase a ser la más reciente.
    this.mapa.delete(clave);
    this.mapa.set(clave, valor);
    return valor;
  }

  set(clave: string, valor: V): void {
    this.mapa.delete(clave);
    this.mapa.set(clave, valor);
    if (this.mapa.size > this.max) {
      const masAntigua = this.mapa.keys().next().value;
      if (masAntigua !== undefined) this.mapa.delete(masAntigua);
    }
  }

  get tamano(): number {
    return this.mapa.size;
  }
}

/** Formato aceptado para el token de sesión que se reenvía a Google (letras, números y guiones). */
export const SESION_VALIDA = /^[A-Za-z0-9-]{8,64}$/;

/** Un token de sesión nuevo (UUID v4 cuando el navegador lo ofrece). */
export function nuevaSesionDeAutocompletado(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
