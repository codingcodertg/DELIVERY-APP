import { describe, it, expect } from "vitest";
import {
  coincidePuesto, contieneMarcadores, documentosParaEmpleado, estadoAlSubirFirmado, extensionPermitida, filtraDocumentos,
  fechaLarga, mapaDeMarcadores, marcadoresEn, mimePorNombre, puedeCambiarEstado, rutaDeFirmado, rutaDeVariante,
  rutaPermitida, sanitizaNombreDeArchivo, varianteMarcada, varianteSugerida, EXTENSIONES_VARIANTE,
} from "./plantillas-de-documentos";

const EMP = "3f2c9d1e-8a4b-4c6d-9e0f-1234567890ab";
const TPL = "7a1b2c3d-4e5f-4a6b-8c7d-0123456789ab";

describe("sanitizaNombreDeArchivo", () => {
  it("quita acentos y espacios, y deja la extensión en minúsculas", () => {
    expect(sanitizaNombreDeArchivo("Política de comisiones (2026) final.DOCX")).toBe("Politica-de-comisiones-2026-final.docx");
  });
  it("no deja rutas: el directorio se tira, así que «../» no llega al cubo", () => {
    expect(sanitizaNombreDeArchivo("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizaNombreDeArchivo("C:\\temp\\..\\manual.pdf")).toBe("manual.pdf");
  });
  it("si no queda nada usable, «archivo» conservando la extensión", () => {
    expect(sanitizaNombreDeArchivo("???.pdf")).toBe("archivo.pdf");
    expect(sanitizaNombreDeArchivo("")).toBe("archivo");
  });
  it("acota el largo del nombre base", () => {
    const r = sanitizaNombreDeArchivo("a".repeat(300) + ".pdf");
    expect(r.endsWith(".pdf")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(104);
  });
  it("sin puntos dobles ni puntos o guiones en los bordes", () => {
    expect(sanitizaNombreDeArchivo("..hola..pdf")).not.toContain("..");
    expect(sanitizaNombreDeArchivo("-raro-.pdf")).toBe("raro.pdf");
  });
});

describe("extensiones, MIME y rutas", () => {
  it("acepta solo las extensiones de la lista", () => {
    expect(extensionPermitida("politica.docx", EXTENSIONES_VARIANTE)).toBe(true);
    expect(extensionPermitida("politica.XLSX", EXTENSIONES_VARIANTE)).toBe(true);
    expect(extensionPermitida("politica.exe", EXTENSIONES_VARIANTE)).toBe(false);
    expect(extensionPermitida("politica", EXTENSIONES_VARIANTE)).toBe(false);
  });
  it("el MIME sale de la extensión, no de lo que diga el navegador", () => {
    expect(mimePorNombre("a.pdf")).toBe("application/pdf");
    expect(mimePorNombre("a.bin")).toBe("application/octet-stream");
  });
  it("la ruta de la variante lleva id, versión y nombre limpio", () => {
    expect(rutaDeVariante(TPL, 2, "Jr Com (final).docx")).toBe(`templates/${TPL}/2-Jr-Com-final.docx`);
  });
  it("la ruta de la copia firmada lleva empleado, documento y marca de tiempo", () => {
    expect(rutaDeFirmado(EMP, TPL, 1700000000000, "firmada.pdf")).toBe(`employees/${EMP}/signed/${TPL}-1700000000000-firmada.pdf`);
  });
  it("solo se firman rutas de variantes o de firmas del mismo empleado y documento", () => {
    expect(rutaPermitida(`templates/${TPL}/1-a.pdf`)).toBe(true);
    expect(rutaPermitida(`employees/${EMP}/signed/${TPL}-1-a.pdf`, EMP, TPL)).toBe(true);
    expect(rutaPermitida(`employees/${EMP}/signed/${TPL}-1-a.pdf`, EMP, "otra")).toBe(false);
    expect(rutaPermitida(`templates/../employees/${EMP}/x.pdf`)).toBe(false);
    expect(rutaPermitida(`${EMP}/handbook/x.pdf`)).toBe(false);
  });
});

describe("puesto del empleado y variante sugerida", () => {
  it("coincide sin importar mayúsculas, acentos ni espacios", () => {
    expect(coincidePuesto(["Junior Sales Representative"], "junior  sales representative")).toBe(true);
    expect(coincidePuesto(["Gerente de Tienda"], "GERENTE DE TIENDA")).toBe(true);
  });
  it("el puesto del empleado puede llevar varios separados por coma", () => {
    expect(coincidePuesto(["Junior Sales Representative"], "Cashier, Junior Sales Representative")).toBe(true);
    expect(coincidePuesto(["Junior Sales Representative"], "Cashier")).toBe(false);
  });
  it("una variante sin puestos, o un empleado sin puesto, no coinciden", () => {
    expect(coincidePuesto([], "Cashier")).toBe(false);
    expect(coincidePuesto(["Cashier"], "")).toBe(false);
    expect(coincidePuesto(null, "Cashier")).toBe(false);
  });

  const variantes = [
    { id: "v-sr", label: "Senior Sales", positions: ["Senior Sales"], offer_note: null, active: true },
    { id: "v-jr-11", label: "Junior $11/hr", positions: ["Junior Sales Representative"], offer_note: "$11/hr", active: true },
    { id: "v-jr-13", label: "Junior $13/hr + commission", positions: ["Junior Sales Representative"], offer_note: "$13/hr + commission", active: false },
  ];
  it("elige la variante activa cuyo puesto coincide", () => {
    expect(varianteSugerida(variantes, "Junior Sales Representative")?.id).toBe("v-jr-11");
    expect(varianteSugerida(variantes, "senior sales")?.id).toBe("v-sr");
  });
  it("sin coincidencia, no hay sugerida; una variante archivada nunca se sugiere", () => {
    expect(varianteSugerida(variantes, "Cashier")).toBeNull();
    expect(varianteSugerida([variantes[2]], "Junior Sales Representative")).toBeNull();
  });
  it("lo guardado manda sobre la sugerencia, aunque esté archivado", () => {
    expect(varianteMarcada("v-jr-13", variantes[1], variantes)?.id).toBe("v-jr-13");
    expect(varianteMarcada(null, variantes[1], variantes)?.id).toBe("v-jr-11");
    expect(varianteMarcada("no-existe", null, variantes)).toBeNull();
  });
});

describe("qué documentos ve cada empleado", () => {
  const documentos = [
    { id: "comision", name: "Política de comisiones", applies_to_all: false, active: true },
    { id: "manual", name: "Manual del empleado", applies_to_all: true, active: true },
    { id: "viejo", name: "Documento archivado", applies_to_all: true, active: false },
  ];
  const variantes = [
    { id: "c-jr", template_id: "comision", label: "Junior $11/hr", positions: ["Junior Sales Representative"], offer_note: null, active: true },
    { id: "c-sr", template_id: "comision", label: "Senior Sales", positions: ["Senior Sales"], offer_note: null, active: true },
    { id: "m-1", template_id: "manual", label: "Manual general", positions: [], offer_note: null, active: true },
    { id: "v-1", template_id: "viejo", label: "Viejo", positions: [], offer_note: null, active: true },
  ];

  it("el vendedor ve la política de comisiones con la variante de su puesto", () => {
    const r = documentosParaEmpleado(documentos, variantes, "Junior Sales Representative");
    const comision = r.find((x) => x.documento.id === "comision");
    expect(comision).toBeDefined();
    expect(comision?.sugerida?.id).toBe("c-jr");
    // Solo las variantes de ESE documento se pueden elegir a mano.
    expect(comision?.variantes.map((v) => v.template_id)).toEqual(["comision", "comision"]);
  });

  it("el almacenista o el chofer NO ve la política de comisiones", () => {
    const r = documentosParaEmpleado(documentos, variantes, "Warehouse Associate, Driver");
    expect(r.some((x) => x.documento.id === "comision")).toBe(false);
  });

  it("un documento «para todos» aparece a cualquiera, sin variante sugerida si no hay puesto", () => {
    const r = documentosParaEmpleado(documentos, variantes, "Driver");
    expect(r.map((x) => x.documento.id)).toEqual(["manual"]);
    expect(r[0].sugerida).toBeNull();
  });

  it("un documento archivado no sale aunque sea para todos", () => {
    const r = documentosParaEmpleado(documentos, variantes, "Driver");
    expect(r.some((x) => x.documento.id === "viejo")).toBe(false);
  });
});

describe("filtros de la biblioteca", () => {
  const lista = [
    { name: "Política de comisiones", category: "Commission", description: "" },
    { name: "Manual", category: "Onboarding", description: "Bienvenida" },
  ];
  it("busca sin acentos en nombre, categoría y descripción", () => {
    expect(filtraDocumentos(lista, { buscar: "comision" }).map((d) => d.name)).toEqual(["Política de comisiones"]);
    expect(filtraDocumentos(lista, { buscar: "bienvenida" }).map((d) => d.name)).toEqual(["Manual"]);
  });
  it("filtra por categoría exacta", () => {
    expect(filtraDocumentos(lista, { categoria: "onboarding" })).toHaveLength(1);
    expect(filtraDocumentos(lista, {})).toHaveLength(2);
  });
});

describe("transiciones de estado de un documento", () => {
  it("pendiente → enviado → firmado, y «no aplica» vale desde cualquiera", () => {
    expect(puedeCambiarEstado("pending", "sent", false)).toEqual({ ok: true });
    expect(puedeCambiarEstado("sent", "signed", false)).toEqual({ ok: true });
    expect(puedeCambiarEstado("signed", "na", true)).toEqual({ ok: true });
    expect(puedeCambiarEstado("sent", "na", false)).toEqual({ ok: true });
  });
  it("sin registro previo, el estado de partida es pendiente", () => {
    expect(puedeCambiarEstado(null, "pending", false)).toEqual({ ok: false, motivo: "igual" });
    expect(puedeCambiarEstado(undefined, "sent", false)).toEqual({ ok: true });
  });
  it("no se acepta un estado que no existe, ni el mismo que ya tiene", () => {
    expect(puedeCambiarEstado("pending", "rechazado", false)).toEqual({ ok: false, motivo: "invalido" });
    expect(puedeCambiarEstado("sent", "sent", false)).toEqual({ ok: false, motivo: "igual" });
  });
  it("con copia firmada subida no se vuelve a pendiente", () => {
    expect(puedeCambiarEstado("signed", "pending", true)).toEqual({ ok: false, motivo: "con_firma" });
    expect(puedeCambiarEstado("signed", "pending", false)).toEqual({ ok: true });
  });
  it("subir una copia firmada deja el estado en firmado", () => {
    expect(estadoAlSubirFirmado()).toBe("signed");
  });
});

describe("marcadores de personalización", () => {
  it("el mapa saca nombre, puesto (el primero), fecha de ingreso, tienda y hoy", () => {
    const m = mapaDeMarcadores(
      { fullName: " Ana Pérez ", position: "Junior Sales Representative, Cashier", hireDate: "2026-11-02", payRate: null, store: "RDZ Pharr" },
      "2026-11-16",
      "en",
    );
    expect(m.employee_name).toBe("Ana Pérez");
    expect(m.position).toBe("Junior Sales Representative");
    expect(m.start_date).toBe("November 2, 2026");
    expect(m.pay_rate).toBe("");
    expect(m.store).toBe("RDZ Pharr");
    expect(m.today).toBe("November 16, 2026");
  });
  it("sin dato, el marcador queda vacío y nunca «undefined»", () => {
    const m = mapaDeMarcadores({}, "2026-11-16", "es");
    expect(Object.values(m).every((v) => typeof v === "string")).toBe(true);
    expect(m.start_date).toBe("");
    expect(m.today).toContain("2026");
  });
  it("el pago se escribe tal cual viene, y 0 cuenta como dato", () => {
    expect(mapaDeMarcadores({ payRate: 13 }, "2026-11-16", "en").pay_rate).toBe("13");
    expect(mapaDeMarcadores({ payRate: 0 }, "2026-11-16", "en").pay_rate).toBe("0");
  });
  it("la fecha larga sale en el idioma de la pantalla", () => {
    expect(fechaLarga("2026-01-05", "es")).toContain("2026");
    expect(fechaLarga(null, "en")).toBe("");
  });
  it("detecta marcadores aunque Word parta la palabra en varias etiquetas", () => {
    const xml = '<w:t>Hola {{employee_</w:t></w:r><w:r><w:t>name}}, puesto {{ position }}</w:t>';
    expect(contieneMarcadores(xml)).toBe(true);
    expect(marcadoresEn(xml).sort()).toEqual(["employee_name", "position"]);
    expect(contieneMarcadores("<w:t>Texto sin nada</w:t>")).toBe(false);
  });
});
