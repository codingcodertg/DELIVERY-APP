/*
 * Lee la página de Indeed que el dueño tiene abierta. ÚNICO sitio que sabe cómo es el DOM de Indeed.
 *
 * SOLO LECTURA: no pulsa nada, no navega, no escribe en la página. Los selectores marcados TODO son suposiciones sin
 * probar contra Indeed real; el botón «Copiar diagnóstico» saca un esquema sin texto personal para corregirlos.
 *
 * Depende de nucleo.js (cargado antes). Expone `globalThis.RTGExtractor`.
 */
(function () {
  const N = globalThis.RTGNucleo;

  const SELECTORES = {
    paginas: {
      // TODO: forma real de la URL de la bandeja y de cada conversación/solicitud.
      mensajes: /\/messages?(\/|$|\?)/i,
      solicitudes: /\/applications?(\/|$|\?)/i,
    },
    // TODO: el contenedor principal del detalle (si falla, se usa todo el documento).
    contenedor: ["main", "[role='main']"],
    // TODO: encabezado con el nombre del candidato.
    encabezados: "h1, h2, [role='heading']",
    // TODO: burbujas de los mensajes de la conversación.
    burbujas: "[data-testid*='message'], [class*='message-bubble'], [class*='MessageBubble']",
    // TODO: cómo se marca una burbuja que escribió el empleador (para no mandar sus propios mensajes).
    esDelEmpleador: /outgoing|sent|employer|self|own/i,
    // TODO: chips de calificaciones de la solicitud.
    calificaciones: "[data-testid*='qualification'], [class*='qualification'], [class*='chip']",
    // TODO: la conversación seleccionada en la lista lateral (para el nombre si no hay encabezado).
    conversacionActiva: "[aria-selected='true']",
    // Textos de los enlaces de acción (se comparan en minúsculas).
    enlaceSolicitud: /see full application|ver (la )?solicitud/i,
    enlaceCv: /view resume|ver (el )?curr[ií]culum/i,
    // Cuántos mensajes del candidato se mandan (los más recientes).
    mensajesMaximos: 3,
  };

  const contenedorDe = (doc) => {
    for (const s of SELECTORES.contenedor) {
      const el = doc.querySelector(s);
      if (el) return el;
    }
    return doc.body;
  };

  /** Tipo de página por la URL y si es un detalle (lleva id). */
  function tipoDePagina(href) {
    const path = (() => {
      try {
        return new URL(href).pathname + new URL(href).search;
      } catch {
        return "";
      }
    })();
    const kind = SELECTORES.paginas.mensajes.test(path) ? "message" : SELECTORES.paginas.solicitudes.test(path) ? "application" : null;
    if (!kind) return null;
    const detalle = N.idDeUrl(href) !== null;
    return detalle ? { kind, detalle: true } : { kind, detalle: false };
  }

  function nombreDelDetalle(doc, contenedor) {
    for (const h of contenedor.querySelectorAll(SELECTORES.encabezados)) {
      const t = (h.innerText || "").trim();
      if (N.pareceNombre(t)) return t;
    }
    const activa = doc.querySelector(SELECTORES.conversacionActiva);
    const primera = activa ? (activa.innerText || "").trim().split("\n")[0].trim() : "";
    return N.pareceNombre(primera) ? primera : null;
  }

  function mensajesDelCandidato(contenedor) {
    const todas = [...contenedor.querySelectorAll(SELECTORES.burbujas)];
    const delCandidato = todas.filter((el) => {
      const marca = `${el.className || ""} ${el.getAttribute("data-testid") || ""}`;
      return !SELECTORES.esDelEmpleador.test(marca);
    });
    const textos = delCandidato.map((el) => (el.innerText || "").trim()).filter(Boolean);
    return textos.slice(-SELECTORES.mensajesMaximos).join("\n\n");
  }

  function primerTiempo(contenedor) {
    const t = contenedor.querySelector("time[datetime]");
    const iso = t ? new Date(t.getAttribute("datetime")) : null;
    return iso && !Number.isNaN(iso.getTime()) ? iso.toISOString() : null;
  }

  function enlaceQue(contenedor, patron) {
    for (const a of contenedor.querySelectorAll("a[href]")) {
      if (!patron.test((a.innerText || "").trim())) continue;
      const seguro = N.enlaceIndeed(a.href);
      if (seguro) return seguro;
    }
    return null;
  }

  /**
   * Del detalle abierto, el objeto con la forma exacta que acepta `POST /api/indeed-bot/ingest`.
   * Lanza un Error con el motivo si no hay nombre (no se manda nada sin nombre).
   */
  async function extraer(doc, href) {
    const tipo = tipoDePagina(href);
    if (!tipo || !tipo.detalle) throw new Error("Esta página no es el detalle de una conversación o solicitud.");
    const contenedor = contenedorDe(doc);
    const texto = (contenedor.innerText || "").slice(0, 200_000);
    const nombre = nombreDelDetalle(doc, contenedor);
    if (!nombre) throw new Error("No encontré el nombre del candidato en esta página.");
    const { puesto, ubicacion } = N.datosDeVacante(texto);
    const receivedAt = primerTiempo(contenedor) || new Date().toISOString();
    const externalId = await N.externalIdDe({ kind: tipo.kind, url: href, nombre, puesto, primerTiempo: receivedAt });

    const tel = contenedor.querySelector("a[href^='tel:']");
    const phone = (tel && N.telefonoDeTexto(tel.getAttribute("href").replace(/^tel:/, ""))) || N.telefonoDeTexto(texto);

    if (tipo.kind === "message") {
      return {
        kind: "message",
        externalId,
        receivedAt,
        candidateName: nombre,
        position: puesto,
        location: ubicacion,
        text: mensajesDelCandidato(contenedor) || texto,
        phone,
      };
    }

    const chips = [...contenedor.querySelectorAll(SELECTORES.calificaciones)]
      .map((el) => (el.innerText || "").trim())
      .filter((t) => t && t.length <= 60);
    const qualifications = [...new Set(chips.length ? chips : N.calificacionesDeTexto(texto))];
    return {
      kind: "application",
      externalId,
      receivedAt,
      candidateName: nombre,
      position: puesto,
      location: ubicacion,
      phone,
      qualifications,
      links: {
        application: enlaceQue(contenedor, SELECTORES.enlaceSolicitud),
        resume: enlaceQue(contenedor, SELECTORES.enlaceCv),
      },
    };
  }

  /**
   * Esquema de la página SIN texto personal: etiquetas, clases, roles y atributos data-testid, con la cantidad de
   * caracteres de cada texto en lugar del texto. Los enlaces solo muestran el host y la forma de la ruta (ids en `:id`).
   */
  function diagnostico(doc, limite = 500) {
    const lineas = [];
    const sangria = (d) => "  ".repeat(d);
    const forma = (el) => {
      const tag = el.tagName.toLowerCase();
      const clases = [...(el.classList || [])].slice(0, 3).map((c) => `.${c.replace(/[^A-Za-z0-9_-]/g, "")}`).join("");
      const role = el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : "";
      const testid = el.getAttribute("data-testid") ? ` data-testid=${el.getAttribute("data-testid")}` : "";
      let extra = "";
      if (tag === "a" && el.getAttribute("href")) {
        try {
          const u = new URL(el.href);
          extra = ` href=${u.host}${u.pathname.replace(/\/[A-Za-z0-9_-]{6,}/g, "/:id")}`;
        } catch {
          extra = " href=?";
        }
      }
      return `${tag}${clases}${role}${testid}${extra}`;
    };
    const recorre = (el, d) => {
      if (lineas.length >= limite || d > 14) return;
      if (["script", "style", "noscript", "svg", "path"].includes(el.tagName.toLowerCase())) return;
      const propio = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").length;
      lineas.push(`${sangria(d)}<${forma(el)}>${propio ? ` [texto:${propio}]` : ""}`);
      for (const hijo of el.children) recorre(hijo, d + 1);
    };
    recorre(doc.body, 0);
    return [
      `Diagnóstico RTG Indeed · ${new Date().toISOString()}`,
      `URL: ${new URL(doc.location.href).host}${new URL(doc.location.href).pathname.replace(/\/[A-Za-z0-9_-]{6,}/g, "/:id")}`,
      `Sin texto personal: solo etiquetas, clases, roles y largos de texto.`,
      ...lineas,
    ].join("\n");
  }

  globalThis.RTGExtractor = { SELECTORES, tipoDePagina, extraer, diagnostico };
})();
