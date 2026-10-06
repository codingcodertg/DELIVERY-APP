import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVISOS_DEL_GESTOR, cierraAviso, claveDeAvisosOcultos, guardaAvisosOcultos, leeAvisosOcultos, type AvisoDelGestor } from "./avisos-ocultos";

/** Las ✕ de los avisos del Gestor de Rutas (D-400): cerrados para siempre, por persona, y recuperables.
 *  D-459 (2026-10-01): dos avisos dejaron de serlo —la tarjeta «Armar las rutas» (ahora un solo botón en la cabecera) y la
 *  ayuda del mapa (ahora un ⓘ)—, y «Mostrar avisos ocultos» bajó al fondo de la página. Las pruebas de aquí que fijaban lo
 *  de antes se pusieron al día; ninguna se quitó sin sustituirla. */

const almacen = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const { choferesSinSenal, atrasadas, diaVacio } = AVISOS_DEL_GESTOR;

describe("lo cerrado se recuerda por persona", () => {
  it("sin nada guardado, no hay nada cerrado", () => {
    expect(leeAvisosOcultos(almacen().getItem, "u1").size).toBe(0);
  });
  it("lo que cerró una persona sigue cerrado al recargar, y NO para otra persona en la misma computadora", () => {
    const a = almacen();
    guardaAvisosOcultos(() => a, "u1", new Set([choferesSinSenal, atrasadas]));
    expect([...leeAvisosOcultos(a.getItem, "u1")].sort()).toEqual([atrasadas, choferesSinSenal].sort());
    expect(leeAvisosOcultos(a.getItem, "u2").size).toBe(0);
    expect(claveDeAvisosOcultos("u1")).not.toBe(claveDeAvisosOcultos("u2"));
  });
  it("cerrar uno no reabre los que ya estaban cerrados", () => {
    const antes = new Set<AvisoDelGestor>([diaVacio]);
    const despues = cierraAviso(antes, atrasadas);
    expect([...despues].sort()).toEqual([diaVacio, atrasadas].sort());
    expect(antes.size).toBe(1);      // no muta lo de antes: React lo necesita nuevo
  });
  it("«Mostrar avisos ocultos» (lista vacía) BORRA la clave, no guarda un vacío", () => {
    const a = almacen();
    guardaAvisosOcultos(() => a, "u1", new Set([diaVacio]));
    guardaAvisosOcultos(() => a, "u1", new Set());
    expect(a.m.has(claveDeAvisosOcultos("u1"))).toBe(false);
    expect(leeAvisosOcultos(a.getItem, "u1").size).toBe(0);
  });
  it("basura guardada, o un id que ya no existe, no rompen nada ni cierran lo que no se cerró", () => {
    const a = almacen();
    a.setItem(claveDeAvisosOcultos("u1"), "{no es json");
    expect(leeAvisosOcultos(a.getItem, "u1").size).toBe(0);
    a.setItem(claveDeAvisosOcultos("u1"), JSON.stringify({ atrasadas: true }));
    expect(leeAvisosOcultos(a.getItem, "u1").size).toBe(0);
    // D-459: «armar-rutas» y «ayuda-del-mapa» ya no son avisos. Quien los tenía cerrados no nota nada: se ignoran al leer.
    a.setItem(claveDeAvisosOcultos("u1"), JSON.stringify(["viejo-aviso", 7, "armar-rutas", "ayuda-del-mapa", diaVacio]));
    expect([...leeAvisosOcultos(a.getItem, "u1")]).toEqual([diaVacio]);
  });
  it("un navegador que niega el almacenamiento: nada cerrado al leer, y guardar no lanza", () => {
    const lanza = () => { throw new Error("SecurityError"); };
    expect(leeAvisosOcultos(lanza, "u1").size).toBe(0);
    expect(() => guardaAvisosOcultos(lanza, "u1", new Set([atrasadas]))).not.toThrow();
  });
  it("los ids no cambian: son lo que está guardado en los navegadores", () => {
    expect(AVISOS_DEL_GESTOR).toEqual({
      choferesSinSenal: "choferes-sin-senal", atrasadas: "atrasadas", diaVacio: "dia-vacio",
    });
  });
});

const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");

