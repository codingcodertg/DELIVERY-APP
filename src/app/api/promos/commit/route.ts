import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { leeLaSubida } from "@/lib/promos/lectura-servidor";
import { filasParaGuardar } from "@/lib/promos/subida";
import { logSecurity } from "@/lib/security-log-server";

/**
 * Paso 2: **la única escritura del módulo**, y la única superficie con llave de servicio.
 *
 * La llave se salta la RLS entera, así que aquí está todo lo que la 140 no puede defender sola. Lo
 * que la protege:
 *
 *   1. **El rol se comprueba en el servidor** antes de nada (`leeLaSubida`), porque una ruta es una
 *      URL y la pantalla no es una puerta.
 *   2. **El servidor vuelve a leer el fichero él mismo.** No recibe filas del navegador: recibe el
 *      `.xlsx` y lo analiza otra vez. Si el cliente pudiera mandar las filas, podría mandar el
 *      costo que quisiera — y el costo es justo lo que la 140 se pasó una migración entera cerrando
 *      por privilegio de columna. Cerrarlo por un lado y abrirlo por el otro no sería cerrarlo.
 *   3. **La huella tiene que casar** con la que devolvió `preview`. Sin eso, un admin que se
 *      equivoca de fichero entre los dos pasos confirma unos avisos que eran de otro libro.
 *   4. **Lo que se escribe sale de una función pura** (`filasParaGuardar`), probada campo por campo
 *      sin base de datos. La ruta no compone filas a mano.
 *
 * Qué pasa si algo falla a mitad: las tres escrituras no son una transacción —PostgREST no la
 * ofrece— así que van en orden y, si una falla, se borra la ronda. `promo_products` y
 * `promo_suggestions` cuelgan de ella con `on delete cascade`, así que borrar la ronda lo deja todo
 * como estaba. Es la vuelta atrás que se puede dar desde aquí, y se dice que existe en vez de
 * suponer que no hará falta.
 */
export async function POST(req: Request) {
  const leida = await leeLaSubida(req);
  if (!leida.ok) return NextResponse.json({ error: leida.fallo.error }, { status: leida.fallo.estado });

  const { userId, etiqueta, resultado, huella, nombreDeFichero, form } = leida.datos;

  // Del formulario que `leeLaSubida` ya leyó: el cuerpo de una `Request` solo se lee una vez.
  const huellaDelCliente = String(form.get("huella") ?? "").trim();
  if (!huellaDelCliente) {
    return NextResponse.json({ error: "Missing huella: confirm from the preview step." }, { status: 400 });
  }
  if (huellaDelCliente !== huella) {
    return NextResponse.json(
      { error: "HUELLA_DISTINTA: the file is not the one that was previewed. Preview it again.", huella },
      { status: 409 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  }

  const { data: ronda, error: errorRonda } = await admin
    .from("promo_rounds")
    .insert({ label: etiqueta, source_name: nombreDeFichero, uploaded_by: userId })
    .select("id")
    .single();
  if (errorRonda || !ronda?.id) {
    return NextResponse.json({ error: errorRonda?.message ?? "Could not create the round." }, { status: 500 });
  }

  const { productos, sugerencias } = filasParaGuardar(ronda.id as string, resultado);

  const { error: errorProductos } = await admin.from("promo_products").insert(productos);
  if (errorProductos) {
    await admin.from("promo_rounds").delete().eq("id", ronda.id);
    return NextResponse.json({ error: `products: ${errorProductos.message}` }, { status: 500 });
  }

  if (sugerencias.length) {
    const { error: errorSugerencias } = await admin.from("promo_suggestions").insert(sugerencias);
    if (errorSugerencias) {
      await admin.from("promo_rounds").delete().eq("id", ronda.id);
      return NextResponse.json({ error: `suggestions: ${errorSugerencias.message}` }, { status: 500 });
    }
  }

  // El registro de seguridad no lleva `targetId`: esa columna apunta a `auth.users` y una ronda no
  // es una persona. La ronda va en el nombre y en el detalle, que es donde se lee.
  void logSecurity({
    actorId: userId,
    targetId: null,
    targetName: etiqueta,
    kind: "promo_round_uploaded",
    detail: `${productos.length} products, ${sugerencias.length} suggestions, ${resultado.avisos.length} notices, from ${nombreDeFichero} (round ${ronda.id})`,
  });

  return NextResponse.json({
    ok: true,
    roundId: ronda.id,
    etiqueta,
    productos: productos.length,
    sugerencias: sugerencias.length,
    avisos: resultado.avisos.length,
  });
}
