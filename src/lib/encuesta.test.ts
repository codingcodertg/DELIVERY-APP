import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// La encuesta de satisfacción del seguimiento (D-418, 151). El cliente de Supabase es FALSO: nada sale de esta máquina,
// y la ruta nunca manda nada a nadie (no hay proveedor que stubear: la encuesta no avisa).

const falso = vi.hoisted(() => ({
  orden: null as { stage: string } | null,
  insertErr: null as { code: string; message: string } | null,
  encuesta: null as { delivery_id: string } | null,
  encuestaErr: null as { code: string; message: string } | null,
  inserts: [] as unknown[],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => (tabla === "deliveries"
        ? { data: falso.orden ? { order_no: 7, order_code: "A-7", account: "Cliente SA", delivery_address: "1 Calle", ...falso.orden } : null, error: null }
        : { data: falso.encuesta, error: falso.encuestaErr });
      q.insert = async (v: unknown) => { falso.inserts.push({ tabla, v }); return { error: falso.insertErr }; };
      return q;
    },
  }),
}));

import { POST } from "@/app/api/track/[id]/survey/route";
import { GET } from "@/app/api/track/[id]/route";
import {
  esIdDeOrden, guardaEncuestaLocal, leeEncuestasLocales, MAX_COMENTARIO, resumenDeEncuestas, sePuedeCalificar, validaRespuesta, veEncuestas,
} from "./encuesta";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ID = "3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f60718";
const manda = (id: string, cuerpo: unknown) =>
  POST(new Request(`http://localhost/api/track/${id}/survey`, { method: "POST", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }), { params: Promise.resolve({ id }) });

beforeEach(() => { falso.orden = { stage: "delivered" }; falso.insertErr = null; falso.encuesta = null; falso.encuestaErr = null; falso.inserts = []; });

describe("la librería", () => {
  it("una respuesta vale con estrellas ENTERAS del 1 al 5; el comentario se limpia y se corta", () => {
    expect(validaRespuesta({ rating: 5 })).toEqual({ ok: true, respuesta: { rating: 5, comment: null } });
    expect(validaRespuesta({ rating: 1, comment: "  muy bien\u0007  " })).toEqual({ ok: true, respuesta: { rating: 1, comment: "muy bien" } });
    expect(validaRespuesta({ rating: 3, comment: "a\nb" })).toEqual({ ok: true, respuesta: { rating: 3, comment: "a\nb" } });
    expect(validaRespuesta({ rating: 4, comment: "x".repeat(900) }).ok && (validaRespuesta({ rating: 4, comment: "x".repeat(900) }) as { respuesta: { comment: string } }).respuesta.comment.length).toBe(MAX_COMENTARIO);
    for (const malo of [{ rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: "5" }, {}, null, "5", { rating: 5, comment: 3 }]) expect(validaRespuesta(malo).ok).toBe(false);
  });

  it("solo una orden entregada; el id tiene forma de uuid", () => {
    expect(sePuedeCalificar("delivered")).toBe(true);
    for (const e of ["ready", "picked_up", "canceled", null]) expect(sePuedeCalificar(e)).toBe(false);
    expect(esIdDeOrden(ID)).toBe(true);
    for (const x of ["123", "abc", `${ID}x`, "'; drop table x; --"]) expect(esIdDeOrden(x)).toBe(false);
  });

  it("quién ve los resultados: admin, logística y gerente", () => {
    expect(["admin", "logistics", "manager"].every((r) => veEncuestas(r as never))).toBe(true);
    for (const r of ["sales", "driver", "warehouse", "accounting", null]) expect(veEncuestas(r as never)).toBe(false);
  });

  it("el resumen del Panel cuenta SOLO las órdenes del Panel", () => {
    const filas = [
      { delivery_id: "a", rating: 5, comment: "genial", created_at: "2026-09-02" },
      { delivery_id: "b", rating: 2, comment: null, created_at: "2026-09-03" },
      { delivery_id: "c", rating: 4, comment: "bien", created_at: "2026-09-04" },
      { delivery_id: "otra-tienda", rating: 1, comment: "mal", created_at: "2026-09-05" },
    ];
    const r = resumenDeEncuestas(filas, new Set(["a", "b", "c"]));
    expect(r.respuestas).toBe(3);
    expect(r.media).toBe(3.7);
    expect(r.reparto).toEqual([0, 1, 0, 1, 1]);
    expect(r.comentarios.map((c) => c.delivery_id)).toEqual(["c", "a"]);
    expect(resumenDeEncuestas([], new Set()).media).toBeNull();
  });

  it("el demo guarda una por orden, en el navegador", () => {
    const m = new Map<string, string>();
    const almacen = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(guardaEncuestaLocal(almacen, "a", { rating: 4, comment: null }, "2026-09-27T10:00:00Z")).toBe(true);
    expect(guardaEncuestaLocal(almacen, "a", { rating: 1, comment: null }, "2026-09-27T10:01:00Z")).toBe(false);
    expect(leeEncuestasLocales(almacen)).toEqual([{ delivery_id: "a", rating: 4, comment: null, created_at: "2026-09-27T10:00:00Z" }]);
  });
});

