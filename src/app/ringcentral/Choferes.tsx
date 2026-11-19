"use client";

import { useEffect, useMemo, useState } from "react";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { usePrefs } from "@/lib/prefs";
import { nombreVisible } from "@/lib/ringcentral-choferes/choferes";
import { cargarExtensiones, guardarChoferes, type ExtensionDeLaLista } from "@/lib/ringcentral-choferes/cliente";

/**
 * Las extensiones de la cuenta de RingCentral, con una casilla por cada una para marcarla como chofer. La lista sale de
 * RingCentral; lo marcado se guarda con «Guardar». Las extensiones que el admin desmarca dejan de salir en «Llamadas»,
 * pero sus llamadas ya guardadas se conservan.
 */
export function Choferes() {
  const { t } = usePrefs();
  const [lista, setLista] = useState<ExtensionDeLaLista[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [guardadas, setGuardadas] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = () => {
    setError(null);
    cargarExtensiones()
      .then((ext) => {
        setLista(ext);
        const ids = new Set(ext.filter((e) => e.esChofer).map((e) => e.id));
        setMarcadas(new Set(ids));
        setGuardadas(new Set(ids));
      })
      .catch(() => {
        setLista([]);
        setError(t("Could not load the RingCentral extensions. Try again.", "No se pudieron cargar las extensiones de RingCentral. Intenta de nuevo."));
      });
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!lista) return [];
    if (!q) return lista;
    return lista.filter((e) => `${e.nombre} ${e.numero}`.toLowerCase().includes(q));
  }, [lista, busqueda]);

  const sucia = useMemo(() => {
    if (marcadas.size !== guardadas.size) return true;
    for (const id of marcadas) if (!guardadas.has(id)) return true;
    return false;
  }, [marcadas, guardadas]);

  const guardar = async () => {
    if (!lista) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const elegidas = lista.filter((e) => marcadas.has(e.id)).map((e) => ({ id: e.id, numero: e.numero, nombre: e.nombre }));
      await guardarChoferes(elegidas);
      setGuardadas(new Set(marcadas));
      setAviso(t(`Saved: ${elegidas.length} drivers.`, `Guardado: ${elegidas.length} choferes.`));
    } catch {
      setError(t("Could not save the drivers. Try again.", "No se pudieron guardar los choferes. Intenta de nuevo."));
    } finally {
      setGuardando(false);
    }
  };

  const columnas: ColumnaEstandar<ExtensionDeLaLista>[] = [
    { key: "numero", en: "Extension", es: "Extensión", ancho: 100, valor: (e) => e.numero },
    { key: "nombre", en: "Name", es: "Nombre", ancho: 240, valor: (e) => nombreVisible(e.nombre, e.numero) },
    { key: "guardado", en: "Saved as driver", es: "Guardado como chofer", ancho: 160, valor: (e) => (guardadas.has(e.id) ? t("Yes", "Sí") : t("No", "No")) },
  ];

  return (
    <section className="rcc-seccion" aria-label={t("Drivers (extensions)", "Choferes (extensiones)")}>
      <p className="hint">
        {t(
          "Mark the RingCentral extensions that belong to drivers. The Calls tab shows the calls of the marked ones.",
          "Marca las extensiones de RingCentral que son de choferes. La pestaña Llamadas muestra las llamadas de las marcadas.",
        )}
      </p>

      <div className="rcc-filtros">
        <label className="rcc-campo rcc-campo-ancho">
          <span>{t("Search by name or extension", "Buscar por nombre o extensión")}</span>
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} data-buscar-extension />
        </label>
        <div className="rcc-resumen">
          <strong data-marcadas>{t(`${marcadas.size} selected`, `${marcadas.size} marcados`)}</strong>
          <button type="button" className="btn btn-sm" onClick={guardar} disabled={!sucia || guardando || !lista} data-guardar-choferes>
            {guardando ? t("Saving…", "Guardando…") : t("Save", "Guardar")}
          </button>
        </div>
      </div>
      {aviso && <div className="hint" role="status">{aviso}</div>}
      {error && <div className="hint" style={{ color: "var(--red, #b91c1c)" }}>{error}</div>}

      {lista === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : (
        <TablaEstandar
          id="ringcentral-choferes"
          data-tabla="ringcentral-choferes"
          claseTabla="rcc-tabla"
          filas={filtradas}
          claveDe={(e) => e.id}
          vacio={t("No extensions found.", "No se encontraron extensiones.")}
          columnas={columnas}
          seleccion={{ marcadas, onCambia: (n) => setMarcadas(n) }}
        />
      )}
    </section>
  );
}
