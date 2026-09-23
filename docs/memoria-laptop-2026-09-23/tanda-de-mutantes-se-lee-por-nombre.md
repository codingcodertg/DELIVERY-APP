---
name: tanda-de-mutantes-se-lee-por-nombre
description: Una tanda de mutantes se lee por QUÉ prueba cae; el código de salida y el «cayó algo» esconden pruebas inertes.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-17T18:26:37.617Z
---

Al romper el código a propósito para comprobar que las pruebas lo cazan, lo que
hay que apuntar es **el nombre de la prueba que cae con cada mutante**, y el
total de pruebas que corrieron. «Falló» no es una medida.

**Por qué:** medido el 2026-09-15 en la 110 del directorio, la lectura mintió de
dos formas seguidas.

- La tanda usaba `--reporter=basic`, que en vitest 4 **no existe**: el reportero
  no cargaba, los siete mutantes salían con código 1 y ninguno había corrido una
  prueba. Siete unos idénticos que parecían una medida. Se lee del informe
  **JSON** (`--reporter=json --outputFile`), no de la pantalla ni del código de
  salida.
- Ya bien leída, un mutante «caía por otras tres pruebas» — y eso tapaba que la
  prueba que decía defender justo eso **no podía fallar**: recortaba el `.sql`
  buscando el texto que el propio mutante hacía desaparecer, `indexOf` devolvía
  −1, y el recorte quedaba en un carácter. **El ancla de un recorte no puede ser
  lo que el mutante cambia**, y un ayudante que revienta cuando falta el ancla
  convierte eso en rojo en vez de en verde silencioso. Es [[escape-en-plantilla-prueba-inerte]]
  por otro camino.

Dos añadidos del 2026-09-17, en la tanda de los adjuntos de ayuda:

- **Un mutante que no compila no es un mutante.** El informe decía «1 cae», pero
  el título era «(el fichero no cargó)»: había dejado el `.ts` sin cerrar. Eso no
  mide ninguna prueba. Si el título de la caída no es el de una prueba, el
  mutante está mal escrito, no el código.
- **Un mutante que sobrevive suele señalar una afirmación demasiado ancha.**
  Quitarle la carpeta propia a UNA de las cuatro políticas del `.sql` no tumbó
  nada, porque la prueba buscaba el texto en el fichero entero y seguía estando
  en las otras tres. Se acota al bloque —política por política— y entonces cae.
  Mismo error que [[grep-de-una-linea-no-ve-la-estructura]], visto desde el otro
  lado.

**Cómo aplicarlo:** por cada mutante, imprimir el total y los títulos de las
fallidas. Si una prueba no cae con ningún mutante, o solo cae acompañada,
escribir el mutante que la deje **sola** en rojo — y el mutante gemelo que es la
misma regla escrita de otra forma, que tiene que quedarse en verde para saber
que no estás fijando tu manera de escribirla. Ver [[arreglo-que-parece-hecho]] y
[[prueba-alimentada-por-quien-llama]].
