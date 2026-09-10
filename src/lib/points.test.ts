import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TASAS_POR_DEFECTO, canje, clavePuntualidad, eventoManual, eventoPuntualidad,
  eventosVisiblesParaEmpleado, puedeConceder, saldo, tasas,
} from "./points";
import type { Profile } from "./types";

// Encargo 1 de cinco: solo base y librería. Lo que decide de verdad quién escribe
// vive en 105 (RLS + guard), así que estas pruebas son de dos clases y conviene no
// confundirlas: las de la función, que importan el código que corre; y las del
// `.sql`, que leen el fichero — texto, no una base ejecutando.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/105_points_ledger.sql");

const admin = { id: "u-admin", role: "admin" } as Pick<Profile, "id" | "role">;
const gerente = { id: "u-mgr", role: "manager" } as Pick<Profile, "id" | "role">;
const vendedor = { id: "u-sales", role: "sales" } as Pick<Profile, "id" | "role">;

describe("el saldo se suma, nunca se guarda", () => {
  it("suma positivos y negativos, y sin eventos es cero", () => {
    expect(saldo([])).toBe(0);
    expect(saldo([{ points: 2 }, { points: 2 }, { points: -5 }, { points: 100 }])).toBe(99);
  });

  it("el empleado solo ve lo que suma, pero su saldo cuenta las restas", () => {
    // La decisión del dueño: ve su saldo, no el detalle de las restas. Las dos
    // mitades tienen que cuadrar así, o el empleado suma lo que ve y no le da.
    const eventos = [{ points: 10 }, { points: -4 }, { points: 2 }];
    expect(eventosVisiblesParaEmpleado(eventos).map((e) => e.points)).toEqual([10, 2]);
    expect(saldo(eventos)).toBe(8);
    expect(saldo(eventosVisiblesParaEmpleado(eventos))).toBe(12); // ≠ 8, y por eso el saldo lo da la base
  });
});

describe("las tasas viven en Ajustes", () => {
  it("manda Ajustes cuando trae un entero positivo", () => {
    expect(tasas({ points_per_punctual_day: 5, points_per_day_off: 250 })).toEqual({ puntual: 5, diaLibre: 250 });
  });

  it("cae al respaldo con null, cero, negativos o decimales", () => {
    for (const malo of [null, undefined, 0, -3, 2.5, "4" as unknown as number]) {
      expect(tasas({ points_per_punctual_day: malo, points_per_day_off: malo })).toEqual({
        puntual: TASAS_POR_DEFECTO.puntual, diaLibre: TASAS_POR_DEFECTO.diaLibre,
      });
    }
  });

  it("las tasas llegan al cliente sin tocar nada, porque Ajustes se lee entero", () => {
    // No hay que añadir las dos columnas a ninguna consulta: `settings` se lee con
    // `select("*")`. Queda fijado porque el día que alguien lo estreche a una lista de
    // columnas, las tasas dejarán de llegar y `tasas()` caerá al respaldo sin avisar —
    // el sistema seguiría funcionando con los números equivocados.
    expect(leer("src/lib/data-provider.tsx")).toContain('from("settings").select("*")');
  });

  it("el respaldo del código es el mismo número que el DEFAULT de la columna", () => {
    // Dos sitios que pueden separarse sin que nada avise: el día que alguien cambie
    // el default de la columna y no este archivo, un entorno nuevo arrancaría con una
    // tasa y el respaldo diría otra.
    const puntual = sql.match(/points_per_punctual_day\s+integer not null default (\d+)/);
    const diaLibre = sql.match(/points_per_day_off\s+integer not null default (\d+)/);
    expect(puntual, "no encontré el default de points_per_punctual_day").toBeTruthy();
    expect(diaLibre, "no encontré el default de points_per_day_off").toBeTruthy();
    expect(Number(puntual![1])).toBe(TASAS_POR_DEFECTO.puntual);
    expect(Number(diaLibre![1])).toBe(TASAS_POR_DEFECTO.diaLibre);
  });
});

describe("canje", () => {
  it("cuántos días cubre el saldo y cuánto falta para el siguiente", () => {
    expect(canje(0, 100)).toEqual({ dias: 0, faltan: 100 });
    expect(canje(40, 100)).toEqual({ dias: 0, faltan: 60 });
    expect(canje(100, 100)).toEqual({ dias: 1, faltan: 100 });
    expect(canje(250, 100)).toEqual({ dias: 2, faltan: 50 });
  });

  it("un saldo negativo no canjea nada y no inventa días", () => {
    expect(canje(-30, 100).dias).toBe(0);
  });

  it("un costo imposible no divide por cero", () => {
    expect(canje(500, 0)).toEqual({ dias: 0, faltan: 0 });
  });
});

