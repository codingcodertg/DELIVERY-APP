#!/usr/bin/env node
// ============================================================================
// Comprueba que DECISIONS.md no esta empalmado.
//
// El 2026-09-17, resolviendo un conflicto con un script que pegaba los dos lados
// del marcador, el commit 564a9b1 (PR #104) metio una COPIA ENTERA del documento
// DENTRO de la entrada D-279, partiendola en dos: el fichero paso de 17.972 a
// 35.921 lineas y 277 entradas quedaron duplicadas. No fallo nada -- Markdown se
// lee igual de bien-- y por eso vivio un dia entero sin que nadie lo notara.
//
// Esto es la comprobacion que lo habria cazado el mismo dia. Corre sola:
//
//   node scripts/decisions-check.mjs
//   node scripts/decisions-check.mjs --contra HEAD~1   (ademas: no se perdio nada)
//
// Sale con 1 si algo falla, para poder colgarlo de un hook o de CI. Lo que mira,
// que son los cinco criterios con los que se reparo:
//
//   1. cada `## D-NNN` una sola vez
//   2. los numeros, en orden ascendente
//   3. el titulo del documento, una sola vez
//   4. ninguna linea con una costura: un encabezado pegado a otro texto
//   5. (--contra) todo renglon no vacio de esa version sigue existiendo
//
// El 5 es el que convierte "se ve bien" en una medicion, y por eso se corre al
// reparar: una deduplicacion que pierde una nota es peor que el empalme.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FICHERO = "DECISIONS.md";
const TITULO = "# Bitácora de decisiones — RDZ · Deliveries";

/** El fichero como lineas, con los saltos normalizados: da igual CRLF o LF. */
export function lineasDe(texto) {
  return texto.split("\r\n").join("\n").split("\n");
}

/**
 * Que lineas son ESTRUCTURA y cuales son una CITA.
 *
 * Lo de dentro de un bloque de codigo (```) no es un encabezado ni un titulo: es texto que una
 * entrada esta citando. Hizo falta el mismo dia: la entrada que cuenta el empalme **cita la linea
 * rota como prueba**, y sin esto el comprobador se cazaba a si mismo.
 *
 * La comprobacion de que no se pierde nada (criterio 5) NO usa esto: ahi cuenta cada renglon,
 * lo cite quien lo cite.
 */
export function fueraDeCodigo(lineas) {
  let dentro = false;
  return lineas.map((l) => {
    if (/^\s*```/.test(l)) { dentro = !dentro; return false; }
    return !dentro;
  });
}

/** Los encabezados de entrada, con su numero y su linea (1-indexada). Sin los citados. */
export function encabezados(lineas) {
  const vivo = fueraDeCodigo(lineas);
  const salida = [];
  lineas.forEach((l, i) => {
    if (!vivo[i]) return;
    const m = /^## (D-(\d+))\b/.exec(l);
    if (m) salida.push({ id: m[1], numero: Number(m[2]), linea: i + 1, texto: l });
  });
  return salida;
}

/**
 * Los cinco criterios. Devuelve la lista de problemas: vacia es que esta bien.
 *
 * `antes` es opcional y es el contenido de otra version; con el se comprueba el
 * criterio 5 (no se perdio nada), que es el unico que necesita dos ficheros.
 */
export function problemas(texto, antes = null) {
  const lineas = lineasDe(texto);
  const vivo = fueraDeCodigo(lineas);
  const enc = encabezados(lineas);
  const fallos = [];

  // 1. Cada numero, una sola vez.
  const porNumero = new Map();
  for (const e of enc) {
    if (!porNumero.has(e.id)) porNumero.set(e.id, []);
    porNumero.get(e.id).push(e.linea);
  }
  const repetidos = [...porNumero].filter(([, v]) => v.length > 1);
  if (repetidos.length) {
    fallos.push(`1. ${repetidos.length} entradas aparecen mas de una vez (de ${porNumero.size}). `
      + `Las tres primeras: ${repetidos.slice(0, 3).map(([id, v]) => `${id} en ${v.join(", ")}`).join(" · ")}`);
  }

  // 2. En orden ascendente. Se dice DONDE se rompe, que es lo unico util.
  for (let i = 1; i < enc.length; i++) {
    if (enc[i].numero <= enc[i - 1].numero) {
      fallos.push(`2. ${enc[i].id} (linea ${enc[i].linea}) va detras de ${enc[i - 1].id} (linea ${enc[i - 1].linea})`);
      break;
    }
  }

  // 3. El titulo, una vez.
  const titulos = lineas.filter((l, i) => vivo[i] && l.trim() === TITULO).length;
  if (titulos !== 1) fallos.push(`3. el titulo del documento aparece ${titulos} veces (tiene que ser 1)`);

  // 4. Costuras: un encabezado pegado a texto que le precede en la misma linea.
  //    Es la firma exacta del empalme de 2026-09-17: la frase de D-279 quedo
  //    cortada a mitad de token y el titulo pegado detras, en la misma linea.
  //
  //    **Este es el unico criterio que habria cazado aquel accidente si el documento pegado no
  //    hubiera traido entradas**: el del titulo NO lo caza, porque un titulo pegado a otro texto
  //    no es una linea de titulo. Medido con el fichero de aquel dia.
  lineas.forEach((l, i) => {
    if (!vivo[i]) return;
    if (/\S# Bitácora de decisiones/.test(l) || /\S## D-\d+ /.test(l)) {
      fallos.push(`4. costura en la linea ${i + 1}: ${l.slice(0, 120)}`);
    }
  });

  // 5. Nada perdido.
  if (antes != null) {
    const hay = new Set(lineasDe(texto).map((l) => l.trim()).filter(Boolean));
    const faltan = [...new Set(lineasDe(antes).map((l) => l.trim()).filter(Boolean))].filter((l) => !hay.has(l));
    if (faltan.length) {
      fallos.push(`5. ${faltan.length} renglones de la version anterior ya no estan. `
        + `Los tres primeros: ${faltan.slice(0, 3).map((l) => JSON.stringify(l.slice(0, 80))).join(" · ")}`);
    }
  }

  return fallos;
}

// ---- Como programa ---------------------------------------------------------
const esPrograma = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("\\").join("/").split("/").pop());
if (esPrograma) {
  const i = process.argv.indexOf("--contra");
  const ref = i > -1 ? process.argv[i + 1] : null;
  const texto = readFileSync(FICHERO, "utf8");
  // `--contra` acepta las dos cosas: un fichero guardado, o una referencia de git. Un fichero
  // primero, porque es lo unico que se puede comprobar sin un repositorio -- y porque al reparar
  // uno quiere comparar contra la copia que se saco antes de tocar nada.
  const antes = ref
    ? (existsSync(ref)
        ? readFileSync(ref, "utf8")
        : execFileSync("git", ["show", `${ref}:${FICHERO}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))
    : null;
  const fallos = problemas(texto, antes);
  const enc = encabezados(lineasDe(texto));
  if (!fallos.length) {
    console.log(`${FICHERO}: ${enc.length} entradas, de ${enc[0]?.id} a ${enc.at(-1)?.id}, sin repetidas, en orden y sin costuras.`);
    if (ref) console.log(`Y no se perdio ningun renglon respecto a ${ref}.`);
    process.exit(0);
  }
  console.error(`${FICHERO} tiene ${fallos.length} problema(s):`);
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
