import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DICT } from "@/lib/timetracker/i18n";
import { APP_SETTINGS, syncAppSettings } from "@/lib/timetracker/helpers";
import {
  ETIQUETAS_DE_PUESTO, PUESTO_POR_DEFECTO, campoDeProyecto, elegirPuesto, elegirTienda, etiquetaDePuesto,
  necesitaProyecto, nombreDeLinea, resolverTiendaYPuesto, seOfreceParaAsignar, tiendaYPuesto,
} from "./tienda-y-puesto";

// D-NEXT. El dueño, 2026-10-07: «la gente que está presencial, no ocupa que se les asignen proyectos
// […] el proyecto de ellos prácticamente es la tienda y el puesto que ellos tienen». La regla pura y,
// leyendo el fuente, que cada pantalla que pedía, avisaba o listaba un proyecto la USA.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");

const presencial = { workerType: "inhouse" as const, tienda: "Pharr", puesto: "sales" };
const remoto = { workerType: "remote" as const, tienda: "Pharr", puesto: "sales" };
const porDefecto = { workerType: null, tienda: "Pharr", puesto: "sales" };

const defectoOriginal = APP_SETTINGS.defaultWorkerType;
afterEach(() => syncAppSettings({ defaultWorkerType: defectoOriginal }));

describe("la regla: al presencial no se le pide proyecto; al remoto sí", () => {
  it("el presencial no necesita proyecto", () => {
    expect(necesitaProyecto(presencial)).toBe(false);
  });
  it("el remoto sí, como siempre", () => {
    expect(necesitaProyecto(remoto)).toBe(true);
  });
  it("sin tipo elegido manda el de la empresa (hoy remoto) — y si la empresa dijera presencial, presencial", () => {
    expect(necesitaProyecto(porDefecto)).toBe(true);
    expect(necesitaProyecto(null)).toBe(true);
    syncAppSettings({ defaultWorkerType: "inhouse" });
    expect(necesitaProyecto(porDefecto)).toBe(false);
  });
});

describe("de dónde sale la tienda y el puesto", () => {
  it("la tienda: la de fichaje primero; sin ella, la del hub; vacío cuenta como no tener", () => {
    expect(elegirTienda("Pharr", "RDZ Pharr")).toBe("Pharr");
    expect(elegirTienda(null, "RDZ Pharr")).toBe("RDZ Pharr");
    expect(elegirTienda("  ", "RDZ Pharr")).toBe("RDZ Pharr");
    expect(elegirTienda(null, "")).toBeNull();
    expect(elegirTienda(undefined, undefined)).toBeNull();
  });
  it("el puesto: el de fichaje; sin poner, el que enseña la ficha de Usuarios (Ventas); sin ficha, ninguno", () => {
    expect(elegirPuesto(true, "office")).toBe("office");
    expect(elegirPuesto(true, null)).toBe("sales");
    expect(elegirPuesto(true, "")).toBe(PUESTO_POR_DEFECTO);
    expect(elegirPuesto(false, null)).toBeNull();
    expect(elegirPuesto(false, "office")).toBeNull();
  });
  it("desde las filas de la base: la tienda por su store_id, y la del hub si el store_id no lleva a ninguna", () => {
    const tiendas = new Map([["s1", "Pharr"], ["s2", "Brownsville"]]);
    expect(resolverTiendaYPuesto({ fichaje: { store_id: "s2", position: "office" }, tiendas, tiendaDelHub: "RDZ Pharr" }))
      .toEqual({ tienda: "Brownsville", puesto: "office" });
    expect(resolverTiendaYPuesto({ fichaje: { store_id: null, position: null }, tiendas, tiendaDelHub: "RDZ Pharr" }))
      .toEqual({ tienda: "RDZ Pharr", puesto: "sales" });
    expect(resolverTiendaYPuesto({ fichaje: { store_id: "borrada", position: "warehouse" }, tiendas, tiendaDelHub: null }))
      .toEqual({ tienda: null, puesto: "warehouse" });
    expect(resolverTiendaYPuesto({ fichaje: null, tiendas, tiendaDelHub: null })).toEqual({ tienda: null, puesto: null });
  });
});