describe("quién puntea", () => {
  it("admin y gerente sí; el resto no", () => {
    expect(puedeConceder(admin, "otro")).toBe(true);
    expect(puedeConceder(gerente, "otro")).toBe(true);
    expect(puedeConceder(vendedor, "otro")).toBe(false);
    expect(puedeConceder(null, "otro")).toBe(false);
  });

  it("nadie se puntea a sí mismo, ni el admin", () => {
    expect(puedeConceder(admin, admin.id)).toBe(false);
    expect(puedeConceder(gerente, gerente.id)).toBe(false);
  });
});

describe("construir un apunte manual", () => {
  const base = { employeeId: "u-emp", points: 2, reason: "punctual_day" };

  it("una fila firmada por quien la concede, y siempre manual", () => {
    const r = eventoManual({ ...base, note: "  llegó antes que nadie  " }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({
      employee_id: "u-emp", account: null, points: 2, reason: "punctual_day",
      kind: "manual", source_key: null, granted_by: admin.id, note: "llegó antes que nadie",
    });
  });

  it("un cliente en vez de un empleado, con su account", () => {
    const r = eventoManual({ account: " Tile Depot ", points: 5, reason: "customer_photo" }, gerente);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.account).toBe("Tile Depot");
    expect(r.valor.employee_id).toBeNull();
  });

  it("rechaza los dos sujetos a la vez, y ninguno", () => {
    expect(eventoManual({ employeeId: "u-emp", account: "Tile Depot", points: 1, reason: "x" }, admin).ok).toBe(false);
    expect(eventoManual({ points: 1, reason: "x" }, admin).ok).toBe(false);
  });

  it("rechaza cero, decimales y motivos vacíos o largos", () => {
    expect(eventoManual({ ...base, points: 0 }, admin).ok).toBe(false);
    expect(eventoManual({ ...base, points: 1.5 }, admin).ok).toBe(false);
    expect(eventoManual({ ...base, reason: "   " }, admin).ok).toBe(false);
    expect(eventoManual({ ...base, reason: "x".repeat(81) }, admin).ok).toBe(false);
  });

  it("acepta restar, que es la mitad del sistema", () => {
    const r = eventoManual({ ...base, points: -10, reason: "late" }, gerente);
    expect(r.ok).toBe(true);
  });

  it("no deja construir lo que la base va a rechazar: sobre sí mismo, o sin rol", () => {
    expect(eventoManual({ ...base, employeeId: admin.id }, admin).ok).toBe(false);
    expect(eventoManual(base, vendedor).ok).toBe(false);
  });
});

describe("el día puntual y su clave", () => {
  it("la clave es empleado + día, así que el mismo día no paga dos veces", () => {
    expect(clavePuntualidad("u-emp", "2026-09-10")).toBe("punctual:u-emp:2026-09-10");
    expect(clavePuntualidad("u-emp", "2026-09-10")).toBe(clavePuntualidad("u-emp", "2026-09-10"));
    expect(clavePuntualidad("u-emp", "2026-09-11")).not.toBe(clavePuntualidad("u-emp", "2026-09-10"));
    expect(clavePuntualidad("u-otro", "2026-09-10")).not.toBe(clavePuntualidad("u-emp", "2026-09-10"));
  });

  it("es automático, no lo firma nadie, y lleva su clave", () => {
    const e = eventoPuntualidad("u-emp", "2026-09-10", tasas().puntual);
    expect(e.kind).toBe("auto");
    expect(e.granted_by).toBeNull();
    expect(e.source_key).toBe("punctual:u-emp:2026-09-10");
    expect(e.points).toBe(TASAS_POR_DEFECTO.puntual);
  });
});

