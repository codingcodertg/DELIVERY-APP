import { ringcentralConfigured, ringcentralSms } from "@/lib/ringcentral";
import { emailConfigured, resendFrom } from "@/lib/email";

// ============================================================
// Quien ENVÍA un SMS o un correo, detrás de una interfaz (D-NEXT, avisos al cliente).
//
// Es el mismo camino que ya usaba /api/notify, sacado de la ruta para que los avisos automáticos lo reutilicen y
// para que se pueda INYECTAR: las pruebas pasan un stub que cuenta llamadas y ninguna llega a RingCentral, Twilio ni
// Resend (CLAUDE.md: las pruebas no disparan efectos en terceros).
//
//   SMS:    RingCentral si está configurado (RINGCENTRAL_CLIENT_ID/SECRET/JWT + RINGCENTRAL_FROM); si no, Twilio
//           (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM); si no, «dry-run» (no se manda nada, y se dice).
//   Correo: Resend (RESEND_API_KEY + remitente, ver lib/email.ts); si no, «dry-run».
//
// En el demo (NEXT_PUBLIC_LOCAL_MODE=true) `proveedorDelEntorno` devuelve SIEMPRE el stub: el demo no puede mandar
// nada aunque la máquina tenga las llaves puestas.
// ============================================================

export type ResultadoDeEnvio =
  | { ok: true; proveedor: string }
  | { ok: false; dryRun: true; motivo: string }
  | { ok: false; dryRun?: false; error: string };

export interface Proveedor {
  sms(to: string, texto: string): Promise<ResultadoDeEnvio>;
  correo(to: string, asunto: string, texto: string): Promise<ResultadoDeEnvio>;
}

/** El proveedor de verdad: lo que hacía /api/notify, tal cual. */
export const proveedorReal: Proveedor = {
  async sms(to, texto) {
    try {
      if (ringcentralConfigured() && process.env.RINGCENTRAL_FROM) {
        await ringcentralSms(to, texto);
        return { ok: true, proveedor: "ringcentral" };
      }
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_FROM;
      if (!sid || !token || !from) return { ok: false, dryRun: true, motivo: "sms provider not configured (set RingCentral or Twilio env vars)" };
      const form = new URLSearchParams({ To: to, From: from, Body: texto });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!res.ok) return { ok: false, error: `sms send failed (${res.status})` };
      return { ok: true, proveedor: "twilio" };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  async correo(to, asunto, texto) {
    try {
      const key = process.env.RESEND_API_KEY;
      const from = resendFrom();
      if (!key || !from || !emailConfigured()) return { ok: false, dryRun: true, motivo: "email provider not configured" };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: asunto || "Delivery update", text: texto }),
      });
      if (!res.ok) return { ok: false, error: `email send failed (${res.status})` };
      return { ok: true, proveedor: "resend" };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};

export type Envio = { canal: "sms" | "correo"; to: string; asunto?: string; texto: string };

/** Un proveedor falso que no sale de la máquina: guarda lo que se le pide y responde «dry-run». */
export function proveedorStub(): Proveedor & { envios: Envio[] } {
  const envios: Envio[] = [];
  return {
    envios,
    async sms(to, texto) { envios.push({ canal: "sms", to, texto }); return { ok: false, dryRun: true, motivo: "stub" }; },
    async correo(to, asunto, texto) { envios.push({ canal: "correo", to, asunto, texto }); return { ok: false, dryRun: true, motivo: "stub" }; },
  };
}

/** El que toca en este entorno: en el demo, el stub, siempre. */
export function proveedorDelEntorno(env: Record<string, string | undefined> = process.env): Proveedor {
  return env.NEXT_PUBLIC_LOCAL_MODE === "true" ? proveedorStub() : proveedorReal;
}
