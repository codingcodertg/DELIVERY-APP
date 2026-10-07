import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DICT } from "@/lib/timetracker/i18n";
import { armarFotos, notaDeParada, type FilaParada, type SitioFoto } from "./day-photos";
import {
  MOTIVOS_DE_SALIDA, MOTIVO_VISITA, etiquetaDeFoto, filaDeSalida, motivoDeViaje, planDeSalida, rutaDeFoto,
  seCierraDeUnToque, vehiculoDeEmpresaPorDefecto, viajePersonalPorDefecto,
} from "./visitas";

// D-455. «Voy a salir» pregunta si va a visitar a un cliente; si dice que sí, bajo el reloj queda
// un botón de foto que puede usar cuando quiera, y cada foto se guarda como una parada (foto,
// hora, ubicación). Estas pruebas cubren la lógica pura y, leyendo el fuente, que las pantallas
// la USAN: PunchPanel (la ventana y el botón), TripPanel (paradas con foto) y Auditoría › Fotos
// (donde el admin las ve).

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const punch = leer("src/components/timetracker/PunchPanel.tsx");
const trip = leer("src/components/timetracker/TripPanel.tsx");
const pregunta = leer("src/components/timetracker/PreguntaDeVehiculo.tsx");

describe("«voy a salir» ya no graba nada a ciegas: pregunta", () => {
  it("el botón abre la ventana; ya no llama a startLeave con customer_visit", () => {
    expect(punch).toContain('<button className="btn-ghost" disabled={!!ocupado} onClick={() => setSalida("pregunta")}>');
    expect(punch).not.toContain('startLeave({ reason: "customer_visit"');
  });
  it("la ventana pregunta si va a visitar a un cliente, con Sí y No, en los dos idiomas", () => {
    expect(punch).toContain('{t("emp.visit.ask")}');
    expect(punch).toContain('onClick={empiezaVisita}>{t("emp.visit.yes")}</button>');
    expect(punch).toContain('onClick={() => setSalida("motivo")}>{t("emp.visit.no")}</button>');
    expect(DICT.en["emp.visit.ask"]).toBe("Are you visiting a customer?");
    expect(DICT.es["emp.visit.ask"]).toBe("¿Vas a visitar a un cliente?");
  });
  it("Sí y No pasan por el MISMO plan (D-NEXT), con lo que contestó del vehículo, y mandan la ubicación si la hay", () => {
    expect(punch).toContain("vehiculo, vehicleId: vehiculoIdEfectivo, odometro: odoSalida, visita, motivo: motivoSalida, nota: notaSalida,");
    expect(punch).toContain("await grabaSalida(planDe(true));");
    expect(punch).toContain("await grabaSalida(planDe(false));");
    expect(punch).toContain('await corre(async () => startTrip({ kind: viaje?.mode ?? "sales", ...v, ...(await ubicacionOpcional()) }));');
  });
  it("una salida que no es viaje se graba como siempre (startLeave) con el motivo y la nota del plan", () => {
    expect(punch).toContain("const { reason, note } = plan.salida;");
    expect(punch).toContain("await corre(async () => startLeave({ reason, note, geo: await ubicacionOpcional() }));");
  });
  it("los motivos del NO son valores del enumerado leave_reason, sin customer_visit ni lunch", () => {
    const sql = leer("supabase/migrations/072_clockin_module.sql");
    const m = sql.match(/create type clockin\.leave_reason as enum \(([^)]+)\);/);
    expect(m, "no se encontró el enumerado en la 072").not.toBeNull();
    const delEnumerado = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    for (const motivo of MOTIVOS_DE_SALIDA) expect(delEnumerado, motivo).toContain(motivo);
    expect(MOTIVOS_DE_SALIDA).not.toContain("customer_visit");
    expect(MOTIVOS_DE_SALIDA).not.toContain("lunch");
    expect(delEnumerado).toContain(MOTIVO_VISITA);
    // Y son TODOS los demás: si mañana se añade un motivo al enumerado, esto obliga a decidir.
    expect([...MOTIVOS_DE_SALIDA].sort()).toEqual(delEnumerado.filter((x) => x !== "customer_visit" && x !== "lunch").sort());
  });
  it("la ventana pinta un motivo por cada valor, cada uno con su texto", () => {
    expect(punch).toContain("{MOTIVOS_DE_SALIDA.map((m) => (");
    for (const motivo of MOTIVOS_DE_SALIDA) expect(punch, motivo).toMatch(new RegExp(`\\n  ${motivo}: \\{ en: "[^"]+", es: "[^"]+" \\},`));
  });
});

