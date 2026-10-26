import { describe, expect, it } from "vitest";
import { coincidenciasDe } from "./coincidencias";
import {
  contactosDe, contactoVacio, deEdicion, enEdicion, erroresDeContactos, parcheDeContactos, repartoDePastillas, rotuloDeContacto,
  textoDeCorreos, textoDeTelefonos,
} from "./contactos";
import { contactosDeLosCampos, espejoDeContactos, normalizaContactos, type Contacto } from "./formato";
import { celda, coincide, valorDeColumna, type Cliente } from "./reglas";

/*
 * D-668 (migración 193): varios contactos por cliente. El dueño, 2026-10-24: «me dice arriba el número y Omar […] quiero
 * que el contacto sea Omar y abajo el número de teléfono», y que un cliente tenga varios contactos, cada uno con varios
 * teléfonos y correos. Datos INVENTADOS con la forma de los del Excel (medidos en producción ese día: «número - NOMBRE»,
 * «NOMBRE número», «…, A/P owner», correos con «;», un teléfono en la columna del correo…).
 */
const t = (en: string, _es: string) => en;
const de = (phone: string | null, extra: { contact_name?: string; contact_title?: string; email?: string } = {}) =>
  contactosDeLosCampos({ phone, email: null, contact_name: null, contact_title: null, ...extra });
const uno = (c: Partial<Contacto>): Contacto => ({ name: null, title: null, phones: [], emails: [], note: null, ...c });

