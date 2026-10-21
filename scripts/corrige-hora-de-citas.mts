// Barrido de una vez para lo guardado ANTES de que RR. HH. fuera entero en hora de Brownsville (D-632, 2026-10-21).
// El dueño: «a él le salen a las 4:30, pero yo lo puse para las 3:30 … que se registren en el horario de mi jefe».
//
// Qué se corrige, y solo lo que se puede MEDIR fila a fila:
//
// 1. `inperson_date` de las citas presenciales. Al agendar, la app deja un contacto «In person / Scheduled» cuya nota
//    empieza con la fecha y hora tal como las vio quien agendó («Oct 21 03:30 PM · Pharr»), formateadas en SU aparato.
//    Esa nota es lo que escribió; el texto que recibió el candidato salió con la misma hora. Si la nota, leída como hora
//    de Brownsville, no da el instante guardado pero se queda a menos de 3 horas (un desfase de zona, no otra cita),
//    se corrige `inperson_date` a lo que dice la nota. Si la nota es de otro día (la cita se movió sin dejar nota), no
//    se toca: no hay medida.
// 2. `reg_date`. La app ponía el día UTC (`toISOString().slice(0, 10)`): registrar después de las 7 p. m. de Texas
//    dejaba la fecha de mañana. Si `reg_date` es el día UTC de `created_at` y no el de Brownsville, pasa al de
//    Brownsville. Si alguien la cambió a mano (no coincide con el día UTC), no se toca.
//
// Qué NO se corrige: `phone_date`. La llamada agendada no deja nota con la hora escrita, y los botones «Ahorita» /
// «En 1 hora» guardaban el instante bien (ida y vuelta por el mismo aparato), así que no hay forma de saber cuáles
// están corridas. Se cuentan y se enseñan, nada más.
//
// Usa la MISMA función de la app (`instanteDePared`), no una copia. Sin `--escribe` solo cuenta y enseña.
// Con `--escribe`: primero guarda en D:\CLAUDE\respaldos-db un JSON con los valores de ANTES de cada fila que cambia
// (para poder deshacerlo), luego actualiza solo esas, en una transacción, y vuelve a medir: debe quedar 0.
//
//   node --env-file=.env.local scripts/corrige-hora-de-citas.mts             (ver)
//   node --env-file=.env.local scripts/corrige-hora-de-citas.mts --escribe   (hacer)
import pg from "pg";
import { writeFileSync } from "node:fs";
import { diaEnBrownsville, instanteDePared, paredDeInstante } from "../src/lib/recruiting/hora-de-brownsville.ts";

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NOTA = /^([A-Z][a-z]{2}) (\d{2}) (\d{2}):(\d{2})\s?(AM|PM)/;
const TRES_HORAS = 3 * 3600_000;

type Cita = { id: string; name: string; inperson_date: Date; nota: string | null; nota_en: Date | null };
type Alta = { id: string; name: string; reg_date: string; created_at: Date };

/** La hora de reloj que dice la nota, con el año de la cita guardada (el más cercano, por si cruza fin de año). */
export function paredDeLaNota(nota: string, guardada: Date): string | null {
  const m = NOTA.exec(nota.trim());
  if (!m) return null;
  const mes = MESES.indexOf(m[1]);
  if (mes < 0) return null;
  let h = Number(m[3]) % 12;
  if (m[5] === "PM") h += 12;
  const y0 = Number(paredDeInstante(guardada).slice(0, 4));
  const opciones = [y0 - 1, y0, y0 + 1].map((y) =>
    `${y}-${String(mes + 1).padStart(2, "0")}-${m[2]}T${String(h).padStart(2, "0")}:${m[4]}`);
  return opciones
    .map((p) => ({ p, t: instanteDePared(p) }))
    .filter((x) => x.t)
    .sort((a, b) => Math.abs(a.t!.getTime() - guardada.getTime()) - Math.abs(b.t!.getTime() - guardada.getTime()))[0]?.p ?? null;
}

/** Lo que hay que poner en `inperson_date`, o null si no se toca (sin nota, nota de otra cita, o ya está bien). */
export function correccionDeCita(c: Pick<Cita, "inperson_date" | "nota">): Date | null {
  if (!c.nota) return null;
  const pared = paredDeLaNota(c.nota, c.inperson_date);
  const buena = pared ? instanteDePared(pared) : null;
  if (!buena) return null;
  const diferencia = Math.abs(buena.getTime() - c.inperson_date.getTime());
  if (diferencia === 0 || diferencia > TRES_HORAS) return null;
  return buena;
}

/** El `reg_date` bueno, o null si no se toca. */
export function correccionDeAlta(a: Pick<Alta, "reg_date" | "created_at">): string | null {
  const utc = a.created_at.toISOString().slice(0, 10);
  const texas = diaEnBrownsville(a.created_at);
  return a.reg_date === utc && utc !== texas ? texas : null;
}