describe("105_points_ledger.sql", () => {
  it("se puede ejecutar dos veces: todo lo que crea es idempotente", () => {
    // Es la condición que pidió el orquestador, y la que evita repetir la caída del
    // 2026-09-10: la migración se aplica a mano ANTES de fusionar, y quien la aplique
    // no puede quedarse con la duda de si ya la había corrido.
    const crea = sql.split("\n").filter((l) => /^\s*create (table|index|unique index|trigger)/i.test(l));
    expect(crea.length).toBeGreaterThanOrEqual(5);
    for (const l of crea) {
      expect(l, l).toMatch(/if not exists|create trigger/i);
    }
    // Los triggers no admiten `if not exists`: se borran antes.
    const triggers = (sql.match(/create trigger (\w+)/g) ?? []).map((m) => m.split(" ")[2]);
    expect(triggers.length).toBeGreaterThan(0);
    for (const t of triggers) expect(sql).toContain(`drop trigger if exists ${t}`);
    for (const p of sql.match(/create policy "([^"]+)"/g) ?? []) {
      expect(sql).toContain(`drop policy if exists ${p.slice("create policy ".length)}`);
    }
    // Y las columnas de Ajustes no se pueden añadir dos veces sin `if not exists`.
    for (const a of sql.match(/add column[^,;]*/g) ?? []) expect(a).toContain("if not exists");
  });

  it("el saldo no tiene columna en ninguna parte", () => {
    // Si alguien añade `balance` a profiles, la mitad del sistema deja de cuadrar
    // en silencio: el libro mayor dirá una cosa y la columna otra.
    expect(sql).not.toMatch(/\bbalance\s+(integer|int|numeric)/i);
    expect(sql).not.toMatch(/add column[^;]*\bpoints\b\s+integer/i);
  });

  it("append-only: ni política ni privilegio de update o delete", () => {
    expect(sql).not.toMatch(/create policy[^;]*for (update|delete)[^;]*point_events/i);
    expect(sql).not.toMatch(/point_events[^;]*for (update|delete)/i);
    const grant = sql.match(/grant ([a-z, ]+) on public\.point_events/i);
    expect(grant![1].trim()).toBe("select, insert");
    // Y un guard que también frena a service_role, que salta la RLS pero no un trigger.
    expect(sql).toMatch(/create trigger point_events_append_only\s+before update or delete/);
  });

  it("nadie se puntea a sí mismo, y los automáticos no entran desde un cliente", () => {
    const insert = sql.slice(sql.indexOf('create policy "point_events insert manual"'));
    const cuerpo = insert.slice(0, insert.indexOf(";"));
    expect(cuerpo).toMatch(/kind = 'manual'/);
    expect(cuerpo).toMatch(/is_admin\(\)/);
    expect(cuerpo).toMatch(/current_user_role\(\) = 'manager'/);
    expect(cuerpo).toMatch(/granted_by = \(select auth\.uid\(\)\)/);
    expect(cuerpo).toMatch(/employee_id <> \(select auth\.uid\(\)\)/);
    // No hay ninguna política de insert que acepte 'auto'.
    expect(sql).not.toMatch(/create policy[^;]*kind = 'auto'/);
  });

  it("el empleado no puede LISTAR sus restas, y aun así su saldo las cuenta", () => {
    const sel = sql.slice(sql.indexOf('create policy "point_events select"'));
    expect(sel.slice(0, sel.indexOf(";"))).toMatch(/employee_id = \(select auth\.uid\(\)\) and points > 0/);
    // La función que da el saldo no filtra por signo, y por eso es SECURITY DEFINER.
    const fn = sql.slice(sql.indexOf("create or replace function public.my_point_balance"));
    const cuerpo = fn.slice(0, fn.indexOf("$$;") + 3);
    expect(cuerpo).toContain("security definer");
    expect(cuerpo).not.toMatch(/points > 0/);
  });

  it("la función que lee el saldo ajeno comprueba el rol ella misma", () => {
    // Es SECURITY DEFINER, así que la RLS de la tabla no la frena: sin esta
    // comprobación sería una puerta trasera al historial de cualquiera.
    const fn = sql.slice(sql.indexOf("create or replace function public.point_balance"));
    const cuerpo = fn.slice(0, fn.indexOf("end $$;"));
    expect(cuerpo).toContain("security definer");
    expect(cuerpo).toMatch(/is_admin\(\)/);
    expect(cuerpo).toMatch(/raise exception/);
    expect(sql).toMatch(/revoke execute on function public\.point_balance\(uuid\) from public, anon/);
  });

  it("un automático sin clave no entra, y la clave es única", () => {
    expect(sql).toMatch(/check \(kind <> 'auto' or source_key is not null\)/);
    expect(sql).toMatch(/create unique index if not exists point_events_source_key_uniq[\s\S]*?where source_key is not null/);
  });

  it("un apunte es de un empleado o de un cliente, nunca de los dos", () => {
    expect(sql).toMatch(/check \(\(employee_id is not null\) <> \(account is not null\)\)/);
  });

  it("no toca ninguna política de otra tabla", () => {
    // Las de `settings` ya las fijó 100; aquí solo se le añaden columnas.
    const policies = sql.match(/on public\.(\w+) for (select|insert|update|delete)/g) ?? [];
    for (const p of policies) expect(p).toContain("public.point_events");
    expect(sql).not.toMatch(/(create|drop) policy[^;]*on public\.settings/);
  });

  it("se auto-registra en el ledger, como exige D-184", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("insert into public.schema_migrations");
    expect(despues).toContain("105_points_ledger.sql");
  });
});