describe("la etiqueta «tienda · puesto»", () => {
  it("los puestos con el texto de la ficha de Usuarios, en los dos idiomas", () => {
    expect(etiquetaDePuesto("sales", "es")).toBe("Ventas");
    expect(etiquetaDePuesto("sales", "en")).toBe("Sales");
    expect(etiquetaDePuesto("office", "es")).toBe("Oficina");
    expect(etiquetaDePuesto("warehouse", "es")).toBe("Almacén");
    expect(etiquetaDePuesto("raro", "es")).toBe("raro");
    expect(etiquetaDePuesto(null, "es")).toBeNull();
  });
  it("«Pharr · Ventas», y con una sola de las dos, esa", () => {
    expect(tiendaYPuesto({ tienda: "Pharr", puesto: "sales" }, "es")).toBe("Pharr · Ventas");
    expect(tiendaYPuesto({ tienda: "RDZ Pharr", puesto: "office" }, "en")).toBe("RDZ Pharr · Office");
    expect(tiendaYPuesto({ tienda: "Pharr", puesto: null }, "es")).toBe("Pharr");
    expect(tiendaYPuesto({ tienda: null, puesto: "sales" }, "es")).toBe("Ventas");
  });
  it("sin ninguna de las dos lo dice, en vez de dejar el hueco", () => {
    expect(tiendaYPuesto({ tienda: null, puesto: null }, "es")).toBe("Presencial — sin tienda ni puesto");
    expect(tiendaYPuesto({}, "en")).toBe("In-house — no store or position set");
  });
});

describe("el nombre de una línea de horas en un listado por proyecto", () => {
  it("con proyecto, el proyecto — también si es de un presencial", () => {
    expect(nombreDeLinea("Proyecto X", remoto, "es", "—")).toBe("Proyecto X");
    expect(nombreDeLinea("Proyecto X", presencial, "es", "—")).toBe("Proyecto X");
  });
  it("sin proyecto y presencial: su tienda y su puesto", () => {
    expect(nombreDeLinea(null, presencial, "es", "(eliminado)")).toBe("Pharr · Ventas");
    expect(nombreDeLinea(undefined, presencial, "en", "(deleted)")).toBe("Pharr · Sales");
  });
  it("sin proyecto y remoto: lo de siempre, no cambia nada", () => {
    expect(nombreDeLinea(null, remoto, "es", "(eliminado)")).toBe("(eliminado)");
    expect(nombreDeLinea("", remoto, "en", "—")).toBe("—");
    expect(nombreDeLinea(null, undefined, "es", "—")).toBe("—");
  });
});

describe("el campo «Proyecto» al pedir o añadir tiempo, y quién se ofrece para asignar", () => {
  it("al remoto, obligatorio aunque no tenga ninguno (le sigue saliendo «Elige un proyecto»)", () => {
    expect(campoDeProyecto(remoto, 0)).toBe("obligatorio");
    expect(campoDeProyecto(remoto, 2)).toBe("obligatorio");
  });
  it("al presencial sin proyectos, fijo: nada que elegir", () => {
    expect(campoDeProyecto(presencial, 0)).toBe("fijo");
  });
  it("al presencial con alguno, opcional", () => {
    expect(campoDeProyecto(presencial, 1)).toBe("opcional");
  });
  it("«Nueva asignación» ofrece al remoto y no al presencial, salvo al editar la suya", () => {
    expect(seOfreceParaAsignar({ ...remoto, id: "r" }, null)).toBe(true);
    expect(seOfreceParaAsignar({ ...presencial, id: "p" }, null)).toBe(false);
    expect(seOfreceParaAsignar({ ...presencial, id: "p" }, "otro")).toBe(false);
    expect(seOfreceParaAsignar({ ...presencial, id: "p" }, "p")).toBe(true);
  });
});

// ---- Quien llama -------------------------------------------------------------------------------