describe("«voy a salir» pregunta por el vehículo: personal o de la empresa (D-NEXT)", () => {
  const base = { vehiculo: "personal" as const, vehicleId: null, odometro: "", visita: true, motivo: "delivery" as const, nota: "" };
  it("sin contestar no se graba nada: es una pregunta, no un defecto escondido", () => {
    expect(planDeSalida({ ...base, vehiculo: null })).toEqual({ ok: false, falta: "eleccion" });
    expect(planDeSalida({ ...base, vehiculo: null, visita: false })).toEqual({ ok: false, falta: "eleccion" });
  });
  it("personal + visita: viaje personal — ni vehículo ni cuentakilómetros — con motivo customer_visit", () => {
    expect(planDeSalida(base)).toEqual({
      ok: true, accion: "viaje", viaje: { personal: true, vehicleId: null, odometer: null, reason: "customer_visit", note: null },
    });
  });
  it("personal + no es visita: la salida de siempre, con su motivo y sin pedir cuentakilómetros", () => {
    expect(planDeSalida({ ...base, visita: false })).toEqual({ ok: true, accion: "salida", salida: { reason: "delivery", note: undefined } });
    expect(planDeSalida({ ...base, visita: false, motivo: "other", nota: "  banco  " })).toEqual({ ok: true, accion: "salida", salida: { reason: "other", note: "banco" } });
    // La nota solo va con «otro»: con otro motivo lo escrito no se manda.
    expect(planDeSalida({ ...base, visita: false, motivo: "delivery", nota: "banco" })).toEqual({ ok: true, accion: "salida", salida: { reason: "delivery", note: undefined } });
  });
  it("empresa + visita: lleva ese vehículo y su cuentakilómetros", () => {
    expect(planDeSalida({ ...base, vehiculo: "empresa", vehicleId: "v1", odometro: " 51200 " })).toEqual({
      ok: true, accion: "viaje", viaje: { personal: false, vehicleId: "v1", odometer: 51200, reason: "customer_visit", note: null },
    });
  });
  it("empresa + no es visita: TAMBIÉN es un viaje, porque el cuentakilómetros solo cabe en un viaje", () => {
    expect(planDeSalida({ ...base, vehiculo: "empresa", vehicleId: "v1", odometro: "100", visita: false, motivo: "picking_up_supplies" })).toEqual({
      ok: true, accion: "viaje", viaje: { personal: false, vehicleId: "v1", odometer: 100, reason: "pickup", note: null },
    });
    expect(planDeSalida({ ...base, vehiculo: "empresa", vehicleId: "v1", odometro: "100", visita: false, motivo: "other", nota: " banco " })).toEqual({
      ok: true, accion: "viaje", viaje: { personal: false, vehicleId: "v1", odometer: 100, reason: "other", note: "banco" },
    });
  });
  it("empresa sin cuentakilómetros: falta, y un vacío NO es 0", () => {
    for (const odometro of ["", "   ", "abc"]) {
      expect(planDeSalida({ ...base, vehiculo: "empresa", vehicleId: "v1", odometro })).toEqual({ ok: false, falta: "odometro" });
      expect(planDeSalida({ ...base, vehiculo: "empresa", vehicleId: "v1", odometro, visita: false })).toEqual({ ok: false, falta: "odometro" });
    }
  });
  it("empresa sin vehículo elegido: falta el vehículo", () => {
    expect(planDeSalida({ ...base, vehiculo: "empresa", vehicleId: null, odometro: "100" })).toEqual({ ok: false, falta: "vehiculo" });
  });
  it("el vehículo de la empresa que sale elegido: el asignado si sigue activo; si no, el primero; sin flota, ninguno", () => {
    const flota = [{ id: "v1" }, { id: "v2" }];
    expect(vehiculoDeEmpresaPorDefecto("v2", flota)).toBe("v2");
    expect(vehiculoDeEmpresaPorDefecto("v9", flota)).toBe("v1");
    expect(vehiculoDeEmpresaPorDefecto(null, flota)).toBe("v1");
    expect(vehiculoDeEmpresaPorDefecto("v1", [])).toBeNull();
  });
  it("«recoger material» se guarda en el viaje como pickup, el nombre que ya usa el panel de viajes", () => {
    expect(motivoDeViaje("picking_up_supplies")).toBe("pickup");
    expect(motivoDeViaje("delivery")).toBe("delivery");
    expect(trip).toContain('{ v: "pickup", l: t("emp.trip.reasonPickup") },');
  });
  it("la ventana pregunta el vehículo ANTES que la visita, a todos, y no deja seguir sin contestar", () => {
    const ventana = punch.slice(punch.indexOf('{salida === "pregunta" ? ('), punch.indexOf('<label>{t("emp.visit.whyOut")}</label>'));
    // El componente de verdad, con la respuesta conectada al estado que lee el plan.
    expect(ventana).toMatch(/<PreguntaDeVehiculo\s+nombre="vehiculo-salida"\s+valor=\{vehiculo\} onValor=\{setVehiculo\}\s+vehiculos=\{flota\} vehiculoId=\{vehiculoIdEfectivo\} onVehiculoId=\{setVehiculoId\}\s+odometro=\{odoSalida\} onOdometro=\{setOdoSalida\}/);
    expect(punch).toContain('import { PreguntaDeVehiculo } from "@/components/timetracker/PreguntaDeVehiculo";');
    expect(ventana.indexOf("<PreguntaDeVehiculo")).toBeLessThan(ventana.indexOf('{t("emp.visit.ask")}'));
    expect(ventana).not.toContain("{vehiculoDeVisita && (");
    expect(ventana).toContain('<button className="btn-ghost" disabled={!planDe(false).ok} onClick={() => setSalida("motivo")}>');
    expect(ventana).toContain("<button disabled={!planVisita.ok || !!ocupado} onClick={empiezaVisita}>");
    expect(punch).toContain("<button disabled={!planDe(false).ok || !!ocupado} onClick={saleSinVisita}>");
    expect(punch).toContain("const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);");
  });
  it("la pregunta tiene las dos respuestas, y el cuentakilómetros solo con la de la empresa", () => {
    expect(pregunta).toContain('onChange={() => onValor("personal")} />');
    expect(pregunta).toContain('disabled={sinFlota} checked={valor === "empresa"} onChange={() => onValor("empresa")} />');
    expect(pregunta).toContain('{valor === "empresa" && !sinFlota && (');
    expect(DICT.en["emp.out.vehicleAsk"]).toBe("Are you going in your personal vehicle or a company vehicle?");
    expect(DICT.es["emp.out.vehicleAsk"]).toBe("¿Vas en tu vehículo personal o en un vehículo de la empresa?");
    for (const k of ["emp.out.personal", "emp.out.company", "emp.out.noFleet"]) {
      expect(DICT.en[k], k).toBeTruthy();
      expect(DICT.es[k], k).toBeTruthy();
    }
  });
  it("la ventana y el panel de viajes usan grupos de radios DISTINTOS (si no, marcar uno desmarca el otro)", () => {
    expect(punch).toContain('nombre="vehiculo-salida"');
    expect(trip).toContain('nombre="vehiculo-viaje"');
    expect(pregunta).toContain("name={nombre}");
  });
});

