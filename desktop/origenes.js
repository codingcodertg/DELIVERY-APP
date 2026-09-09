"use strict";

// ============================================================
// Qué es «nuestro» para la ventana de escritorio (D-NEXT).
//
// El fallo que cierra: en la app instalada, «Cerrar sesión» no cerraba la sesión — abría el
// navegador. El instalador que la gente tiene (RDZ Hub 1.0.0, del 3 de septiembre) lleva embebido
// el dominio viejo `deliveries-app-seven.vercel.app`; el cambio a `rtg-hub.vercel.app` en
// `main.js` es del día siguiente. El dominio viejo redirige con 307 al nuevo, así que la app
// **carga bien y todo parece funcionar**: navegar por dentro es enrutado de cliente de Next.js y
// no dispara `will-navigate`.
//
// Pero el cierre de sesión es un `<form method="post">`, o sea una navegación de página completa.
// Ahí sí salta `will-navigate`, con una URL de `rtg-hub` que no coincidía con la constante
// embebida — y la ventana la mandaba a `shell.openExternal`. De ahí el navegador, y de ahí que la
// sesión no se cerrara.
//
// El arreglo de fondo no es recompilar: es que **una app instalada no se rompa porque el sitio
// cambie de dominio**. Esto ya pasó y volverá a pasar.
//
// Vive aquí, separado de `main.js`, por dos razones: no depende de Electron —así que se puede
// probar de verdad, y hay pruebas— y porque lo que decide no es cosmético, es qué se abre dentro
// de una ventana con sesión iniciada.
// ============================================================

/**
 * La lista de orígenes de confianza de esta ventana.
 *
 * Empieza con el origen compilado y **aprende uno más: el origen al que de verdad acabó la
 * primera carga**. Esa primera carga la inicia la propia app hacia su URL de inicio, así que si
 * termina en otro origen es porque **nuestro propio dominio** redirigió allí.
 *
 * **Solo la primera, y esto es la parte importante.** La regla más general —«confía en cualquier
 * origen al que te lleve una redirección desde un origen de confianza»— parece mejor y es peor:
 * un flujo que redirija a un proveedor externo (un OAuth, una pasarela de pago) convertiría ese
 * sitio en interno, y entonces se abriría **dentro** de la ventana con la sesión puesta y sin
 * barra de direcciones. Aquí la confianza se gana una vez, al arrancar, y no se vuelve a ganar.
 *
 * Lo que **no** se hace, y el encargo lo pedía explícitamente: tratar como interno cualquier
 * origen donde la ventana acabe. Estar cargado no vuelve confiable a nadie.
 */
function crearConfianza(origenCompilado) {
  const confiables = new Set();
  let aprendido = false;
  const normaliza = (u) => {
    try {
      const url = new URL(u);
      // `origin` de un `mailto:`, `sms:` o `tel:` es la cadena "null": no son orígenes web y no
      // pueden entrar aquí. Es lo que mantiene esos enlaces saliendo al programa del sistema,
      // que es justo lo que se quiere.
      return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
      return null;
    }
  };

  const inicial = normaliza(origenCompilado);
  if (inicial) confiables.add(inicial);

  return {
    /** ¿Esta URL se abre DENTRO de la ventana? */
    esNuestro(u) {
      const o = normaliza(u);
      return o != null && confiables.has(o);
    },

    /**
     * El origen donde acabó la primera carga, aprendido una sola vez.
     *
     * Devuelve el origen aprendido si era nuevo, o `null` si no había nada que aprender (ya se
     * aprendió, no es una URL web, o es el mismo de siempre). El valor de retorno existe para
     * poder registrarlo: un cambio de dominio silencioso es justo lo que costó este fallo.
     */
     aprendeDeLaPrimeraCarga(u) {
      if (aprendido) return null;
      aprendido = true;
      const o = normaliza(u);
      if (o == null || confiables.has(o)) return null;
      confiables.add(o);
      return o;
    },

    /** Para poder decir en un informe qué consideraba suyo esta ventana. */
    origenes() {
      return [...confiables];
    },

    /** Si ya se gastó la única oportunidad de aprender. Para las pruebas y para el registro. */
    yaAprendio() {
      return aprendido;
    },
  };
}

module.exports = { crearConfianza };