describe("Usuarios y Time Tracker dicen lo mismo del puesto", () => {
  const ficha = leer("src/components/ClockinSettings.tsx");
  it("la ficha pinta el puesto vacío con PUESTO_POR_DEFECTO y los textos de ETIQUETAS_DE_PUESTO", () => {
    expect(ficha).toContain("value={s.position ?? PUESTO_POR_DEFECTO}");
    expect(ficha).toContain("const POSITION_LABELS = ETIQUETAS_DE_PUESTO;");
    expect(ficha).not.toContain('s.position ?? "sales"');
    expect(Object.keys(ETIQUETAS_DE_PUESTO)).toEqual(["office", "sales", "warehouse", "manager", "owner"]);
  });
});

describe("de dónde lee cada vista la tienda y el puesto", () => {
  it("el layout (la propia persona): su ficha de fichaje, las tiendas y profiles.store, por resolverTiendaYPuesto", () => {
    const layout = leer("src/app/timetracker/(timetracker)/layout.tsx");
    expect(layout).toContain('.select("id, full_name, role, avatar_url, timetracker_role, module_access, store")');
    expect(layout).toContain('supabase.schema("clockin").from("employee_settings").select("store_id, position").eq("id", user.id).maybeSingle()');
    expect(layout).toContain('supabase.schema("clockin").from("job_sites").select("id, name")');
    expect(layout).toContain("tiendaDelHub: profile.store,");
    expect(layout).toMatch(/deletedAt: es\?\.deleted_at \?\? null,\n\s*tienda,\n\s*puesto,/);
  });
  it("el proveedor (todas, para el gerente): la misma regla con las fichas de todos", () => {
    const prov = leer("src/lib/timetracker-data-provider.tsx");
    expect(prov).toContain('.select("id, full_name, timetracker_role, store")');
    expect(prov).toContain('supabase.schema("clockin").from("employee_settings").select("id, store_id, position")');
    expect(prov).toContain("...resolverTiendaYPuesto({ fichaje: fichaPorId.get(p.id), tiendas: nombreDeTienda, tiendaDelHub: p.store }),");
  });
});

describe("Registrar tiempo: ni aviso de proyecto ni cronómetro por delante para el presencial", () => {
  const crono = leer("src/components/timetracker/Cronometro.tsx");
  it("el aviso «pídele a tu gerente que te asigne uno» solo sale a quien necesita proyecto", () => {
    expect(crono).toContain("{assignments.length === 0 && necesitaProyecto(me) && (");
    expect(crono).toContain('<div className="banner info">{t("track.noProjects")}</div>');
  });
  it("un admin presencial abre en su reloj de fichaje; el remoto, en el cronómetro", () => {
    expect(crono).toContain('useState<"timer" | "punch">(() => (necesitaProyecto(me) ? "timer" : "punch"))');
  });
});

describe("Mis solicitudes › Tiempo: al presencial no se le pide proyecto", () => {
  const sol = leer("src/app/timetracker/(timetracker)/requests/page.tsx");
  it("el campo lo decide campoDeProyecto con sus proyectos", () => {
    expect(sol).toContain("const campo = campoDeProyecto(me, assignments.length);");
  });
  it("«Elige un proyecto» solo cuando es obligatorio", () => {
    expect(sol).toContain('if (!f.assignmentId && campo === "obligatorio") { setMsg(t("emp.req.pickProject")); return; }');
  });
  it("sin proyecto elegido, la solicitud va sin proyecto (null), no con uno inventado", () => {
    expect(sol).toContain("const a = f.assignmentId ? aMap.get(f.assignmentId) : undefined;");
    expect(sol).toContain("projectId: a ? a.projectId : null, assignmentId: a ? a.id : null,");
  });
  it("fijo: se dice su tienda y su puesto en vez de un desplegable; opcional: es la primera opción", () => {
    expect(sol).toContain('{campo === "fijo" ? (');
    expect(sol).toContain('<div style={{ padding: "8px 0", fontWeight: 700 }}>{t("emp.req.yourStore", { label: miTienda })}</div>');
    expect(sol).toContain('{campo === "opcional" ? t("emp.req.yourStore", { label: miTienda }) : t("emp.req.pick")}');
    expect(sol).toContain('{campo !== "obligatorio" && <div className="hint">{t("emp.req.inhouseHint")}</div>}');
    expect(sol).toContain("const miTienda = tiendaYPuesto(me, lang);");
  });
  it("en la lista de solicitudes y al elegir una entrada, su tienda y su puesto donde iba el proyecto", () => {
    expect(sol).toContain("nombreDeLinea(aMap.get(typeof aid === \"string\" ? aid : \"\")?.project.name, me, lang, sinProyecto);");
    expect(sol).toContain('const proj = nombreDelProyecto(p.assignmentId, "");');
    expect(sol.split('{nombreDelProyecto(s.assignmentId, "—")}').length - 1).toBe(2);
  });
});