describe("la pantalla del Gestor usa lo cerrado", () => {
  const pagina = lee("src/app/(app)/routes/page.tsx");
  it("lee lo guardado de ESTA persona, y cerrar lo guarda con su id", () => {
    expect(pagina).toContain("setAvisosOcultos(leeAvisosOcultos((k) => window.localStorage.getItem(k), me.id));");
    expect(pagina).toContain("const nuevos = cierraAviso(avisosOcultos ?? new Set(), id); setAvisosOcultos(nuevos); if (me?.id) guardaAvisosOcultos(() => window.localStorage, me.id, nuevos);");
  });
  it("mientras no se ha leído lo guardado no se pinta ningún aviso (nada parpadea al recargar)", () => {
    expect(pagina).toContain("const oculto = (id: AvisoDelGestor) => avisosOcultos == null || avisosOcultos.has(id);");
  });
  it("cada aviso se esconde si está cerrado, y lleva su ✕", () => {
    expect(pagina).toContain("{trackingIssues.length > 0 && !oculto(AVISOS_DEL_GESTOR.choferesSinSenal) && (");
    expect(pagina).toContain("(pendientes.atrasadas.length + pendientes.sinFecha.length > 0) && !oculto(AVISOS_DEL_GESTOR.atrasadas) && (");
    expect(pagina).toContain("{dayOrders.length === 0 && !oculto(AVISOS_DEL_GESTOR.diaVacio) && (() => {");
    for (const id of ["choferesSinSenal", "atrasadas", "diaVacio"]) {
      expect(pagina).toContain(`<CerrarAviso aviso={AVISOS_DEL_GESTOR.${id}} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.${id})} />`);
    }
  });
  it("«Mostrar avisos ocultos» sale solo si hay algo cerrado, y lo devuelve todo (y lo borra de lo guardado) — al FONDO, no en la barra de arriba (D-459)", () => {
    expect(pagina).toContain("{avisosOcultos != null && avisosOcultos.size > 0 && ( <div style={{ textAlign: \"right\", marginTop: 18 }}> <button className=\"notif-clear\" data-mostrar-avisos-ocultos onClick={muestraAvisosOcultos} style={{ fontSize: 11 }}");
    expect(pagina).toContain("const muestraAvisosOcultos = () => { setAvisosOcultos(new Set()); if (me?.id) guardaAvisosOcultos(() => window.localStorage, me.id, new Set()); };");
    // Uno solo, y detrás de todas las tarjetas: el dueño, «osea que no aparezca eso de show hidden notices» (estaba junto a «Ocultar mapa»).
    expect(pagina.split("data-mostrar-avisos-ocultos").length - 1).toBe(1);
    expect(pagina.indexOf("data-mostrar-avisos-ocultos")).toBeGreaterThan(pagina.indexOf("{!ready && <div className=\"empty\">"));
    const barra = pagina.slice(pagina.indexOf("{/* ---------- Layout toolbar ---------- */}"), pagina.indexOf("{/* ---------- Driver panel + map ---------- */}"));
    expect(barra).toContain("Hide map & drivers");
    for (const fuera of ["avisosOcultos", "setWideRoutes", "Show hidden notices"]) expect(barra, fuera).not.toContain(fuera);
  });
  it("D-459: «Armar rutas» es UN botón, el de la cabecera, que abre y cierra el panel; ya no es un aviso que se cierra", () => {
    expect(pagina).toContain("{puedeArmarRutas && ( <button className=\"btn btn-primary btn-sm\" data-armar-rutas aria-expanded={planAbierto} onClick={() => setPlanAbierto((v) => !v)}");
    expect(pagina).toContain("{puedeArmarRutas && ( <PlanDelDia date={date} onPublicado={() => setPublicaciones((n) => n + 1)} abierto={planAbierto} onCerrar={() => setPlanAbierto(false)} onEstado={setEstadoPlan} onAbrirOrden={(id) => { const d = deliveries.find((x) => x.id === id.split(\"#\")[0]); if (d) setOpenOrder(d); }} columnas={{");
    for (const muerto of ["planTraidoAMano", "barraDeArmarRutas", "data-traer-armar-rutas", "AVISOS_DEL_GESTOR.armarRutas", "AVISOS_DEL_GESTOR.ayudaDelMapa"]) expect(pagina, muerto).not.toContain(muerto);
    // Los mismos que antes pueden planear: admin y logística, con un día concreto.
    // Puesto al día por D-481: y nunca en «Ruta de hoy» (el Gestor en solo lectura).
    expect(pagina).toContain("const puedeArmarRutas = !soloLectura && !allDates && !soloPendientes && !!me && [\"admin\", \"logistics\"].includes(me.role);");
  });
});

describe("D-459: el panel de «Armar las rutas» no tiene tarjeta plegada ni ✕; lo abre y lo cierra la página", () => {
  const plan = lee("src/components/PlanDelDia.tsx");
  it("cerrado no pinta nada; abierto, su título lo cierra; y no guarda él si está abierto", () => {
    expect(plan).toContain("if (!abierto) return null;");
    expect(plan).toContain("data-cerrar-el-plan aria-expanded onClick={onCerrar}");
    for (const muerto of ["CerrarAviso", "AVISOS_DEL_GESTOR", "naceAbierto", "setAbierto", "data-abrir-armar-rutas"]) expect(plan, muerto).not.toContain(muerto);
  });
});

describe("la ✕ se anuncia en los dos idiomas", () => {
  const boton = lee("src/components/CerrarAviso.tsx");
  it("aria-label con inglés y español, y el clic no llega al contenedor", () => {
    expect(boton).toContain("t(\"Close this notice — it won't show again\", \"Cerrar este aviso — no volverá a salir\")");
    expect(boton).toContain("aria-label={etiqueta}");
    expect(boton).toContain("onClick={(e) => { e.stopPropagation(); onCerrar(); }}");
  });
});
