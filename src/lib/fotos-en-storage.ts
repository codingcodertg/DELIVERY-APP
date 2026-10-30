// ============================================================
// Las fotos de entrega viven en Storage (cubo `delivery-photos`, migración 178); la fila guarda solo RUTAS (D-565).
//
// Medido 2026-10-15: `deliveries.photos` guardaba cada foto como `data:image/jpeg;base64,…` (~400 KB–1 MB por orden) y
// `photo_meta`, indexado por esa misma cadena, pesaba LO MISMO otra vez. Hoy eso tumbó la instancia. Desde aquí:
//   · `photos` guarda `<delivery_id>/<marca-de-tiempo>-<n>.jpg` (la ruta dentro del cubo), y `photo_meta` se indexa
//     por esa ruta —unos 60 bytes por foto en vez de un megabyte—;
//   · para ENSEÑARLAS se pide una URL firmada (1 h) solo de las fotos de la orden abierta: eso es «descargar lo
//     necesario para ese momento». Se eligió ruta + firma al mostrar, y no una URL firmada guardada en la fila, porque
//     una firma caduca y una ruta no; y no un cubo público porque una foto de entrega es la prueba de a quién se
//     entregó qué. La política del cubo lee la orden con su propia RLS: quien ve la orden ve sus fotos.
//   · una foto vieja que siga siendo `data:` se enseña tal cual (compatibilidad): `urlsDeFotos` no la toca.
//
// Puro salvo lo que recibe por parámetro (el `storage` del cliente de Supabase, reducido a lo que se usa), para que
// se pruebe sin red.
// ============================================================

export const CUBO_DE_FOTOS = "delivery-photos";
/** Cuánto vale la URL firmada. La ficha las vuelve a pedir si la orden cambia; una hora cubre con holgura una ficha abierta. */
export const SEGUNDOS_DE_FIRMA = 3600;

/** ¿La foto sigue embebida en la fila (base64), como antes de la 178? */
export function esFotoEmbebida(foto: string): boolean {
  return foto.startsWith("data:");
}

/** ¿Ya es una URL que se puede pintar tal cual (firmada o pública, o un `blob:` local)? */
export function esUrlPintable(foto: string): boolean {
  return /^(https?:|blob:)/i.test(foto);
}

/**
 * El `src` con el que se pinta una foto: una `data:` vieja, tal cual; una URL ya firmada o pública (las fotos de fichaje
 * del Time Tracker llegan así, D-NEXT), tal cual; una ruta del cubo, por su URL firmada. Una ruta SIN firma (aún no
 * llegó, o la política no dejó) se deja en blanco: pedirla a pelo sería un 400 del cubo privado.
 */
export function srcDeFoto(foto: string, urls: Record<string, string> | undefined): string {
  if (esFotoEmbebida(foto) || esUrlPintable(foto)) return foto;
  return urls?.[foto] ?? "";
}

/** La ruta de la foto `n` de la orden dentro del cubo: la primera carpeta es el `id` de la orden, que es lo que mira la política. */
export function rutaDeFotoDeEntrega(deliveryId: string, marca: number, n: number): string {
  return `${deliveryId}/${marca}-${n}.jpg`;
}

/** Lo mínimo del `storage` del cliente de Supabase que hace falta aquí. */
export type AlmacenDeFotos = {
  from: (cubo: string) => {
    upload: (
      ruta: string, cuerpo: Blob, opts: { contentType: string; upsert: boolean },
    ) => PromiseLike<{ error: { message: string } | null }>;
    createSignedUrls: (
      rutas: string[], segundos: number,
    ) => PromiseLike<{ data: { path: string | null; signedUrl: string | null }[] | null; error: { message: string } | null }>;
  };
};

