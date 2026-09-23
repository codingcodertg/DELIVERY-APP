import { NextResponse } from "next/server";
import { leeLaSubida } from "@/lib/promos/lectura-servidor";
import { resumenParaPantalla } from "@/lib/promos/subida";

/**
 * Paso 1 de subir una ronda: **analizar el libro y NO escribir nada**.
 *
 * Es la mitad de la razón por la que subir va en dos pasos. Los previews de Vercel de este proyecto
 * apuntan a la MISMA base que producción, así que una ruta que escribe sube rondas de verdad en
 * cuanto alguien abre un preview. Esta no puede: no importa `createAdminClient` ni por asomo, y
 * todo lo que toca va con el cliente de quien llama, o sea por la RLS.
 *
 * Devuelve el recuento, los `avisos` —todo lo que el lector decidió no meter, y por qué— y una
 * muestra **sin las cinco columnas privadas**. Quien sube es un admin y la base se las dejaría ver,
 * pero para confirmar que un libro se leyó bien no hace falta el costo: no se manda por el cable lo
 * que no se necesita.
 *
 * La `huella` que devuelve la guarda la pantalla y se la pasa a `commit`, para que lo que se
 * confirma sea lo que se vio.
 */
export async function POST(req: Request) {
  const leida = await leeLaSubida(req);
  if (!leida.ok) return NextResponse.json({ error: leida.fallo.error }, { status: leida.fallo.estado });

  const { etiqueta, resultado, huella, gruposConocidos, nombreDeFichero } = leida.datos;
  return NextResponse.json({
    ok: true,
    etiqueta,
    nombreDeFichero,
    huella,
    gruposConocidos,
    ...resumenParaPantalla(resultado),
  });
}
