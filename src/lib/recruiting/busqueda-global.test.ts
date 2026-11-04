import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATOS, MAX_EMPLEADOS, PARAM_FICHA, aEncontrado, agrupaResultados, buscaCandidatos, buscaEmpleados,
  cabeceraDeGrupo, destinoDeResultado, detalleDeEmpleado, etiquetaDeTipo, fichaPedida, placeholderDelBuscador,
  puedeBuscarEmpleados, type CandidatoParaBuscar, type EmpleadoParaBuscar,
} from "@/lib/recruiting/busqueda-global";

const es = (_en: string, es: string) => es;
const en = (en: string) => en;
const HOY = "2026-11-04";

const cand = (id: string, name: string, extra: Partial<CandidatoParaBuscar> = {}): CandidatoParaBuscar => ({
  id, name, phone: "", email: null, role: null, tags: [], extra_phones: [], extra_emails: [], pinned: false, ...extra,
});
const emp = (id: string, full_name: string, extra: Partial<EmpleadoParaBuscar> = {}): EmpleadoParaBuscar => ({
  id, full_name, job_title: null, department: null, store: null, phone: null, ringcentral_ext: null, email: null,
  personal_email: null, employee_code: null, date_left: null, ...extra,
});

describe("buscador de la barra: quién busca empleados", () => {
  it("exactamente quien ve la pestaña Empleados: admin y gerente; no el reclutador ni el gerente de tienda", () => {
    expect(puedeBuscarEmpleados("admin")).toBe(true);
    expect(puedeBuscarEmpleados("manager")).toBe(true);
    expect(puedeBuscarEmpleados("recruiter")).toBe(false);
    expect(puedeBuscarEmpleados("store_manager")).toBe(false);
    expect(puedeBuscarEmpleados("")).toBe(false);
    expect(puedeBuscarEmpleados(null)).toBe(false);
    expect(puedeBuscarEmpleados(undefined)).toBe(false);
  });

  it("el texto del cuadro dice «y empleados» solo a quien los va a encontrar", () => {
    expect(placeholderDelBuscador(true, es)).toBe("🔍 Buscar candidatos y empleados…  ( / )");
    expect(placeholderDelBuscador(true, en)).toBe("🔍 Search candidates and employees…  ( / )");
    expect(placeholderDelBuscador(false, es)).toBe("🔍 Buscar candidatos…  ( / )");
  });
});