describe("Solicitudes del equipo: la del presencial sale con su tienda y su puesto", () => {
  const eq = leer("src/app/timetracker/(timetracker)/team-requests/page.tsx");
  it("projName mira a la persona que pidió", () => {
    expect(eq).toContain('return nombreDeLinea(a ? pMap.get(a.projectId)?.name : null, uMap.get(uid), lang, "—");');
    expect(eq.split("projName(p.assignmentId as string, r.employeeUid)").length - 1).toBe(2);
  });
});

describe("Mi semana: sus horas sin proyecto, bajo su tienda y su puesto", () => {
  const sem = leer("src/app/timetracker/(timetracker)/week/page.tsx");
  it("la tabla por proyecto y las entradas del día", () => {
    expect(sem).toContain('const proj = { name: nombreDeLinea(a?.project.name, me, lang, t("emp.week.deletedProject")) };');
    expect(sem).toContain('const projectName = (a: Assignment | undefined) => nombreDeLinea(a?.project.name, me, lang, "—");');
  });
});

describe("Nómina › Remoto (tabla, detalle, CSV, recibo y «Agregar entrada»)", () => {
  const rep = leer("src/components/timetracker/ManagerReports.tsx");
  it("cada línea se nombra con nombreDeLinea y la persona de la fila", () => {
    expect(rep).toContain("nombreDeLinea(a ? pMap.get(a.projectId)?.name : null, uMap.get(uid), lang, sinProyecto);");
    // Dos veces: la tabla del grupo y el recibo.
    expect(rep.split('<td>{nombreDe(l.a, uid, "(deleted)")}</td>').length - 1).toBe(2);
    expect(rep).toContain('const proj = nombreDeLinea(s.projectId ? pMap.get(s.projectId)?.name : null, uMap.get(s.employeeUid), lang, "—");');
  });
  it("el CSV y el recibo: nombre y lugar (la tienda del presencial)", () => {
    expect(rep).toContain('status, nombreDe(l.a, uid, "(deleted)"), lugarDe(l.a, uid), (l.g.sec / 3600).toFixed(2),');
    expect(rep).toContain('<td>{nombreDe(l.a, uid, "(deleted)")}</td><td>{lugarDe(l.a, uid) || "—"}</td>');
    expect(rep).toContain('return u && !necesitaProyecto(u) ? u.tienda ?? "" : "";');
  });
  it("«Agregar entrada» no exige proyecto al presencial y la guarda sin él", () => {
    expect(rep).toContain("if ((!nadd.assignmentId && necesitaProyecto(emp)) || !nadd.from || !nadd.to) { alert(t(\"mgr.rep.addPrompt\")); return; }");
    expect(rep).toContain("projectId: a ? a.projectId : null, assignmentId: a ? a.id : null,");
    expect(rep).toContain('{necesitaProyecto(uMap.get(uid)) ? t("mgr.rep.projectOpt") : t("mgr.rep.inhouseOpt", { label: tiendaYPuesto(uMap.get(uid)!, lang) })}');
  });
});

