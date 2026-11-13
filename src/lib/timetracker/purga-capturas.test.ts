import { describe, it, expect } from "vitest";
import {
  corteCapturas, enLotes, purgaCapturas, rutaDeCapturaValida, carpetaDeRuta,
  RETENCION_CAPTURAS_DIAS, LIMITE_CAPTURAS_POR_CORRIDA, BUCKET_CAPTURAS,
} from "./purga-capturas";
import type { FetchLike } from "./live-session-cron";

// La purga de capturas (la que de verdad borra), probada con un fetch FALSO y datos sintéticos: nada toca producción.
// Se vigila: que la antigüedad la mande el created_at del OBJETO en Storage, que una fila solo borre su propio archivo
// (dueño = employee_uid, sin traversal), que un archivo reciente con fila vieja NO se borre, que la fila salga después
// de su archivo, y que un fallo deje las filas para la próxima corrida.

const DIA = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 3, 0, 0);
const URL = "https://x.supabase.co";
const KEY = "service-key";
const ME = "acf43ad5-a937-419b-980c-ef57d45b67c6";
const OTRO = "11111111-2222-4333-8444-555555555555";
const SES = "16bfdf7b-851e-42fb-baac-70a8e48625da";

type Fila = { id: string; path: string | null; employee_uid: string | null; taken_at: string };
type Obj = { name: string; created_at: string };

/**
 * Fetch falso. `filas`: lo que devuelve el SELECT. `carpetas`: objetos de Storage por prefijo (`uid/sesion/`).
 * Registra cada DELETE de Storage (prefijos) y cada DELETE de fila (ids).
 */
function fakeFetch(opts: {
  filas: Fila[];
  carpetas?: Record<string, Obj[]>;
  listOk?: boolean;
  storageOk?: (lote: string[]) => boolean;
  filasOk?: boolean;
}) {
  const storageDeletes: string[][] = [];
  const rowDeletes: string[][] = [];
  const f: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return { ok: true, status: 200, json: async () => opts.filas };
    }
    if (url.includes("/storage/v1/object/list/")) {
      if (opts.listOk === false) return { ok: false, status: 500, json: async () => null };
      const prefix = JSON.parse(init!.body as string).prefix as string;
      const items = (opts.carpetas?.[prefix] ?? []).map((o) => ({ name: o.name, id: "x", created_at: o.created_at }));
      return { ok: true, status: 200, json: async () => items };
    }
    if (url.includes("/storage/v1/object/")) {
      const prefixes = JSON.parse(init!.body as string).prefixes as string[];
      storageDeletes.push(prefixes);
      const ok = opts.storageOk ? opts.storageOk(prefixes) : true;
      return { ok, status: ok ? 200 : 500, json: async () => null };
    }
    const ids = decodeURIComponent(url.split("id=in.(")[1] ?? "").replace(/\)$/, "").split(",").filter(Boolean);
    rowDeletes.push(ids);
    const ok = opts.filasOk ?? true;
    return { ok, status: ok ? 204 : 500, json: async () => null };
  };
  return { f, storageDeletes, rowDeletes };
}

const idDe = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const fila = (i: number, path: string | null, uid: string | null, diasAtras: number): Fila => ({
  id: idDe(i), path, employee_uid: uid, taken_at: new Date(NOW - diasAtras * DIA).toISOString(),
});
const creado = (diasAtras: number) => new Date(NOW - diasAtras * DIA).toISOString();

describe("corteCapturas, enLotes y carpetaDeRuta", () => {
  it("el corte son exactamente los días de retención hacia atrás, y la retención es 14", () => {
    expect(RETENCION_CAPTURAS_DIAS).toBe(14);
    expect(corteCapturas(NOW)).toBe(NOW - 14 * DIA);
    expect(corteCapturas(NOW, 3)).toBe(NOW - 3 * DIA);
  });

  it("enLotes parte en orden, con el último lote más corto", () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(enLotes([], 2)).toEqual([]);
  });

  it("carpetaDeRuta da uid/sesion/", () => {
    expect(carpetaDeRuta(`${ME}/${SES}/1.jpg`)).toBe(`${ME}/${SES}/`);
  });
});

describe("rutaDeCapturaValida (pura)", () => {
  it("acepta <employee_uid propio>/<session>/<archivo>", () => {
    expect(rutaDeCapturaValida(`${ME}/${SES}/1783727331818.jpg`, ME)).toBe(true);
  });

  it("rechaza el dueño distinto (otra persona)", () => {
    expect(rutaDeCapturaValida(`${OTRO}/${SES}/1.jpg`, ME)).toBe(false);
  });

  it("rechaza el recorrido con '..' y la barra inicial o invertida", () => {
    expect(rutaDeCapturaValida(`${ME}/../${OTRO}/${SES}/1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}/${SES}/../../${OTRO}/x.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`/${ME}/${SES}/1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}\\${SES}\\1.jpg`, ME)).toBe(false);
  });

  it("rechaza las formas que no son tres partes, vacías, o sin dueño", () => {
    expect(rutaDeCapturaValida(`${ME}/${SES}`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}/${SES}/a/b.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}//1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(null, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}/${SES}/1.jpg`, null)).toBe(false);
  });
});

