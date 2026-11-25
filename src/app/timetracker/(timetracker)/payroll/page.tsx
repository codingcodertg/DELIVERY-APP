import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PayrollTabs } from "@/components/timetracker/PayrollTabs";
import { periodStartOf } from "@/lib/timetracker/period";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { addDaysISO, fmtISOday } from "@/lib/timetracker/helpers";
import { hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { seccionPorUrl } from "@/lib/timetracker/trabajando-ahora-en-nomina";
import {
  DIA_DE_INICIO_DE_PAGO, MAX_SEMANAS_DE_NOMINA, eleccionDeRango, semanasDePagoDelRango, semanasDePagoSinRecortar,
} from "@/lib/timetracker/rango-de-nomina";

export const dynamic = "force-dynamic";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const esFecha = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * La nómina de un rango de fechas (2026-11-24). El rango llega por la URL:
 *  - `?period=` (la forma de siempre): UNA semana de pago, la que empieza en ese viernes;
 *  - `?desde=&hasta=`: las semanas de pago que tocan ese rango (de viernes a jueves), como mucho catorce;
 *  - sin nada: la semana de pago de hoy.
 * Cerrar, pagar y aprobar van siempre por una sola semana: la página solo los deja cuando `semanas` tiene una.
 * El menú de fechas que ve la persona se calcula aquí, con la misma semana de pago, para que la URL y el menú
 * no puedan decir cosas distintas.
 *
 * Las horas, los fichajes y los totales ya no salen de esta página: los carga la pantalla semana a semana
 * (`getPayrollPeriod`) y los junta (`combinaSemanas`). Aquí solo queda el aviso de «revisar» por persona.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; desde?: string; hasta?: string; vista?: string; tienda?: string; empleado?: string }>;
}) {
  const { period, desde, hasta, vista, tienda, empleado } = await searchParams;
  // `?vista=` abre una sección plegada de Nómina: «ahora» (la antigua pestaña «Trabajando ahora»), «fotos»,
  // «excepciones» o «capturas» (las vistas que salieron de Auditoría). Un valor desconocido no abre nada.
  const vistaPorUrl = seccionPorUrl(vista);
  const hoy = hoyEnTexas();

  let semanas: string[];
  let recortado = false;
  if (esFecha(desde) && esFecha(hasta) && desde <= hasta) {
    recortado = semanasDePagoSinRecortar(desde, hasta, DIA_DE_INICIO_DE_PAGO).length > MAX_SEMANAS_DE_NOMINA;
    semanas = semanasDePagoDelRango(desde, hasta, DIA_DE_INICIO_DE_PAGO, MAX_SEMANAS_DE_NOMINA);
  } else {
    semanas = [esFecha(period) ? period : periodStartOf(new Date())];
  }
  const primera = semanas[0];
  const ultimoDia = addDaysISO(semanas[semanas.length - 1], 6);
  const eleccion = eleccionDeRango(primera, ultimoDia, hoy);
  const etiqueta = `${fmtISOday(primera)} – ${fmtISOday(ultimoDia)}`;
  const filtro = { tienda: tienda || null, empleado: empleado || null };

  // Modo demo: las secciones leen del proveedor en memoria, sin tocar la base.
  if (LOCAL_MODE) {
    return (
      <PayrollTabs
        semanas={semanas}
        recortado={recortado}
        eleccion={eleccion}
        etiqueta={etiqueta}
        hoy={hoy}
        filtro={filtro}
        vistaPorUrl={vistaPorUrl}
        revisar={[]}
      />
    );
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

  // Quién tiene horas por las dos vías (`period_hours.revisar`), en todas las semanas del rango.
  const { data: horas } = await supabase
    .schema("timetracker")
    .from("period_hours")
    .select("employee_id, revisar")
    .in("period_start", semanas);
  const revisar = [...new Set((horas ?? []).filter((r) => r.revisar).map((r) => r.employee_id as string))];

  return (
    <PayrollTabs
      semanas={semanas}
      recortado={recortado}
      eleccion={eleccion}
      etiqueta={etiqueta}
      hoy={hoy}
      filtro={filtro}
      vistaPorUrl={vistaPorUrl}
      revisar={revisar}
    />
  );
}