describe("buscador de la barra: candidatos (el filtro de siempre)", () => {
  const lista = [
    cand("c1", "Ana Pérez", { phone: "956-555-0101", tags: ["bilingüe"] }),
    cand("c2", "Beto Ana", { pinned: true, email: "beto@x.com" }),
    cand("c3", "Carla Ruiz", { role: "Cajera", extra_phones: ["956 777 1234"] }),
  ];
  it("nombre, correo, vacante, etiquetas y teléfonos; los fijados primero", () => {
    expect(buscaCandidatos(lista, "ana").map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(buscaCandidatos(lista, "BETO@X").map((c) => c.id)).toEqual(["c2"]);
    expect(buscaCandidatos(lista, "cajera").map((c) => c.id)).toEqual(["c3"]);
    expect(buscaCandidatos(lista, "bilingüe").map((c) => c.id)).toEqual(["c1"]);
    expect(buscaCandidatos(lista, "9565550101").map((c) => c.id)).toEqual(["c1"]);
    expect(buscaCandidatos(lista, "777 1234").map((c) => c.id)).toEqual(["c3"]);
  });
  it("vacío no busca, y hay tope", () => {
    expect(buscaCandidatos(lista, "   ")).toEqual([]);
    const muchos = Array.from({ length: 20 }, (_, i) => cand("x" + i, "Zoe " + i));
    expect(buscaCandidatos(muchos, "zoe")).toHaveLength(MAX_CANDIDATOS);
  });
});

describe("buscador de la barra: empleados", () => {
  const lista = [
    emp("e1", "Ana Núñez", { job_title: "Cajera", store: "RDZ Edinburg", phone: "956-555-0101", employee_code: "RT-042" }),
    emp("e2", "Ana Baja", { date_left: "2026-10-01", personal_email: "ana.baja@gmail.com" }),
    emp("e3", "Beto Ruiz", { department: "Ventas", ringcentral_ext: "204", email: "beto@rtg.com" }),
  ];
  it("lo mismo que la caja de Empleados, sin acentos; más el número de empleado y el teléfono por dígitos", () => {
    expect(buscaEmpleados(lista, "nunez", undefined, HOY).map((e) => e.id)).toEqual(["e1"]);
    expect(buscaEmpleados(lista, "edinburg", undefined, HOY).map((e) => e.id)).toEqual(["e1"]);
    expect(buscaEmpleados(lista, "ventas", undefined, HOY).map((e) => e.id)).toEqual(["e3"]);
    expect(buscaEmpleados(lista, "204", undefined, HOY).map((e) => e.id)).toEqual(["e3"]);
    expect(buscaEmpleados(lista, "gmail", undefined, HOY).map((e) => e.id)).toEqual(["e2"]);
    expect(buscaEmpleados(lista, "rt-042", undefined, HOY).map((e) => e.id)).toEqual(["e1"]);
    expect(buscaEmpleados(lista, "9565550101", undefined, HOY).map((e) => e.id)).toEqual(["e1"]);
    expect(buscaEmpleados(lista, "zzz", undefined, HOY)).toEqual([]);
    expect(buscaEmpleados(lista, "  ", undefined, HOY)).toEqual([]);
  });
  it("los activos antes que las bajas, y hay tope", () => {
    const orden = [lista[1], lista[0]];
    expect(buscaEmpleados(orden, "ana", undefined, HOY).map((e) => e.id)).toEqual(["e1", "e2"]);
    const muchos = Array.from({ length: 20 }, (_, i) => emp("x" + i, "Zoe " + i));
    expect(buscaEmpleados(muchos, "zoe", undefined, HOY)).toHaveLength(MAX_EMPLEADOS);
  });
  it("al navegador viaja solo lo que se pinta: ni correos, ni extensión, ni número", () => {
    const fuera = aEncontrado(lista[1]);
    expect(Object.keys(fuera).sort()).toEqual(["date_left", "full_name", "id", "job_title", "phone", "store"]);
    expect(JSON.stringify(fuera)).not.toContain("gmail");
  });
  it("la segunda línea: puesto · tienda · teléfono, y «Baja» delante si ya se fue", () => {
    // D-850: el teléfono guardado de antes («956-555-0101») sale en la forma única del hub.
    expect(detalleDeEmpleado(lista[0], es, HOY)).toBe("Cajera · RDZ Edinburg · (956) 555-0101");
    expect(detalleDeEmpleado(lista[1], es, HOY)).toBe("Baja");
    expect(detalleDeEmpleado(lista[1], en, HOY)).toBe("Left");
    expect(detalleDeEmpleado(emp("e9", "X", { date_left: "2099-01-01", job_title: "Chofer" }), es, HOY)).toBe("Chofer");
  });
});

describe("buscador de la barra: grupos, etiquetas y destino", () => {
  const c = [cand("c1", "Ana"), cand("c2", "Ana B")];
  const e = [aEncontrado(emp("e1", "Ana N"))];

  it("dos grupos, candidatos primero; la lista plana de las flechas sigue el mismo orden", () => {
    const { grupos, planos } = agrupaResultados(c, e);
    expect(grupos.map((g) => [g.tipo, g.desde, g.items.length])).toEqual([["candidato", 0, 2], ["empleado", 2, 1]]);
    expect(planos.map((r) => r.tipo + ":" + r.id)).toEqual(["candidato:c1", "candidato:c2", "empleado:e1"]);
    // Cada grupo, desde su `desde`, es el mismo trozo de la lista plana.
    for (const g of grupos) expect(planos.slice(g.desde, g.desde + g.items.length)).toEqual(g.items);
  });
  it("un grupo vacío no se pinta", () => {
    expect(agrupaResultados([], e).grupos.map((g) => [g.tipo, g.desde])).toEqual([["empleado", 0]]);
    expect(agrupaResultados(c, []).grupos.map((g) => g.tipo)).toEqual(["candidato"]);
    expect(agrupaResultados([], [])).toEqual({ grupos: [], planos: [] });
  });
  it("cada fila y cada grupo dicen qué es, en los dos idiomas", () => {
    expect(etiquetaDeTipo("candidato", es)).toBe("Candidato");
    expect(etiquetaDeTipo("empleado", es)).toBe("Empleado");
    expect(etiquetaDeTipo("candidato", en)).toBe("Candidate");
    expect(etiquetaDeTipo("empleado", en)).toBe("Employee");
    expect(cabeceraDeGrupo("candidato", 2, es)).toBe("Candidatos · 2");
    expect(cabeceraDeGrupo("empleado", 1, en)).toBe("Employees · 1");
  });
  it("el candidato abre su perfil; el empleado, su ficha en Empleados", () => {
    expect(destinoDeResultado({ tipo: "candidato", id: "c1" })).toEqual({ tipo: "perfil", id: "c1" });
    expect(destinoDeResultado({ tipo: "empleado", id: "e 1/x" })).toEqual({ tipo: "ruta", href: "/recruiting/employees?ficha=e%201%2Fx" });
  });
  it("Empleados lee de la URL la ficha que pidió el buscador", () => {
    const href = (destinoDeResultado({ tipo: "empleado", id: "e 1/x" }) as { href: string }).href;
    expect(fichaPedida(new URLSearchParams(href.split("?")[1]))).toBe("e 1/x");
    expect(fichaPedida(new URLSearchParams(PARAM_FICHA + "=%20"))).toBeNull();
    expect(fichaPedida(new URLSearchParams(""))).toBeNull();
    expect(fichaPedida(null)).toBeNull();
  });
});