describe("la foto: en cualquier momento, cuantas veces quiera", () => {
  it("el nombre de la foto: la nota si la escribió; si no, el nombre por defecto. Nunca vacío", () => {
    expect(etiquetaDeFoto("  Sr. Pérez  ", "Visita a cliente")).toBe("Sr. Pérez");
    expect(etiquetaDeFoto("", "Visita a cliente")).toBe("Visita a cliente");
    expect(etiquetaDeFoto("   ", "Visita a cliente")).toBe("Visita a cliente");
  });
  it("cada foto se guarda como una parada: logStop con photoPath y la ubicación", () => {
    expect(punch).toContain("const subida = await subirFotoDeFichaje(file, { companyId: d.companyId, userId: d.userId });");
    expect(punch).toContain("const r = await logStop({ label: etiqueta, photoPath: subida.path, ...geo });");
  });
  it("si la foto no subió, no se guarda nada: se sale antes de logStop", () => {
    const g = punch.slice(punch.indexOf("async function guardaFoto("), punch.indexOf("async function alTomarFotoDeVisita("));
    const salida = g.indexOf("if (!subida.ok) return { ok: false,");
    expect(salida).toBeGreaterThan(-1);
    expect(salida).toBeLessThan(g.indexOf("await logStop("));
  });
  it("el botón de la visita usa el nombre por defecto y deja la parada CERRADA (una foto es un instante)", () => {
    expect(punch).toContain('const r = await guardaFoto(file, etiquetaDeFoto(notaFoto, t("emp.visit.photoLabel")), true);');
    expect(punch).toContain("const cierre = cerrar ? await finishStop({ ...geo }) : null;");
  });
  it("es la cámara del teléfono: un input con capture, propio de la visita", () => {
    expect(punch).toContain('<input ref={fotoVisitaRef} type="file" accept="image/*" capture="environment" hidden onChange={alTomarFotoDeVisita} />');
    expect(punch).toContain("<button disabled={!!ocupado} onClick={() => fotoVisitaRef.current?.click()}>");
  });
  it("cancelar la cámara no guarda nada", () => {
    const g = punch.slice(punch.indexOf("async function alTomarFotoDeVisita("), punch.indexOf("const planVisita ="));
    expect(g.indexOf("if (!file) return;")).toBeGreaterThan(-1);
    expect(g.indexOf("if (!file) return;")).toBeLessThan(g.indexOf("await guardaFoto("));
  });
  it("la ruta de la foto es la de siempre: empresa/persona/hora.jpg", () => {
    expect(rutaDeFoto("c1", "u1", 1787771247565)).toBe("c1/u1/1787771247565.jpg");
  });
  it("sube al mismo bucket, comprimida, con su límite de 30 s — y el fichaje sube por el mismo sitio", () => {
    const sube = leer("src/lib/clockin/sube-foto.ts");
    expect(sube).toContain("const body = await compressImage(file);");
    expect(sube).toContain("const path = rutaDeFoto(quien.companyId, quien.userId, Date.now());");
    expect(sube).toContain('supabase.storage.from("exception-photos").upload(path, body, { contentType: "image/jpeg", upsert: false }),');
    expect(sube).toContain('new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 30000)),');
    const subeFoto = punch.slice(punch.indexOf("async function subeFoto("), punch.indexOf("async function ficha("));
    expect(subeFoto).toContain("await subirFotoDeFichaje(file, { companyId: d.companyId, userId: d.userId });");
    expect(subeFoto).toContain('setErr(r.motivo === "timeout" ? t("emp.punch.photoTimeout") : r.message);');
  });
});