describe("los contactos que estaban escritos juntos en las columnas de antes", () => {
  it("«número NOMBRE» y «número - Nombre»: el nombre es el contacto y el número, su teléfono (con formato)", () => {
    expect(de("(956) 555-1234 Omar")).toEqual([uno({ name: "OMAR", phones: ["(956) 555-1234"] })]);
    expect(de("956-555-2345 - Rosa Mena")).toEqual([uno({ name: "ROSA MENA", phones: ["(956) 555-2345"] })]);
    expect(de("NOELIA 956*555*3456")).toEqual([uno({ name: "NOELIA", phones: ["(956) 555-3456"] })]);
    expect(de("956-555-4567-ABEL")).toEqual([uno({ name: "ABEL", phones: ["(956) 555-4567"] })]);
  });
  it("el cargo se separa del nombre: A/P (también «(AP)»), owner, office, wife…", () => {
    expect(de("956-555-1111 - Viky, A/P")).toEqual([uno({ name: "VIKY", title: "A/P", phones: ["(956) 555-1111"] })]);
    expect(de("832-555-2222 Gaby, A/P owner")).toEqual([uno({ name: "GABY", title: "A/P OWNER", phones: ["(832) 555-2222"] })]);
    expect(de("956-555-3333 - Office - Sara A/P")).toEqual([uno({ name: "SARA", title: "OFFICE A/P", phones: ["(956) 555-3333"] })]);
    expect(de("956-555-4444 - OWNER MARIA ROJO")).toEqual([uno({ name: "MARIA ROJO", title: "OWNER", phones: ["(956) 555-4444"] })]);
    expect(de("956-555-5555 REBE (AP)")).toEqual([uno({ name: "REBE", title: "A/P", phones: ["(956) 555-5555"] })]);
    expect(de("(956) 555-6666 Owner")).toEqual([uno({ title: "OWNER", phones: ["(956) 555-6666"] })]);
  });
  it("lo que no es nombre ni cargo va a la NOTA, no al nombre", () => {
    expect(de("956-555-7777 - Arturo, solo Bea le puede hablar.")).toEqual([uno({ name: "ARTURO", phones: ["(956) 555-7777"], note: "solo Bea le puede hablar." })]);
    expect(de("956-555-8888 - Luis Paz for POs")).toEqual([uno({ name: "LUIS PAZ", phones: ["(956) 555-8888"], note: "for POs" })]);
    expect(de("956-555-9999 - Edu - ROJO HOMES")).toEqual([uno({ name: "EDU", phones: ["(956) 555-9999"], note: "ROJO HOMES" })]);
    expect(de("956-555-0001-NO")).toEqual([uno({ phones: ["(956) 555-0001"], note: "NO" })]);
  });
  it("dos personas con el mismo número («y», «/», «u») son DOS contactos; con una coma, no", () => {
    expect(de("956-555-1212 - Pepe y Marta Gil")).toEqual([
      uno({ name: "PEPE", phones: ["(956) 555-1212"] }), uno({ name: "MARTA GIL", phones: ["(956) 555-1212"] })]);
    expect(de("956-555-1313 FER / OSCAR")).toEqual([uno({ name: "FER", phones: ["(956) 555-1313"] }), uno({ name: "OSCAR", phones: ["(956) 555-1313"] })]);
    expect(de("956-555-1414 - PEPE, NO LLAMAR")).toEqual([uno({ name: "PEPE", phones: ["(956) 555-1414"], note: "NO LLAMAR" })]);
    // «Jr.» detrás de una coma es parte del nombre.
    expect(de("956-555-1515 - Beto, Jr.")).toEqual([uno({ name: "BETO JR.", phones: ["(956) 555-1515"] })]);
  });
  it("varios números: dos completos; 7 dígitos heredan el código de área; 4 cambian los 4 últimos", () => {
    expect(de("956-555-0518 / 956-555-3332")).toEqual([uno({ phones: ["(956) 555-0518", "(956) 555-3332"] })]);
    expect(de("956-555-0955 - 555-2802 Rubi A/P")).toEqual([uno({ name: "RUBI", title: "A/P", phones: ["(956) 555-0955", "(956) 555-2802"] })]);
    expect(de("956-555-9756 and 9750")).toEqual([uno({ phones: ["(956) 555-9756", "(956) 555-9750"] })]);
    // Otro nombre con otro número: otro contacto.
    expect(de("956-555-0101 Ana, 956-555-0202 Beto")).toEqual([uno({ name: "ANA", phones: ["(956) 555-0101"] }), uno({ name: "BETO", phones: ["(956) 555-0202"] })]);
  });
  it("un número mal escrito (7 dígitos o más que no cuadran) sigue siendo un teléfono, tal cual; menos, no", () => {
    expect(de("956-555-12")).toEqual([uno({ phones: ["956-555-12"] })]);
    expect(de("956-555-0101 - Dora - owner 100%")).toEqual([uno({ name: "DORA", title: "OWNER 100%", phones: ["(956) 555-0101"] })]);
    expect(de("JOSE LUNA")).toEqual([uno({ name: "JOSE LUNA" })]);
  });
  it("el correo: varios con «;» van al primero; un número escrito en el correo, a sus teléfonos; «Nombre <correo>» da el nombre", () => {
    expect(de("956-555-0303 - Leo", { email: "A@x.example; b@y.example" })).toEqual([uno({ name: "LEO", phones: ["(956) 555-0303"], emails: ["a@x.example", "b@y.example"] })]);
    expect(de(null, { email: "(956) 555-0404" })).toEqual([uno({ phones: ["(956) 555-0404"] })]);
    expect(de("956-555-0505", { email: "luz mar <luz@x.example>" })).toEqual([uno({ name: "LUZ MAR", phones: ["(956) 555-0505"], emails: ["luz@x.example"] })]);
  });
  it("la columna «contacto» manda si es la misma persona (o si el teléfono no traía nombre); si es otra, son dos y la suya va primero", () => {
    expect(de("956-555-0606 - ADAN", { contact_name: "Adan" })).toEqual([uno({ name: "ADAN", phones: ["(956) 555-0606"] })]);
    expect(de("(956) 555-0707", { contact_name: "jorge paz", contact_title: "owner", email: "j@x.example" }))
      .toEqual([uno({ name: "JORGE PAZ", title: "OWNER", phones: ["(956) 555-0707"], emails: ["j@x.example"] })]);
    expect(de("956-555-0808 - Rita", { contact_name: "Hugo" })).toEqual([uno({ name: "HUGO" }), uno({ name: "RITA", phones: ["(956) 555-0808"] })]);
    // Un cargo de solo puntuación («.») no es un cargo.
    expect(de("(956) 555-0909", { contact_title: "." })).toEqual([uno({ phones: ["(956) 555-0909"] })]);
  });
  it("sin nada, ningún contacto", () => {
    expect(de(null)).toEqual([]);
    expect(de("  ", { email: " " })).toEqual([]);
  });
});

