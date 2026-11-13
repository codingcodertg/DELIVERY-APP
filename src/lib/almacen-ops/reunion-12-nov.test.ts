import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAVE_ROMPIO_TEXTO, separaRompio } from "./pasos";
import { celdasDeMerma, rompioEscrito, type FilaDeMermaExcel } from "./tabla-de-merma";
import { mermaParaEnviar } from "./datos";
import { COLUMNAS_DE_HOJA } from "./columnas-de-hoja";
import { APK_CON_CAMARA_DEL_FORMULARIO, ficheroDeDataUrl, usaCamaraDentroDeLaApp } from "./foto-del-telefono";
import { ordenLimpio, sueltaEnOrden } from "@/app/operaciones/useOrdenDeColumnas";

// Reunión con Roberto, 12 nov (8:52 PM): lo que se decidió para Operaciones de almacén / Merma.
const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const OPS = "src/app/operaciones";
const LISTA = leer(`${OPS}/ListaDeReportes.tsx`);
const UUID = "11111111-1111-4111-8111-111111111111";

describe("1. borrar en bloque: cada falla con su motivo, y lo borrado desaparece en el acto", () => {
  it("la pantalla junta una falla POR reporte y la enseña como error, no como una línea gris", () => {
    expect(LISTA).toContain("fallos.push({ id: r.id,");
    expect(LISTA).toContain('className="ops-aviso ops-aviso-error ops-fallos-de-borrado" role="alert"');
    expect(LISTA).toContain("data-fallo-de={f.id}");
    // Cada reporte sale de la lista en cuanto la base lo borra, dentro del ciclo (no al final).
    const ciclo = LISTA.slice(LISTA.indexOf("for (const r of lista) {"), LISTA.indexOf("setFallosDeBorrado(fallos);"));
    expect(ciclo).toContain("setFilas((f) => (f ?? []).filter((x) => x.id !== r.id));");
  });

  it("migración 301: el admin borra aunque el grupo esté aprobado, el gerente no, y queda historial", () => {
    const sql = leer("supabase/migrations/301_merma_borrar_aprobadas_e_historial.sql");
    const f = sql.slice(sql.indexOf("create or replace function public.warehouse_ops_delete_scrap_report"), sql.indexOf("-- Autocomprobacion"));
    expect(f).toContain("security definer");
    expect(f).toContain("for update");
    expect(f).toContain("es_admin or public.warehouse_ops_can_start_approval(r.store)");
    // El grupo aprobado sigue cerrado para quien no es admin.
    expect(f).toMatch(/if g\.approved_at is not null then[\s\S]{0,200}if not es_admin then\s+raise exception/);
    // El historial se escribe ANTES de borrar la fila.
    const historial = f.indexOf("insert into public.warehouse_deleted_reports");
    const borra = f.indexOf("delete from public.warehouse_reports where id = r.id");
    expect(historial).toBeGreaterThan(0);
    expect(borra).toBeGreaterThan(historial);
    // Las salvaguardas de la 297 siguen: archivos compartidos fuera de la lista, filtrados después de borrar.
    expect(f.indexOf("where not exists (select 1 from public.warehouse_reports x")).toBeGreaterThan(borra);
    expect(f).toContain("x.adjustment_proof = f");
    expect(f).toContain("x.approval_sheet = f");
    // La tabla: RLS, solo lectura y solo para el admin; anon fuera de la función.
    expect(sql).toContain("alter table public.warehouse_deleted_reports enable row level security");
    expect(sql).toContain("revoke all on public.warehouse_deleted_reports from public, anon, authenticated");
    expect(sql).toContain("grant select on public.warehouse_deleted_reports to authenticated");
    expect(sql).toContain("revoke all on function public.warehouse_ops_delete_scrap_report(uuid) from public, anon");
    expect(sql).not.toMatch(/\b23[789]_/); // no toca las migraciones en espera
  });
});

