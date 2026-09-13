import { describe, it, expect } from "vitest";
import {
  CIERRE_DIARIO, AVISO_MINUTOS_ANTES,
  CIERRE_EXENTO_ENTREGAS, CIERRE_EXENTO_FICHAJE,
  exentoDelCierre, minutosDeHHMM, pasoElCorte, minutosHastaElCorte, tocaAvisar,
  ultimoCortePasado, debeCerrarSesion,
} from "./session-cutoff";
import { ROLE_INFO } from "./constants";
import { isApiPath, skipsSession } from "./route-guard";
import { ACCOUNTS_KEY } from "./remembered-accounts";
import { readFileSync } from "node:fs";

/** El fichero sin sus líneas de comentario: lo que se juzga es lo que se ejecuta. */
const codigoDe = (src: string) =>
  src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

describe("la hora del corte", () => {
  it("es las 18:30, que es lo que pidió el dueño", () => {
    expect(CIERRE_DIARIO).toBe("18:30");
  });

  it("antes del corte no cierra, en el minuto exacto sí", () => {
    expect(pasoElCorte("18:29")).toBe(false);
    expect(pasoElCorte("18:30")).toBe(true);
    expect(pasoElCorte("18:31")).toBe(true);
  });

  it("la mañana entera y la madrugada quedan fuera", () => {
    for (const h of ["00:00", "06:00", "09:15", "12:00", "17:59"]) {
      expect(pasoElCorte(h)).toBe(false);
    }
  });

  it("compara en minutos y no como texto", () => {
    // "9:00" es mayor que "18:30" comparando cadenas, y eso habría cerrado a las nueve de la
    // mañana el día que alguien escribiera la hora sin el cero delante.
    expect("9:00" > "18:30").toBe(true);
    expect(pasoElCorte("09:00")).toBe(false);
  });

  it("una hora que no se entiende NO cierra a nadie", () => {
    // La dirección segura aquí es la contraria que en los roles: un fallo de formato no puede
    // echar a toda la empresa de la app.
    for (const basura of ["", "tarde", "25:00", "18:70", "9:00", "18-30"]) {
      expect(pasoElCorte(basura)).toBe(false);
    }
    expect(pasoElCorte("18:31", "no es una hora")).toBe(false);
  });

  it("minutosDeHHMM rechaza lo que no es una hora", () => {
    expect(minutosDeHHMM("18:30")).toBe(1110);
    expect(minutosDeHHMM("00:00")).toBe(0);
    expect(minutosDeHHMM("23:59")).toBe(1439);
    expect(minutosDeHHMM("24:00")).toBe(-1);
    expect(minutosDeHHMM("18:60")).toBe(-1);
  });
});

describe("el aviso previo", () => {
  it("sale en la ventana de antes y no después", () => {
    expect(tocaAvisar("18:19")).toBe(false); // 11 min: todavía no
    expect(tocaAvisar("18:20")).toBe(true);  // 10 min justos
    expect(tocaAvisar("18:29")).toBe(true);
    expect(tocaAvisar("18:30")).toBe(false); // ya no se avisa: se cierra
    expect(tocaAvisar("19:00")).toBe(false);
  });

  it("la ventana es la constante, no un número suelto", () => {
    expect(AVISO_MINUTOS_ANTES).toBe(10);
    expect(minutosHastaElCorte("18:20")).toBe(AVISO_MINUTOS_ANTES);
  });

  it("con una hora ilegible no avisa de nada", () => {
    expect(minutosHastaElCorte("basura")).toBeNull();
    expect(tocaAvisar("basura")).toBe(false);
  });
});