describe("la lista guardada (193)", () => {
  it("normaliza lo que venga de la base: formato, sin repetidos ni huecos, y fuera lo que no tiene la forma", () => {
    expect(normalizaContactos([
      { name: " ana  ruiz ", title: "owner", phones: ["9565550101", "(956) 555-0101", ""], emails: ["ANA@X.example", " "], note: "  hola  " },
      { name: "", phones: [], emails: [] }, null, "basura", { phones: [7, "956.555.0202"] },
    ])).toEqual([
      uno({ name: "ANA RUIZ", title: "OWNER", phones: ["(956) 555-0101"], emails: ["ana@x.example"], note: "hola" }),
      uno({ phones: ["(956) 555-0202"] }),
    ]);
    expect(normalizaContactos(null)).toEqual([]);
    // D-697: el sitio web y la dirección son de cada contacto; un contacto con solo eso se queda; sin ellos, ni la clave.
    expect(normalizaContactos([{ name: "ana", website: " ana.example.com ", address: ["  12 Main St ", "", "  Laredo,  TX "].join("\r\n") }, { address: "5 Elm" }])).toEqual([
      uno({ name: "ANA", website: "ana.example.com", address: ["12 Main St", "Laredo, TX"].join("\n") }), uno({ address: "5 Elm" }),
    ]);
    expect(Object.keys(normalizaContactos([{ name: "ana", website: " ", address: "" }])[0])).toEqual(["name", "title", "phones", "emails", "note"]);
    expect(normalizaContactos({})).toEqual([]);
  });
  it("el espejo de las cuatro columnas: nombre y cargo del primero, el primer teléfono y el primer correo de quien los tenga", () => {
    expect(espejoDeContactos([uno({ name: "ANA", title: "OWNER" }), uno({ name: "LUIS", phones: ["(956) 555-0101"], emails: ["l@x.example"] })]))
      .toEqual({ contact_name: "ANA", contact_title: "OWNER", phone: "(956) 555-0101", email: "l@x.example" });
    expect(espejoDeContactos([])).toEqual({ contact_name: null, contact_title: null, phone: null, email: null });
  });
  it("contactosDe: los guardados si hay; si la lista está vacía o falta (sin la 193), los de las columnas", () => {
    const fila = { contact_name: null, contact_title: null, phone: "956-555-0101 - Omar", email: null };
    expect(contactosDe({ ...fila, contacts: [uno({ name: "OTRA", phones: ["(956) 555-0000"] })] })).toEqual([uno({ name: "OTRA", phones: ["(956) 555-0000"] })]);
    expect(contactosDe({ ...fila, contacts: [] })).toEqual([uno({ name: "OMAR", phones: ["(956) 555-0101"] })]);
    expect(contactosDe({ ...fila, contacts: null })).toEqual([uno({ name: "OMAR", phones: ["(956) 555-0101"] })]);
    expect(contactosDe(null)).toEqual([]);
  });
});

