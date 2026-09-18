/**
 * La hoja del despachador: leerla, reconocer sus columnas y casar sus filas con órdenes de la app.
 *
 * Reglas que no se negocian (diseño, §8.1):
 *   · **Nada se adivina.** Una fila casa con una orden por Invoice #, PO # o SO #, dentro de la fecha. Si sus
 *     identificadores apuntan a órdenes DISTINTAS, o a más de una, queda sin casar y se dice por qué.
 *   · **«Pickup Address» no es una dirección:** es el número de carga — el orden en que el chofer hace sus
 *     recogidas. Empieza en 0 y se reinicia con cada chofer; un número repetido es una sola parada física.
 *   · La hoja da el chofer y el orden de RECOGIDAS. **No da el orden de las entregas.**
 *   · De la hoja no se guarda nada aquí ni en el repo: esto trabaja sobre celdas ya leídas en el navegador.
 */

export const CAMPOS_DE_LA_HOJA = [
  "orderType", "store", "po", "so", "invoice", "inputDate", "inputTime", "deliveryDate", "pickupName", "carga", "pallets", "chofer",
  "deliveryAddress", "ventana", "account",
] as const;
export type CampoDeHoja = typeof CAMPOS_DE_LA_HOJA[number];

/** Cómo se llama cada columna en la hoja, en minúsculas y sin signos. La primera es la cabecera «oficial». */
export const CABECERAS: Record<CampoDeHoja, readonly string[]> = {
  orderType: ["order type"], store: ["store sold from", "store", "sold from"], po: ["po", "po number"], so: ["so", "so number"],
  invoice: ["invoice", "invoice number"], inputDate: ["input date"], inputTime: ["input military time", "input time"],
  deliveryDate: ["delivery date"], pickupName: ["pickup name"], carga: ["pickup address"], pallets: ["est pallets", "pallets", "estimated pallets"],
  chofer: ["assigned driver optional", "assigned driver", "driver"], deliveryAddress: ["delivery address"],
  ventana: ["delivery military time windows", "delivery windows", "delivery window"], account: ["account"],
};

const normaliza = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Texto pegado o CSV/TSV a celdas. Entiende comillas dobles, comas o tabuladores, y saltos dentro de comillas. */
export function celdasDeTexto(texto: string): string[][] {
  // La marca de orden de bytes con que Excel empieza un CSV: por su código, para que no haya un carácter invisible aquí.
  const sinMarca = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const t = sinMarca.replace(/\r\n?/g, "\n");
  const primera = t.split("\n", 1)[0] ?? "";
  const sep = primera.includes("\t") ? "\t" : ",";
  const filas: string[][] = [];
  let fila: string[] = [], celda = "", entreComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') entreComillas = false; else celda += c;
    } else if (c === '"' && celda === "") entreComillas = true;
    else if (c === sep) { fila.push(celda); celda = ""; }
    else if (c === "\n") { fila.push(celda); filas.push(fila); fila = []; celda = ""; }
    else celda += c;
  }
  if (celda !== "" || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.map((f) => f.map((x) => x.trim())).filter((f) => f.some((x) => x !== ""));
}

export type MapaDeColumnas = Partial<Record<CampoDeHoja, number>>;

/** Qué columna es cada campo, por su cabecera. Lo que no se reconoce queda fuera del mapa, y `sobran` lista
 *  las cabeceras que nadie reclamó — para que quien importa elija a mano. */
export function columnasDeLaHoja(cabeceras: readonly string[]): { mapa: MapaDeColumnas; faltan: CampoDeHoja[]; sobran: { indice: number; cabecera: string }[] } {
  const normales = cabeceras.map(normaliza);
  const mapa: MapaDeColumnas = {};
  const usadas = new Set<number>();
  for (const campo of CAMPOS_DE_LA_HOJA) {
    for (const alias of CABECERAS[campo]) {
      const i = normales.indexOf(alias);      // ningún alias es de dos campos: la primera columna con esa cabecera gana
      if (i >= 0) { mapa[campo] = i; usadas.add(i); break; }
    }
  }
  return {
    mapa, faltan: CAMPOS_DE_LA_HOJA.filter((c) => mapa[c] === undefined),
    sobran: cabeceras.map((cabecera, indice) => ({ indice, cabecera })).filter((x) => !usadas.has(x.indice) && x.cabecera.trim() !== ""),
  };
}

/** Para casar hacen falta: algo con que identificar la orden, el chofer y el número de carga. */
export const hojaUtilizable = (mapa: MapaDeColumnas): boolean =>
  (mapa.invoice !== undefined || mapa.po !== undefined || mapa.so !== undefined) && mapa.chofer !== undefined && mapa.carga !== undefined;

export interface FilaDeHoja {
  /** El renglón de la hoja, contando la cabecera como 1: es como lo busca quien la tiene abierta. */
  renglon: number;
  po: string; so: string; invoice: string;
  deliveryDate: string | null;
  chofer: string;
  /** El número de carga TAL COMO está en la hoja (empieza en 0). `null` si está vacío o no es un número. */
  carga: number | null;
  pallets: number | null;
  ventana: string; account: string; orderType: string; store: string; pickupName: string; deliveryAddress: string;
}

/** Una fecha de la hoja a ISO. Entiende `2026-03-04`, `3/4/2026` y `03/04/26` (mes/día, como se escribe en EE. UU.).
 *  Lo que no entiende es `null`: no se adivina. */