describe("Nómina › En sitio: al lado del nombre, su puesto (la tienda ya es el grupo)", () => {
  const ts = leer("src/components/timetracker/PayrollTimesheets.tsx");
  it("solo al presencial", () => {
    expect(ts).toContain("return u && !necesitaProyecto(u) ? etiquetaDePuesto(u.puesto, lang) : null;");
    expect(ts).toContain('{puestoDe(id) && <span className="muted small"> · {puestoDe(id)}</span>}');
  });
});

describe("El Panel (proyectos principales) y Ahora mismo", () => {
  it("el Panel cuenta las horas del presencial sin proyecto bajo su tienda y su puesto", () => {
    const ins = leer("src/app/timetracker/(timetracker)/insights/page.tsx");
    expect(ins).toContain('const name = nombreDeLinea(proj, u, lang, "(deleted)");');
    expect(ins).toContain('const key = !proj && u && !necesitaProyecto(u) ? "t:" + name : "p:" + (s.projectId ?? "");');
  });
  it("Ahora mismo: la tarjeta del que ficha lleva su tienda y su puesto donde la del remoto lleva el proyecto", () => {
    const live = leer("src/app/timetracker/(timetracker)/live/page.tsx");
    expect(live).toContain('<div className="live-sub">{emp && !necesitaProyecto(emp) ? tiendaYPuesto(emp, lang) : "\\u00a0"}</div>');
    expect(live).toContain('<div className="live-sub">{nombreDeLinea(proj?.name, emp, lang, "—")}');
  });
});

describe("Asignaciones: el presencial, marcado y sin ofrecerlo", () => {
  const asn = leer("src/components/timetracker/AssignmentsPanel.tsx");
  it("el desplegable de «Nueva asignación» solo lista a quien se le ofrece", () => {
    expect(asn).toContain("const asignables = users.filter((u) => seOfreceParaAsignar(u, editandoA));");
    expect(asn).toContain("{asignables.map((u) => <option key={u.id} value={u.id}>");
    expect(asn).not.toContain("{users.map((u) => <option");
  });
  it("al editar, cuenta la persona de la asignación que se edita", () => {
    expect(asn).toContain("const editandoA = editId ? assignments.find((a) => a.id === editId)?.employeeUid ?? null : null;");
  });
  it("los presenciales salen aparte, con «Presencial — su tienda y su puesto» y la etiqueta de cada uno", () => {
    expect(asn).toContain("const presenciales = users.filter((u) => !necesitaProyecto(u));");
    expect(asn).toContain('<h2 style={{ marginTop: 0 }}>{t("mgr.asn.inhouseTitle")}</h2>');
    expect(asn).toContain("<td>{tiendaYPuesto(u, lang)}</td>");
    expect(asn).toContain('<th>{t("mgr.asn.colStore")}</th>');
    expect(DICT.es["mgr.asn.inhouseTitle"]).toBe("Presencial — su tienda y su puesto");
  });
  it("una asignación que ya tuviera un presencial se marca, no se esconde", () => {
    expect(asn).toContain("{uMap.has(a.employeeUid) && !necesitaProyecto(uMap.get(a.employeeUid)) && (");
    // `.pill on` y no `.live-tag`: la global de Entregas late con opacidad (parecería apagada, D-489).
    expect(asn).toContain('<span className="pill on" style={{ marginLeft: 6 }}>{t("mgr.asn.inhousePill")}</span>');
  });
});

describe("los textos nuevos, en los dos idiomas", () => {
  it("existen en en y es, y son distintos", () => {
    for (const k of ["emp.req.yourStore", "emp.req.inhouseHint", "mgr.asn.inhouseTitle", "mgr.asn.inhouseNote", "mgr.asn.inhousePill", "mgr.asn.colStore", "mgr.rep.inhouseOpt"]) {
      expect(DICT.en[k], `falta ${k} en inglés`).toBeDefined();
      expect(DICT.es[k], `falta ${k} en español`).toBeDefined();
      expect(DICT.en[k]).not.toBe(DICT.es[k]);
    }
  });
});
