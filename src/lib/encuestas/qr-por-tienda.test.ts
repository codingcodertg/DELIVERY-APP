import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { archivoDelQr, ENLACE_DE_LA_ENCUESTA, enlaceDeTienda, nombresDeTiendas } from "./qr";
import { COLUMNAS, COLUMNAS_SIN_TIENDA, porTienda, tablaCsv, type RespuestaEncuesta } from "./resumen";
import { faltaLaColumna, filaDeLaBase } from "./almacen";

// D-NEXT (2026-10-28) · El dueño, por WhatsApp: «for the survey can it be a QR for each store?». Un QR por tienda: el
// enlace lleva `?tienda=`, el sitio lo manda como `store`, la 209 lo guarda y el panel lo enseña.

const base: RespuestaEncuesta = {
  id: "r1", created_at: "2026-10-28T15:00:00Z", nothing_to_improve: true, selected_areas: [], other_text: null, ratings: {},
  wants_contact: false, contact_name: null, contact_phone: null, contact_email: null, contacted: false, contacted_at: null, note: null,
};

describe("el enlace y el QR de cada tienda", () => {
  it("sin tienda es el enlace general; con tienda, ?tienda= con el nombre codificado tal cual está en Ajustes", () => {
    expect(enlaceDeTienda(null)).toBe(ENLACE_DE_LA_ENCUESTA);
    expect(enlaceDeTienda("  ")).toBe(ENLACE_DE_LA_ENCUESTA);
    expect(enlaceDeTienda("RDZ McAllen")).toBe(`${ENLACE_DE_LA_ENCUESTA}/?tienda=RDZ%20McAllen`);
    expect(enlaceDeTienda(" Bodega Azul ")).toBe(`${ENLACE_DE_LA_ENCUESTA}/?tienda=Bodega%20Azul`);
    expect(decodeURIComponent(new URL(enlaceDeTienda("Peñitas & Co")).searchParams.get("tienda") ?? "")).toBe("Peñitas & Co");
  });
  it("el PNG que se descarga lleva el nombre de la tienda sin acentos ni espacios; sin tienda, el de siempre", () => {
    expect(archivoDelQr(null)).toBe("RTG-encuesta-QR.png");
    expect(archivoDelQr("RDZ McAllen")).toBe("RTG-encuesta-QR-RDZ-McAllen.png");
    expect(archivoDelQr("Peñitas / Sur")).toBe("RTG-encuesta-QR-Penitas-Sur.png");
  });
  it("las tiendas de Ajustes: recortadas, sin vacías ni repetidas, en su orden", () => {
    expect(nombresDeTiendas([{ name: " A " }, { name: "" }, { name: "B" }, { name: "A" }, { name: null }, {}])).toEqual(["A", "B"]);
    expect(nombresDeTiendas(null)).toEqual([]);
  });
});

describe("la tienda en el panel", () => {
  it("se lee de la base (y hay una lista sin ella para cuando la 209 aún no está), y llega a la fila y al CSV", () => {
    expect(COLUMNAS.split(", ")).toContain("store");
    expect(COLUMNAS_SIN_TIENDA.split(", ")).not.toContain("store");
    expect(COLUMNAS_SIN_TIENDA.split(", ")).toContain("rating_notes");
    expect(faltaLaColumna({ code: "42703" })).toBe(true);
    expect(faltaLaColumna({ code: "42P01" })).toBe(false);
    expect(filaDeLaBase({ ...base, store: "RDZ Pharr" }).store).toBe("RDZ Pharr");
    expect(filaDeLaBase({ ...base }).store).toBeNull();
    const csv = tablaCsv([{ ...base, store: "RDZ Pharr" }, base]);
    const col = csv.cabeceras.indexOf("store");
    expect(col).toBeGreaterThan(0);
    expect(csv.filas.map((f) => f[col])).toEqual(["RDZ Pharr", null]);
  });
  it("porTienda cuenta de más a menos y deja «sin tienda» al final", () => {
    const filas = [
      { ...base, id: "1", store: "RDZ Pharr" }, { ...base, id: "2", store: "RDZ McAllen" }, { ...base, id: "3", store: "RDZ McAllen" },
      { ...base, id: "4" }, { ...base, id: "5", store: "  " }, { ...base, id: "6", store: "RDZ Brownsville" },
    ];
    expect(porTienda(filas)).toEqual([
      { tienda: "RDZ McAllen", n: 2 }, { tienda: "RDZ Brownsville", n: 1 }, { tienda: "RDZ Pharr", n: 1 }, { tienda: null, n: 2 },
    ]);
    expect(porTienda([])).toEqual([]);
  });
  it("la 209: columna con su CHECK, la función admite `store` con su tope y lo inserta, y el checksum está puesto", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/209_encuesta_tienda.sql", import.meta.url), "utf8");
    expect(sql).toContain("add column if not exists store text");
    expect(sql).toContain("check (store is null or length(btrim(store)) between 1 and 60)");
    expect(sql).toContain("'contact_name', 'contact_phone', 'contact_email', 'note', 'rating_notes', 'store') then");
    expect(sql).toContain("v_store := public.survey_payload_text(payload, 'store');");
    expect(sql).toContain("if v_store is not null and length(v_store) > 60 then");
    expect(sql).toContain("(v_nothing, v_areas, v_other, v_ratings, v_wants, v_name, v_phone, v_email, v_note, v_notes, v_store)");
    // Lo demás es la 186 tal cual: ninguna regla vieja cambia por el camino.
    expect(sql).toContain("raise exception 'survey: a phone or an email is required to be contacted'");
    expect(sql).toContain("elsif length(v_txt) > 300 then");
    expect(sql).not.toContain("'PENDIENTE'");
  });
  it("la pantalla pinta un QR por tienda, la columna «Tienda» en las dos tablas, y la página lee las tiendas de Ajustes", () => {
    const pantalla = readFileSync(new URL("../../app/surveys/Encuestas.tsx", import.meta.url), "utf8");
    const pagina = readFileSync(new URL("../../app/surveys/page.tsx", import.meta.url), "utf8");
    expect(pantalla).toContain("<TarjetaQr tienda={null} />");
    expect(pantalla).toContain("{tiendas.map((nombre) => <TarjetaQr key={nombre} tienda={nombre} />)}");
    expect(pantalla.split('<th>{t("Store", "Tienda")}</th>').length - 1).toBe(2);
    expect(pantalla.split('<td>{f.store ?? "—"}</td>').length - 1).toBe(2);
    expect(pagina).toContain('.from("settings").select("stores").eq("id", 1).maybeSingle()');
    expect(pagina).toContain("nombresDeTiendas(demoSettings().stores)");
  });
});
