/**
 * Un mensaje de candidato de Indeed: encontrar o crear al candidato, guardar su teléfono si falta, agendar la llamada
 * que pidió en el calendario de RR. HH. y anotar el texto completo. SOLO SERVIDOR (llave de servicio).
 *
 * Calendario: la llamada es `candidates.phone_date` (la misma que escribe el formulario de «Programar entrevista
 * telefónica»; el calendario la pinta). «Cualquier hora» no tiene hora fija: se guarda como `candidates.follow_up`
 * (fecha), que la pantalla Hoy muestra como «Vence» ese día. Nada se envía al candidato.
 *
 * Coincidencia: nombre completo sin mayúsculas ni tildes entre candidatos no archivados; desempate por puesto. Si no hay
 * ninguno, se CREA al candidato desde el mensaje (nombre, puesto, ubicación del bloque de la vacante). Si hay varios, no
 * se toca nada y el correo queda omitido con el motivo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName } from "@/lib/recruiting/utils";
import { telefonoEstandar } from "@/lib/recruiting/formato";
import { choquesDeHorario } from "@/lib/recruiting/choque-de-horario";
import { buscaDuplicado, digitosTel, patronTel } from "@/lib/recruiting/candidato-duplicado";
import type { MensajeDeIndeed } from "./indeed";
import { crearCandidatoDesdeCorreo } from "./crear-candidato";
import { horaDeLlamada, planearAgenda, telefonoDeMensaje, type PlanAgenda } from "./llamada-del-mensaje";

export type BusquedaCandidato = { tipo: "unico"; id: string } | { tipo: "ninguno" } | { tipo: "ambiguo"; cuantos: number };

/**
 * Patrón `ilike` tolerante a acentos: cada vocal (y la ñ/n) se vuelve un comodín de un carácter, para que «Sanchez»
 * encuentre «Sánchez» en la base. El resto se compara después en JS con normalizeName, que es la verdad.
 */
export function patronApellido(nombre: string): string | null {
  const ultimo = normalizeName(nombre).split(" ").filter(Boolean).pop();
  if (!ultimo || ultimo.length < 3) return null;
  const patron = [...ultimo].map((ch) => (/[aeiouyn]/.test(ch) ? "_" : ch)).join("");
  return `%${patron}%`;
}

type Fila = { id: string; name: string | null; role: string | null; archived: boolean | null };

export async function buscarCandidatoParaMensaje(db: SupabaseClient, nombre: string, puesto: string | null): Promise<BusquedaCandidato> {
  const patron = patronApellido(nombre);
  if (!patron) return { tipo: "ninguno" };
  const { data, error } = await db.schema("recruiting").from("candidates").select("id, name, role, archived").ilike("name", patron).limit(100);
  if (error) throw new Error(`No se pudo buscar al candidato: ${error.message}`);

  const buscado = normalizeName(nombre);
  let coinciden = ((data ?? []) as Fila[]).filter((f) => f.archived !== true && normalizeName(f.name ?? "") === buscado);
  if (coinciden.length > 1 && puesto) {
    const p = normalizeName(puesto);
    const porPuesto = coinciden.filter((f) => {
      const r = normalizeName(f.role ?? "");
      return r.length > 0 && (r === p || r.includes(p) || p.includes(r));
    });
    if (porPuesto.length >= 1) coinciden = porPuesto;
  }
  if (coinciden.length === 1) return { tipo: "unico", id: coinciden[0].id };
  if (coinciden.length === 0) return { tipo: "ninguno" };
  return { tipo: "ambiguo", cuantos: coinciden.length };
}

/** La nota de actividad: el texto COMPLETO del candidato, con el puesto y la fecha del correo. */
export function textoDeLaNota(m: MensajeDeIndeed, recibido: string): string {
  const cabecera = `Mensaje de Indeed${m.puesto ? ` (${m.puesto})` : ""} · ${recibido.slice(0, 16).replace("T", " ")} UTC`;
  return `${cabecera}:\n${m.texto}`;
}

export async function anotarMensajeEnCandidato(db: SupabaseClient, candidateId: string, nota: string): Promise<void> {
  const { error } = await db.schema("recruiting").from("contacts").insert({ candidate_id: candidateId, type: "Note", note: nota, result: null });
  if (error) throw new Error(`No se pudo anotar el mensaje: ${error.message}`);
}