describe("2 y 3. «seleccionar todos» solo marca lo que se ve; el buscador, a la izquierda", () => {
  it("la tabla avisa qué renglones enseña y la selección se limita a esos", () => {
    expect(LISTA).toContain("onVisibles={setALaVista}");
    expect(LISTA).toContain("const seleccionables = useMemo(() => mermasPorEtapa.filter((r) => puedeSeleccionar(r) && seVe(r.id))");
    expect(LISTA).toContain("seleccion.has(r.id) && puedeSeleccionar(r) && seVe(r.id)");
    expect(LISTA).toContain("onVisibles?.(new Set(");
  });
  it("la barra de la tabla ya no empuja el buscador a la derecha", () => {
    const css = leer(`${OPS}/operaciones.css`);
    expect(css).toContain(".ops-columnas-barra { justify-content: flex-start; }");
    expect(css).toContain(".ops-columnas-barra > :last-child { margin-left: auto; }");
  });
});

describe("5. dos columnas de daño: «Dañadas (pzas)» y «Cajas dañadas»", () => {
  it("la hoja de aprobación las trae las dos, y sus tres pantallas pintan «cajas»", () => {
    const claves = COLUMNAS_DE_HOJA.map((c) => c.key);
    expect(claves.indexOf("cajas")).toBe(claves.indexOf("danadas") + 1);
    expect(COLUMNAS_DE_HOJA.find((c) => c.key === "cajas")).toMatchObject({ en: "Damaged boxes", es: "Cajas dañadas", num: true });
    expect(leer(`${OPS}/HojaDeGrupo.tsx`)).toContain('{cols.ve("cajas") && <td className="num">{f.cajas}</td>}');
    expect(leer(`${OPS}/ColumnasDeHoja.tsx`)).toContain('case "cajas": return <td key={k} className="num">{f.cajas}</td>;');
    // El ancho de las filas vacía y de total sale de la lista de columnas, no de un número escrito a mano.
    expect(leer(`${OPS}/HojaDeGrupo.tsx`)).not.toMatch(/fijasIzq \+ \d+ - cols\.ocultas\.length/);
  });
});

describe("6. «Imprimir» arriba en la hoja del grupo", () => {
  it("va en la barra de arriba y ya no en las acciones de abajo", () => {
    const hoja = leer(`${OPS}/HojaDeGrupo.tsx`);
    const barra = hoja.slice(hoja.indexOf('<div className="hoja-barra no-imprimir">'), hoja.indexOf('<article className="hoja-aprobacion">'));
    expect(barra).toContain('data-accion="imprimir-grupo"');
    const abajo = hoja.slice(hoja.indexOf("data-acciones-grupo"));
    expect(abajo).not.toContain("imprimir-grupo");
    expect(abajo).toContain('data-accion="cerrar-grupo"');
    expect(COLUMNAS_DE_HOJA.map((c) => c.key)).toContain("folio"); // el folio se elige en ⚙ Columnas
  });
});

