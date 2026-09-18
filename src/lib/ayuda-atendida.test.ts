import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { asomoDelMensaje, avisoDeAtendida, separaPorEstado, type SolicitudDeAyuda } from "./help-requests";
import { AYUDA_ATENDIDA_KIND } from "./notifications";

/**
 * Atender una solicitud se le avisa a quien la escribió, y las atendidas se van al archivo (D-NEXT).
 *
 * Antes, atender era un cambio que solo veía el admin: quien pidió ayuda no se enteraba nunca.
 *
 * **Ninguna prueba toca la base ni manda nada**: lo que se mide es la semilla que la pantalla habría
 * insertado, y el texto del fichero que decide cuándo la inserta.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const pagina = leer("src/app/home/solicitudes-de-ayuda/page.tsx");
const campana = leer("src/components/NotificationBell.tsx");

const fila = (extra: Partial<SolicitudDeAyuda> = {}): SolicitudDeAyuda => ({
  id: "s1", created_at: "2026-09-17T15:00:00.000Z", user_id: "u1", sender_name: "Ana", sender_email: "ana@x.test",
  role_label: "Ventas", page: "/map", app_version: "1.0.0", lang: "es", message: "No carga el mapa", files: [],
  email_to: "soporte@x.test", email_ok: true, email_error: null, status: "pendiente", attended_by: null,
  attended_at: null, ...extra,
});

describe("el aviso a quien escribió", () => {
  it("va a su cuenta, sin orden, con su propia clave", () => {
    expect(avisoDeAtendida(fila(), "admin-1")).toEqual({
      user_id: "u1",
      delivery_id: null,
      order_no: null,
      kind: AYUDA_ATENDIDA_KIND,
      message: "Tu solicitud de ayuda ya está atendida: «No carga el mapa»",
    });
  });

  it("y lleva el principio del mensaje, para reconocer cuál de las suyas es", () => {
    const largo = "a".repeat(200);
    const aviso = avisoDeAtendida(fila({ message: largo }), "admin-1");
    // Cortado: el texto entero NO viaja en el aviso.
    expect(aviso?.message).not.toContain(largo);
    expect(aviso?.message).toContain(asomoDelMensaje(largo));
    expect(aviso?.message).toContain("…");
  });

  it("en el idioma que tenía al escribir, no en el de quien atiende", () => {
    expect(avisoDeAtendida(fila({ lang: "es" }), "admin-1")?.message).toContain("Tu solicitud de ayuda");
    expect(avisoDeAtendida(fila({ lang: "es-MX" }), "admin-1")?.message).toContain("Tu solicitud de ayuda");
    expect(avisoDeAtendida(fila({ lang: "en" }), "admin-1")?.message).toContain("Your help request");
    // Sin idioma guardado se queda en inglés, como el resto de los avisos de la campana.
    expect(avisoDeAtendida(fila({ lang: null }), "admin-1")?.message).toContain("Your help request");
  });

  it("no hay a quién avisar si la cuenta se borró", () => {
    // La 120 pone `user_id` a null al borrar la cuenta, a propósito: el historial no se va con ella.
    expect(avisoDeAtendida(fila({ user_id: null }), "admin-1")).toBeNull();
  });

  it("ni cuando quien atiende es quien la escribió", () => {
    expect(avisoDeAtendida(fila({ user_id: "admin-1" }), "admin-1")).toBeNull();
  });
});

describe("el asomo del mensaje", () => {
  it("un mensaje corto viaja entero y sin puntos suspensivos", () => {
    expect(asomoDelMensaje("No carga")).toBe("No carga");
  });

  it("los saltos de línea y los espacios de más se comen", () => {
    expect(asomoDelMensaje("No\n\ncarga   el   mapa")).toBe("No carga el mapa");
  });

  it("uno largo se corta al límite, contando el puntito", () => {
    const corte = asomoDelMensaje("b".repeat(90), 20);
    expect(corte).toHaveLength(20);
    expect(corte.endsWith("…")).toBe(true);
  });
});

describe("las atendidas se van al archivo", () => {
  const filas = [
    fila({ id: "a" }),
    fila({ id: "b", status: "atendida", attended_by: "admin-1", attended_at: "2026-09-17T16:00:00.000Z" }),
    fila({ id: "c" }),
  ];

  it("la lista de trabajo son las pendientes, en su orden", () => {
    expect(separaPorEstado(filas).pendientes.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("y el archivo, las atendidas", () => {
    expect(separaPorEstado(filas).atendidas.map((s) => s.id)).toEqual(["b"]);
  });

  it("un estado que no conocemos se queda donde se ve, no dentro del archivo", () => {
    // Si algún día hay un tercer estado, que aparezca en la lista de trabajo en vez de desaparecer
    // en el archivo, que es donde nadie mira.
    const raro = separaPorEstado([fila({ id: "x", status: "escalada" as never })]);
    expect(raro.pendientes.map((s) => s.id)).toEqual(["x"]);
    expect(raro.atendidas).toEqual([]);
  });
});

describe("la pantalla avisa, y solo cuando toca", () => {
  it("avisa al atender, nunca al devolverla a pendiente", () => {
    expect(pagina).toContain("if (atiende) await avisaAlRemitente(supabase, s, sesion.user.id);");
  });

  it("primero guarda el estado y después avisa: un aviso que falle no desatiende la solicitud", () => {
    const guarda = pagina.indexOf('.update(parche).eq("id", s.id).select("id")');
    const avisa = pagina.indexOf("if (atiende) await avisaAlRemitente");
    expect(guarda).toBeGreaterThan(-1);
    expect(avisa).toBeGreaterThan(guarda);
  });

  it("la fila de la campana se inserta SIN pedirla de vuelta", () => {
    // `notif read own` (001) deja leer solo las propias; encadenar `.select()` obligaría a Postgres a
    // leer una fila que es de otra persona para devolverla.
    expect(pagina).toContain('.from("notifications").insert([semilla]);');
    const insercion = pagina.slice(pagina.indexOf('.from("notifications")'), pagina.indexOf('.from("notifications")') + 60);
    expect(insercion).not.toContain(".select(");
  });

  it("y dice qué pasó con el aviso, incluso cuando no había a quién avisar", () => {
    expect(pagina).toContain("Atendida — se avisó a quien la escribió.");
    expect(pagina).toContain("Atendida, pero no se pudo avisar a quien la escribió.");
    expect(pagina).toContain("Atendida — sin cuenta a la que avisar: esa cuenta ya no existe.");
    expect(pagina).toContain("Atendida — la escribiste tú, así que no hay a quién avisar.");
  });
});

describe("la lista de trabajo y el archivo", () => {
  it("la principal son las pendientes", () => {
    expect(pagina).toContain("pendientes.map(tarjeta)");
  });

  it("las atendidas están detrás del botón del archivo, cerrado de salida", () => {
    expect(pagina).toContain("const [verAtendidas, setVerAtendidas] = useState(false);");
    expect(pagina).toContain("{verAtendidas && atendidas.map(tarjeta)}");
    expect(pagina).toContain("aria-expanded={verAtendidas}");
  });

  it("con su número a la vista, para que no parezca que se perdieron", () => {
    const boton = pagina.slice(pagina.indexOf("setVerAtendidas((v) => !v)"), pagina.indexOf("</button>", pagina.indexOf("setVerAtendidas((v) => !v)")));
    expect(boton).toContain("({atendidas.length})");
  });

  it("y la casilla de «solo pendientes» ya no hace falta", () => {
    expect(pagina).not.toContain("soloPendientes");
  });
});

describe("el punto de la campana", () => {
  it("el aviso de ayuda lleva color propio, no el prestado de la primera etapa", () => {
    // `stageInfo` cae a STAGES[0] con una clave que no es etapa: sin esta rama, el punto se pintaba
    // con el color de otra cosa y nada chirriaba.
    const expresion = campana.slice(campana.indexOf("const dotColor ="), campana.indexOf(";", campana.indexOf("const dotColor =")));
    expect(expresion).toContain("AYUDA_ATENDIDA_KIND");
    expect(expresion.indexOf("AYUDA_ATENDIDA_KIND")).toBeLessThan(expresion.indexOf("stageInfo"));
  });

  it("y la clave que pinta es la misma que manda la pantalla", () => {
    expect(campana).toContain('import { ASSIGNED_KIND, AYUDA_ATENDIDA_KIND } from "@/lib/notifications";');
  });
});
