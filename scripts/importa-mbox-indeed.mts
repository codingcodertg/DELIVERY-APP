// Importa un .mbox con correos de Indeed bajados del buzón de careers@ (script de consola en el navegador del dueño,
// porque GoDaddy no deja dar el permiso de administrador). Cada correo pasa por la MISMA cadena que Outlook y Gmail
// (`procesaMensajeIndeed`): verificación por la Authentication-Results de Microsoft, sin duplicados (clave gmail:<Message-ID>,
// la misma que usa el importador de Gmail).
//
//   npx tsx --env-file=.env.local scripts/importa-mbox-indeed.mts <archivo.mbox> [--escribe]
//
// Sin --escribe solo cuenta: cuántos pasan la verificación, cuántos ya estaban procesados.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { simpleParser, type Attachment } from "mailparser";
import { cabecerasDe } from "../src/lib/gmail/extraer";
import { claveDelCorreo } from "../src/lib/gmail/clave";
import { verificadoComoIndeed } from "../src/lib/outlook/verificacion";
import { validaCv } from "../src/lib/outlook/cv";
import { procesaSeguro, type MensajeIndeed } from "../src/lib/outlook/sincronizar";

const [archivo, ...banderas] = process.argv.slice(2);
const escribe = banderas.includes("--escribe");
if (!archivo) throw new Error("Falta el archivo .mbox");

const texto = fs.readFileSync(archivo, "utf8");
const crudos = texto.split(/^From indeed@export .*\n/m).filter((x) => x.trim().length > 0).map((x) => x.replace(/^>From /gm, "From "));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function cv(adjuntos: readonly Attachment[]) {
  const pick = adjuntos.find((a) => /\.(pdf|docx?)$/i.test(a.filename ?? ""));
  if (!pick?.content?.length) return { cv: null, avisoAdjunto: null };
  if (pick.content.length > 10 * 1024 * 1024) return { cv: null, avisoAdjunto: "CV no guardado: el CV pasa de 10 MB" };
  const v = validaCv(pick.filename ?? "cv", pick.content);
  return v.ok ? { cv: { nombreFichero: pick.filename ?? "cv", bytes: pick.content }, avisoAdjunto: null } : { cv: null, avisoAdjunto: `CV no guardado: ${v.motivo}` };
}

const cuenta: Record<string, number> = {};
const suma = (k: string) => (cuenta[k] = (cuenta[k] ?? 0) + 1);
const creados: string[] = [];
let i = 0;
for (const crudo of crudos) {
  i++;
  const p = await simpleParser(crudo);
  const cabeceras = cabecerasDe(p);
  const fromAddress = (p.from?.value?.[0]?.address ?? "").toLowerCase();
  const verif = verificadoComoIndeed(cabeceras, fromAddress);
  const clave = claveDelCorreo({ messageId: p.messageId, uidvalidity: 0, uid: i });
  if (!verif.ok) { suma(`no verificado: ${verif.motivo}`); continue; }
  if (!escribe) {
    const { data } = await db.schema("recruiting").from("outlook_processed").select("message_id").eq("message_id", clave).maybeSingle();
    suma(data ? "ya procesado antes" : "por procesar");
    continue;
  }
  const m: MensajeIndeed = {
    clave,
    receivedDateTime: (p.date ?? new Date(0)).toISOString(),
    subject: p.subject ?? "",
    from: p.from?.text ?? fromAddress,
    fromAddress,
    replyTo: (Array.isArray(p.replyTo) ? p.replyTo : p.replyTo ? [p.replyTo] : []).flatMap((a) => a.value ?? []).map((v) => (v.address ?? "").toLowerCase()).filter(Boolean),
    bodyText: typeof p.html === "string" && p.html ? p.html : p.text ?? "",
    cabeceras,
    verificacion: verif,
    cvDelCorreo: async () => cv(p.attachments),
  };
  const r = await procesaSeguro(db as never, m, { dominioBuzon: "rdztilegroup.net", ahora: new Date() });
  suma(String(r));
  if (r === "created") creados.push(`${m.receivedDateTime.slice(0, 10)} · ${m.subject}`);
  if (i % 25 === 0) console.log(`${i} de ${crudos.length}…`);
}
console.log(`\nCorreos en el archivo: ${crudos.length}`);
console.table(cuenta);
if (creados.length) console.log("\nCandidatos NUEVOS (no estaban en el hub):\n" + creados.join("\n"));