describe("las pastillas de contacto", () => {
  it("hasta tres a la vista; el resto, en «+N»", () => {
    expect(repartoDePastillas(1)).toEqual({ pastillas: [0], enElMenu: [] });
    expect(repartoDePastillas(3)).toEqual({ pastillas: [0, 1, 2], enElMenu: [] });
    expect(repartoDePastillas(4)).toEqual({ pastillas: [0, 1, 2], enElMenu: [3] });
    expect(repartoDePastillas(8)).toEqual({ pastillas: [0, 1, 2], enElMenu: [3, 4, 5, 6, 7] });
    expect(repartoDePastillas(0)).toEqual({ pastillas: [], enElMenu: [] });
  });
  it("el rótulo: el nombre; sin nombre, el cargo; sin nada, «Contact N»", () => {
    expect(rotuloDeContacto(uno({ name: "ANA", title: "OWNER" }), 0, t)).toBe("ANA");
    expect(rotuloDeContacto(uno({ title: "OFFICE" }), 1, t)).toBe("OFFICE");
    expect(rotuloDeContacto(uno({ phones: ["(956) 555-0101"] }), 2, t)).toBe("Contact 3");
  });
});

describe("editar los contactos", () => {
  const antes = [uno({ name: "ANA", title: "OWNER", phones: ["(956) 555-0101"], emails: ["ana@x.example"] })];
  const fila = { contact_name: "ANA", contact_title: "OWNER", phone: "(956) 555-0101", email: "ana@x.example" };
  it("para editar: cada contacto con al menos un hueco de teléfono y uno de correo; sin contactos, uno en blanco", () => {
    expect(enEdicion([uno({ name: "LEO" })])).toEqual([{ name: "LEO", title: "", phones: [""], emails: [""], note: "", website: "", address: "" }]);
    expect(enEdicion([])).toEqual([contactoVacio()]);
    expect(deEdicion([contactoVacio()])).toEqual([]);
  });
  it("sin tocar nada no se guarda nada (tampoco en una fila que aún los saca de sus columnas)", () => {
    expect(parcheDeContactos(antes, enEdicion(antes), fila)).toEqual({});
    const deColumnas = contactosDe({ contact_name: null, contact_title: null, phone: "956-555-0101 - Omar", email: null });
    expect(parcheDeContactos(deColumnas, enEdicion(deColumnas), { contact_name: null, contact_title: null, phone: "956-555-0101 - Omar", email: null })).toEqual({});
    expect(parcheDeContactos([], [contactoVacio()], null)).toEqual({});
  });
  it("D-697: el sitio web y la dirección de cada contacto se editan y se guardan en SU contacto", () => {
    const dos = [uno({ name: "ANA", website: "ana.example.com" }), uno({ name: "LEO" })];
    const ed = enEdicion(dos);
    expect(ed.map((c) => [c.website, c.address])).toEqual([["ana.example.com", ""], ["", ""]]);
    ed[1] = { ...ed[1], address: "5 Elm St" };
    expect(parcheDeContactos(dos, ed, null).contacts).toEqual([uno({ name: "ANA", website: "ana.example.com" }), uno({ name: "LEO", address: "5 Elm St" })]);
  });
  it("con un cambio: la lista entera en formato, y del espejo solo lo que difiere de la fila", () => {
    const editados = enEdicion(antes);
    editados[0].phones.push("9565550199");
    editados.push({ ...contactoVacio(), name: "luis", emails: ["LUIS@x.example"] });
    expect(parcheDeContactos(antes, editados, fila)).toEqual({
      contacts: [
        uno({ name: "ANA", title: "OWNER", phones: ["(956) 555-0101", "(956) 555-0199"], emails: ["ana@x.example"] }),
        uno({ name: "LUIS", emails: ["luis@x.example"] }),
      ],
    });
    // Separar «número - Omar» en Omar y su número reescribe el espejo de la fila con el teléfono limpio.
    const sucia = { contact_name: null, contact_title: null, phone: "956-555-0101 - Omar", email: null };
    const separados = enEdicion(contactosDe(sucia));
    separados[0].title = "A/P";
    expect(parcheDeContactos(contactosDe(sucia), separados, sucia)).toEqual({
      contacts: [uno({ name: "OMAR", title: "A/P", phones: ["(956) 555-0101"] })], contact_name: "OMAR", contact_title: "A/P", phone: "(956) 555-0101",
    });
  });
  it("en un alta, la lista y lo que tenga del espejo (lo vacío ya es null en una fila nueva)", () => {
    expect(parcheDeContactos([], [{ ...contactoVacio(), name: "ana", phones: ["9565550101"] }], null)).toEqual({
      contacts: [uno({ name: "ANA", phones: ["(956) 555-0101"] })], contact_name: "ANA", phone: "(956) 555-0101",
    });
  });
  it("errores: un teléfono a medias (1 a 9 dígitos) y un correo que no lo parece; los huecos vacíos no", () => {
    expect(erroresDeContactos([
      { ...contactoVacio(), phones: ["(956) 555-01", "", "(956) 555-0101"], emails: ["ana@", "", "b@x.example"] },
      { ...contactoVacio(), phones: ["19565550101"] },
    ])).toEqual(["contacto.0.phones.0", "contacto.0.emails.0"]);
  });
  it("todos los teléfonos y correos en un texto, para el aviso de duplicado", () => {
    const dos = [uno({ phones: ["(956) 555-0101"], emails: ["a@x.example"] }), uno({ phones: ["(956) 555-0202"], emails: ["b@x.example"] })];
    expect(textoDeTelefonos(dos)).toBe("(956) 555-0101 / (956) 555-0202");
    expect(textoDeCorreos(dos)).toBe("a@x.example; b@x.example");
  });
});

