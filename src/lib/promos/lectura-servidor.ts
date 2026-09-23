import { createClient } from "@/lib/supabase/server";
import { huellaDeLectura, leePromo, type ResultadoPromo } from "./excel";
import { leeLibro } from "./libro";
import { etiquetaDeRonda, gruposDeAjustes, problemaDelFichero, problemaDeLoLeido } from "./subida";
import type { NamedLocation } from "@/lib/types";

/**
 * Leer la subida: **lo que las dos rutas hacen igual, escrito una vez**.
 *
 * SOLO LEE. No importa `createAdminClient` y no escribe nada en ningún sitio: usa el cliente del
 * que llama, así que todo lo que hace pasa por la RLS como cualquier consulta suya. Esa es la
 * propiedad que hace que `preview` sea inofensiva, y es comprobable de un vistazo — si algún día
 * aparece aquí la llave de servicio, `preview` deja de serlo sin que nadie lo note.
 *
 * Comprobar el rol en el SERVIDOR, y no confiar en que la pantalla solo se la enseñe a un admin:
 * la ruta es una URL y cualquiera con sesión puede llamarla. Mismo molde que `/api/delete-user`.
 */

export type FalloDeLectura = { estado: number; error: string };

export interface SubidaLeida {
  userId: string;
  nombreDeFichero: string;
  etiqueta: string;
  resultado: ResultadoPromo;
  huella: string;
  /** Los grupos que había cruzados en Ajustes al leer. Vacío es legítimo (§ `gruposDeAjustes`). */
  gruposConocidos: string[];
  /** El formulario ya leído. El cuerpo de una `Request` **solo se puede leer una vez**, así que
   *  quien necesite otro campo —`commit` necesita la `huella`— lo saca de aquí y no del `req`. */
  form: FormData;
}

export async function leeLaSubida(req: Request): Promise<{ ok: true; datos: SubidaLeida } | { ok: false; fallo: FalloDeLectura }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, fallo: { estado: 401, error: "Not signed in." } };

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return { ok: false, fallo: { estado: 403, error: "Only admins can upload a promo round." } };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, fallo: { estado: 400, error: "Invalid request body." } };
  }
  const fichero = form.get("file");
  if (!(fichero instanceof File)) {
    return { ok: false, fallo: { estado: 400, error: "Missing file." } };
  }
  const malFichero = problemaDelFichero(fichero.name, fichero.size);
  if (malFichero) return { ok: false, fallo: { estado: 400, error: `${malFichero.codigo}: ${malFichero.detalle}` } };

  // Los grupos salen de Ajustes con el cliente de quien llama: es una lectura normal, y si algún
  // día `settings` dejara de ser legible para él, esto tiene que fallar igual que fallaría la app.
  const { data: ajustes } = await supabase.from("settings").select("stores").eq("id", 1).maybeSingle();
  const gruposConocidos = gruposDeAjustes((ajustes?.stores ?? []) as NamedLocation[]);

  let resultado: ResultadoPromo;
  try {
    resultado = leePromo(await leeLibro(await fichero.arrayBuffer()), gruposConocidos);
  } catch {
    return { ok: false, fallo: { estado: 400, error: "That file couldn't be read as an .xlsx workbook." } };
  }

  const etiqueta = etiquetaDeRonda(typeof form.get("label") === "string" ? String(form.get("label")) : null, fichero.name);
  const malLeido = problemaDeLoLeido(resultado, etiqueta);
  if (malLeido) return { ok: false, fallo: { estado: 400, error: `${malLeido.codigo}: ${malLeido.detalle}` } };

  return {
    ok: true,
    datos: {
      userId: user.id,
      nombreDeFichero: fichero.name,
      etiqueta,
      resultado,
      huella: huellaDeLectura(resultado),
      gruposConocidos,
      form,
    },
  };
}
