---
name: premisa-heredada-no-es-medicion
description: Un comentario del repo no es una medición; etiquetarlo como «no verificado» no autoriza a construir un hallazgo encima.
metadata:
  type: feedback
---

El comentario de `NO_MATCH` en `clockin/scope.ts` decía que una lista vacía en
`.in()` podía «ser descartada y coincidir con todo». Nadie lo había medido. Esa
frase sostuvo **tres decisiones en un día**: la forma de `visibleStores`, un
encargo entero y un hallazgo de auditoría que hablaba de una fuga de datos.
Medido después: `postgrest-js` **manda** `in.()` y el servidor devuelve **cero
filas**. No había fuga, ni latente.

**Por qué no basta con avisar:** yo escribí «evitado, no medido» las dos veces,
y aun así puse la premisa en el título de una entrada, en un comentario del
código y en la lista de puntos del aviso al auditor. **La etiqueta permitió
corregirlo, no impidió construir encima.**

**Cómo aplicarlo:** rodear algo que no se puede medir es buena ingeniería y mal
cimiento para una afirmación. Si un hallazgo depende de una premisa sin medir,
la premisa se mide antes de darle nombre, o el hallazgo se enuncia sin ella
(aquí quedaba en pie solo: seis sitios con dos formas distintas es peor que
seis iguales). Y al corregir la frase original, **se corrige donde vive** — el
comentario del código— con la medición al lado, no se borra. Emparejado con
[[comentario-dice-la-verdad]] y [[auditoria-no-es-medicion]].

**2026-10-10 — y la premisa puede ser mía, del mismo día.** En D-509 escribí «el mapa no se puede dibujar
desde el DOM» como razón para usar `getDisplayMedia`, sin medirlo. El dueño la probó y la rechazó por los
diálogos de permiso. Medir costó diez minutos: los mapas son Leaflet con `<img>`, y los tres servidores de
mosaicos mandan CORS (`curl -H "Origin: …"` contra cada uno). Era falso. Un «no se puede» que decide el diseño
se mide ANTES de construir encima, aunque lo haya pensado yo hace una hora. D-513.

Y un gemelo de medición del mismo día: un guion convertía un argumento vacío en el valor por defecto, así que
dos corridas «de Órdenes» fueron en el Gestor. Lo delató el nombre del fichero de salida. **Que la salida diga
qué midió** (ruta, ancho, nombre) y leerlo antes de citar el número.