describe("quién se queda dentro", () => {
  it("el admin de Entregas y el owner de fichaje", () => {
    expect(exentoDelCierre({ entregas: "admin" })).toBe(true);
    expect(exentoDelCierre({ fichaje: "owner" })).toBe(true);
  });

  it("y nadie más, incluidos los que mandan mucho", () => {
    for (const r of ["manager", "accounting", "logistics", "sales", "warehouse", "driver"]) {
      expect(exentoDelCierre({ entregas: r })).toBe(false);
    }
    // El `manager` de fichaje aprueba horas y tampoco se libra: la exención es del owner.
    expect(exentoDelCierre({ fichaje: "manager" })).toBe(false);
  });

  it("son dos preguntas y no una lista: cada rol contra SU tabla", () => {
    // `owner` no existe en Entregas y `admin` no existe en fichaje. Si esto fuera un solo
    // array de cadenas, cualquiera de los dos colaría por el lado equivocado.
    expect(exentoDelCierre({ entregas: "owner" })).toBe(false);
    expect(exentoDelCierre({ fichaje: "admin" })).toBe(false);
  });

  it("sin rol, o con basura, se cierra", () => {
    expect(exentoDelCierre({})).toBe(false);
    expect(exentoDelCierre({ entregas: null, fichaje: null })).toBe(false);
    expect(exentoDelCierre({ entregas: "" })).toBe(false);
  });

  it("no se le escapa por mayúsculas o espacios", () => {
    expect(exentoDelCierre({ entregas: "  Admin " })).toBe(true);
    expect(exentoDelCierre({ fichaje: "OWNER" })).toBe(true);
  });

  // El canario: recorre los roles de verdad en vez de una lista escrita a mano, así que un rol
  // nuevo en `ROLE_INFO` entra aquí solo. Y entra CERRANDO, que es la dirección segura: si
  // alguien añade un rol y quiere eximirlo, tiene que decirlo en `CIERRE_EXENTO_ENTREGAS` y
  // esta prueba se lo recuerda.
  it("recorre ROLE_INFO: solo admin está exento, el resto cierra", () => {
    const roles = Object.keys(ROLE_INFO);
    expect(roles.length).toBeGreaterThanOrEqual(7); // control: si el recorrido sale vacío, falla
    const exentos = roles.filter((r) => exentoDelCierre({ entregas: r }));
    expect(exentos).toEqual(["admin"]);
  });

  it("y las listas dicen a quién se EXIME, no a quién se cierra", () => {
    expect(CIERRE_EXENTO_ENTREGAS).toEqual(["admin"]);
    expect(CIERRE_EXENTO_FICHAJE).toEqual(["owner"]);
  });
});

// ---- El ancla: qué corte manda, y los tres casos del encargo ------------------------------
// La regla no es «a las 18:30 corre un cierre», es «una sesión no vale si se autenticó antes
// del último corte que ya pasó». Esa diferencia es lo único que cubre la cookie de ayer usada
// hoy a las nueve de la mañana, que era el caso que se escapaba.
describe("ultimoCortePasado", () => {
  // Chicago en septiembre es CDT, UTC-5: las 18:30 locales son las 23:30 UTC.
  const enChicago = (iso: string) => new Date(iso);

  it("por la tarde, después del corte, manda el de HOY", () => {
    const corte = ultimoCortePasado(enChicago("2026-09-11T01:00:00Z")); // 20:00 del día 10
    expect(corte?.toISOString()).toBe("2026-09-10T23:30:00.000Z");
  });

  it("por la mañana manda el de AYER", () => {
    const corte = ultimoCortePasado(enChicago("2026-09-11T14:00:00Z")); // 09:00 del día 11
    expect(corte?.toISOString()).toBe("2026-09-10T23:30:00.000Z");
  });

  it("un minuto antes del corte todavía manda el de ayer, y un minuto después el de hoy", () => {
    expect(ultimoCortePasado(enChicago("2026-09-11T23:29:00Z"))?.toISOString()).toBe("2026-09-10T23:30:00.000Z");
    expect(ultimoCortePasado(enChicago("2026-09-11T23:31:00Z"))?.toISOString()).toBe("2026-09-11T23:30:00.000Z");
  });

  it("en invierno, con CST, el corte se mueve una hora en UTC y no en Chicago", () => {
    // El control de que esto usa la zona del negocio y no el reloj del servidor: si estuviera
    // en UTC fijo, las dos respuestas caerían a la misma hora UTC.
    const verano = ultimoCortePasado(enChicago("2026-09-11T23:31:00Z"));
    const invierno = ultimoCortePasado(enChicago("2026-01-15T23:31:00Z"));
    expect(verano?.toISOString()).toBe("2026-09-11T23:30:00.000Z");
    expect(invierno?.toISOString()).toBe("2026-01-15T00:30:00.000Z");
  });
});

