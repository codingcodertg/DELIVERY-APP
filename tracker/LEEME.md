# El tracker: qué ha pedido el dueño, y en qué quedó

Una tarea por fichero en `tracker/tareas/T-0001.json`, un CLI y una página. **Node a secas, sin
dependencias nuevas.**

```bash
npm run tracker                              # la página en http://127.0.0.1:4319
node tracker/cli.mjs html > tracker/informe.html   # el mismo informe, en un fichero suelto
node tracker/cli.mjs list                    # lo mismo, en la terminal
node tracker/cli.mjs --help                  # todas las órdenes
```

## Las dos formas de verlo

**`npm run tracker`** abre la página y deja cambiar el estado, la verificación y añadir notas.

**`node tracker/cli.mjs html`** escribe el informe entero por la salida estándar. Redirigido a un
fichero, se abre con doble clic: sin servidor, sin internet y sin nada de fuera —ni tipografías, ni
librerías, ni CDN—, porque un informe que necesita internet para pintarse no es un fichero que
puedas guardar. Se puede mandar por correo o imprimir.

**Las dos salen de la misma función** (`informe.mjs`). Si fueran dos plantillas acabarían
discrepando, y el dueño vería una cosa en la pantalla y otra en el fichero. Una prueba compara las
dos salidas y exige que solo las separe la bandera de «se puede escribir».

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
| `fecha` | **cuándo lo pidió él**, `YYYY-MM-DD` en la zona del negocio (`America/Chicago`). Ver abajo: se equivoca con facilidad. |
| `resumen` | una o dos líneas. Lo que se lee en la tabla. |
| `texto_original` | **sus palabras, literales**, cuando las hay. Vacío no es lo mismo que «no dijo nada»: es «no lo tengo». |
| `lo_hizo_claude` | `Si` / `Parcial` / `No`. |
| `estado` | los cuatro de abajo. |
| `padre` | el `T-00NN` de la tarea madre, para las subtareas. |
| `evidencia` | `commits`, `prs`, `ficheros`, `decisiones` (D-0XX), `links`. **Suma**: un `update` añade, no reemplaza. |
| `notas` | con su fecha. Aquí va el «por qué sigue abierta». |
| `verificacion` | **¿alguien lo comprobó?** `sin verificar` / `verificado` / `fallo`, con la `prueba` que lo sostiene. |
| `fuentes` | de dónde salió la fila: una sesión, `DECISIONS.md`, un commit. Es lo que separa «lo dijo él» de «lo deduje yo». |

Los cuatro estados, con sus palabras: **En revisión – desplegado**, **En revisión – no desplegado**,
**Ocupa revisión**, **Completado**.

## La fecha es la del pedido, y solo la del pedido

De un mensaje suyo, la del mensaje. De una entrada de `DECISIONS.md`, la de la decisión, que es lo
más cerca del pedido que queda cuando no hay transcripción.

**Nunca la de un commit, la de un despliegue, ni la de una fila de un espejo.** Esas dicen cuándo se
hizo algo, y la tabla ordena por cuándo lo pidió: mezclarlas hace que una petición de agosto
aparezca en septiembre y parezca reciente.

Ya se coló una vez. T-0016 llevaba `2026-09-17` porque era la fila más nueva del espejo de Notion —
que además resultó ser un parche escrito a mano, así que ni siquiera medía lo que parecía medir. Se
corrigió a `2026-08-18`, la fecha de D-046, que es donde el dueño pidió la documentación viva.
`update --fecha` existe para eso: se corrige por el CLI, con su validación, y no editando el JSON.

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

## «Desplegado» no es «comprobado»

Son dos preguntas distintas, y el tracker las guarda por separado. **El estado** dice dónde está el
cambio; **la verificación** dice si alguien lo abrió y lo vio funcionar.

```bash
node tracker/cli.mjs update T-0001 --verificacion verificado \
  --prueba "lo abrió worker en el navegador el 2026-09-24 y vio la vista de Recepción"
node tracker/cli.mjs list --verificacion "sin verificar" --contar
```

Un `verificado` **sin `--prueba` se rechaza**, por las dos puertas, igual que «Completado». Una
afirmación sin nada detrás es peor que ninguna, porque se cree. Y `fallo` vale tanto como
`verificado`: se midió y no hacía lo que se pidió.

Hoy hay **2 comprobadas de 362**, y eso no es un reproche a nadie: es el estado real, y el tracker
existe para decirlo en vez de dar por bueno lo que solo está compilado.

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

## De dónde salieron las 362

- **Del 2026-09-04 a hoy**, de los mensajes del dueño en las sesiones de esta máquina, leídos uno a
  uno. 185 con sustancia; los que no son peticiones —preguntas, prompts de arranque, trazas de
  instalación— se contaron aparte y no son tareas.
- **Del 2026-08-11 al 09-03** no hay transcripción, así que salen de `DECISIONS.md`. En esas, **el
  resumen es el título de la decisión palabra por palabra**, no una paráfrasis, y cada una lo dice
  en una nota. **48 entradas quedaron fuera** por no traer marca de petición suya ni cita: son
  auditorías y arreglos vistos de paso, y meterlas como «lo que pidió el dueño» sería fabricar
  justo el dato que esto viene a controlar.
- **Del 2026-07-23 al 08-10** no hay ni una cosa ni la otra: 207 commits y ninguna fuente de qué se
  pidió. Es **una sola tarea** (T-0015), con las áreas en las notas como inventario de lo hecho,
  nunca como afirmación de lo pedido.
- **Del 09-20 al 22** se trabajó en la laptop y aquí no quedó sesión. Ese hueco se puede cerrar
  trayendo esas transcripciones, como se trajo la memoria.

## Los hooks

`hook-contexto.mjs` (para `UserPromptSubmit`) busca tareas parecidas a lo que se acaba de pedir y
las pone delante. `hook-recordatorio.mjs` (para `Stop`) recuerda actualizar y enumera los commits
nuevos. **Ninguno registra nada solo**: `Stop` se dispara cada vez que Claude termina de responder,
no al acabar una tarea, así que no sabe si se cerró algo.

Los dos se tragan cualquier error y salen limpios: un hook que se queja rompe el mensaje del dueño.
Medido con 362 tareas: 84 ms y 67 ms. La configuración para pegarlos está en
`PROPUESTA-HOOKS.json`, con lo que está verificado y lo que no.

## Lo que no hace

- **No decide nada solo.** No cierra tareas, no cambia estados por su cuenta y no adivina si algo se
  desplegó.
- **No mira producción.** «Desplegado» es un dato que alguien pone, no algo que el tracker compruebe.
- **No es multiusuario**: el servidor escucha solo en `127.0.0.1`, porque esta página escribe
  ficheros del repo sin pedirle la contraseña a nadie.