export function fechaDeHoja(s: string): string | null {
  const v = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  let a = 0, mes = 0, dia = 0;
  if (m) { a = +m[1]; mes = +m[2]; dia = +m[3]; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v))) { mes = +m[1]; dia = +m[2]; a = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
  else return null;
  const d = new Date(Date.UTC(a, mes - 1, dia));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function filasDeLaHoja(celdas: readonly (readonly string[])[], mapa: MapaDeColumnas): FilaDeHoja[] {
  const de = (f: readonly string[], c: CampoDeHoja) => { const i = mapa[c]; return i === undefined ? "" : (f[i] ?? "").trim(); };
  const numero = (s: string) => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
  return celdas.slice(1).map((f, k): FilaDeHoja => {
    const carga = numero(de(f, "carga"));
    return {
      renglon: k + 2, po: de(f, "po"), so: de(f, "so"), invoice: de(f, "invoice"), deliveryDate: fechaDeHoja(de(f, "deliveryDate")),
      chofer: de(f, "chofer"), carga: carga !== null && Number.isInteger(carga) && carga >= 0 ? carga : null, pallets: numero(de(f, "pallets")),
      ventana: de(f, "ventana"), account: de(f, "account"), orderType: de(f, "orderType"), store: de(f, "store"), pickupName: de(f, "pickupName"),
      deliveryAddress: de(f, "deliveryAddress"),
    };
  }).filter((f) => f.po !== "" || f.so !== "" || f.invoice !== "" || f.chofer !== "");
}

export type OrdenParaCasar = { id: string; invoice_num: string | null; po2: string | null; so_num: string | null };
export type MotivoSinCasar = "sin_identificador" | "no_esta_en_la_app" | "varias_ordenes" | "identificadores_en_conflicto" | "otra_fecha" | "repetida_en_la_hoja";

export interface Casamiento {
  casadas: { fila: FilaDeHoja; ordenId: string; por: "invoice" | "po" | "so" }[];
  sinCasar: { fila: FilaDeHoja; motivo: MotivoSinCasar }[];
  /** Órdenes de la app de ese día que la hoja no trae. */
  soloEnLaApp: string[];
}

const clave = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/^#/, "");

/** Casa cada fila con UNA orden del día, o dice por qué no. `ordenes` son las de la fecha que se compara. */
export function casaConOrdenes(filas: readonly FilaDeHoja[], ordenes: readonly OrdenParaCasar[], fechaISO: string): Casamiento {
  const indice = (campo: "invoice_num" | "po2" | "so_num") => {
    const m = new Map<string, string[]>();
    for (const o of ordenes) { const k = clave(o[campo]); if (k) m.set(k, [...(m.get(k) ?? []), o.id]); }
    return m;
  };
  const por = { invoice: indice("invoice_num"), po: indice("po2"), so: indice("so_num") };
  const r: Casamiento = { casadas: [], sinCasar: [], soloEnLaApp: [] };
  const yaCasada = new Set<string>();
  for (const fila of filas) {
    if (fila.deliveryDate && fila.deliveryDate !== fechaISO) { r.sinCasar.push({ fila, motivo: "otra_fecha" }); continue; }
    const pistas = ([["invoice", fila.invoice], ["po", fila.po], ["so", fila.so]] as const).filter(([, v]) => clave(v) !== "");
    if (!pistas.length) { r.sinCasar.push({ fila, motivo: "sin_identificador" }); continue; }
    const halladas = pistas.map(([campo, v]) => ({ campo, ids: por[campo].get(clave(v)) ?? [] })).filter((h) => h.ids.length > 0);
    if (!halladas.length) { r.sinCasar.push({ fila, motivo: "no_esta_en_la_app" }); continue; }
    if (halladas.some((h) => h.ids.length > 1)) { r.sinCasar.push({ fila, motivo: "varias_ordenes" }); continue; }
    const ids = new Set(halladas.map((h) => h.ids[0]));
    if (ids.size > 1) { r.sinCasar.push({ fila, motivo: "identificadores_en_conflicto" }); continue; }
    const ordenId = halladas[0].ids[0];
    if (yaCasada.has(ordenId)) { r.sinCasar.push({ fila, motivo: "repetida_en_la_hoja" }); continue; }
    yaCasada.add(ordenId);
    r.casadas.push({ fila, ordenId, por: halladas[0].campo });
  }
  r.soloEnLaApp = ordenes.map((o) => o.id).filter((id) => !yaCasada.has(id)).sort();
  return r;
}

/** El valor de una celda de un XLSX (como lo da `exceljs`) a texto: fechas a ISO, fórmulas por su resultado,
 *  texto enriquecido por su texto. Lo que no se entiende es cadena vacía. */
export function textoDeCelda(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text?: unknown }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => (typeof r.text === "string" ? r.text : "")).join("").trim();
    if (o.result !== undefined) return textoDeCelda(o.result);
    if (o.text !== undefined) return textoDeCelda(o.text);
  }
  return "";
}

/** Lo mínimo de cada fila que viaja al servidor: con qué casar, con quién va y en qué carga. El resto de la hoja
 *  —direcciones, cuentas, ventanas— se queda en el navegador. */
export const filaParaEnviar = (f: FilaDeHoja) => ({ renglon: f.renglon, po: f.po, so: f.so, invoice: f.invoice, chofer: f.chofer, carga: f.carga, deliveryDate: f.deliveryDate });
