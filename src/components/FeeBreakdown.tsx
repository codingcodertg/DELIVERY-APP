"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { fmtMoney } from "@/lib/utils";
import type { FeeBreakdown as Desglose, PasoTarifa } from "@/lib/pricing";
import { textoDelRango, textoDeLaRegla } from "@/lib/fee-formula-text";

/**
 * «¿Cómo se calculó?» — la fórmula con los números de ESTE pedido (D-244).
 *
 * El dueño pidió ver la fórmula del recargo de entrega. Lo que se enseña no es la fórmula en
 * abstracto —eso está en Ajustes, para consultarla sin abrir nada— sino **el camino que llevó a
 * los dos importes de los botones**: el tramo que aplicó, su regla, el bruto, el redondeo a $10
 * y el recargo de mismo día, si lo hay.
 *
 * Todo viene de `breakdown`, que sale del **mismo** cálculo que el precio. Este componente no
 * hace aritmética: si sumara por su cuenta, tarde o temprano diría una cosa y el botón otra, y
 * una explicación que no cuadra con el número es peor que no explicar nada.
 *
 * Solo lo ve un admin **por su rol real**, no por «ver como»: es información de cómo se fija un
 * precio, y quien está previsualizando la pantalla de un vendedor debe ver lo que ve el vendedor.
 */
export function FeeBreakdownDetails({ desglose }: { desglose: Desglose }) {
  const { t } = usePrefs();
  const [abierto, setAbierto] = useState(false);

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        {abierto ? "▾ " : "▸ "}{t("How was this calculated?", "¿Cómo se calculó?")}
      </button>

      {abierto && (
        <div className="box" style={{ marginTop: 6, padding: 10 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            {desglose.local ? t("Local zone", "Zona local") : t("Outside the local zone", "Fuera de la zona local")}
            {" · "}
            {t(`${desglose.miles} driving miles`, `${desglose.miles} millas de recorrido`)}
          </div>
          <Camino titulo={t("List", "Lista")} paso={desglose.list} />
          <div style={{ height: 8 }} />
          <Camino titulo={t("Discount", "Descuento")} paso={desglose.discount} />
        </div>
      )}
    </div>
  );
}

/** Un precio, paso a paso. Una línea por paso, con su número al lado. */
function Camino({ titulo, paso }: { titulo: string; paso: PasoTarifa }) {
  const { t } = usePrefs();

  // El rango y la regla se dicen en un solo sitio, compartido con la tabla de Ajustes: la misma
  // frase escrita dos veces acaba diciendo dos cosas.
  const rango = textoDelRango(t, paso.desde, paso.hasta);
  const regla = textoDeLaRegla(t, paso.base, paso.factor);

  return (
    <div>
      <div className="small" style={{ fontWeight: 700 }}>{titulo}</div>
      <Linea texto={`${rango} — ${regla}`} />
      {paso.factor !== 0 && <Linea texto={t("Before rounding", "Antes de redondear")} valor={fmtMoney(paso.bruto)} />}
      <Linea texto={t("Rounded to $10", "Redondeado a $10")} valor={fmtMoney(paso.redondeado)} />
      {paso.recargo > 0 && <Linea texto={t("Same-day surcharge", "Recargo de mismo día")} valor={`+ ${fmtMoney(paso.recargo)}`} />}
      <Linea texto={t("Total", "Total")} valor={fmtMoney(paso.total)} fuerte />
    </div>
  );
}

function Linea({ texto, valor, fuerte }: { texto: string; valor?: string; fuerte?: boolean }) {
  return (
    <div
      className="small"
      style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: fuerte ? 700 : 400 }}
    >
      <span className={fuerte ? undefined : "muted"}>{texto}</span>
      {valor && <span>{valor}</span>}
    </div>
  );
}