describe("debeCerrarSesion · los tres casos que pidió el dueño, y los que no", () => {
  const tarde = new Date("2026-09-11T23:35:00Z");   // 18:35 del día 11 en Chicago
  const manana = new Date("2026-09-11T14:00:00Z");  // 09:00 del día 11
  const sesionDeAyer = new Date("2026-09-10T15:00:00Z");
  const sesionDeHoyTemprano = new Date("2026-09-11T13:00:00Z"); // 08:00 del día 11

  it("la app abierta cuando llegan las 18:30: cierra", () => {
    expect(debeCerrarSesion({ sesionCreadaEn: sesionDeHoyTemprano, ahora: tarde })).toBe(true);
  });

  it("la cookie de ayer usada esta mañana a las nueve: cierra", () => {
    expect(debeCerrarSesion({ sesionCreadaEn: sesionDeAyer, ahora: manana })).toBe(true);
  });

  it("quien entró hoy a las ocho y sigue a las cinco de la tarde: NO cierra", () => {
    const cincoDeLaTarde = new Date("2026-09-11T22:00:00Z");
    expect(debeCerrarSesion({ sesionCreadaEn: sesionDeHoyTemprano, ahora: cincoDeLaTarde })).toBe(false);
  });

  it("quien acaba de entrar después del corte: NO cierra hasta el corte siguiente", () => {
    const recien = new Date("2026-09-11T23:40:00Z");
    expect(debeCerrarSesion({ sesionCreadaEn: recien, ahora: new Date("2026-09-11T23:45:00Z") })).toBe(false);
  });

  it("el admin y el owner se quedan, con la misma sesión que echaría a cualquier otro", () => {
    const args = { sesionCreadaEn: sesionDeAyer, ahora: manana };
    expect(debeCerrarSesion(args)).toBe(true); // control: sin rol, esa sesión cierra
    expect(debeCerrarSesion({ ...args, rolEntregas: "admin" })).toBe(false);
    expect(debeCerrarSesion({ ...args, rolFichaje: "owner" })).toBe(false);
    expect(debeCerrarSesion({ ...args, rolEntregas: "manager" })).toBe(true);
  });

  it("sin hora de sesión NO cierra a nadie: la función de base puede no existir todavía", () => {
    expect(debeCerrarSesion({ sesionCreadaEn: null, ahora: manana })).toBe(false);
    expect(debeCerrarSesion({ sesionCreadaEn: undefined, ahora: manana })).toBe(false);
  });
});

// ---- El login rápido no se pierde con el cierre (punto 4 del encargo) ----------------------
// El encargo lo pidió con estas palabras: «sin perder el fast login que ya está: ahí queda
// guardado el perfil y solo deben poner la contraseña». Se cumple por construcción —las cuentas
// recordadas viven en `localStorage` y el cierre solo borra cookies— y por construcción es justo
// lo que se rompe sin darse cuenta, así que se recorre cada camino de cierre y se exige que
// ninguno toque esa clave.
describe("el cierre de sesión no borra las cuentas recordadas", () => {
  const caminos = [
    "src/lib/supabase/middleware.ts",       // el cierre de las 18:30 (D-248)
    "src/app/auth/signout/route.ts",        // el Salir de servidor
    "src/app/no-access/SignOut.tsx",        // el Salir de la pantalla sin acceso
    "src/lib/timetracker-data-provider.tsx", // el signOut global del Time Tracker
  ];

  it("ninguno menciona la clave de las cuentas recordadas", () => {
    expect(caminos.length).toBeGreaterThanOrEqual(4); // control: si la lista se vacía, falla
    for (const f of caminos) {
      const src = codigoDe(readFileSync(f, "utf8"));
      expect(src, f).not.toContain(ACCOUNTS_KEY);
      expect(src, f).not.toContain("rtg_accounts");
    }
  });

  it("y el del corte borra solo cookies que empiezan por sb-", () => {
    const src = readFileSync("src/lib/supabase/middleware.ts", "utf8");
    expect(src).toMatch(/startsWith\("sb-"\)/);
    // Mirando el CÓDIGO y no los comentarios: el comentario de ese fichero nombra
    // `localStorage` a propósito, para decir que NO se toca, y un `toContain` a secas lo
    // contaba como si se tocara. Es el mismo mordisco de siempre.
    expect(codigoDe(src)).not.toContain("localStorage");
  });
});

