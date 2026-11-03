"use strict";

// ============================================================
// La identidad de ESTA instalación de la app de escritorio (D-811).
//
// El dueño: «el bloqueo debe ser único por app downloaded, nadie puede copiar». Una cookie o un
// `localStorage` se copian de una máquina a otra; esto no: el id sale del `MachineGuid` de Windows
// (nace con la instalación de Windows y vive en el registro, HKLM\SOFTWARE\Microsoft\Cryptography)
// más una sal que esta app genera la primera vez y guarda en su carpeta de datos. Copiar la carpeta
// de la app a otra PC da otro MachineGuid y por tanto otro id; copiar la sal sin el registro,
// igual. El id viaja en una cabecera (`x-rtg-device`) que solo esta ventana pone en las peticiones
// a nuestro sitio; un navegador no puede ponerla desde la barra de direcciones.
//
// Vive aparte de `main.js` por lo mismo que `origenes.js`: no depende de Electron y se prueba.
// ============================================================

const { createHash, randomBytes } = require("node:crypto");

/** El nombre de la cabecera. Tiene que ser el mismo que lee `src/lib/security/reglas.ts`. */
const CABECERA = "x-rtg-device";

/**
 * El id: sha256 de `machineGuid|sal`, en hexadecimal, 64 letras. Sin `machineGuid` (un Windows raro, un registro que no
 * se pudo leer) se usa solo la sal: sigue siendo único por instalación, aunque entonces sí se podría copiar la carpeta.
 */
function idDeMaquina(machineGuid, sal) {
  const g = String(machineGuid ?? "").trim().toLowerCase();
  const s = String(sal ?? "").trim();
  if (!s) throw new Error("sin sal");
  return createHash("sha256").update(`${g}|${s}`, "utf8").digest("hex");
}

/** Una sal nueva: 32 bytes al azar, en hexadecimal. */
function salNueva() {
  return randomBytes(32).toString("hex");
}

/** El `MachineGuid` tal como lo imprime `reg query`, o null si no está. */
function machineGuidDe(salidaDeReg) {
  const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(String(salidaDeReg ?? ""));
  return m ? m[1].toLowerCase() : null;
}

module.exports = { CABECERA, idDeMaquina, salNueva, machineGuidDe };
