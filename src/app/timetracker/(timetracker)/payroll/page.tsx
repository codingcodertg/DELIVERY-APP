import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PayrollTabs } from "@/components/timetracker/PayrollTabs";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { addDaysISO, fmtISOday } from "@/lib/timetracker/helpers";
import { hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import {
  inicioDeSemanaDePago,
  DIA_DE_INICIO_DE_PAGO, MAX_SEMANAS_DE_NOMINA, cuantasSemanasDePago, eleccionDeRango, rangoValidoDeNomina,
  semanasDePagoDelRango,
} from "@/lib/timetracker/rango-de-nomina";

export const dynamic = "force-dynamic";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const esFecha = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

type Parametros = { period?: string; desde?: string; hasta?: string; tienda?: string; empleado?: string };

/**
 * El rango de la URL, ya resuelto en semanas de pago:
 *  - `?desde=&hasta=` válidos: las semanas que tocan el rango, como mucho catorce (las más recientes);
 *  - `?period=` (la forma de siempre): la semana que empieza en ese viernes;
 *  - cualquier otra cosa (fechas inválidas, al revés, nada): la semana de pago de hoy.
 * Nunca lanza ni recorre un rango sin acotar: `semanasDePagoDelRango` cuenta hacia atrás desde `hasta`.
 */
function resolverRango(p: Parametros, hoy: string) {
  const valido = rangoValidoDeNomina(p.desde, p.hasta);
  let semanas: string[];
  let recortado = false;
  if (valido) {
    recortado = cuantasSemanasDePago(valido.desde, valido.hasta, DIA_DE_INICIO_DE_PAGO) > MAX_SEMANAS_DE_NOMINA;
    semanas = semanasDePagoDelRango(valido.desde, valido.hasta, DIA_DE_INICIO_DE_PAGO, MAX_SEMANAS_DE_NOMINA);
  } else {
    // La semana de HOY se saca del día de Texas (`hoy`), no de `new Date()`: con el reloj del servidor en otra zona, de noche
    // el día ya es el siguiente y la semana salía corrida (visto en pantalla: 21–27 nov en vez de 20–26).
    semanas = [esFecha(p.period) ? p.period : inicioDeSemanaDePago(hoy)];
  }
  const primera = semanas[0];
  const ultimoDia = addDaysISO(semanas[semanas.length - 1], 6);
  return {
    semanas,
    recortado,
    eleccion: eleccionDeRango(primera, ultimoDia, hoy),
    etiqueta: `${fmtISOday(primera)} – ${fmtISOday(ultimoDia)}`,
  };
}

/**
 * La nómina de un rango de fechas (2026-11-24). El rango llega por la URL:
 *  - `?period=` (la forma de siempre): UNA semana de pago, la que empieza en ese viernes;
 *  - `?desde=&hasta=`: las semanas de pago que tocan ese rango (de viernes a jueves), como mucho catorce;
 *  - sin nada, o con fechas que no cuadran: la semana de pago de hoy.
 * Cerrar, pagar y aprobar van siempre por una sola semana: la pantalla solo los deja cuando hay una.
 * El menú de fechas se calcula aquí con la misma semana de pago, para que la URL y el menú no digan cosas distintas.
 *
 * Las horas las carga la pantalla semana a semana (`getPayrollPeriod`) y las junta (`combinaSemanas`). Aquí solo
 * queda el aviso de «revisar» por persona.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Parametros>;
}) {
  const p = await searchParams;
  const hoy = hoyEnTexas();
  const filtro = { tienda: p.tienda || null, empleado: p.empleado || null };

  // Modo demo: las secciones leen del proveedor en memoria, sin tocar la base (no hay sesión que comprobar).
  if (LOCAL_MODE) {
    return <PayrollTabs {...resolverRango(p, hoy)} hoy={hoy} filtro={filtro} revisar={[]} />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timetracker/payroll");

  const { data: me, error: errorPerfil } = await supabase
    .from("profiles")
    .select("timetracker_role")
    .eq("id", user.id)
    .maybeSingle();
  // Igual que en los layouts (D-234): una consulta que FALLA no manda a nadie a otro
  // sitio. Aqui el rebote es a /timetracker en vez de al login, asi que no hace bucle,
  // pero si hace lo otro: te saca de la pantalla que pediste sin decir por que.
  if (estadoDeLectura({ data: me, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  // Las horas de todo el mundo son cosa de quien lleva la nómina.
  if (me?.timetracker_role !== "admin") redirect("/timetracker");

  // Con la sesión y el rol ya comprobados, se resuelve el rango de la URL.
  const rango = resolverRango(p, hoy);

  // Quién tiene horas por las dos vías (`period_hours.revisar`), en todas las semanas del rango.
  const { data: horas, error: errorHoras } = await supabase
    .schema("timetracker")
    .from("period_hours")
    .select("employee_id, revisar")
    .in("period_start", rango.semanas);
  const revisar = [...new Set((horas ?? []).filter((r) => r.revisar).map((r) => r.employee_id as string))];

  return (
    <PayrollTabs {...rango} hoy={hoy} filtro={filtro} revisar={revisar}
      errorHoras={errorHoras?.message ?? null} />
  );
}
