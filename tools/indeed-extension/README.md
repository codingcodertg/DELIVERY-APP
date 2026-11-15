# RTG Hub · Indeed (extensión de Chrome)

Envía a RTG Hub las solicitudes y los mensajes de Indeed que abres en tu Chrome normal. Solo lee: no pulsa nada en
Indeed, no navega y no recorre la bandeja por su cuenta. Solo actúa en la página que tienes abierta.

## Instalar (una vez)

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta `tools\indeed-extension` de este repositorio.
4. En la tarjeta de la extensión, pulsa **Detalles → Opciones**, pega el token que te dio quien administra RTG Hub,
   pulsa **Guardar** y después **Probar conexión** (debe decir «Token correcto»).

El token se guarda en el almacenamiento de la extensión de esta cuenta de Chrome. No se escribe en ningún archivo del
repositorio ni en el registro.

## Uso

Abre en Indeed el **detalle** de una conversación o de una solicitud. Aparece un panel abajo a la derecha:

- **Enviar a RTG Hub**: manda lo que ves en esa página. El resultado sale en el panel: «Perfil creado · llamada agendada
  lun 16 nov 12:00», «Ya estaba en RTG Hub», «Mensaje anotado» o el motivo si se omitió.
- **Auto**: apagado por defecto. Encendido, la extensión manda cada detalle que abras, una sola vez. Lo recuerda por
  identificador, así que no repite nada.
- **Copiar diagnóstico**: copia un esquema de la página **sin texto personal** (etiquetas, clases y roles). Pégalo en el
  chat cuando algo no se lea bien.

## Qué se envía

Del detalle abierto: tipo (mensaje o solicitud), nombre, puesto, ubicación, teléfono si aparece, calificaciones, enlaces
de Indeed (solo `indeed.com`) y el texto del candidato (sus últimos mensajes, en los mensajes). Los CV no se descargan
desde la extensión.

## Si algo no se lee bien

Los selectores de la página de Indeed (`extractor.js`, objeto `SELECTORES`) son suposiciones marcadas `TODO`. Para
corregirlos: abre el detalle, pulsa **Copiar diagnóstico** y mándalo. No hace falta tocar nada más.

## Pruebas

Desde la raíz del repositorio: `node --test tools/indeed-extension/nucleo.test.mjs` (funciones puras: identificadores, deduplicado,
textos de resultado).