export interface ResultadoMensaje {
  resultado: "created" | "noted" | "skipped";
  candidateId: string | null;
  /** Motivo si se omitió, o aviso no fatal. */
  error: string | null;
  /** Lo que quedó en `phone_date` (llamada con hora), o null. */
  scheduledAt: string | null;
  /** Resumen legible: teléfono, hora, agenda. Lo ve el admin en la tarjeta. */
  detail: string;
}

/** Terminales = etapas que no están «active» (contratado, descartado…). Para no marcar choques con gente ya fuera. */
async function etapasTerminales(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.schema("recruiting").from("stages").select("key, type");
  return new Set(((data ?? []) as Array<{ key: string; type: string }>).filter((s) => s.type !== "active").map((s) => s.key));
}

/**
 * Procesa un mensaje de candidato de punta a punta. Nunca manda nada a la persona: solo escribe en RR. HH.
 * `ahora` es el reloj de la corrida (decide si una hora ya pasó); `recibido` es la fecha del correo.
 */
export async function procesarMensaje(
  db: SupabaseClient,
  p: { mensaje: MensajeDeIndeed; recibido: string; ahora: string; replyToRelay: string | null },
): Promise<ResultadoMensaje> {
  const rec = db.schema("recruiting");
  const { mensaje: m } = p;
  const telefono = telefonoDeMensaje(m.texto);
  const hora = horaDeLlamada(m.texto, p.recibido);
  const busqueda = await buscarCandidatoParaMensaje(db, m.candidateName, m.puesto);

  if (busqueda.tipo === "ambiguo") {
    return {
      resultado: "skipped",
      candidateId: null,
      error: `message, no matching candidate (ambiguous: ${busqueda.cuantos} matches)`,
      scheduledAt: null,
      detail: "",
    };
  }

  let candidateId: string | null = busqueda.tipo === "unico" ? busqueda.id : null;
  let creado = false;
  if (!candidateId) {
    // Ningún candidato con ese nombre: se crea desde el mensaje (nombre, puesto, ubicación del bloque de la vacante).
    const alta = await crearCandidatoDesdeCorreo(
      db,
      {
        name: m.candidateName,
        email: p.replyToRelay,
        correoEsRelay: p.replyToRelay !== null,
        phone: telefono ?? "",
        role: m.puesto,
        home_location: m.ubicacion,
        tags: [],
        enlaces: { solicitud: null, cv: null },
        notes: `Llegó por mensaje de Indeed${m.puesto ? ` para ${m.puesto}` : ""} (${p.recibido.slice(0, 16).replace("T", " ")} UTC).`,
      },
      null,
    );
    candidateId = alta.candidateId;
    creado = alta.resultado === "created";
  }

  const { data: cand, error: eCand } = await rec
    .from("candidates")
    .select("id, name, phone, status, phone_date, follow_up, email, role")
    .eq("id", candidateId)
    .maybeSingle();
  if (eCand || !cand) throw new Error(`No se pudo leer al candidato: ${eCand?.message ?? "no existe"}`);
  const actual = cand as { id: string; name: string; phone: string | null; status: string; phone_date: string | null; follow_up: string | null; email: string | null; role: string | null };

  // Revisión de seguridad (D-1050): coincidir solo por NOMBRE no basta para cambiarle el teléfono o la cita a una ficha
  // que ya existía (dos personas pueden llamarse igual). Se cambia si la ficha la creó este mismo mensaje, si el correo
  // de Indeed que reenvía (Reply-To) es el que ya tiene la ficha, o si el puesto coincide. Si no, solo se anota, «por
  // confirmar», y RR. HH. decide.
  const mismoRelay = !!p.replyToRelay && !!actual.email && actual.email.trim().toLowerCase() === p.replyToRelay.trim().toLowerCase();
  const mismoPuesto = !!m.puesto && !!actual.role && normalizeName(m.puesto) === normalizeName(actual.role);
  const confiable = creado || mismoRelay || mismoPuesto;

  const avisos: string[] = [];
  const partes: string[] = [];

  // 1) Teléfono: solo si la ficha no tiene uno. Si el número ya es de otra persona, no se pisa ni se asigna.
  if (telefono) {
    const digitos = digitosTel(actual.phone);
    if (!digitos) {
      const pTel = patronTel(telefono);
      const { data: otros } = pTel ? await rec.from("candidates").select("id, name, phone").ilike("phone", pTel).limit(25) : { data: [] };
      const dueno = buscaDuplicado(((otros ?? []) as Array<{ id: string; name: string; phone: string }>).filter((x) => x.id !== actual.id), { phone: telefono });
      if (dueno) {
        avisos.push(`Teléfono ${telefonoEstandar(telefono)} ya es de ${dueno.name}; no se asignó aquí.`);
        partes.push(`Teléfono ${telefonoEstandar(telefono)} (ya de otro candidato)`);
      } else if (!confiable) {
        avisos.push(`Teléfono ${telefonoEstandar(telefono)} por confirmar: la ficha coincide solo por nombre.`);
        partes.push(`Teléfono por confirmar: ${telefonoEstandar(telefono)}`);
      } else {
        const { error } = await rec.from("candidates").update({ phone: telefonoEstandar(telefono) }).eq("id", actual.id);
        if (error) throw new Error(`No se pudo guardar el teléfono: ${error.message}`);
        partes.push(`Teléfono guardado: ${telefonoEstandar(telefono)}`);
      }
    } else if (digitos !== digitosTel(telefono)) {
      avisos.push(`El mensaje trae otro teléfono (${telefonoEstandar(telefono)}); la ficha se queda con el suyo.`);
      partes.push(`Teléfono distinto en el mensaje: ${telefonoEstandar(telefono)}`);
    } else {
      partes.push(`Teléfono: ${telefonoEstandar(telefono)} (ya estaba)`);
    }
  } else {
    partes.push("Sin teléfono en el mensaje");
  }

  // 2) Hora: se consulta el calendario (choques) solo si la hora es fija y futura.
  let choques: string[] = [];
  if (hora.tipo === "fija" && Date.parse(hora.iso) > Date.parse(p.ahora)) {
    const ventana = 2 * 60 * 60 * 1000;
    const { data: cercanas } = await rec
      .from("candidates")
      .select("id, name, status, archived, phone_date, inperson_date, assigned_recruiter, interview, location")
      .gte("phone_date", new Date(Date.parse(hora.iso) - ventana).toISOString())
      .lte("phone_date", new Date(Date.parse(hora.iso) + ventana).toISOString())
      .neq("id", actual.id)
      .limit(50);
    const terminales = await etapasTerminales(db);
    choques = choquesDeHorario(
      (cercanas ?? []) as Parameters<typeof choquesDeHorario>[0],
      { id: actual.id, tipo: "llamada", iso: hora.iso, reclutador: null },
      terminales,
    ).map((c) => c.nombre);
  }

  const plan: PlanAgenda = planearAgenda({
    hora,
    recibido: p.recibido,
    ahora: p.ahora,
    citaFuturaIso: actual.phone_date,
    seguimientoActual: actual.follow_up,
    choques,
  });

  // 3) Aplicar el plan: solo la llamada de esta persona, nunca otra.
  let scheduledAt: string | null = null;
  if (!confiable && plan.accion !== "ninguna") {
    avisos.push("Llamada por confirmar: la ficha coincide solo por nombre; no se agendó.");
    partes.push(`Por confirmar (solo coincide el nombre): ${plan.detalle}`);
  } else if (plan.accion === "agendar") {
    const { error } = await rec
      .from("candidates")
      .update({ phone_date: plan.iso, status: actual.status === "registered" ? "phone" : actual.status })
      .eq("id", actual.id);
    if (error) throw new Error(`No se pudo agendar la llamada: ${error.message}`);
    scheduledAt = plan.iso;
  } else if (plan.accion === "seguimiento") {
    const { error } = await rec.from("candidates").update({ follow_up: plan.dia }).eq("id", actual.id);
    if (error) throw new Error(`No se pudo poner el seguimiento: ${error.message}`);
  }
  if (confiable || plan.accion === "ninguna") partes.push(plan.detalle);
  if (choques.length && plan.accion === "ninguna") avisos.push(plan.detalle);

  // 4) Nota con el texto completo y el resumen de lo que se hizo.
  const nota = `${textoDeLaNota(m, p.recibido)}\n— ${partes.join(" · ")}`;
  await anotarMensajeEnCandidato(db, actual.id, nota);

  return {
    resultado: creado ? "created" : "noted",
    candidateId: actual.id,
    error: avisos.length ? avisos.join(" ") : null,
    scheduledAt,
    detail: partes.join(" · "),
  };
}