describe("7. «quién lo rompió» admite un nombre escrito", () => {
  const esPersona = (x: string) => x === "p1";
  it("los empleados van a la columna; los nombres escritos, a answers.broken_by_text", () => {
    expect(CLAVE_ROMPIO_TEXTO).toBe("broken_by_text");
    expect(separaRompio([UUID, "p1", " Pedro (temporal) ", ""], esPersona)).toEqual({ ids: [UUID, "p1"], textos: ["Pedro (temporal)"] });
    expect(separaRompio(null)).toEqual({ ids: [], textos: [] });
    const r = { qty: { boxes: 1, piecesPerBox: 2 }, split: { damaged: 2, sample: 0 }, return_type: "internal", reason: "fell", broken_by: ["p1", "Pedro"] };
    expect(mermaParaEnviar(r, esPersona).broken_by).toEqual(["p1"]); // un nombre nunca llega a la columna uuid[]
  });
  it("se enseña junto a los empleados en la tabla, el CSV y la hoja", () => {
    expect(rompioEscrito({ broken_by_text: ["Pedro", " ", 3, "Juan "] })).toEqual(["Pedro", "Juan"]);
    expect(rompioEscrito({})).toEqual([]);
    expect(rompioEscrito(null)).toEqual([]);
    const fila: FilaDeMermaExcel = {
      kind: "scrap", created_at: "2026-11-12T15:00:00Z", broken_on: "2026-11-12", product_sku: "X", product_name: "X", scrap_type: "damaged",
      boxes: 1, pieces_per_box: 4, total_pieces: 4, damaged_pieces: 4, sample_pieces: 0, unit_cost: 1, total_loss: 4,
      return_type: "internal", reason: "fell", broken_by: [UUID], crma: null, answers: { broken_by_text: ["Pedro"] },
    };
    expect(celdasDeMerma(fila, [{ id: UUID, full_name: "Luis" }], "es").loRompio).toBe("Luis, Pedro");
    expect(celdasDeMerma({ ...fila, broken_by: [] }, [], "es").loRompio).toBe("Pedro"); // ya no «IDK»: sí se sabe quién
    expect(LISTA).toContain("[...r.broken_by.map(nombre), ...rompioEscrito(r.answers)]");
    expect(LISTA).toContain("respuestas[CLAVE_ROMPIO_TEXTO] = escritosFinales");
  });
  it("cada nombre elegido se puede quitar (✕) en el asistente", () => {
    expect(leer(`${OPS}/Asistente.tsx`)).toContain("data-quitar-persona={x}>✕</button>");
  });
});

