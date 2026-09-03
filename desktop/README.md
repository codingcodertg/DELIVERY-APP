# RDZ Hub — app de escritorio para Windows

Una ventana que abre **el hub** (`/home`), desde donde cada quien entra a los módulos que
tenga: Deliveries, RR. HH., Time Tracker, ERP.

Para **toda la empresa menos los choferes**. Ellos tienen su propia app de Android, que
además pide GPS permanente — un permiso que un vendedor o alguien de oficina no necesita y
no debería tener que conceder.

## Qué hace, y qué no

**No trae el sitio dentro.** Lo carga en vivo desde
`https://deliveries-app-seven.vercel.app/home`, igual que la cáscara de Android. Cuando
despliegas a Vercel, todo el mundo tiene el cambio **sin reinstalar nada**. Solo hay que
volver a compilar esto si cambia el icono, el nombre o algo de la ventana en sí.

**No es el cliente de Time Tracker.** Aquel expone `window.ttDesktop`, y con eso captura
pantallas y actividad y **esconde el selector de módulos** (D-076) — porque salir de
`/timetracker` detiene la captura en silencio.

Esta ventana no expone ese puente, a propósito:

- Si lo expusiera, la web escondería el selector de módulos, que es justo lo único que esta
  app viene a ofrecer.
- Y Time Tracker creería que puede capturar pantallas desde aquí, sin que haya nada al otro
  lado que las tome.

Dentro de esta ventana, Time Tracker se comporta **exactamente como en una pestaña del
navegador**. Quien tenga que cronometrar con capturas sigue usando su cliente.

## Probarla

```bash
cd desktop
npm install
npm start
```

Se abre la ventana contra el sitio en producción. Si no hay sesión, aparece el login.

## Compilar el instalador

```bash
cd desktop
npm run dist
```

Deja un `.exe` en `desktop/dist/`. Es un instalador NSIS **por usuario** (no pide permisos de
administrador), con acceso directo en el escritorio y en el menú de inicio.

### El icono

Falta `build/icon.ico` — un `.ico` de 256×256. Sin él, `electron-builder` usa el icono por
defecto de Electron, que es un átomo gris y no dice nada. Ponlo ahí antes de repartirlo.

### Firma

El `.exe` no va firmado. Windows SmartScreen mostrará *"Windows protegió su PC"* la primera
vez, y hay que pulsar **Más información → Ejecutar de todas formas**. Se quita comprando un
certificado de firma de código; hasta entonces, conviene avisarlo al repartir el instalador
para que nadie crea que es un virus y lo borre.

## Detalles de la ventana

- **Una sola por máquina.** Abrir el acceso directo dos veces enfoca la que ya está.
- **Recuerda su tamaño y posición**, y si estaba maximizada.
- **Los enlaces de fuera abren en el navegador del sistema.** Esta ventana no tiene barra de
  direcciones ni botón de atrás: si un enlace a Google Maps se abriera aquí dentro, la
  persona se quedaría sin forma de volver.
- **Sin conexión** sale un aviso con un botón de reintentar, no una página en blanco con un
  error de Chromium.
- **F5** o **Ctrl+R** recarga. **Ctrl+Shift+I** abre las herramientas de desarrollo, para dar
  soporte a distancia.
- La página **no tiene acceso a Node** (`nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`). Esta ventana carga un sitio remoto; sin eso, un día malo en la web sería
  un día malo en el ordenador de quien la abrió.

## Actualizar la app (no el sitio)

El sitio se actualiza solo. Esta cáscara no tiene auto-actualización: si algún día cambia,
hay que repartir un instalador nuevo. Se dejó fuera a propósito — auto-actualizar exige un
servidor de publicación y firma, y es bastante trabajo para una ventana que apenas cambia.
