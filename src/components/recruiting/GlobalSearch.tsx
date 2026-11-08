"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { stageOf } from "@/lib/recruiting/constants";
import { avatarColor, initials } from "@/lib/recruiting/utils";
import { buscaEmpleadosParaLaBarra } from "@/app/recruiting/actions/hr";
import {
  agrupaResultados, buscaCandidatos, cabeceraDeGrupo, destinoDeResultado, detalleDeEmpleado, etiquetaDeTipo,
  placeholderDelBuscador, puedeBuscarEmpleados, type EmpleadoEncontrado, type ResultadoDeBusqueda, type TipoDeResultado,
} from "@/lib/recruiting/busqueda-global";
import type { Candidate, Stage } from "@/lib/recruiting/types";
import { telefonoEstandar } from "@/lib/recruiting/formato";

/** Cuánto se espera tras la última tecla antes de preguntar al servidor por empleados. */
const ESPERA_EMPLEADOS_MS = 180;

type T = (en: string, es: string) => string;
type Resultado = ResultadoDeBusqueda<Candidate, EmpleadoEncontrado>;

/**
 * El buscador de la barra: candidatos y, para quien ve Empleados, también empleados (busqueda-global.ts). El dueño:
 * «aquí no es solo candidatos, también empleados, pero que se note la diferencia entre los 2». Dos grupos con su
 * cabecera (👥 Candidatos · n / 👤 Empleados · n), y en cada fila una pastilla «Candidato» / «Empleado»; el empleado
 * lleva además el avatar cuadrado y verde, para que se distingan sin leer. Las flechas y Enter recorren los dos grupos
 * como una sola lista. El candidato abre su perfil, como siempre; el empleado, su ficha en RR. HH. › Empleados.
 */