describe("qué botones salen bajo el reloj", () => {
  it("sin nada abierto: almuerzo y voy a salir", () => {
    expect(filaDeSalida({ descansoAbierto: false, viajeAbierto: false })).toBe("normal");
  });
  it("con un viaje abierto: la fila de la visita, con el botón de foto", () => {
    expect(filaDeSalida({ descansoAbierto: false, viajeAbierto: true })).toBe("visita");
  });
  it("el descanso manda sobre la visita: con el viaje en pausa la foto solo sabría fallar", () => {
    expect(filaDeSalida({ descansoAbierto: true, viajeAbierto: true })).toBe("descanso");
    expect(filaDeSalida({ descansoAbierto: true, viajeAbierto: false })).toBe("descanso");
  });
  it("PunchPanel decide la fila con el descanso y el viaje de verdad", () => {
    expect(punch).toContain("const fila = filaDeSalida({ descansoAbierto: !!d.leave, viajeAbierto: !!viaje?.trip });");
  });
  it("el botón de foto está en la fila de la visita, visible mientras dure", () => {
    const fila = punch.slice(punch.indexOf(') : fila === "visita" && viaje?.trip ? ('), punch.indexOf("{/* Ya no graba nada al pulsarlo"));
    expect(fila).toContain('📷 {t("emp.visit.takePhoto")}');
    expect(fila).toContain("fotoVisitaRef.current?.click()");
    expect(DICT.en["emp.visit.takePhoto"]).toBe("Take photo");
    expect(DICT.es["emp.visit.takePhoto"]).toBe("Tomar foto");
  });
  it("«ya volví» de un toque solo en un viaje personal: con vehículo hay que dar el cuentakilómetros abajo", () => {
    expect(seCierraDeUnToque({ vehicleId: null })).toBe(true);
    expect(seCierraDeUnToque({ vehicleId: "v1" })).toBe(false);
    expect(punch).toContain("{seCierraDeUnToque(viaje.trip) && (");
    expect(punch).toContain("onClick={() => corre(async () => endTrip({ ...(await ubicacionOpcional()) }))}>");
  });
});

