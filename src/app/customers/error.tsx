"use client";

import { ProfileReadError } from "@/components/ProfileReadError";

/**
 * La frontera de error de «Clientes»: la misma del ERP (`erp/error.tsx`, D-235) porque comparte su cascarón. Lo que
 * se lanza en el servidor cae aquí y se pinta con la pantalla común del hub (D-234); el detalle nunca llega al
 * navegador (Next deja solo el `digest`), y por eso se enseña como referencia.
 */
export default function CustomersError({ error }: { error: Error & { digest?: string } }) {
  return <ProfileReadError error={{ message: error.message, code: error.digest ?? null }} verDetalle={false} />;
}
