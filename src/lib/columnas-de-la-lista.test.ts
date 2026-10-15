import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  COLUMNAS_DE_DELIVERY, COLUMNAS_DE_LA_LISTA, COLUMNAS_DE_LA_LISTA_SIN_CONTEO, conteoDeFotos, faltaPhotoCount, sinPhotoCount,
} from "./columnas-de-la-lista";
import { blankDelivery } from "./blank-delivery";

// D-562 (177): la lista de órdenes dejó de pedir `select("*")` porque las fotos van en base64 dentro de la fila.
const raiz = path.resolve(__dirname, "..", "..");
const lista = COLUMNAS_DE_LA_LISTA.split(",");

/** Las columnas de `public.deliveries` según schema.sql + las migraciones (add/drop column), quitando comentarios. */
function columnasDeLasMigraciones(): Set<string> {
  const dir = path.join(raiz, "supabase", "migrations");
  const ficheros = [path.join(raiz, "supabase", "schema.sql"), ...fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(dir, f))];
  const sql = ficheros.map((f) => fs.readFileSync(f, "utf8").replace(/--.*$/gm, "")).join("\n");
  const cols = new Set<string>();
  const creada = /create table\s+(?:if not exists\s+)?public\.deliveries\s*\(([\s\S]*?)\n\s*\);/i.exec(sql);
  for (const l of (creada?.[1] ?? "").split("\n")) {
    const k = /^\s*([a-z_0-9]+)\s+[a-z]/.exec(l);
    if (k && !/^(constraint|primary|unique|check|foreign)$/.test(k[1])) cols.add(k[1]);
  }
  const alteraciones = [...sql.matchAll(/alter table\s+(?:if exists\s+)?(?:only\s+)?(?:public\.)?deliveries\b([\s\S]*?);/gi)];
  for (const m of alteraciones) {
    for (const k of m[1].matchAll(/add column\s+(?:if not exists\s+)?([a-z_0-9]+)/gi)) cols.add(k[1]);
    for (const k of m[1].matchAll(/drop column\s+(?:if exists\s+)?([a-z_0-9]+)/gi)) cols.delete(k[1]);
  }
  return cols;
}

describe("las columnas de la lista de órdenes (D-562, 177)", () => {
  it("no piden las fotos (photos, photo_meta) y sí su conteo (photo_count)", () => {
    expect(lista).not.toContain("photos");
    expect(lista).not.toContain("photo_meta");
    expect(lista).toContain("photo_count");
    expect(lista).not.toContain("*");
    expect(lista).toContain("id");
    expect(lista).toContain("updated_at");
  });

  it("sin conteo: lo mismo menos photo_count (para la 177 sin aplicar)", () => {
    const sin = COLUMNAS_DE_LA_LISTA_SIN_CONTEO.split(",");
    expect(sin).not.toContain("photo_count");
    expect(sin).not.toContain("photos");
    expect(sin).not.toContain("photo_meta");
    expect(new Set([...sin, "photo_count"])).toEqual(new Set(lista));
  });

  it("son TODAS las columnas que crean las migraciones: una nueva no se pierde en silencio", () => {
    const enLaBase = columnasDeLasMigraciones();
    expect(enLaBase.size).toBeGreaterThan(60);   // el lector de SQL encontró la tabla
    expect(new Set(COLUMNAS_DE_DELIVERY)).toEqual(enLaBase);
  });

  it("cubren todo lo que tiene una orden en blanco", () => {
    for (const k of Object.keys(blankDelivery())) expect(COLUMNAS_DE_DELIVERY).toContain(k);
  });

  it("la lista de data-provider sale de aquí, no de select(\"*\")", () => {
    const fuente = fs.readFileSync(path.join(raiz, "src", "lib", "data-provider.tsx"), "utf8");
    expect(fuente).toContain("pedir(COLUMNAS_DE_LA_LISTA)");
    expect(fuente).not.toMatch(/from\("deliveries"\)\s*\.select\("\*"\)/);
  });
});

describe("faltaPhotoCount", () => {
  it("reconoce la columna que no existe (la 177 sin aplicar)", () => {
    expect(faltaPhotoCount({ code: "42703", message: "column deliveries.photo_count does not exist" })).toBe(true);
  });
  it("no confunde otro error con ese", () => {
    expect(faltaPhotoCount({ code: "42703", message: "column deliveries.foo does not exist" })).toBe(false);
    expect(faltaPhotoCount({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(faltaPhotoCount(null)).toBe(false);
  });
});

describe("conteoDeFotos", () => {
  it("en una fila de la lista (sin photos) cuenta photo_count", () => {
    expect(conteoDeFotos({ photo_count: 3 })).toBe(3);
    expect(conteoDeFotos({})).toBe(0);
  });
  it("si la fila trae sus fotos, mandan ellas (demo, recién guardadas)", () => {
    expect(conteoDeFotos({ photos: ["a", "b"], photo_count: 0 })).toBe(2);
    expect(conteoDeFotos({ photos: null, photo_count: 4 })).toBe(4);
  });
});

describe("sinPhotoCount", () => {
  it("quita photo_count de lo que se escribe y deja lo demás", () => {
    expect(sinPhotoCount<{ photo_count?: number; stage: string }>({ photo_count: 2, stage: "ready" })).toEqual({ stage: "ready" });
    expect(sinPhotoCount<{ photo_count?: number; stage: string }>({ stage: "ready" })).toEqual({ stage: "ready" });
  });
});
