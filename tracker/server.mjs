#!/usr/bin/env node
// La app del tracker: un servidor de Node a secas y una pagina. `npm run tracker`.
//
// **Escucha solo en 127.0.0.1**, a proposito: esta pagina escribe ficheros del repo sin pedir
// contrasena a nadie. En la red de casa eso seria una pagina que cualquiera del wifi puede editar.
// Si algun dia hace falta verla desde otro equipo, es una decision, no una bandera.

import { createServer } from "node:http";
import { join } from "node:path";
import { informeHTML } from "./informe.mjs";
import {
  ESTADO_FINAL, HECHO, RAIZ, VERIFICACION, ahoraLocal, guarda, lee, normalizaEstado, normalizaVerificacion,
  tapaSecretos, todas,
} from "./tarea.mjs";

const PUERTO = Number(process.env.TRACKER_PUERTO) || 4319;
void RAIZ;
void join;

const json = (res, codigo, cuerpo) => {
  const t = JSON.stringify(cuerpo);
  res.writeHead(codigo, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(t) });
  res.end(t);
};

function cuerpoDe(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (d) => {
      b += d;
      // Una nota no ocupa un mega. El tope evita que un fallo deje el proceso comiendo memoria.
      if (b.length > 1_000_000) { reject(new Error("cuerpo demasiado grande")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      // **La misma página que el fichero suelto**, pintada por `informe.mjs`, con `editable` en
      // true. Dos plantillas acabarían discrepando y el dueño vería una cosa en la pantalla y
      // otra en el fichero guardado.
      const html = informeHTML({ editable: true, tareas: todas() });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/tarea/")) {
      const id = url.pathname.slice("/api/tarea/".length);
      const t = lee(id);
      if (!t) return json(res, 404, { error: "no existe " + id });
      const c = await cuerpoDe(req);

      if (c.estado !== undefined) {
        const e = normalizaEstado(c.estado);
        if (!e) return json(res, 400, { error: "estado desconocido" });
        // La misma regla que el CLI, escrita en los dos sitios por los que se puede escribir: una
        // regla que solo vigila una puerta no vigila nada.
        if (e === ESTADO_FINAL) {
          if (!c.confirmadoPorElDueno) return json(res, 400, { error: "«" + ESTADO_FINAL + "» solo lo pone el dueno" });
          if (!String(c.nota ?? "").trim()) return json(res, 400, { error: "para cerrar hace falta una nota que diga cuando y donde lo confirmo" });
        }
        t.estado = e;
      }
      if (c.lo_hizo_claude !== undefined) {
        if (!HECHO.includes(c.lo_hizo_claude)) return json(res, 400, { error: "valor desconocido" });
        t.lo_hizo_claude = c.lo_hizo_claude;
      }
      if (c.verificacion !== undefined) {
        const v = normalizaVerificacion(c.verificacion);
        if (!v) return json(res, 400, { error: "verificación desconocida" });
        // La misma regla que el CLI: sin decir quién lo midió, cuándo y cómo, no se acepta.
        const prueba = String(c.prueba ?? "").trim();
        if (v !== VERIFICACION[0] && !prueba) {
          return json(res, 400, { error: "para marcar «" + v + "» hace falta decir quién lo midió, cuándo y cómo" });
        }
        t.verificacion = { estado: v, prueba: tapaSecretos(prueba).texto, fecha: v === VERIFICACION[0] ? null : ahoraLocal() };
      }
      if (String(c.nota ?? "").trim()) {
        const { texto, tapados } = tapaSecretos(String(c.nota));
        t.notas.push({ fecha: ahoraLocal(), texto });
        if (tapados.length) t.notas[t.notas.length - 1].texto += "  (se tapo: " + tapados.join(", ") + ")";
      }
      guarda(t);
      return json(res, 200, { tarea: t });
    }

    json(res, 404, { error: "no hay nada en " + url.pathname });
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

/**
 * El puerto ocupado es el caso NORMAL, no el raro: varias sesiones trabajan en este repo a la vez y
 * cualquiera puede haber levantado ya el tracker.
 *
 * Sin esto, Node suelta un `Unhandled 'error' event` con su traza, que se lee como «el tracker esta
 * roto» y empuja a lo peor que puede pasar aqui: buscar el PID del 4319 y matarlo. Eso ya ocurrio
 * el 2026-09-23 — una sesion midio el servidor de otra creyendo que era el suyo, y despues lo
 * cerro. **No se arranca otro en otro puerto por las buenas**: dos trackers escuchando es como dos
 * sesiones acaban mirando numeros distintos y discutiendo cual es el bueno.
 */
servidor.on("error", (e) => {
  if (e?.code === "EADDRINUSE") {
    console.error("Ya hay un tracker escuchando en http://127.0.0.1:" + PUERTO + " — abrelo en el navegador.");
    console.error("Si de verdad quieres otro aparte: TRACKER_PUERTO=" + (PUERTO + 1) + " npm run tracker");
    console.error("No lo mates por PID sin comprobar que lo arrancaste tu: puede ser el de otra sesion.");
    process.exit(1);
  }
  if (e?.code === "EACCES") {
    console.error("El sistema no deja escuchar en el puerto " + PUERTO + ". Prueba con TRACKER_PUERTO=4320.");
    process.exit(1);
  }
  console.error("No se pudo levantar el tracker: " + (e?.message ?? e));
  process.exit(1);
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log("tracker en http://127.0.0.1:" + PUERTO + "   (" + todas().length + " tareas)");
  console.log("Ctrl-C para pararlo.");
});