describe("9. teléfono: toda tarjeta se cierra, y «entrar como» no tapa la pantalla", () => {
  it("toda tarjeta (.overlay > .modal) de Operaciones lleva la ✕ pegada arriba", () => {
    const sinX: string[] = [];
    for (const f of readdirSync(join(process.cwd(), OPS)).filter((x) => x.endsWith(".tsx"))) {
      const lineas = leer(`${OPS}/${f}`).split(/\r?\n/);
      lineas.forEach((l, i) => {
        if (!/className="overlay" onClick=/.test(l) || !/className="modal/.test(lineas[i + 1] ?? "")) return;
        // El diálogo «¿descartar?» del asistente es una pregunta con sus dos botones a la vista: no lleva ✕.
        if (/data-dialogo="descartar"/.test(lineas[i + 1])) return;
        if (!/<CerrarX onCerrar=/.test(lineas[i + 2] ?? "")) sinX.push(`${f}:${i + 1}`);
      });
    }
    expect(sinX).toEqual([]);
    const css = leer(`${OPS}/operaciones.css`);
    expect(css).toMatch(/\.ops-cerrar-fila \{ position: sticky;/);
  });
  it("en pantalla de teléfono la burbuja de «entrar como» queda en una sola pastilla chica hasta que se toca", () => {
    const css = leer("src/app/globals.css");
    const bloque = css.slice(css.indexOf(".fab-general-caja.suplantando:not(:has(.fab-menu)) .fab-volver { display: none; }") - 40);
    expect(bloque.startsWith("@media (max-width: 640px) {") || bloque.includes("@media (max-width: 640px) {")).toBe(true);
    expect(css).toContain(".fab-general-caja.suplantando:not(:has(.fab-menu)) .fab-suplantando-texto { font-size: 0; }");
  });
});

describe("10. inicio: una sola entrada de Mantenimiento, y Conteos arriba con las tarjetas", () => {
  it("la tarjeta de la bitácora no se repite y Conteos es una tarjeta del tablero", () => {
    const ini = leer(`${OPS}/Operaciones.tsx`);
    expect(ini).toContain('tipos.filter((k) => !(k === "maintenance" && mantenimiento))');
    const tablero = ini.slice(ini.indexOf('<nav className="ops-tablero"'), ini.indexOf("</nav>"));
    expect(tablero).toContain('data-ir="conteos"');
    expect(tablero).toContain('data-ir="mantenimiento"');
    // La bitácora (el formulario) se sigue pudiendo llenar: se abre desde la sección de Mantenimiento.
    expect(leer(`${OPS}/Mantenimiento.tsx`)).toContain('href="/operaciones/nuevo/maintenance"');
  });
});

describe("11. la cámara en la app de Android", () => {
  it("dentro de una APK anterior a la 9, «Tomar foto» usa la cámara de dentro de la app; fuera, el <input capture> de siempre", () => {
    const ua = (n: number) => `Mozilla/5.0 (Linux; Android 16) Chrome/130 Mobile Safari/537.36 RDZDeliveries/${n}`;
    expect(APK_CON_CAMARA_DEL_FORMULARIO).toBe(9);
    expect(usaCamaraDentroDeLaApp(ua(8), true)).toBe(true);
    expect(usaCamaraDentroDeLaApp(ua(6), true)).toBe(true);
    expect(usaCamaraDentroDeLaApp(ua(8), false)).toBe(false); // sin getUserMedia no hay con qué
    expect(usaCamaraDentroDeLaApp(ua(9), true)).toBe(false); // la APK 9 ya abre la cámara del teléfono
    expect(usaCamaraDentroDeLaApp("Mozilla/5.0 (Linux; Android 16) Chrome/130 Mobile Safari/537.36", true)).toBe(false);
    expect(usaCamaraDentroDeLaApp(null, true)).toBe(false);
  });
  it("la foto de esa cámara se entrega como File, por el mismo camino que la del <input>", async () => {
    const f = ficheroDeDataUrl("data:image/jpeg;base64,/9j/4AAQ");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await f!.arrayBuffer())).slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
    expect(ficheroDeDataUrl("no es una foto")).toBeNull();
    expect(ficheroDeDataUrl("data:image/jpeg;base64,%%%")).toBeNull();
  });
  it("el manifiesto de Android declara <queries> para la cámara (sale en la APK 9)", () => {
    const m = leer("mobile/android/app/src/main/AndroidManifest.xml");
    const q = m.slice(m.indexOf("<queries>"), m.indexOf("</queries>"));
    expect(q).toContain('<action android:name="android.media.action.IMAGE_CAPTURE" />');
    expect(m).toContain('<uses-permission android:name="android.permission.CAMERA" />');
  });
});

describe("12. columnas que se arrastran", () => {
  it("el orden guardado se limpia y soltar una columna sobre otra la deja en su lugar", () => {
    const claves = ["a", "b", "c", "d"];
    expect(ordenLimpio(null, claves)).toEqual(claves);
    expect(ordenLimpio(["c", "x", "c", 7, "a"], claves)).toEqual(["c", "a", "b", "d"]);
    expect(sueltaEnOrden(claves, "a", "c")).toEqual(["b", "c", "a", "d"]); // hacia la derecha: queda después
    expect(sueltaEnOrden(claves, "d", "b")).toEqual(["a", "d", "b", "c"]); // hacia la izquierda: queda antes
    expect(sueltaEnOrden(claves, "a", "a")).toEqual(claves);
    expect(sueltaEnOrden(claves, "a", "zz")).toEqual(claves);
  });
  it("la tabla simple de reportes y el ⚙ Columnas de la de merma también se arrastran", () => {
    expect(LISTA).toContain("useOrdenDeColumnas(`rtg:ops:reportes:orden:${ctx.yo.id}`");
    expect(LISTA).toContain("onSuelta: (desde, sobre) => setPrefs(sueltaColumna(prefs, desde, sobre))");
    expect(leer("src/components/SelectorDeColumnas.tsx")).toContain("draggable={mover.onSuelta ? true : undefined}");
  });
});
