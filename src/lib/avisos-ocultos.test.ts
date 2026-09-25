import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVISOS_DEL_GESTOR, cierraAviso, claveDeAvisosOcultos, guardaAvisosOcultos, leeAvisosOcultos, type AvisoDelGestor } from "./avisos-ocultos";

/** Las ✕ de los avisos del Gestor de Rutas (D-NEXT): cerrados para siempre, por persona, y recuperables. */

const almacen = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const { armarRutas, choferesSinSenal, atrasadas, diaVacio, ayudaDelMapa } = AVISOS_DEL_GESTOR;

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
    const antes = new Set<AvisoDelGestor>([armarRutas]);
    const despues = cierraAviso(antes, atrasadas);
    expect([...despues].sort()).toEqual([armarRutas, atrasadas].sort());
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
    a.setItem(claveDeAvisosOcultos("u1"), JSON.stringify(["viejo-aviso", 7, ayudaDelMapa]));
    expect([...leeAvisosOcultos(a.getItem, "u1")]).toEqual([ayudaDelMapa]);
  });
  it("un navegador que niega el almacenamiento: nada cerrado al leer, y guardar no lanza", () => {
    const lanza = () => { throw new Error("SecurityError"); };
    expect(leeAvisosOcultos(lanza, "u1").size).toBe(0);
    expect(() => guardaAvisosOcultos(lanza, "u1", new Set([atrasadas]))).not.toThrow();
  });
  it("los ids no cambian: son lo que está guardado en los navegadores", () => {
    expect(AVISOS_DEL_GESTOR).toEqual({
      armarRutas: "armar-rutas", choferesSinSenal: "choferes-sin-senal", atrasadas: "atrasadas", diaVacio: "dia-vacio", ayudaDelMapa: "ayuda-del-mapa",
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
    expect(pagina).toContain("{!oculto(AVISOS_DEL_GESTOR.ayudaDelMapa) && (");
    for (const id of ["choferesSinSenal", "atrasadas", "diaVacio", "ayudaDelMapa"]) {
      expect(pagina).toContain(`<CerrarAviso aviso={AVISOS_DEL_GESTOR.${id}} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.${id})} />`);
    }
  });
  it("«Mostrar avisos ocultos» sale solo si hay algo cerrado, y lo devuelve todo (y lo borra de lo guardado)", () => {
    expect(pagina).toContain("{avisosOcultos != null && avisosOcultos.size > 0 && ( <button className=\"btn btn-ghost btn-sm\" data-mostrar-avisos-ocultos onClick={muestraAvisosOcultos}");
    expect(pagina).toContain("const muestraAvisosOcultos = () => { setAvisosOcultos(new Set()); setPlanTraidoAMano(false); if (me?.id) guardaAvisosOcultos(() => window.localStorage, me.id, new Set()); };");
  });
  it("con la barra «Armar las rutas» cerrada, la acción sigue en la cabecera y la trae abierta", () => {
    expect(pagina).toContain("const barraDeArmarRutas = puedeArmarRutas && (!oculto(AVISOS_DEL_GESTOR.armarRutas) || planTraidoAMano);");
    expect(pagina).toContain("{puedeArmarRutas && avisosOcultos != null && !barraDeArmarRutas && ( <button className=\"btn btn-ghost btn-sm\" data-traer-armar-rutas onClick={() => setPlanTraidoAMano(true)}");
    expect(pagina).toContain("{barraDeArmarRutas && ( <PlanDelDia date={date} onPublicado={() => setPublicaciones((n) => n + 1)} naceAbierto={planTraidoAMano} onCerrar={() => { setPlanTraidoAMano(false); cierraAvisoDelGestor(AVISOS_DEL_GESTOR.armarRutas); }} /> )}");
    // Los mismos que antes pueden planear: admin y logística, con un día concreto.
    expect(pagina).toContain("const puedeArmarRutas = !allDates && !soloPendientes && !!me && [\"admin\", \"logistics\"].includes(me.role);");
  });
});

describe("la barra de «Armar las rutas» lleva su ✕, plegada y desplegada", () => {
  const plan = lee("src/components/PlanDelDia.tsx");
  it("la ✕ sale en los dos estados, y nace abierta si se trae desde la cabecera", () => {
    expect(plan.split("{onCerrar && <CerrarAviso aviso={AVISOS_DEL_GESTOR.armarRutas} onCerrar={onCerrar} />}").length - 1).toBe(2);
    expect(plan).toContain("const [abierto, setAbierto] = useState(naceAbierto);");
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