export function GlobalSearch() {
  const { candidates, stages, me } = useData();
  const { openProfile } = useUI();
  const { t } = usePrefs();
  const router = useRouter();
  // D-NEXT: en el demo no hay empleados (viven en el servidor): el buscador es solo de candidatos.
  const conEmpleados = puedeBuscarEmpleados(me?.role) && !MODO_DEMO;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Position the dropdown as a viewport-fixed box clamped to stay on screen,
  // so it can never render off the edge no matter where the top bar wraps.
  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 6, left, width });
  }, []);

  // keep it anchored while open (scroll / resize)
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // "/" focuses the search from anywhere (ignoring when typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close when clicking outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Los empleados se buscan en el servidor (solo viajan los que coinciden). Una respuesta vieja —de una tecla
  // anterior— se descarta por el número de petición.
  const [empleados, setEmpleados] = useState<EmpleadoEncontrado[]>([]);
  const [buscandoEmpleados, setBuscandoEmpleados] = useState(false);
  const peticion = useRef(0);
  useEffect(() => {
    const texto = q.trim();
    const n = ++peticion.current;
    if (!conEmpleados || !texto) {
      setEmpleados([]);
      setBuscandoEmpleados(false);
      return;
    }
    setBuscandoEmpleados(true);
    const espera = window.setTimeout(() => {
      buscaEmpleadosParaLaBarra(texto)
        .then((r) => { if (n === peticion.current) setEmpleados(r); })
        .catch(() => { if (n === peticion.current) setEmpleados([]); })
        .finally(() => { if (n === peticion.current) setBuscandoEmpleados(false); });
    }, ESPERA_EMPLEADOS_MS);
    return () => window.clearTimeout(espera);
  }, [q, conEmpleados]);

  const candidatos = useMemo(() => buscaCandidatos(candidates, q), [q, candidates]);
  const { grupos, planos: results } = useMemo(() => agrupaResultados(candidatos, empleados), [candidatos, empleados]);

  useEffect(() => setActive(0), [q]);
  // Si llegan menos resultados de los que había, que la fila activa no se quede fuera de la lista.
  useEffect(() => setActive((a) => Math.min(a, Math.max(results.length - 1, 0))), [results.length]);

  const pick = (r: Resultado) => {
    const destino = destinoDeResultado(r);
    if (destino.tipo === "perfil") openProfile(destino.id);
    else router.push(destino.href);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      pick(results[active]);
    }
  };

  const placeholder = placeholderDelBuscador(conEmpleados, t);

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); place(); }}
        onFocus={() => { setOpen(true); place(); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{
          width: conEmpleados ? 290 : 240,
          maxWidth: "100%",
          height: 32,
          padding: "0 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,.25)",
          background: "rgba(255,255,255,.12)",
          color: "#fff",
          fontSize: 13,
        }}
      />
      {open && q.trim() && pos && (
        <div
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: "min(380px, calc(100vh - " + (pos.top + 16) + "px))",
            overflowY: "auto",
            background: "var(--card, #fff)",
            color: "var(--ink, #1a1f2b)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,.24)",
            border: "1px solid rgba(0,0,0,.08)",
            zIndex: 1000,
            padding: 6,
          }}
        >
          {results.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, opacity: 0.7 }}>
              {buscandoEmpleados ? t("Searching…", "Buscando…") : t("No matches.", "Sin resultados.")}
            </div>
          )}
          {grupos.map((g) => {
            const cabecera = cabeceraDeGrupo(g.tipo, g.items.length, t);
            return (
              <div key={g.tipo} className="gs-grupo" data-grupo={g.tipo} role="group" aria-label={cabecera}>
                <div className="gs-cabecera"><span aria-hidden="true">{g.tipo === "candidato" ? "👥" : "👤"}</span> {cabecera}</div>
                {g.items.map((r, j) => {
                  const i = g.desde + j;
                  return (
                    <button
                      key={r.tipo + r.id}
                      data-tipo={r.tipo}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(r)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        border: "none",
                        borderRadius: 8,
                        background: i === active ? "rgba(37,99,235,.12)" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      {r.tipo === "candidato"
                        ? <FilaCandidato c={r.candidato} stages={stages} t={t} />
                        : <FilaEmpleado e={r.empleado} t={t} />}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {conEmpleados && buscandoEmpleados && results.length > 0 && (
            <div className="gs-buscando">{t("Searching employees…", "Buscando empleados…")}</div>
          )}
        </div>
      )}
    </div>
  );
}

function PastillaDeTipo({ tipo, t }: { tipo: TipoDeResultado; t: T }) {
  return <span className="gs-tipo" data-tipo={tipo}>{etiquetaDeTipo(tipo, t)}</span>;
}

function FilaCandidato({ c, stages, t }: { c: Candidate; stages: Stage[]; t: T }) {
  const st = stageOf(stages, c.status);
  return (
    <>
      {c.photo ? (
        <div className="avatar" style={{ backgroundImage: `url(${c.photo})`, width: 30, height: 30, flex: "0 0 30px" }} />
      ) : (
        <div className="avatar" style={{ background: avatarColor(c.name), width: 30, height: 30, flex: "0 0 30px", fontSize: 12 }}>{initials(c.name)}</div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="gs-nombre">
          <span className="gs-nombre-texto">{c.pinned && "📌 "}{c.name}</span>
          <PastillaDeTipo tipo="candidato" t={t} />
        </div>
        <div className="gs-detalle">{[c.role, telefonoEstandar(c.phone)].filter(Boolean).join(" · ")}</div>
      </div>
      <span className="sema" style={{ flex: "0 0 auto", background: st.color + "22", color: st.color, fontSize: 10 }}>
        {st.label}
      </span>
    </>
  );
}

function FilaEmpleado({ e, t }: { e: EmpleadoEncontrado; t: T }) {
  return (
    <>
      <div className="avatar gs-avatar-empleado" aria-hidden="true">{initials(e.full_name)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="gs-nombre">
          <span className="gs-nombre-texto">{e.full_name}</span>
          <PastillaDeTipo tipo="empleado" t={t} />
        </div>
        <div className="gs-detalle">{detalleDeEmpleado(e, t)}</div>
      </div>
    </>
  );
}