describe("POST /api/track/<id>/survey: comprueba todo antes de escribir, y no devuelve nada de la orden", () => {
  it("guarda estrellas y comentario limpios, y contesta solo `ok`", async () => {
    const res = await manda(ID, { rating: 5, comment: "  gracias  " });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toEqual({ ok: true });
    expect(falso.inserts).toEqual([{ tabla: "delivery_surveys", v: { delivery_id: ID, rating: 5, comment: "gracias" } }]);
  });

  it("un id que no es uuid, un cuerpo que no vale o demasiado grande: ni se busca la orden, ni se escribe", async () => {
    expect((await manda("123", { rating: 5 })).status).toBe(404);
    expect((await manda(ID, { rating: 9 })).status).toBe(400);
    expect((await manda(ID, "no es json")).status).toBe(400);
    expect((await manda(ID, JSON.stringify({ rating: 5, comment: "x".repeat(3000) }))).status).toBe(413);
    expect(falso.inserts).toEqual([]);
  });

  it("una orden que no existe o que no está entregada no se califica", async () => {
    falso.orden = null;
    expect((await manda(ID, { rating: 5 })).status).toBe(404);
    falso.orden = { stage: "picked_up" };
    expect((await manda(ID, { rating: 5 })).status).toBe(409);
    expect(falso.inserts).toEqual([]);
  });

  it("la segunda respuesta de la misma orden choca con la clave (23505) y se dice «ya estaba»; sin la tabla, 503", async () => {
    falso.insertErr = { code: "23505", message: "duplicate key" };
    const r = await manda(ID, { rating: 3 });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: true, already: true });
    falso.insertErr = { code: "PGRST205", message: "Could not find the table 'public.delivery_surveys' in the schema cache" };
    expect((await manda(ID, { rating: 3 })).status).toBe(503);
  });
});

describe("GET /api/track/<id>: dice SI ya se respondió, nunca la respuesta", () => {
  const pide = () => GET(new Request(`http://localhost/api/track/${ID}`), { params: Promise.resolve({ id: ID }) });
  it("entregada: `survey.answered`; sin la tabla, `survey: null` y el seguimiento sigue igual", async () => {
    expect((await (await pide()).json()).survey).toEqual({ answered: false });
    falso.encuesta = { delivery_id: ID };
    expect((await (await pide()).json()).survey).toEqual({ answered: true });
    falso.encuestaErr = { code: "PGRST205", message: "no table" };
    const b = await (await pide()).json();
    expect(b.survey).toBeNull();
    expect(b.order.stage).toBe("delivered");
  });
  it("sin entregar, ni se pregunta", async () => {
    falso.orden = { stage: "ready" };
    expect((await (await pide()).json()).survey).toBeNull();
  });
});

describe("las pantallas", () => {
  it("la página de seguimiento la enseña solo entregada y con `survey`, y manda por la ruta", () => {
    const p = plano(leer("src/app/track/[id]/page.tsx"));
    expect(p).toContain("{sePuedeCalificar(order.stage) && survey && <Encuesta id={id} answered={survey.answered} />}");
    expect(p).toContain("const v = validaRespuesta({ rating: stars, comment });");
    expect(p).toContain("fetch(`/api/track/${id}/survey`, { method: \"POST\"");
    // Nada de SMS: la encuesta vive en la página.
    expect(p).not.toContain("/api/notify");
  });
  it("el Panel la pinta con SUS órdenes (`scoped`), y la tarjeta usa `resumenDeEncuestas` y `veEncuestas`", () => {
    expect(plano(leer("src/app/(app)/dashboard/page.tsx"))).toContain("<EncuestaDelPanel desde={from} entregasDelPanel={scoped} />");
    const c = plano(leer("src/components/EncuestaDelPanel.tsx"));
    expect(c).toContain("const puedeVer = veEncuestas(me?.role);");
    expect(c).toContain("resumenDeEncuestas(filas ?? [], new Set(porId.keys()))");
    expect(c).toContain("if (!puedeVer || sinTabla) return null;");
  });
  it("ni la ficha ni la vista del chofer la enseñan (D-043, D-026)", () => {
    for (const f of ["src/components/OrderModal.tsx", "src/app/(app)/driver/page.tsx"]) expect(leer(f)).not.toContain("delivery_surveys");
  });
});

describe("la migración 151", () => {
  const sql = leer("supabase/migrations/151_requisitos_y_encuesta.sql");
  const codigo = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("la encuesta: una sola política, de LECTURA, para admin/logística/gerente y órdenes que ya ve; ninguna de escritura", () => {
    const c = plano(codigo(sql));
    expect((c.match(/create policy/g) ?? []).length).toBe(1);
    expect(c).toContain('create policy "delivery_surveys select" on public.delivery_surveys for select to authenticated');
    expect(c).toContain("(select public.current_user_role()) in ('admin', 'logistics', 'manager')");
    expect(c).toContain("exists (select 1 from public.deliveries d where d.id = delivery_surveys.delivery_id)");
    expect(c).toContain("revoke all on public.delivery_surveys from anon, authenticated;");
    expect(c).toContain("grant select on public.delivery_surveys to authenticated;");
    expect(c).not.toMatch(/grant [^;]*(insert|update|delete)[^;]* to (anon|authenticated)/);
    expect(c).toContain("delivery_id uuid primary key references public.deliveries(id) on delete cascade");
    expect(c).toContain("d.stage = 'delivered'");
  });
  it("las tres columnas de requisitos, text[] not null default '{}'", () => {
    const c = plano(codigo(sql));
    for (const [t, col] of [["settings", "delivery_requirements"], ["deliveries", "requirements"], ["driver_settings", "features"]]) {
      expect(c).toContain(`alter table public.${t} add column if not exists ${col} text[] not null default '{}'::text[];`);
    }
  });
  it("sin begin/commit propios, sin D-418 dentro (numerar cambiaría el checksum), con reversión y con su fila del registro al día", () => {
    expect(codigo(sql)).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/im);
    expect(sql).not.toContain("D-418");
    expect(sql).toContain("--   drop table if exists public.delivery_surveys;");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('151_requisitos_y_encuesta.sql', '${sha}') on conflict (name) do nothing;`);
  });
});
