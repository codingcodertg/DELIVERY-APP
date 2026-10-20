"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { diaEntreLasFichas, fichasDeDia, fichasDeHora, horaEntreLasFichas, juntaFechaYHora, parteDeFechaYHora } from "@/lib/recruiting/fecha-y-hora";

/**
 * Fecha y hora con fichas (D-NEXT): «Hoy / Mañana / jue 22 / …» y «8:00 a.m. / 8:30 a.m. / …», más «Otro día» (el calendario
 * del navegador) y «Otra hora». `value` y `onChange` son el `YYYY-MM-DDTHH:mm` de siempre: los diálogos no cambian nada más.
 * Mientras falta una de las dos partes, `onChange("")` (el diálogo sigue pidiendo las dos); la parte elegida se queda aquí.
 */
export function SelectorDeFechaYHora({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const { t, lang } = usePrefs();
  const dias = useMemo(() => fichasDeDia(lang), [lang]);
  const horas = useMemo(() => fichasDeHora(lang), [lang]);
  const inicial = parteDeFechaYHora(value);
  const [fecha, setFecha] = useState(inicial.fecha);
  const [hora, setHora] = useState(inicial.hora);
  const [otroDia, setOtroDia] = useState(() => !!inicial.fecha && !diaEntreLasFichas(inicial.fecha, dias));
  const [otraHora, setOtraHora] = useState(() => !!inicial.hora && !horaEntreLasFichas(inicial.hora, horas));

  // Si el diálogo pone el valor desde fuera («🕐 Ahorita»), las fichas lo siguen.
  useEffect(() => {
    const p = parteDeFechaYHora(value);
    if (p.fecha && p.hora && (p.fecha !== fecha || p.hora !== hora)) {
      setFecha(p.fecha); setHora(p.hora);
      setOtroDia(!diaEntreLasFichas(p.fecha, dias)); setOtraHora(!horaEntreLasFichas(p.hora, horas));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const pon = (f: string, h: string) => { setFecha(f); setHora(h); onChange(juntaFechaYHora(f, h)); };

  return (
    <div className="selector-fecha-hora" data-selector-fecha-hora>
      <div className="hint" style={{ margin: "0 0 4px" }}>📅 {t("Day", "Día")}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {dias.map((d) => (
          <button key={d.fecha} type="button" className={"chip " + (!otroDia && fecha === d.fecha ? "on" : "")} data-dia={d.fecha}
            onClick={() => { setOtroDia(false); pon(d.fecha, hora); }} autoFocus={autoFocus && d.fecha === dias[0].fecha}>
            <b>{d.etiqueta}</b> <span style={{ opacity: .75 }}>{d.sub}</span>
          </button>
        ))}
        <button type="button" className={"chip " + (otroDia ? "on" : "")} onClick={() => setOtroDia(true)}>{t("Other day…", "Otro día…")}</button>
      </div>
      {otroDia && (
        <input type="date" value={fecha} onChange={(e) => pon(e.target.value, hora)} style={{ marginTop: 6 }} autoFocus />
      )}

      <div className="hint" style={{ margin: "10px 0 4px" }}>🕐 {t("Time", "Hora")}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {horas.map((h) => (
          <button key={h.hora} type="button" className={"chip " + (!otraHora && hora === h.hora ? "on" : "")} data-hora={h.hora}
            onClick={() => { setOtraHora(false); pon(fecha, h.hora); }}>
            {h.etiqueta}
          </button>
        ))}
        <button type="button" className={"chip " + (otraHora ? "on" : "")} onClick={() => setOtraHora(true)}>{t("Other time…", "Otra hora…")}</button>
      </div>
      {otraHora && (
        <input type="time" value={hora} onChange={(e) => pon(fecha, e.target.value)} style={{ marginTop: 6 }} autoFocus />
      )}
      {(fecha || hora) && !juntaFechaYHora(fecha, hora) && (
        <div className="hint" style={{ marginTop: 6 }}>{!fecha ? t("Pick the day", "Elige el día") : t("Pick the time", "Elige la hora")}</div>
      )}
    </div>
  );
}