describe("el panel de viajes: visitas y mandados, con foto", () => {
  it("sin vehículo asignado el viaje nace personal; con uno, no", () => {
    expect(viajePersonalPorDefecto(null)).toBe(true);
    expect(viajePersonalPorDefecto(undefined)).toBe(true);
    expect(viajePersonalPorDefecto("")).toBe(true);
    expect(viajePersonalPorDefecto("v1")).toBe(false);
  });
  it("TripPanel usa ese defecto hasta que la persona conteste la pregunta", () => {
    expect(trip).toContain("const personal = personalElegido ?? viajePersonalPorDefecto(d.currentVehicleId);");
    expect(trip).toContain("const [personalElegido, setPersonal] = useState<boolean | null>(null);");
  });
  it("el panel de viajes hace la MISMA pregunta que la ventana (D-NEXT), con las opciones de Time Tracker (.motivo)", () => {
    expect(trip).toContain('valor={personal ? "personal" : "empresa"}');
    expect(trip).toContain('onValor={(v) => setPersonal(v === "personal")}');
    expect(pregunta).toContain('<label className={"motivo" + (valor === "personal" ? " on" : "")}>');
    expect(trip).not.toContain('className="perm-opt"');
  });
  it("un viaje personal no pide vehículo ni cuentakilómetros y el botón de empezar no espera a un vehículo", () => {
    expect(trip).toContain("disabled={busy || (!personal && !vehiculo)}");
    expect(trip).toContain("vehicleId: personal ? null : vehiculo,");
    expect(trip).toContain("odometer: personal ? null : num(odoIni),");
  });
  it("llegar a una parada exige el nombre y abre la cámara; la parada se guarda con la foto", () => {
    expect(trip).toContain('<button className="btn-ghost" disabled={busy || !parada.trim()} onClick={() => camara.current?.click()}>');
    expect(trip).toContain('<input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={alTomarFoto} />');
    expect(trip).toContain("const r = await fotoDeParada(file, parada.trim());");
    // Y ya no hay camino sin foto: el panel no llama a logStop por su cuenta.
    expect(trip).not.toContain("logStop(");
    expect(punch).toContain("fotoDeParada={(file, etiqueta) => guardaFoto(file, etiqueta, false)}");
  });
  it("manda la ubicación al empezar, al salir de la parada y al terminar", () => {
    expect(trip).toContain("              ...(await ubicacion()),\n            }))}");
    expect(trip).toContain("onClick={() => corre(async () => finishStop({ ...(await ubicacion()) }))}>");
    expect(trip).toContain("void corre(async () => endTrip({ odometer: num(odoFin), ...(await ubicacion()) }));");
    expect(punch).toContain("ubicacion={ubicacionOpcional}");
  });
  it("el viaje se carga UNA vez, en PunchPanel, y TripPanel lo recibe", () => {
    expect(punch).toContain("const [res, v] = await Promise.all([getMyDay(), getMyTrip()]);");
    expect(punch).toContain("setViaje(v.ok ? v : null);");
    expect(punch).toContain("d={viaje}");
    expect(punch).toContain("recargar={load}");
    expect(trip).not.toContain("getMyTrip()");
  });
  it("los textos hablan de visitas, no solo de «vehículo»", () => {
    expect(DICT.es["emp.trip.title"]).toContain("Visitas, mandados y viajes");
    expect(DICT.en["emp.trip.title"]).toContain("Visits, errands & trips");
    expect(DICT.es["emp.trip.ownVehicle"]).toContain("Viaje personal");
    expect(DICT.en["emp.trip.ownVehicle"]).toContain("Personal trip");
    // El servidor rechaza una parada sin nombre: el campo ya no puede decir «opcional».
    expect(DICT.es["emp.trip.stopNamePh"]).not.toContain("opcional");
    expect(DICT.en["emp.trip.stopNamePh"]).not.toContain("optional");
  });
  it("runner.ts sigue exigiendo el nombre y aceptando foto y ubicación: de eso depende todo lo de arriba", () => {
    const runner = leer("src/app/timetracker/clock-in/actions/runner.ts");
    expect(runner).toContain("if (!input.label?.trim()) {");
    expect(runner).toContain("photo_path: input.photoPath ?? null,");
    expect(runner).toContain("latitude: input.lat ?? null,");
    expect(runner).toContain("if (!input.personal) {");
  });
});

