import { agendasExtraDesde, type CredencialesRingCentral } from "@/lib/recruiting/agendas-ringcentral";
import { elegirAgenda } from "@/lib/recruiting/rc-comms";

/**
 * Las credenciales con las que se lee el RingCentral de TODA la empresa (las llamadas de los choferes por extensión y
 * las de los leads): la app de la agenda del dueño que ya usan las comunicaciones de candidatos
 * (`RINGCENTRAL_AGENDAS_EXTRA` y `RINGCENTRAL_COMMS_AGENDA`). Sin ninguna, null: las rutas responden «sin configurar» y
 * el cron sale con 200 y `omitido`, igual que el de comunicaciones.
 *
 * **D-1128 — `RINGCENTRAL_LLAMADAS_JWT`.** Leer las llamadas de otras extensiones pide el permiso
 * *ReadCompanyCallLog* en el USUARIO del JWT, y el de la agenda del dueño (ext. 908) no lo tiene. Con esta variable, la
 * misma app entra como un usuario administrador de RingCentral SOLO para estas lecturas. Las comunicaciones de
 * candidatos (`rc-comms`) y el guardado de contactos siguen con el JWT de la agenda: leen y escriben en SU extensión, y
 * cambiarles el usuario las mandaría a la libreta y al registro de otra persona.
 */
export function credencialesDeLaSincronizacion(
  env: Record<string, string | undefined> = process.env,
): CredencialesRingCentral | null {
  const agenda = elegirAgenda(agendasExtraDesde(env.RINGCENTRAL_AGENDAS_EXTRA), env.RINGCENTRAL_COMMS_AGENDA);
  if (!agenda) return null;
  const jwtDeEmpresa = (env.RINGCENTRAL_LLAMADAS_JWT ?? "").trim();
  return jwtDeEmpresa ? { clientId: agenda.clientId, clientSecret: agenda.clientSecret, jwt: jwtDeEmpresa } : agenda;
}
