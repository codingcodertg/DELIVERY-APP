import { describe, it, expect } from "vitest";
import {
  candidatasDeStorage, corteCapturas, enLotes, purgaCapturas, rutaDeCapturaValida,
  RETENCION_CAPTURAS_DIAS, LIMITE_CAPTURAS_POR_CORRIDA, BUCKET_CAPTURAS, FUNCION_CANDIDATAS,
} from "./purga-capturas";
import type { FetchLike } from "./live-session-cron";

// La purga de capturas, probada con un fetch FALSO y datos sintéticos: nada toca producción.
// Se vigila: que las candidatas salgan de storage.objects (no de las filas), que una fila NUNCA decida un borrado, que
// los objetos mal formados no bloqueen la purga (starvation), que un archivo reciente no se borre aunque su fila sea
// vieja, y que el borrado de filas vaya solo detrás del archivo.

const DIA = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 3, 0, 0);
const URL = "https://x.supabase.co";
const KEY = "service-key";
const ME = "acf43ad5-a937-419b-980c-ef57d45b67c6";
const OTRO = "11111111-2222-4333-8444-555555555555";
const SES = "16bfdf7b-851e-42fb-baac-70a8e48625da";

type Obj = { name: string; created_at: string };

/** Forma que la función SQL (migración 304) deja pasar: tres partes, sin `..`, barra inicial, barra invertida ni comillas. */
const formaSql = (n: string) => /^[^/]+\/[^/]+\/[^/]+$/.test(n) && !/(\.\.|\\|^\/|")/.test(n);

/**
 * Fetch falso. `objetos` es storage.objects del bucket. El RPC emula la función SQL: forma válida, anterior al corte,
 * orden ascendente y LIMIT. Registra cada borrado de Storage y de filas, y cualquier lectura de la tabla de filas.
 */
function fakeFetch(opts: {
  objetos: Obj[];
  storageOk?: (lote: string[]) => boolean;
  filasOk?: boolean;
}) {
  const storageDeletes: string[][] = [];
  const rowDeletes: string[][] = [];
  const rowReads: string[] = [];
  const rpcs: Array<{ url: string; body: { corte: string; limite: number }; headers?: Record<string, string> }> = [];
  const f: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    if (url.includes(`/rest/v1/rpc/${FUNCION_CANDIDATAS}`)) {
      const body = JSON.parse(init!.body as string);
      rpcs.push({ url, body, headers: init?.headers as Record<string, string> });
      const corteMs = Date.parse(body.corte);
      const rows = opts.objetos
        .filter((o) => formaSql(o.name) && Date.parse(o.created_at) < corteMs)
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .slice(0, body.limite);
      return { ok: true, status: 200, json: async () => rows };
    }
    if (url.includes("/rest/v1/screenshots") && method === "GET") {
      rowReads.push(url);
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes("/storage/v1/object/")) {
      const prefixes = JSON.parse(init!.body as string).prefixes as string[];
      storageDeletes.push(prefixes);
      const ok = opts.storageOk ? opts.storageOk(prefixes) : true;
      return { ok, status: ok ? 200 : 500, json: async () => null };
    }
    // DELETE de filas: ?path=in.("p1","p2")
    const enc = url.split("path=in.(")[1] ?? "";
    const lista = decodeURIComponent(enc).replace(/\)$/, "");
    const paths = lista.split(",").map((p) => p.replace(/^"|"$/g, "")).filter(Boolean);
    rowDeletes.push(paths);
    const ok = opts.filasOk ?? true;
    return { ok, status: ok ? 200 : 500, json: async () => paths.map((p) => ({ path: p })) };
  };
  return { f, storageDeletes, rowDeletes, rowReads, rpcs };
}

const creado = (diasAtras: number) => new Date(NOW - diasAtras * DIA).toISOString();

describe("corteCapturas, enLotes, rutaDeCapturaValida", () => {
  it("el corte son exactamente los días de retención hacia atrás, y la retención es 14", () => {
    expect(RETENCION_CAPTURAS_DIAS).toBe(14);
    expect(corteCapturas(NOW)).toBe(NOW - 14 * DIA);
    expect(corteCapturas(NOW, 3)).toBe(NOW - 3 * DIA);
  });

  it("enLotes parte en orden, con el último lote más corto", () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(enLotes([], 2)).toEqual([]);
  });

  it("acepta <employee_uid propio>/<session>/<archivo> y rechaza otro dueño, recorridos y formas raras", () => {
    expect(rutaDeCapturaValida(`${ME}/${SES}/1.jpg`, ME)).toBe(true);
    expect(rutaDeCapturaValida(`${OTRO}/${SES}/1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}/../${OTRO}/${SES}/1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`/${ME}/${SES}/1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}\\${SES}\\1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}/${SES}`, ME)).toBe(false);
    expect(rutaDeCapturaValida(`${ME}//1.jpg`, ME)).toBe(false);
    expect(rutaDeCapturaValida(null, ME)).toBe(false);
  });
});

describe("candidatasDeStorage (pura)", () => {
  const corteMs = corteCapturas(NOW);
  const o = (name: string, diasAtras: number) => ({ name, created_at: creado(diasAtras) });

  it("solo objetos con forma de captura, anteriores al corte, de más viejo a más nuevo, con límite", () => {
    const c = candidatasDeStorage(
      [o(`${ME}/${SES}/b.jpg`, 20), o(`${ME}/${SES}/nuevo.jpg`, 2), o(`${ME}/${SES}/a.jpg`, 30), o(`${ME}/${SES}/c.jpg`, 25)],
      corteMs,
      2,
    );
    expect(c.map((x) => x.path)).toEqual([`${ME}/${SES}/a.jpg`, `${ME}/${SES}/c.jpg`]);
  });

  it("descarta forma rara, recorridos, comillas y objetos sin fecha", () => {
    const c = candidatasDeStorage(
      [
        o(`${ME}/${SES}/x/y.jpg`, 30),
        o(`${ME}/../x/y.jpg`, 30),
        o(`/${ME}/${SES}/z.jpg`, 30),
        o(`${ME}/${SES}/q"uote.jpg`, 30),
        { name: `${ME}/${SES}/sin.jpg`, created_at: null },
      ],
      corteMs,
      100,
    );
    expect(c).toEqual([]);
  });
});