describe("las fotos de visita se ven donde el admin revisa el día: Auditoría › Fotos", () => {
  const sitio: SitioFoto = { id: "s1", name: "Pharr", latitude: 26.2, longitude: -98.18, radius_meters: 100, boundary: null } as SitioFoto;
  const parada = (p: Partial<FilaParada> = {}): FilaParada => ({
    employee_id: "u1", label: "Sr. Pérez", note: null, address: "1420 N 10th St, McAllen", photo_path: "c1/u1/2.jpg",
    arrived_at: "2026-10-01T16:00:00.000Z", latitude: 26.3, longitude: -98.2, ...p,
  });
  const base = { punches: [], excs: [], sites: [sitio], entradas: [], nombre: new Map([["u1", "Everto Prado"]]) };

  it("una parada con foto sale como foto de visita, con quién, cuándo, dónde y a quién visitó", () => {
    const [f] = armarFotos({ ...base, stops: [parada()] });
    expect(f).toMatchObject({
      path: "c1/u1/2.jpg", who: "Everto Prado", at: "2026-10-01T16:00:00.000Z", kind: "stop",
      offSite: null, note: "Sr. Pérez · 1420 N 10th St, McAllen", lat: 26.3, lng: -98.2, siteName: "Pharr", siteId: "s1",
    });
    expect(f.distanceM).toBeGreaterThan(1000);
  });
  it("una parada sin foto no sale: esta pantalla enseña fotos", () => {
    expect(armarFotos({ ...base, stops: [parada({ photo_path: null })] })).toEqual([]);
  });
  it("sin posición sale igual, sin sitio ni distancia", () => {
    const [f] = armarFotos({ ...base, stops: [parada({ latitude: null, longitude: null })] });
    expect(f).toMatchObject({ kind: "stop", lat: null, lng: null, siteName: null, distanceM: null });
  });
  it("se ordenan por hora junto a las demás fotos del día", () => {
    const fotos = armarFotos({
      ...base,
      punches: [{
        employee_id: "u1", clock_in_at: "2026-10-01T15:00:00.000Z", clock_out_at: null, clock_in_photo_path: "c1/u1/1.jpg",
        clock_out_photo_path: null, clock_in_in_radius: true, clock_out_in_radius: null, clock_in_lat: 26.2, clock_in_lng: -98.18,
        clock_in_site_id: "s1", clock_out_lat: null, clock_out_lng: null, clock_out_site_id: null,
      }],
      stops: [parada({ arrived_at: "2026-10-01T17:00:00.000Z", photo_path: "c1/u1/3.jpg" }), parada()],
    });
    expect(fotos.map((f) => f.kind)).toEqual(["in", "stop", "stop"]);
    expect(fotos.map((f) => f.path)).toEqual(["c1/u1/1.jpg", "c1/u1/2.jpg", "c1/u1/3.jpg"]);
  });
  it("quien no pasa paradas ve lo de siempre", () => {
    expect(armarFotos(base)).toEqual([]);
  });
  it("lo que se lee bajo la foto: nombre, nota y dirección, lo que haya", () => {
    expect(notaDeParada({ label: "Sr. Pérez", note: "cotización", address: "McAllen" })).toBe("Sr. Pérez · cotización · McAllen");
    expect(notaDeParada({ label: " ", note: null, address: "McAllen" })).toBe("McAllen");
    expect(notaDeParada({ label: null, note: null, address: null })).toBeNull();
  });

  const accion = leer("src/app/timetracker/clock-in/actions/photos.ts");
  it("la acción pide las paradas CON foto del día, con el mismo alcance por tienda, y se las pasa a armarFotos", () => {
    const q = accion.slice(accion.indexOf("let stopQ = supabase"), accion.indexOf("// El día más reciente que TIENE fotos."));
    expect(q).toContain('.from("trip_stops")');
    expect(q).toContain('.select("employee_id, label, note, address, photo_path, arrived_at, latitude, longitude")');
    expect(q).toContain('.eq("company_id", companyId)');
    expect(q).toContain('.not("photo_path", "is", null)');
    expect(q).toContain('.gte("arrived_at", from)');
    expect(q).toContain('.lt("arrived_at", to);');
    expect(q).toContain('stopQ = stopQ.in("employee_id", inEmp);');
    expect(accion).toContain("stops: (stops ?? []) as unknown as FilaParada[],");
  });
  it("y un día que solo tuvo fotos de visita cuenta como «día con fotos»", () => {
    expect(accion).toContain("const diaStop = aDiaLocal((ultimaStop ?? [])[0]?.arrived_at as string | undefined);");
    expect(accion).toContain("const latestWithPhotos = [diaPunch, diaExc, diaStop].filter(Boolean).sort().pop() ?? null;");
    expect(accion).toContain('ultimaStopQ = ultimaStopQ.in("employee_id", inEmp);');
  });
  it("la pantalla de Fotos tiene rótulo para la visita, en los dos idiomas", () => {
    const pantalla = leer("src/components/timetracker/DayPhotos.tsx");
    expect(pantalla).toContain('if (k === "stop") return t("mgr.photos.kindStop");');
    expect(DICT.en["mgr.photos.kindStop"]).toBe("Visit / stop");
    expect(DICT.es["mgr.photos.kindStop"]).toBe("Visita / parada");
  });
});
