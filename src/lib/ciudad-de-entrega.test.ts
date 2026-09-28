import { describe, expect, it } from "vitest";
import { ciudadDeEntrega, ciudadesConocidas } from "./ciudad-de-entrega";
import { cityFromAddress } from "./utils";

/** La ciudad de una dirección de entrega, para la columna «Ciudad de entrega» del Gestor de Rutas (D-408). */

describe("ciudadDeEntrega", () => {
  it("las del demo y las escritas a mano: «calle, Ciudad TX»", () => {
    expect(ciudadDeEntrega("4500 N 23rd St, McAllen TX")).toBe("McAllen");
    expect(ciudadDeEntrega("1400 W Freddy Gonzalez Dr, Edinburg TX")).toBe("Edinburg");
    expect(ciudadDeEntrega("845 Paredes Line Rd, Brownsville TX")).toBe("Brownsville");
    expect(ciudadDeEntrega("1200 S Texas Blvd, Weslaco TX")).toBe("Weslaco");
    expect(ciudadDeEntrega("1102 W Expressway 83, Weslaco")).toBe("Weslaco");
    expect(ciudadDeEntrega("100 Main St, McAllen, TX")).toBe("McAllen");
    expect(ciudadDeEntrega("123 Main St, McAllen, TX 78501")).toBe("McAllen");
    expect(ciudadDeEntrega("4500 N 23rd St, McAllen TX 78504")).toBe("McAllen");
    expect(ciudadDeEntrega("4500 N 23rd St, McAllen TX 78504-1234")).toBe("McAllen");
  });
  it("las que da un geocodificador: Google («…, Pharr, TX 78577, USA») y Nominatim, con condado, estado, zip y país", () => {
    expect(ciudadDeEntrega("1120 E Expressway 83, Pharr, TX 78577, USA")).toBe("Pharr");
    expect(ciudadDeEntrega("1120 E Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States")).toBe("Pharr");
    expect(ciudadDeEntrega("1120, East Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States of America")).toBe("Pharr");
    expect(ciudadDeEntrega("Calle 5 123, Centro, Reynosa, Tamps., 88500, México")).toBe("Reynosa");
    expect(ciudadDeEntrega("Av. Constitución 400, Monterrey, N.L., México")).toBe("Monterrey");
  });
  it("la sigla de un estado que no es Texas también se quita, en su trozo o pegada a la ciudad", () => {
    expect(ciudadDeEntrega("Av. Juárez 10, Monterrey, NL 64000, MX")).toBe("Monterrey");
    expect(ciudadDeEntrega("Av. Juárez 10, Monterrey NL")).toBe("Monterrey");  });
  it("una ciudad de varias palabras sale entera, y en minúsculas se le quita el estado igual", () => {
    expect(ciudadDeEntrega("500 Main, Rio Grande City, TX 78582")).toBe("Rio Grande City");
    expect(ciudadDeEntrega("12 Palm Blvd, South Padre Island TX")).toBe("South Padre Island");
    expect(ciudadDeEntrega("  100  norte ave,  san juan tx ")).toBe("san juan");
    expect(ciudadDeEntrega("100 Norte Ave, Alamo Texas")).toBe("Alamo");
  });
  it("una calle con nombre de ciudad no engaña: manda el trozo de la ciudad", () => {
    expect(ciudadDeEntrega("2 McAllen Ave, Pharr TX")).toBe("Pharr");
    expect(ciudadDeEntrega("3 Mission Blvd, Edinburg, TX")).toBe("Edinburg");
  });
  it("sin ciudad, «» (la celda pinta «—»): vacía, nula, solo la calle, o una calle sin nada que diga dónde acaba", () => {
    expect(ciudadDeEntrega("")).toBe("");
    expect(ciudadDeEntrega(null)).toBe("");
    expect(ciudadDeEntrega(undefined)).toBe("");
    expect(ciudadDeEntrega(" , , ")).toBe("");
    expect(ciudadDeEntrega("123 Main St")).toBe("");
    expect(ciudadDeEntrega("123 sin ciudad 78501")).toBe("");
    // Acaba en la calle aunque haya más trozos detrás que se quitan.
    expect(ciudadDeEntrega("123 Main St, TX 78501, USA")).toBe("");
    // Todo en un trozo y sin una ciudad CONOCIDA que lo cierre: no se adivina dónde acaba la calle. Ni por el tipo de vía:
    // «7 Dos St sin coma» daría la ciudad «sin coma».
    expect(ciudadDeEntrega("123 Main St McAllen TX 78501")).toBe("");
    expect(ciudadDeEntrega("7 Dos St sin coma")).toBe("");
    expect(ciudadDeEntrega("9 W Robles Villa Norte TX", ["Puerto Sur"])).toBe("");
  });

  /**
   * D-NEXT (T-0413): las escritas a mano. Medido en producción el 2026-09-27, 21 de 295 daban «» o basura; estos son sus
   * patrones, con calles inventadas.
   */
  it("el lote, apartamento o suite, delante, detrás o detrás del país, se quita (antes salía «LOTE #24 …» o «USA LOTE 11»)", () => {
    expect(ciudadDeEntrega("LOTE #24 9 W Robles Dr, Edinburg, TX")).toBe("Edinburg");
    expect(ciudadDeEntrega("9 Oak Rd, Mission, TX, USA LOTE 11")).toBe("Mission");
    expect(ciudadDeEntrega("9 Oak Rd, Mission, TX, USA Lot 11")).toBe("Mission");
    expect(ciudadDeEntrega("9 Oak Rd Apt 3B, Pharr, TX")).toBe("Pharr");
    expect(ciudadDeEntrega("9 Oak Rd, Pharr TX STE 200")).toBe("Pharr");
    expect(ciudadDeEntrega("9 Oak Rd #12, Pharr TX")).toBe("Pharr");
    expect(ciudadDeEntrega("9 Oak Rd, Pharr TX Sweet 104")).toBe("Pharr");
  });

  it("el estado con punto, en su trozo o pegado: «TX.» y «TX.78521» (antes salían como ciudad); y el punto tras la ciudad", () => {
    expect(ciudadDeEntrega("9 Oak Rd, Brownsville, TX.")).toBe("Brownsville");
    expect(ciudadDeEntrega("9 Oak Rd, Brownsville, TX.78521")).toBe("Brownsville");
    expect(ciudadDeEntrega("9 Oak Rd, Brownsville, tx. 78521")).toBe("Brownsville");
    expect(ciudadDeEntrega("9 Oak Rd, Brownsville TX.78521")).toBe("Brownsville");
    expect(ciudadDeEntrega("9 Oak Rd, San Benito. TX 78586")).toBe("San Benito");
  });

  it("todo en un trozo: la ciudad CONOCIDA que cierra el texto (la más larga), con la calle delante y con su grafía del texto", () => {
    const conocidas = ["Edinburg", "Brownsville", "Juan", "San Juan", "Los Fresnos", "La Feria", "McAllen"];
    expect(ciudadDeEntrega("123 Main St McAllen TX 78501", conocidas)).toBe("McAllen");
    expect(ciudadDeEntrega("LOTE #24 9 W Robles EDINBURG, TX", conocidas)).toBe("EDINBURG");
    expect(ciudadDeEntrega("9 W Robles EDINBURG TX  LOTE #24", conocidas)).toBe("EDINBURG");
    expect(ciudadDeEntrega("9 Pino Palm BROWNSVILLE", conocidas)).toBe("BROWNSVILLE");
    expect(ciudadDeEntrega("9 cedar xing brownsville ", conocidas)).toBe("brownsville");
    expect(ciudadDeEntrega("9 Oak Expy BROWNSVILLE SWEET 104", conocidas)).toBe("BROWNSVILLE");
    expect(ciudadDeEntrega("9 Oak Brownsville, TX.78521", conocidas)).toBe("Brownsville");
    expect(ciudadDeEntrega("99 Taylor Rd LA FERIA TX", conocidas)).toBe("LA FERIA");
    expect(ciudadDeEntrega("9 N Arroyo Blvd Los  Fresnos", conocidas)).toBe("Los Fresnos");
    expect(ciudadDeEntrega("9 San Pedro Loop Mission. TX 78586", [...conocidas, "Mission"])).toBe("Mission");
    // La más larga: «Juan» no parte «San Juan».
    expect(ciudadDeEntrega("9 W Robles San Juan TX", conocidas)).toBe("San Juan");
    // Sin la lista, las mismas no se adivinan.
    expect(ciudadDeEntrega("9 Pino Palm BROWNSVILLE")).toBe("");
    // Tiene que quedar la calle delante: una conocida que es el texto entero no es la ciudad de una calle.
    expect(ciudadDeEntrega("9 Brownsville", ["9 Brownsville"])).toBe("");
    // Y la conocida tiene que CERRAR el texto: detrás de ella no puede quedar nada.
    expect(ciudadDeEntrega("Calle Brownsville 9", conocidas)).toBe("");
  });

  it("las conocidas salen de las direcciones que se leen limpias, sin repetir (sin mayúsculas)", () => {
    expect(ciudadesConocidas(["1 A, Edinburg, TX", "2 B, EDINBURG TX", "3 C, Pharr TX", "9 C Rd Alamo TX", "9 sin nada", null])).toEqual(["Edinburg", "Pharr"]);
  });
  it("un solo trozo que es la ciudad se devuelve; un «TX» suelto no se vacía", () => {
    expect(ciudadDeEntrega("McAllen")).toBe("McAllen");
    expect(ciudadDeEntrega("McAllen TX")).toBe("McAllen");
    expect(ciudadDeEntrega("TX")).toBe("TX");
  });
  it("por qué no `cityFromAddress`: con estas mismas direcciones da la calle o el código postal", () => {
    expect(cityFromAddress("4500 N 23rd St, McAllen TX")).toBe("4500 N 23rd St");
    expect(cityFromAddress("1120 E Expressway 83, Pharr, Hidalgo County, Texas, 78577, United States")).toBe("78577");
  });
});
