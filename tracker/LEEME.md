# El tracker: qué ha pedido el dueño, y en qué quedó

Una tarea por fichero en `tracker/tareas/T-0001.json`, un CLI y una página local. **Node a secas, sin
dependencias nuevas.**

```bash
npm run tracker                 # la app en http://127.0.0.1:4319
node tracker/cli.mjs list       # lo mismo, en la terminal
node tracker/cli.mjs --help     # todas las órdenes
```

## Por qué un fichero por tarea

Porque dos sesiones escribiendo a la vez es el caso normal aquí, no la excepción. Un JSON grande con
todo dentro choca en cada merge, igual que `DECISIONS.md` —eso ya se paga hoy—; con un fichero por
tarea, dos sesiones que crean tareas distintas no se tocan y git las fusiona solo.

SQLite se descartó por lo mismo: es binario, no se fusiona, y no se lee en un diff. Lo que se gana en
consultas no compensa perder la revisión por PR de lo que dijo el dueño.

## Los campos

| campo | qué es |
|---|---|
| `id` | `T-0001`. El nombre del fichero **es** el candado: dos sesiones no pueden crear el mismo. |
| `fecha` | cuándo lo pidió, `YYYY-MM-DD` en la zona del negocio (`America/Chicago`). |
| `resumen` | una o dos líneas. Lo que se lee en la tabla. |
| `texto_original` | **sus palabras, literales**, cuando las hay. Vacío no es lo mismo que «no dijo nada»: es «no lo tengo». |
| `lo_hizo_claude` | `Si` / `Parcial` / `No`. |
| `estado` | los cuatro de abajo. |
| `padre` | el `T-00NN` de la tarea madre, para las subtareas. |
| `evidencia` | `commits`, `prs`, `ficheros`, `decisiones` (D-0XX), `links`. **Suma**: un `update` añade, no reemplaza. |
| `notas` | con su fecha. Aquí va el «por qué sigue abierta». |
| `fuentes` | de dónde salió la fila: una sesión, `DECISIONS.md`, un commit. Es lo que separa «lo dijo él» de «lo deduje yo». |

Los cuatro estados, con sus palabras: **En revisión – desplegado**, **En revisión – no desplegado**,
**Ocupa revisión**, **Completado**.

## «Completado» no se pone solo

Una tarea la cierra el dueño, no quien la hizo. Un tracker que se autoaprueba no es un control, es un
boletín.

Por eso ese estado exige, por las dos puertas que pueden escribirlo —el CLI y la app—, la
confirmación **y** una nota que diga cuándo y dónde lo dijo:

```bash
node tracker/cli.mjs update T-0001 --estado Completado \
  --confirmado-por-el-dueno --nota "lo confirmó el 2026-09-23 en persona"
```

Sin las dos cosas, se niega. `tracker.test.mjs` lo mide por las dos puertas, y mide también el caso
que **sí** pasa: si solo probara los rechazos, un CLI que rechazara siempre pasaría la prueba.

## Buscar parecidos

`node tracker/cli.mjs search "almacen recepcion"` compara por palabras, pesando cada una por lo rara
que es en el conjunto: que dos tareas compartan «orden» no dice nada, que compartan «intertienda»
dice mucho. Y dice **por qué** se parecen, porque un porcentaje suelto no se puede discutir.

**No sale nada de esta máquina.** Ni API, ni red, ni modelo: es aritmética sobre los ficheros. Una
prueba recorre `tarea.mjs` y falla si aparece un `fetch(` o un `http`.

## Los secretos no llegan al repo

Esto se commitea, así que antes de escribir se tapan tokens de Notion, JWT, llaves de Supabase,
Google y GitHub, cadenas de conexión, correos y teléfonos. Se tapa el secreto, **no la frase**: el
texto sigue contando qué se pidió. Y lo que se tapó se dice por pantalla, para que nadie crea que
está completo.

No es hipotético: el token de Notion se pega en el chat cada vez que hay que correr el sync.

## Lo que no hace

- **No decide nada solo.** No cierra tareas, no cambia estados por su cuenta y no adivina si algo se
  desplegó.
- **No mira producción.** «Desplegado» es un dato que alguien pone, no algo que el tracker compruebe.
- **No es multiusuario**: el servidor escucha solo en `127.0.0.1`, porque esta página escribe
  ficheros del repo sin pedirle la contraseña a nadie.
