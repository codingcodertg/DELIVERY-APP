import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLAVE_DE_ESTADO, KIND_CHAT, LARGO_MAXIMO, type Mensaje,
  chatEnLaRuta, conMensaje, cuerpoValido, esDeMiTienda, estadoInicial, hilos, hilosRecientes, listaVisible, llevaPush, noLeidosTotal, ordenaContactos, textoDelAviso,
} from "./chat";

// D-609 (2026-10-20) · El dueño: «un chat dentro del app en general … con los de su tienda … buscar el nombre … si es un admin
// siempre son push messages». Datos de prueba, no los del dueño.

const yo = { id: "yo", store: "Tienda Norte" };
const gente = [
  { id: "yo", full_name: "Yo Mismo", store: "Tienda Norte" },
  { id: "a", full_name: "Ángel Pérez", store: "Tienda Sur" },
  { id: "b", full_name: "beatriz lópez", store: "tienda norte" },
  { id: "c", full_name: "Carlos Ruiz", store: null },
  { id: "d", full_name: "Diana Ortiz", store: "Tienda Norte" },
];
const m = (id: string, from: string, to: string, at: string, read: string | null = null): Mensaje => ({ id, from_user: from, to_user: to, body: "x" + id, created_at: at, read_at: read });

describe("chat interno", () => {
  it("contactos: sin uno mismo, los de MI tienda primero (sin mayúsculas ni acentos), luego el resto, por nombre", () => {
    expect(ordenaContactos(gente, yo).map((c) => c.id)).toEqual(["b", "d", "a", "c"]);
    expect(ordenaContactos(gente, { id: "yo", store: null }).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(esDeMiTienda({ store: "tienda norte" }, yo)).toBe(true);
    expect(esDeMiTienda({ store: "Tienda Sur" }, yo)).toBe(false);
    expect(esDeMiTienda({ store: "Tienda Norte" }, { store: "" })).toBe(false);
  });

  it("lo que se lista (D-614): sin búsqueda, solo mi tienda (sin tienda, nadie); con búsqueda, cualquiera que coincida, mi tienda primero", () => {
    expect(listaVisible(gente, yo).map((c) => c.id)).toEqual(["b", "d"]);
    expect(listaVisible(gente, { id: "yo", store: null })).toEqual([]);
    expect(listaVisible(gente, yo, "a").map((c) => c.id)).toEqual(["b", "d", "a", "c"]);
    expect(listaVisible(gente, yo, "carlos").map((c) => c.id)).toEqual(["c"]);
    expect(listaVisible(gente, yo, "   ").map((c) => c.id)).toEqual(["b", "d"]);
  });

  it("la búsqueda por nombre ignora acentos y mayúsculas y vale a medias", () => {
    expect(ordenaContactos(gente, yo, "angel").map((c) => c.id)).toEqual(["a"]);
    expect(ordenaContactos(gente, yo, "LÓP").map((c) => c.id)).toEqual(["b"]);
    expect(ordenaContactos(gente, yo, "zzz")).toEqual([]);
    expect(ordenaContactos(gente, yo, "yo mismo")).toEqual([]);
  });

  it("hilos: uno por interlocutor, del más viejo al más nuevo, con los no leídos que ME mandaron; los ajenos no entran", () => {
    const ms = [
      m("1", "a", "yo", "2026-10-20T10:00:00Z"),
      m("2", "yo", "a", "2026-10-20T10:05:00Z"),
      m("3", "a", "yo", "2026-10-20T10:06:00Z", "2026-10-20T10:07:00Z"),
      m("4", "b", "yo", "2026-10-20T09:00:00Z"),
      m("5", "yo", "c", "2026-10-20T11:00:00Z"),
      m("6", "a", "b", "2026-10-20T12:00:00Z"),
    ];
    const h = hilos(ms, "yo");
    expect([...h.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(h.get("a")!.mensajes.map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(h.get("a")!.noLeidos).toBe(1);
    expect(h.get("b")!.noLeidos).toBe(1);
    expect(h.get("c")!.noLeidos).toBe(0);
    expect(noLeidosTotal(h)).toBe(2);
    expect(hilosRecientes(h).map((x) => x.con)).toEqual(["c", "a", "b"]);
  });

  it("el cuerpo: recortado, de 1 a 2000 letras; vacío o pasado no vale", () => {
    expect(cuerpoValido("  hola \r\n ")).toBe("hola");
    expect(cuerpoValido("   ")).toBeNull();
    expect(cuerpoValido(null)).toBeNull();
    expect(cuerpoValido("x".repeat(LARGO_MAXIMO))).toHaveLength(LARGO_MAXIMO);
    expect(cuerpoValido("x".repeat(LARGO_MAXIMO + 1))).toBeNull();
  });

  it("push solo cuando escribe un admin; el aviso dice quién y qué, recortado", () => {
    expect(llevaPush("admin")).toBe(true);
    expect(llevaPush("manager")).toBe(false);
    expect(llevaPush(null)).toBe(false);
    expect(textoDelAviso("Ana", "hola\n\n¿cómo vas?")).toBe("💬 Ana: hola ¿cómo vas?");
    expect(textoDelAviso("", "x")).toBe("💬 Chat: x");
    expect(textoDelAviso("Ana", "y".repeat(200))).toHaveLength("💬 Ana: ".length + 140);
    expect(KIND_CHAT).toBe("chat");
  });

  it("la burbuja: sale donde sale la de Ayuda; solo «oculta» se recuerda; un mensaje repetido por tiempo real entra una vez", () => {
    expect(chatEnLaRuta("/home")).toBe(true);
    expect(chatEnLaRuta("/recruiting")).toBe(true);
    expect(chatEnLaRuta("/login")).toBe(false);
    expect(chatEnLaRuta("/track/abc")).toBe(false);
    expect(estadoInicial("oculta")).toBe("oculta");
    expect(estadoInicial("abierta")).toBe("burbuja");
    expect(estadoInicial(null)).toBe("burbuja");
    expect(CLAVE_DE_ESTADO).toBe("chat-interno-estado");
    const a = m("1", "a", "yo", "2026-10-20T10:00:00Z");
    expect(conMensaje([a], { ...a, read_at: "2026-10-20T10:01:00Z" }).map((x) => x.read_at)).toEqual(["2026-10-20T10:01:00Z"]);
    expect(conMensaje([a], m("2", "a", "yo", "2026-10-20T10:02:00Z"))).toHaveLength(2);
  });

  it("puerta: la burbuja está en el layout raíz (todas las apps), manda por /api/chat/send, y la ruta hace push solo con llevaPush", () => {
    const raiz = new URL("../../", import.meta.url);
    const layout = readFileSync(new URL("app/layout.tsx", raiz), "utf8");
    expect(layout).toContain("<ChatFlotante />");
    const comp = readFileSync(new URL("components/ChatFlotante.tsx", raiz), "utf8");
    expect(comp).toContain('fetch("/api/chat/send"');
    expect(comp).toContain("listaVisible(contactos, yo, busqueda)");
    expect(comp).toContain('table: "chat_messages"');
    const ruta = readFileSync(new URL("app/api/chat/send/route.ts", raiz), "utf8");
    expect(ruta).toContain("requireUser()");
    expect(ruta).toContain("if (llevaPush(yo.role) && fcmConfigured())");
    expect(ruta).toContain('from("chat_messages")');
    expect(ruta).toContain("kind: KIND_CHAT");
    const sql = readFileSync(new URL("../supabase/migrations/184_chat_interno.sql", raiz), "utf8");
    expect(sql).toContain("from_user = (select auth.uid()) or to_user = (select auth.uid())");
    expect(sql).toContain("with check (from_user = (select auth.uid()))");
    expect(sql).toContain("grant update (read_at) on public.chat_messages to authenticated;");
    expect(sql).not.toContain("'PENDIENTE'");
  });
});
