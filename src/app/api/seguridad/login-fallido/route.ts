import { NextResponse } from "next/server";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { cuerpoLoginFallido } from "@/lib/seguridad/identificador";
import { registraEvento } from "@/lib/seguridad/registro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lo llama el login (navegador) cuando Supabase Auth rechazó una entrada (320). SIN sesión: quien falla al entrar no tiene
 * ninguna. Solo acepta `{ identificador_hash }` (SHA-256 hecho en el navegador): ni usuario, ni correo, ni contraseña.
 * Rate limit por IP para que no sirva de inundación. No dice nada a quien llama más que si lo recibió.
 */
export async function POST(req: Request) {
  const lim = await limita(req, { clave: "seg-login-fallido", max: 60, ventanaSeg: 60 });
  if (!lim.ok) return respuesta429(lim.reset);

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const limpio = cuerpoLoginFallido(cuerpo);
  if (!limpio) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  // Aquí se espera la escritura: la respuesta es corta y así el registro no se pierde al cerrarse la función.
  await registraEvento({
    categoria: "auth",
    severidad: 2,
    metodo: "login",
    estado: 401,
    ruta: "/login",
    objetivo_tipo: "identificador",
    objetivo_id: limpio.identificador_hash,
    cabeceras: req.headers,
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