/** Los bytes de un `data:` URL, para subirlos. Lanza si no es un `data:` en base64. */
export function blobDeDataUrl(dataUrl: string): Blob {
  const coma = dataUrl.indexOf(",");
  const cabecera = coma >= 0 ? dataUrl.slice(0, coma) : "";
  const m = /^data:([^;,]+)(;base64)?$/.exec(cabecera);
  if (!m || !m[2]) throw new Error("not a base64 data: URL");
  const bin = atob(dataUrl.slice(coma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export type SubidaDeFotos =
  | { ok: true; rutas: string[] }
  | { ok: false; message: string };

/** Cuántas fotos suben a la vez (D-637). Tres: más rápido que una a una sin ahogar el 4G de un chofer en la calle. */
export const SUBIDAS_A_LA_VEZ = 3;

/**
 * Corre `tarea` sobre cada elemento con, como mucho, `tope` a la vez, y devuelve los resultados EN EL ORDEN de entrada.
 * Si `parar` dice que sí a un resultado, no se empiezan más (las que ya iban terminan).
 */
export async function enParaleloConTope<T, R>(
  items: readonly T[], tope: number, tarea: (item: T, i: number) => Promise<R>, parar: (r: R) => boolean = () => false,
): Promise<R[]> {
  const resultados = new Array<R>(items.length);
  let siguiente = 0;
  let parado = false;
  const obrero = async () => {
    while (!parado && siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await tarea(items[i], i);
      if (parar(resultados[i])) parado = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(tope, items.length)) }, obrero));
  return resultados;
}

/**
 * Sube cada `data:` al cubo y devuelve sus rutas, EN EL MISMO ORDEN. Todo o nada: si una falla (el cubo no existe, la
 * política no deja, sin red), devuelve el error y quien llama NO guarda la orden —ni a medias con las que sí subieron—.
 * Las que ya son rutas pasan tal cual, así que llamarlo dos veces con la misma lista no sube nada dos veces.
 *
 * D-637: suben de `SUBIDAS_A_LA_VEZ` en `SUBIDAS_A_LA_VEZ` (antes, una a una). Las rutas y su numeración no cambian: el
 * número `n` de cada foto se fija ANTES de subir, por su sitio en la lista, no por cuál termina antes. Y un `data:` que no
 * es base64 se rechaza antes de subir ninguna.
 */
export async function subirFotosDeEntrega(
  storage: AlmacenDeFotos, deliveryId: string, fotos: readonly string[], marca: number,
): Promise<SubidaDeFotos> {
  type Pendiente = { ruta: string; cuerpo: Blob | null };
  const pendientes: Pendiente[] = [];
  let n = 0;
  for (const foto of fotos) {
    if (!esFotoEmbebida(foto)) { pendientes.push({ ruta: foto, cuerpo: null }); continue; }
    let cuerpo: Blob;
    try { cuerpo = blobDeDataUrl(foto); } catch { return { ok: false, message: "photo is not a base64 image" }; }
    pendientes.push({ ruta: rutaDeFotoDeEntrega(deliveryId, marca, n++), cuerpo });
  }
  const errores = await enParaleloConTope(pendientes, SUBIDAS_A_LA_VEZ, async ({ ruta, cuerpo }) => {
    if (!cuerpo) return null;
    const r = await storage.from(CUBO_DE_FOTOS).upload(ruta, cuerpo, { contentType: "image/jpeg", upsert: false });
    return r.error ? r.error.message : null;
  }, (error) => error !== null);
  const error = errores.find((e) => typeof e === "string");
  if (error !== undefined) return { ok: false, message: error };
  return { ok: true, rutas: pendientes.map((p) => p.ruta) };
}

/**
 * Con qué `src` se enseña cada foto: las rutas del cubo, con su URL firmada; las `data:` viejas, tal cual. Una ruta que
 * no se pudo firmar no aparece en el mapa (quien pinta la deja en blanco en vez de pedir el base64 a la base).
 */
export async function urlsDeFotos(storage: AlmacenDeFotos, fotos: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const rutas: string[] = [];
  for (const f of fotos) {
    if (esFotoEmbebida(f)) out[f] = f;
    else if (!rutas.includes(f)) rutas.push(f);
  }
  if (!rutas.length) return out;
  const r = await storage.from(CUBO_DE_FOTOS).createSignedUrls(rutas, SEGUNDOS_DE_FIRMA);
  for (const s of r.data ?? []) if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
  return out;
}