const principal = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/corrige-hora-de-citas.mts");
if (principal) {
  const escribe = process.argv.includes("--escribe");
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  if (!escribe) await c.query("set default_transaction_read_only = on");

  const leeCitas = async () => (await c.query<Cita>(`
    select cd.id, cd.name, cd.inperson_date, k.note as nota, k.created_at as nota_en
      from recruiting.candidates cd
      left join lateral (
        select note, created_at from recruiting.contacts
         where candidate_id = cd.id and type = 'In person' and result = 'Scheduled' and coalesce(trim(note), '') <> ''
         order by created_at desc limit 1
      ) k on true
     where cd.inperson_date is not null
     order by cd.inperson_date`)).rows;
  const leeAltas = async () => (await c.query<Alta>(
    `select id, name, to_char(reg_date, 'YYYY-MM-DD') as reg_date, created_at from recruiting.candidates order by created_at`)).rows;

  const citas = await leeCitas();
  const citasPorCorregir = citas.map((r) => ({ r, nueva: correccionDeCita(r) })).filter((x) => x.nueva);
  const sinNota = citas.filter((r) => !r.nota).length;
  const notaDeOtraCita = citas.filter((r) => r.nota && !correccionDeCita(r) && (() => {
    const p = paredDeLaNota(r.nota!, r.inperson_date);
    return !p || instanteDePared(p)!.getTime() !== r.inperson_date.getTime();
  })()).length;
  console.log(`citas presenciales: ${citas.length} · por corregir: ${citasPorCorregir.length} · ya bien: ${citas.length - citasPorCorregir.length - sinNota - notaDeOtraCita} · sin nota: ${sinNota} · nota de otra fecha (no se toca): ${notaDeOtraCita}`);
  const ahora = Date.now();
  for (const { r, nueva } of citasPorCorregir) {
    const futura = nueva!.getTime() > ahora ? "  ← FUTURA" : "";
    console.log(`  ${r.name.padEnd(24)} nota «${r.nota!.slice(0, 32)}» · guardada ${paredDeInstante(r.inperson_date)} → ${paredDeInstante(nueva!)} (Brownsville)${futura}`);
  }

  const altas = await leeAltas();
  const altasPorCorregir = altas.map((r) => ({ r, nueva: correccionDeAlta(r) })).filter((x) => x.nueva);
  console.log(`altas: ${altas.length} · reg_date con el día UTC en vez del de Texas: ${altasPorCorregir.length}`);
  for (const { r, nueva } of altasPorCorregir.slice(0, 6)) console.log(`  ${r.name.padEnd(24)} ${r.reg_date} → ${nueva}  (registrado ${paredDeInstante(r.created_at)} Brownsville)`);

  const llamadas = (await c.query<{ total: string; futuras: string }>(
    `select count(*) as total, count(*) filter (where phone_date > now()) as futuras from recruiting.candidates where phone_date is not null`)).rows[0];
  console.log(`llamadas agendadas (no se tocan, sin medida por fila): ${llamadas.total} · futuras: ${llamadas.futuras}`);

  if (escribe && (citasPorCorregir.length || altasPorCorregir.length)) {
    const sello = new Date().toISOString().replace(/[:.]/g, "-");
    const respaldo = `D:/CLAUDE/respaldos-db/hora-de-citas-antes-${sello}.json`;
    writeFileSync(respaldo, JSON.stringify({
      inperson_date: citasPorCorregir.map(({ r, nueva }) => ({ id: r.id, antes: r.inperson_date.toISOString(), despues: nueva!.toISOString(), nota: r.nota })),
      reg_date: altasPorCorregir.map(({ r, nueva }) => ({ id: r.id, antes: r.reg_date, despues: nueva })),
    }, null, 2));
    console.log("respaldo:", respaldo);
    await c.query("begin");
    let n = 0;
    for (const { r, nueva } of citasPorCorregir) {
      n += (await c.query(`update recruiting.candidates set inperson_date = $2 where id = $1 and inperson_date = $3`, [r.id, nueva!.toISOString(), r.inperson_date.toISOString()])).rowCount ?? 0;
    }
    for (const { r, nueva } of altasPorCorregir) {
      n += (await c.query(`update recruiting.candidates set reg_date = $2 where id = $1 and reg_date = $3`, [r.id, nueva, r.reg_date])).rowCount ?? 0;
    }
    const esperadas = citasPorCorregir.length + altasPorCorregir.length;
    if (n !== esperadas) { await c.query("rollback"); throw new Error(`se esperaban ${esperadas} filas y fueron ${n}: deshecho`); }
    await c.query("commit");
    const quedanCitas = (await leeCitas()).filter((r) => correccionDeCita(r)).length;
    const quedanAltas = (await leeAltas()).filter((r) => correccionDeAlta(r)).length;
    console.log(`actualizadas: ${n} · quedan por corregir: ${quedanCitas} citas, ${quedanAltas} altas`);
  }
  await c.end();
}
