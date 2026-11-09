import { describe, expect, it } from "vitest";
import { accessibleModules, canReachHub, MODULE_ACCESS } from "@/lib/constants";
import { DEMO_USERS } from "@/lib/demo-data";
import { esIdDeSolicitud } from "@/lib/ayuda-para-claude";
import { veElMapa } from "@/lib/mapa-de-apps";
import { separaEliminadas, separaPorEstado } from "@/lib/help-requests";
import { tiendasDelDirectorio } from "@/lib/phone-book";
import { clienteDemoDelHub } from "./cliente-demo";
import { AVISO_DEL_DEMO, directorioDemo, mensajesDemo, PERFIL_DEMO, solicitudesDemo, tutorialesDemo, usuariosDemoDelHub } from "./demo-data";

const AHORA = new Date("2026-11-09T18:00:00.000Z");

describe("la semilla del inicio del Hub", () => {
  it("el perfil es el admin del demo, con todos los módulos y todas las puertas del hub abiertas", () => {
    expect(PERFIL_DEMO.id).toBe("u-admin");
    expect(PERFIL_DEMO.role).toBe("admin");
    expect([...(PERFIL_DEMO.module_access ?? [])].sort()).toEqual(MODULE_ACCESS.map((m) => m.key as string).sort());
    expect(accessibleModules(PERFIL_DEMO.module_access).length).toBeGreaterThan(5);
    expect(canReachHub(PERFIL_DEMO)).toBe(true);
    expect(veElMapa(PERFIL_DEMO)).toBe(true);
  });

  it("Usuarios recibe a todas las personas de DEMO_USERS, cada una con sus módulos", () => {
    const usuarios = usuariosDemoDelHub(DEMO_USERS);
    expect(usuarios.map((u) => u.id)).toEqual(DEMO_USERS.map((u) => u.id));
    for (const u of usuarios) expect(u.module_access?.length, u.id).toBeGreaterThan(0);
    expect(usuarios.find((u) => u.id === "u-mgr")?.recruiting_role).toBe("manager");
  });

  it("el directorio trae teléfonos inventados del rango 555-01NN y los tres tipos de grupo", () => {
    const filas = directorioDemo();
    for (const p of filas) expect(p.phone, p.full_name).toMatch(/^\(956\) 555-01\d\d$/);
    expect(new Set(filas.map((p) => p.phone)).size).toBe(filas.length);
    expect(new Set(tiendasDelDirectorio(filas).map((g) => g.tipo))).toEqual(new Set(["tienda", "remote", "sin_tienda"]));
  });

  it("hay cinco tutoriales, de ids únicos, fechados con el `ahora` que se pasa", () => {
    const lista = tutorialesDemo(AHORA);
    expect(lista).toHaveLength(5);
    expect(new Set(lista.map((t) => t.id)).size).toBe(5);
    expect(lista[0].added_at).toBe("2026-10-26T18:00:00.000Z");
  });

  it("hay tres solicitudes con id de UUID, y cada una tiene su respuesta en el hilo", () => {
    const s = solicitudesDemo(AHORA);
    expect(s).toHaveLength(3);
    for (const x of s) {
      expect(esIdDeSolicitud(x.id), x.id).toBe(true);
      expect(mensajesDemo(AHORA).filter((m) => m.request_id === x.id), x.id).toHaveLength(1);
    }
    const { pendientes, atendidas } = separaPorEstado(separaEliminadas(s).vivas);
    expect([pendientes.length, atendidas.length]).toEqual([2, 1]);
  });

  it("nada de lo sembrado apunta a un dominio real", () => {
    const texto = JSON.stringify([directorioDemo(), tutorialesDemo(AHORA)]);
    const dominios = [...texto.matchAll(/(?:@|https:\/\/)([a-z0-9.-]+)/g)].map((m) => m[1]);
    expect(dominios.length).toBeGreaterThan(0);
    expect(new Set(dominios)).toEqual(new Set(["demo.example", "example.com"]));
  });
});

describe("el cliente de mentira", () => {
  const c = () => clienteDemoDelHub(AHORA);

  it("«Mis solicitudes» recibe solo las de quien mira: el filtro por usuario se aplica", async () => {
    const { data } = await c().from("help_requests").select("*").eq("user_id", "u-admin").order("created_at", { ascending: false }).limit(200);
    expect((data as { id: string }[]).map((f) => f.id)).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });

  it("ordena de verdad: las solicitudes, de la más nueva a la más vieja y al revés", async () => {
    const fechas = async (ascending: boolean) => ((await c().from("help_requests").select("*").order("created_at", { ascending })).data as { created_at: string }[]).map((f) => f.created_at);
    const nuevas = await fechas(false);
    expect(nuevas[0] > nuevas[2]).toBe(true);
    expect(await fechas(true)).toEqual([...nuevas].reverse());
  });

  it("toda escritura contesta el aviso y no finge haber guardado, por tabla y por función", async () => {
    const aviso = { data: null, error: { message: AVISO_DEL_DEMO } };
    expect(await c().from("help_requests").update().eq("id", "x").select("id")).toEqual(aviso);
    expect(await c().from("help_messages").insert()).toEqual(aviso);
    expect(await c().from("help_reads").upsert()).toEqual(aviso);
    expect(await c().rpc("delete_help_request")).toEqual(aviso);
  });

  it("tutorials y phone_book salen de la semilla; maybeSingle da una fila o nada", async () => {
    expect((await c().rpc("tutorials")).data).toHaveLength(5);
    expect((await c().rpc("phone_book")).data).toHaveLength(8);
    expect((await c().from("profiles").select("*").eq("id", "u-admin").maybeSingle()).data).toMatchObject({ id: "u-admin" });
    expect(await c().from("profiles").select("*").eq("id", "otro").maybeSingle()).toEqual({ data: null, error: null });
  });
});
