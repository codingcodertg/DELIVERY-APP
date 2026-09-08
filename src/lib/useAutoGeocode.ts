"use client";

import { useEffect, useRef, useState } from "react";
import type { Delivery } from "@/lib/types";
import { claveDireccion, necesitaUbicacion, parcheDeUbicacion, resultadoDeRespuesta } from "@/lib/geocode-on-save";

// Direcciones que el proveedor dice no conocer (404). Reintentarlas en cada barrido daría el mismo
// 404 y gastaría cuota en bucle — esto recorre el día entero cada vez que cambia la lista. Los
// fallos temporales NO entran aquí: esos sí se reintentan.
const sinPunto = new Set<string>();

/** Geocodes any order missing a map pin but with an address — sequential + slightly throttled,
 * since the free OSM fallback provider asks for at most ~1 request/second. Shared by the Map and
 * Routes pages. Returns how many geocodes are currently in flight (for a loading hint).
 *
 * Desde D-223 esto **ya no es el único camino**: un pedido se ubica al guardarse, en el proveedor
 * de datos. Este barrido se queda para los pedidos que ya existían sin punto y que nadie vuelve a
 * guardar, y comparte con aquel las mismas funciones puras —qué es «necesita punto», qué significó
 * la respuesta, qué se escribe— para que no haya dos definiciones que se separen con el tiempo.
 *
 * Lo que aquí **no** se hace es avisar al usuario: esto recorre el día entero por su cuenta, y un
 * aviso por cada dirección que no exista sería ruido sobre pedidos que quien mira el mapa quizá ni
 * está tocando. El aviso vive donde hay un acto del usuario detrás: el guardado. */
export function useAutoGeocode(
  orders: Delivery[],
  updateDelivery: (id: string, patch: Partial<Delivery>) => Promise<boolean>,
): number {
  const [geocoding, setGeocoding] = useState(0);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const todo = orders.filter(
      (d) => necesitaUbicacion(d) && !inFlight.current.has(d.id) && !sinPunto.has(claveDireccion(d.delivery_address)),
    );
    if (!todo.length) return;

    (async () => {
      for (const d of todo) {
        if (cancelled) return;
        inFlight.current.add(d.id);
        setGeocoding((n) => n + 1);
        try {
          const res = await fetch("/api/geocode-point", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: d.delivery_address }),
          });
          const resultado = resultadoDeRespuesta(res.status, await res.json().catch(() => null));
          if (resultado.kind === "ok") {
            if (!cancelled) await updateDelivery(d.id, parcheDeUbicacion(resultado));
          } else if (resultado.kind === "noEncontrada") {
            // Se recuerda para no volver a pedirla en el siguiente barrido. Un fallo temporal, en
            // cambio, se deja pasar: la próxima vez puede funcionar.
            sinPunto.add(claveDireccion(d.delivery_address));
          }
        } catch { /* red caída: se reintentará en el próximo barrido */ }
        inFlight.current.delete(d.id);
        setGeocoding((n) => n - 1);
        await new Promise((r) => setTimeout(r, 350));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  return geocoding;
}
