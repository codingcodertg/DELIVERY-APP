/**
 * El corte del modo enseñanza/práctica (D-626/D-628): cuando la cookie está puesta, las escrituras que no se pueden
 * practicar (funciones de la base, subidas de archivo) vuelven con un 403 `{ code: "ENSENANZA" }` (o `"CAPACITACION"`
 * en Time Tracker), y el `fetch` de práctica ya dispara el aviso global. Esto solo RECONOCE ese corte para que cada app
 * lo trate como un no-op amable en vez de como un error de verdad.
 */
export function esCorteDePractica(e: unknown): boolean {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return code === "ENSENANZA" || code === "CAPACITACION";
}

/** Un corte de práctica tratado como excepción (para las acciones que devuelven un id y no pueden seguir en práctica). */
export class CorteDePractica extends Error {
  readonly code = "ENSENANZA";
  constructor() {
    super("En práctica no se guarda.");
    this.name = "CorteDePractica";
  }
}