describe("purgaCapturas", () => {
  it("borra el archivo viejo de SU carpeta por la API de Storage y luego su fila", async () => {
    const path = `${ME}/${SES}/1.jpg`;
    const { f, storageDeletes, rowDeletes } = fakeFetch({
      filas: [fila(1, path, ME, 20)],
      carpetas: { [`${ME}/${SES}/`]: [{ name: "1.jpg", created_at: creado(20) }] },
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([[path]]);
    expect(rowDeletes).toEqual([[idDe(1)]]);
    expect(out).toMatchObject({ ok: true, archivosBorrados: 1, filasBorradas: 1, rechazadas: 0, recientes: 0 });
  });

  it("archivo RECIENTE con fila de fecha vieja: no se borra ni el archivo ni la fila (la antigüedad es la del objeto)", async () => {
    const path = `${ME}/${SES}/2.jpg`;
    const { f, storageDeletes, rowDeletes } = fakeFetch({
      filas: [fila(2, path, ME, 30)], // la fila dice 30 días
      carpetas: { [`${ME}/${SES}/`]: [{ name: "2.jpg", created_at: creado(1) }] }, // el archivo es de ayer
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([]);
    expect(rowDeletes).toEqual([]);
    expect(out).toMatchObject({ ok: true, recientes: 1, archivosBorrados: 0, filasBorradas: 0 });
  });

  it("fila con ruta de OTRO empleado: se rechaza, no se borra ningún archivo ni fila, y no se lista su carpeta", async () => {
    const ajeno = `${OTRO}/${SES}/9.jpg`;
    const { f, storageDeletes, rowDeletes } = fakeFetch({
      filas: [fila(3, ajeno, ME, 20)], // employee_uid = ME pero la ruta es de OTRO
      carpetas: { [`${OTRO}/${SES}/`]: [{ name: "9.jpg", created_at: creado(20) }] },
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([]);
    expect(rowDeletes).toEqual([]);
    expect(out).toMatchObject({ ok: true, rechazadas: 1, archivosBorrados: 0 });
  });

  it("rutas con recorrido ('..', barra inicial) se rechazan aunque la fila sea del empleado", async () => {
    const { f, storageDeletes, rowDeletes } = fakeFetch({
      filas: [
        fila(4, `${ME}/../${OTRO}/${SES}/4.jpg`, ME, 20),
        fila(5, `/${ME}/${SES}/5.jpg`, ME, 20),
      ],
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([]);
    expect(rowDeletes).toEqual([]);
    expect(out).toMatchObject({ ok: true, rechazadas: 2 });
  });

  it("archivo que ya no está en Storage: solo se borra la fila", async () => {
    const { f, storageDeletes, rowDeletes } = fakeFetch({
      filas: [fila(6, `${ME}/${SES}/6.jpg`, ME, 20)],
      carpetas: { [`${ME}/${SES}/`]: [] },
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([]);
    expect(rowDeletes).toEqual([[idDe(6)]]);
    expect(out).toMatchObject({ ok: true, sinArchivo: 1, filasBorradas: 1 });
  });

  it("fila sin ruta: se borra la fila, sin tocar Storage", async () => {
    const { f, storageDeletes, rowDeletes } = fakeFetch({ filas: [fila(7, null, ME, 30)] });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([]);
    expect(rowDeletes).toEqual([[idDe(7)]]);
    expect(out).toMatchObject({ ok: true, sinArchivo: 1, filasBorradas: 1 });
  });

  it("si el borrado del archivo falla, su fila NO se borra (queda para la próxima corrida)", async () => {
    const path = `${ME}/${SES}/8.jpg`;
    const { f, rowDeletes } = fakeFetch({
      filas: [fila(8, path, ME, 20)],
      carpetas: { [`${ME}/${SES}/`]: [{ name: "8.jpg", created_at: creado(20) }] },
      storageOk: () => false,
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(rowDeletes).toEqual([]);
    expect(out).toMatchObject({ ok: false, archivosBorrados: 0, filasBorradas: 0, fallidas: 1 });
  });

  it("si listar la carpeta falla, no se borra nada de esa sesión", async () => {
    const { f, storageDeletes, rowDeletes } = fakeFetch({
      filas: [fila(9, `${ME}/${SES}/9.jpg`, ME, 20)],
      carpetas: { [`${ME}/${SES}/`]: [{ name: "9.jpg", created_at: creado(20) }] },
      listOk: false,
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([]);
    expect(rowDeletes).toEqual([]);
    expect(out).toMatchObject({ ok: false, fallidas: 1 });
  });

  it("pide solo filas ANTERIORES al corte, con el perfil timetracker y el tope por corrida", async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, headers: init?.headers as Record<string, string> | undefined });
      return { ok: true, status: 200, json: async () => [] };
    };
    await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(calls[0].url).toContain("/rest/v1/screenshots?select=id,path,employee_uid&taken_at=lt.");
    expect(calls[0].url).toContain(`limit=${LIMITE_CAPTURAS_POR_CORRIDA}`);
    expect(decodeURIComponent(calls[0].url)).toContain(new Date(corteCapturas(NOW)).toISOString());
    expect(calls[0].headers?.["Accept-Profile"]).toBe("timetracker");
  });

  it("los archivos se borran en lotes de 100 por llamada", async () => {
    const filas = Array.from({ length: 250 }, (_, i) => fila(i + 1, `${ME}/${SES}/${i}.jpg`, ME, 20));
    const objetos = Array.from({ length: 250 }, (_, i) => ({ name: `${i}.jpg`, created_at: creado(20) }));
    const { f, storageDeletes } = fakeFetch({ filas, carpetas: { [`${ME}/${SES}/`]: objetos } });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, limite: 250, fetchImpl: f });
    expect(storageDeletes.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(out.archivosBorrados).toBe(250);
    expect(BUCKET_CAPTURAS).toBe("timetracker-screenshots");
  });
});
