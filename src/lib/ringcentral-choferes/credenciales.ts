import { agendasExtraDesde, type CredencialesRingCentral } from "@/lib/recruiting/agendas-ringcentral";
import { elegirAgenda } from "@/lib/recruiting/rc-comms";

/**
 * Las credenciales con las que se lee el RingCentral de los choferes: la misma agenda del dueño que ya usan las
 * comunicaciones de candidatos (`RINGCENTRAL_AGENDAS_EXTRA` y `RINGCENTRAL_COMMS_AGENDA`). Sin ninguna, null: las rutas
 * responden «sin configurar» y el cron sale con 200 y `omitido`, igual que el de comunicaciones.
 */
export function credencialesDeLaSincronizacion(): CredencialesRingCentral | null {
  return elegirAgenda(agendasExtraDesde(process.env.RINGCENTRAL_AGENDAS_EXTRA), process.env.RINGCENTRAL_COMMS_AGENDA);
}