describe("la lista y la búsqueda usan los contactos", () => {
  const base = (c: Partial<Cliente>): Cliente => ({
    id: 1, store: "MCA", account: "Acme", unified_account: null, house_no: null, added_batch: null, qb_status: null, activity_status: null,
    status_store: null, status_group: null, history_store: null, history_group: null, crm_type_store: null, crm_type_group: null, associated_with: null,
    rep_history: null, rep_qb: null, rep_store: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
    credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: null, updated_by: null, archived_at: null,
    archived_reason: null, company_id: "e1", contacts: null, ...c,
  });
  it("las columnas Contacto / Teléfono salen ya separadas, aunque la fila los tenga juntos", () => {
    const c = base({ phone: "956-555-0101 - Omar" });
    expect(valorDeColumna(c, "contact_name")).toBe("OMAR");
    expect(valorDeColumna(c, "phone")).toBe("(956) 555-0101");
    expect(celda(c, "phone", t)).toBe("(956) 555-0101");
    expect(valorDeColumna(base({}), "phone")).toBeNull();
  });
  it("la búsqueda encuentra por cualquier contacto: nombre, nota, correo y teléfono por dígitos", () => {
    const c = base({ contacts: [uno({ name: "ANA" }), uno({ name: "LUIS PAZ", phones: ["(956) 555-0199"], emails: ["luis@x.example"], note: "solo POs" })] });
    for (const q of ["luis paz", "solo pos", "luis@x", "555-0199", "5550199"]) expect(coincide(c, q), q).toBe(true);
    expect(coincide(c, "beto")).toBe(false);
  });
  it("el aviso de duplicado mira los teléfonos y correos de TODOS los contactos de la otra fila", () => {
    const otra = base({ id: 2, company_id: "e2", account: "Otra", contacts: [uno({ name: "ANA" }), uno({ name: "LUIS", phones: ["(956) 555-0199"], emails: ["luis@x.example"] })] });
    const porTel = coincidenciasDe({ account: "Nueva", phone: "9565550199" }, [otra]);
    expect(porTel.map((x) => x.motivos)).toEqual([["telefono"]]);
    const porCorreo = coincidenciasDe({ account: "Nueva", email: "LUIS@x.example" }, [otra]);
    expect(porCorreo.map((x) => x.motivos)).toEqual([["correo"]]);
  });
});