// ---- El reloj solo se para a quien pierde la sesión ---------------------------------------
// El auditor lo cazó y tenía razón: la razón de parar el cronómetro es no dejar una fila
// huérfana cuando cae la sesión, y a quien está exento no le cae. Pararlo igual sería una regla
// de nómina —«a las 18:30 cierra el negocio»— que nadie pidió, disfrazada de regla de sesión.
//
// Se comprueba por texto porque el paro vive dentro de un componente de mil doscientas líneas
// con `setInterval`, que vitest en node no puede montar. Lo que se puede exigir es que pregunte.
describe("el cronómetro respeta la misma exención que el middleware", () => {
  const page = codigoDe(readFileSync("src/app/timetracker/(timetracker)/page.tsx", "utf8"));
  // El efecto que decide el paro, de su ref al cierre del `useEffect`.
  const bloqueDelCorte = page.slice(page.indexOf("const paradoPorCorteRef"), page.indexOf("const arrancandoRef"));

  it("solo un «sí» explícito libra del paro: sin respuesta, para", () => {
    expect(page).toContain("useCutoffExempt");
    // La asimetría es el arreglo entero. `!== false` habría dejado que un `null` —sin respuesta,
    // o pestaña abierta después del corte— librara del paro, y ahí es justo donde no puede:
    // pasado el corte, `/auth/cutoff` ya no contesta a un no exento, así que `null` es su caso
    // más probable, no el raro.
    expect(bloqueDelCorte).toMatch(/if \(exentoDelCorte === true\) return;/);
    expect(bloqueDelCorte).not.toContain("exentoDelCorte !== false");
  });

  it("y pregunta en la ventana previa, no al llegar el corte", () => {
    // Preguntar tarde no da «no exento»: da un error, porque la puerta del middleware corre
    // también sobre `/auth/cutoff` —no lleva `/api/`, así que `skipsSession` no la salta— y a
    // un no exento le devuelve la redirección al login con las cookies borradas.
    expect(bloqueDelCorte).toMatch(/tocaAvisar\(ahora\)/);
    expect(bloqueDelCorte).toContain("setCerca(true)");
  });

  it("y esa ruta NO está entre las que el middleware se salta: es lo que obliga a lo anterior", () => {
    // Medido aquí para que el día que alguien meta `/auth/cutoff` en `skipsSession` esta
    // prueba lo obligue a releer el porqué en vez de descubrirlo en producción.
    expect(isApiPath("/auth/cutoff")).toBe(false);
    expect(skipsSession("/auth/cutoff")).toBe(false);
    expect(skipsSession("/timetracker/api/heartbeat")).toBe(true); // control
  });

  it("y sigue preguntando por la hora con la función compartida, no con una copia", () => {
    expect(bloqueDelCorte).toContain("horaDelNegocio()");
    expect(bloqueDelCorte).toContain("pasoElCorte(ahora)");
    // Control: si alguien reescribiera la hora a mano, esto no lo vería, así que además se
    // exige que no aparezca la hora escrita como literal en la pantalla.
    expect(page).not.toContain('"18:30"');
  });

  it("la respuesta viene del servidor, y aquí no se compara ningún rol", () => {
    // El hook es quien pregunta; lo que se exige de la pantalla es que NO decida por su cuenta.
    const hook = codigoDe(readFileSync("src/lib/use-cutoff-exempt.ts", "utf8"));
    expect(hook).toContain("/auth/cutoff");
    // Acotado AL BLOQUE del corte, no al fichero: `page.tsx` compara `me.role === "admin"` en
    // otro sitio (`:1063`, para pintar la vista de admin del Time Tracker) y eso es legítimo y
    // no tiene nada que ver con esto. Una aserción sobre el fichero entero prohibía código
    // inocente — el mismo error que un grep demasiado ancho, en la otra dirección.
    expect(bloqueDelCorte).not.toContain("owner");
    expect(bloqueDelCorte).not.toMatch(/me\.role/);
  });

  it("el bloque del corte existe y es lo que se está midiendo", () => {
    // Control: sin esto, un cambio de nombre dejaría el bloque vacío y las dos aserciones de
    // arriba pasarían por no encontrar nada.
    expect(bloqueDelCorte.length).toBeGreaterThan(200);
    expect(bloqueDelCorte).toContain("stopRef.current()");
  });

  it("no deduce la exención del rol que tiene a mano, que es otra pregunta", () => {
    // `me.role` aquí es "admin" | "employee" y sale de `profiles.timetracker_role`. Un admin
    // de Time Tracker no es un admin de Entregas ni un owner de fichaje, y usarlo habría
    // eximido a gente que no lo está.
    expect(page).not.toMatch(/exentoDelCierre\(/);
  });
});
