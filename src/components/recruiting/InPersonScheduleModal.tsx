"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import {
  MARCADORES_DE_LA_CITA, type Tienda,
  contactoDeLaCita, contactoDeLaConfirmacion, etapaTrasAgendar, lugaresParaAgendar, plantillaDeAjustes,
  prepararConfirmacionPresencial, textoConfirmacionPresencial, validarFechaPresencial,
} from "@/lib/recruiting/agendar-presencial";

/**
 * «📅 Agendar entrevista presencial» (D-585, D-597). Fecha y hora (futura), lugar (sede o texto) y nota.
 * Mientras se rellena, el texto para el candidato se arma solo —fecha, hora, tienda y su DIRECCIÓN (de Datos → Tiendas,
 * por `/api/recruiting/stores`), o la plantilla de Ajustes si hay una «presencial»— y se puede editar en el mismo diálogo.
 * «Guardar y mandar texto» hace las dos cosas de un golpe: `inperson_date`, la etapa que toque (librería), el contacto
 * «In person / Scheduled», y abre RingCentral con el texto (mismo camino que D-581; contacto SMS marcado). Nada sale
 * hasta que se pulse enviar en RingCentral. «Guardar sin texto» agenda y ya. Permisos: los de la entrevista; ninguno extra.
 */
export function InPersonScheduleModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, stages, templates, updateCandidate, addContact, notify, me } = useData();
  const { t, lang } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const existing = c?.inperson_date ?? null;
  const [dt, setDt] = useState(existing ? existing.slice(0, 16) : "");
  const lugares = lugaresParaAgendar(c?.location ?? "");
  const [lugar, setLugar] = useState(c?.location && lugares.includes(c.location) ? c.location : lugares[0] ?? "");
  const [otro, setOtro] = useState(false);
  const [lugarLibre, setLugarLibre] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  /** El texto tal como va a salir; `editado` = lo tocó quien manda y ya no se rearma solo. */
  const [texto, setTexto] = useState("");
  const [editado, setEditado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/recruiting/stores")
      .then((r) => (r.ok ? r.json() : { stores: [] }))
      .then((j) => { if (vivo && Array.isArray(j?.stores)) setTiendas(j.stores); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  const lugarElegido = (otro ? lugarLibre : lugar).trim();
  const fecha = validarFechaPresencial(dt);
  const recruiter = me?.full_name ?? "";
  const plantilla = plantillaDeAjustes(templates);
  const propuesto = c && fecha.ok ? textoConfirmacionPresencial(c, { iso: fecha.iso, lugar: lugarElegido }, recruiter, lang, tiendas, plantilla) : "";

  useEffect(() => {
    if (!editado) setTexto(propuesto);
  }, [propuesto, editado]);

  if (!c) return null;

  const validar = (): string | null => {
    const v = validarFechaPresencial(dt);
    if (v.ok) return v.iso;
    setError(
      v.motivo === "sin-fecha" ? t("Pick a date and time", "Elige fecha y hora")
      : v.motivo === "en-el-pasado" ? t("The date must be in the future", "La fecha tiene que ser futura")
      : t("Invalid date", "Fecha no válida"),
    );
    return null;
  };

  const agendar = async (iso: string) => {
    await updateCandidate(c.id, { inperson_date: iso, status: etapaTrasAgendar(stages, c.status) });
    await addContact(c.id, contactoDeLaCita(iso, lugarElegido, nota));
  };

  /** Guardar la cita y abrir RingCentral con el texto, de un golpe. */
  const guardarYMandar = async () => {
    const iso = validar();
    if (!iso) return;
    const r = prepararConfirmacionPresencial(c, texto);
    if (!r.ok) {
      setError(r.motivo === "sin-telefono" ? t("No phone number", "Sin número de teléfono") : t("The text is empty", "El texto está vacío"));
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      await agendar(iso);
      window.location.href = r.enlace;
      await addContact(c.id, contactoDeLaConfirmacion(r.texto));
      notify(t("Scheduled ✓ · text opened in RingCentral", "Agendada ✓ · texto abierto en RingCentral"));
      close();
    } finally {
      setGuardando(false);
    }
  };

  const guardarSinTexto = async () => {
    const iso = validar();
    if (!iso) return;
    setError(null);
    setGuardando(true);
    try {
      await agendar(iso);
      notify(t("In-person interview scheduled ✓", "Entrevista presencial programada ✓"));
      close();
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async () => {
    await updateCandidate(c.id, { inperson_date: null });
    close();
  };

  const sinTelefono = !c.phone?.trim();

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-agendar-presencial>
        <h3>📅 {t("Schedule in-person interview", "Agendar entrevista presencial")} — {c.name}</h3>

        <label>{t("Interview date and time", "Fecha y hora de la entrevista")}</label>
        <input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} />

        <label style={{ marginTop: 10 }}>{t("Place", "Lugar")}</label>
        <select value={otro ? "__otro__" : lugar} onChange={(e) => { if (e.target.value === "__otro__") setOtro(true); else { setOtro(false); setLugar(e.target.value); } }}>
          {lugares.map((l) => <option key={l} value={l}>{l}</option>)}
          <option value="__otro__">{t("Other…", "Otro…")}</option>
        </select>
        {otro && (
          <input placeholder={t("Address or place", "Dirección o lugar")} value={lugarLibre} onChange={(e) => setLugarLibre(e.target.value)} style={{ marginTop: 6 }} />
        )}

        <label style={{ marginTop: 10 }}>{t("Note (optional)", "Nota (opcional)")}</label>
        <input placeholder={t("e.g. bring ID", "p. ej. traer identificación")} value={nota} onChange={(e) => setNota(e.target.value)} />

        <label style={{ marginTop: 10 }}>
          {t("Text for the candidate (edit it if you like)", "Texto para el candidato (edítalo si quieres)")}
          {editado && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => { setEditado(false); setTexto(propuesto); }}>
              ↺ {t("Rebuild", "Rearmar")}
            </button>
          )}
        </label>
        <textarea
          rows={6}
          value={texto}
          placeholder={fecha.ok ? "" : t("Pick the date and time and the text builds itself", "Pon la fecha y la hora y el texto se arma solo")}
          onChange={(e) => { setEditado(true); setTexto(e.target.value); }}
        />
        <div className="hint">
          {plantilla
            ? t("Using the «in person» template from Settings.", "Usa la plantilla «presencial» de Ajustes.")
            : t("To change the wording for good, add a template named «In person» in Settings → Templates.", "Para cambiar el texto de una vez, agrega en Ajustes → Plantillas una que se llame «Presencial».")}
          {" "}{t("Placeholders:", "Marcadores:")} {"{name} {role} {recruiter} " + MARCADORES_DE_LA_CITA}
        </div>

        {error && <div style={{ color: "var(--red, #c0392b)", fontSize: 12, marginTop: 8 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={guardarYMandar} disabled={guardando || sinTelefono}
            title={sinTelefono ? t("No phone number", "Sin número de teléfono") : t("Saves the interview and opens the text in RingCentral", "Guarda la cita y abre el texto en RingCentral")}>
            📱 {t("Save and send text", "Guardar y mandar texto")}
          </button>
          <button className="btn btn-ghost" onClick={guardarSinTexto} disabled={guardando}>{t("Save without text", "Guardar sin texto")}</button>
          {existing && <button className="btn btn-danger" onClick={quitar}>{t("Remove date", "Quitar fecha")}</button>}
          <button className="btn btn-ghost" onClick={close}>{t("Cancel", "Cancelar")}</button>
        </div>
      </div>
    </div>
  );
}