describe("purgaCapturas", () => {
  it("las candidatas salen de storage.objects por la función, con el perfil timetracker y el corte/límite", async () => {
    const { f, rpcs } = fakeFetch({ objetos: [] });
    await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].url).toBe(`${URL}/rest/v1/rpc/${FUNCION_CANDIDATAS}`);
    expect(rpcs[0].body.limite).toBe(LIMITE_CAPTURAS_POR_CORRIDA);
    expect(rpcs[0].body.corte).toBe(new Date(corteCapturas(NOW)).toISOString());
    expect(rpcs[0].headers?.["Content-Profile"]).toBe("timetracker");
  });

  it("borra el archivo viejo por la API de Storage y luego su fila, por la ruta del archivo", async () => {
    const path = `${ME}/${SES}/1.jpg`;
    const { f, storageDeletes, rowDeletes } = fakeFetch({ objetos: [{ name: path, created_at: creado(20) }] });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([[path]]);
    expect(rowDeletes).toEqual([[path]]);
    expect(out).toMatchObject({ ok: true, encontradas: 1, archivosBorrados: 1, filasBorradas: 1, rechazadas: 0 });
  });

  it("N objetos falsos ANTES que los archivos reales no bloquean la purga: los reales se borran", async () => {
    // 600 objetos mal formados, más viejos que los reales y listados primero (recorrido, barra inicial, cuatro partes).
    const falsos: Obj[] = Array.from({ length: 600 }, (_, i) => ({
      name: i % 3 === 0 ? `${ME}/../${OTRO}/${SES}/${i}.jpg` : i % 3 === 1 ? `/${ME}/${SES}/${i}.jpg` : `${ME}/${SES}/x/${i}.jpg`,
      created_at: creado(200 - i / 10),
    }));
    const reales: Obj[] = [1, 2, 3].map((i) => ({ name: `${ME}/${SES}/real-${i}.jpg`, created_at: creado(40 - i) }));
    const { f, storageDeletes, rowDeletes } = fakeFetch({ objetos: [...falsos, ...reales] });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    const borrados = storageDeletes.flat();
    expect(borrados.sort()).toEqual(reales.map((r) => r.name).sort());
    expect(rowDeletes.flat().sort()).toEqual(reales.map((r) => r.name).sort());
    expect(out).toMatchObject({ ok: true, archivosBorrados: 3, filasBorradas: 3 });
  });

  it("archivo RECIENTE con fila de fecha vieja: no se borra nada (la antigüedad es la del objeto)", async () => {
    const path = `${ME}/${SES}/2.jpg`;
    const { f, storageDeletes, rowDeletes, rowReads } = fakeFetch({ objetos: [{ name: path, created_at: creado(1) }] });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(storageDeletes).toEqual([]);
    expect(rowDeletes).toEqual([]);
    expect(rowReads).toEqual([]); // las filas nunca deciden
    expect(out).toMatchObject({ ok: true, encontradas: 0, archivosBorrados: 0, filasBorradas: 0 });
  });

  it("nunca lee filas: solo borra filas cuya ruta es un archivo ya borrado", async () => {
    const real = `${ME}/${SES}/3.jpg`;
    const { f, rowDeletes, rowReads } = fakeFetch({ objetos: [{ name: real, created_at: creado(30) }] });
    await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(rowReads).toEqual([]);
    expect(rowDeletes.flat()).toEqual([real]);
  });

  it("si el borrado del archivo falla, su fila NO se borra (queda para la próxima corrida)", async () => {
    const path = `${ME}/${SES}/8.jpg`;
    const { f, rowDeletes } = fakeFetch({
      objetos: [{ name: path, created_at: creado(20) }],
      storageOk: () => false,
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(rowDeletes).toEqual([]);
    expect(out).toMatchObject({ ok: false, archivosBorrados: 0, filasBorradas: 0, fallidas: 1 });
  });

  it("si el borrado de filas falla tras borrar el archivo, sale no ok y lo deja anotado", async () => {
    const path = `${ME}/${SES}/9.jpg`;
    const { f } = fakeFetch({ objetos: [{ name: path, created_at: creado(20) }], filasOk: false });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(out).toMatchObject({ ok: false, archivosBorrados: 1, filasBorradas: 0, fallidas: 1 });
  });

  it("si la función no responde, no se borra nada", async () => {
    const f: FetchLike = async (url) => ({
      ok: !url.includes("/rpc/"),
      status: 500,
      json: async () => [],
    });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, fetchImpl: f });
    expect(out.ok).toBe(false);
    expect(out.archivosBorrados).toBe(0);
  });

  it("los archivos se borran en lotes de 100 por llamada", async () => {
    const objetos = Array.from({ length: 250 }, (_, i) => ({ name: `${ME}/${SES}/${i}.jpg`, created_at: creado(20) }));
    const { f, storageDeletes } = fakeFetch({ objetos });
    const out = await purgaCapturas({ url: URL, key: KEY, now: NOW, limite: 250, fetchImpl: f });
    expect(storageDeletes.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(out.archivosBorrados).toBe(250);
    expect(BUCKET_CAPTURAS).toBe("timetracker-screenshots");
  });
});
