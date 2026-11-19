import type { ChoferDeLaLista, ExtensionDeLaLista, FilaDeLlamada, FiltrosDeLaLista, RespuestaDeLlamadas } from "./cliente";

// ============================================================
// Datos INVENTADOS para el modo demo (`NEXT_PUBLIC_LOCAL_MODE`): sin RingCentral ni base. Ni un nombre ni un número son
// reales: los números son 555-01xx (los que no existen) y los nombres dicen «demo». La grabación es un silencio de un
// segundo en un data URI, para probar el reproductor y la velocidad sin audio de nadie.
// ============================================================

const MIN = 60 * 1000;

interface ExtensionDemo {
  id: string;
  numero: string;
  nombre: string;
  esChofer: boolean;
}

/** Las extensiones de la cuenta de demo: tres choferes marcados y otras que no lo son. */
const EXTENSIONES: ExtensionDemo[] = [
  { id: "9101", numero: "101", nombre: "Chofer demo Ana", esChofer: true },
  { id: "9102", numero: "102", nombre: "Chofer demo Luis", esChofer: true },
  { id: "9103", numero: "103", nombre: "Chofer demo Marta", esChofer: true },
  { id: "9104", numero: "104", nombre: "Chofer demo Pedro", esChofer: false },
  { id: "9150", numero: "150", nombre: "Oficina demo", esChofer: false },
  { id: "9160", numero: "160", nombre: "Gerente demo", esChofer: false },
  { id: "9170", numero: "170", nombre: "Almacén demo", esChofer: false },
];

/** Un WAV mono de 8 kHz con un segundo de silencio, como data URI. Se hace una vez. */
let silencioWav: string | null = null;
function wavDeSilencio(): string {
  if (silencioWav) return silencioWav;
  const rate = 8000;
  const n = rate;
  const buf = new Uint8Array(44 + n);
  const v = new DataView(buf.buffer);
  const txt = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  txt(0, "RIFF"); v.setUint32(4, 36 + n, true); txt(8, "WAVE");
  txt(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  txt(36, "data"); v.setUint32(40, n, true);
  buf.fill(128, 44);
  let binario = "";
  for (let i = 0; i < buf.length; i++) binario += String.fromCharCode(buf[i]);
  silencioWav = `data:audio/wav;base64,${btoa(binario)}`;
  return silencioWav;
}

interface LlamadaDemo extends FilaDeLlamada {
  /** Solo en el demo: el data URI que el «Escuchar» de demo devuelve. */
  audio: string | null;
}

/** Las llamadas inventadas, repartidas en los últimos seis días, de la más reciente a la más antigua. */
function llamadasDemo(ahora: number): LlamadaDemo[] {
  const plantillas: { ext: string; sentido: "in" | "out"; minutosAtras: number; seg: number | null; resultado: string; grabada: boolean; otro: { nombre: string; numero: string } }[] = [
    { ext: "9101", sentido: "in", minutosAtras: 25, seg: 183, resultado: "Accepted", grabada: true, otro: { nombre: "Cliente demo 1", numero: "5550100" } },
    { ext: "9102", sentido: "out", minutosAtras: 70, seg: 41, resultado: "Accepted", grabada: true, otro: { nombre: "Cliente demo 2", numero: "5550101" } },
    { ext: "9103", sentido: "in", minutosAtras: 130, seg: null, resultado: "Missed", grabada: false, otro: { nombre: "", numero: "5550102" } },
    { ext: "9101", sentido: "out", minutosAtras: 360, seg: 97, resultado: "Accepted", grabada: true, otro: { nombre: "Tienda demo", numero: "5550103" } },
    { ext: "9102", sentido: "in", minutosAtras: 1560, seg: 12, resultado: "Voicemail", grabada: false, otro: { nombre: "", numero: "5550104" } },
    { ext: "9103", sentido: "out", minutosAtras: 1800, seg: 255, resultado: "Accepted", grabada: true, otro: { nombre: "Cliente demo 3", numero: "5550105" } },
    { ext: "9101", sentido: "in", minutosAtras: 3000, seg: 64, resultado: "Accepted", grabada: false, otro: { nombre: "Cliente demo 4", numero: "5550106" } },
    { ext: "9102", sentido: "out", minutosAtras: 4320, seg: 0, resultado: "No Answer", grabada: false, otro: { nombre: "", numero: "5550107" } },
    { ext: "9103", sentido: "in", minutosAtras: 5760, seg: 140, resultado: "Accepted", grabada: true, otro: { nombre: "Cliente demo 5", numero: "5550108" } },
    { ext: "9101", sentido: "in", minutosAtras: 7200, seg: 310, resultado: "Accepted", grabada: true, otro: { nombre: "Cliente demo 6", numero: "5550109" } },
    { ext: "9102", sentido: "in", minutosAtras: 8640, seg: 75, resultado: "Accepted", grabada: true, otro: { nombre: "Cliente demo 7", numero: "5550110" } },
    { ext: "9103", sentido: "out", minutosAtras: 8940, seg: 20, resultado: "Accepted", grabada: false, otro: { nombre: "Cliente demo 8", numero: "5550111" } },
  ];
  const ext = (id: string) => EXTENSIONES.find((e) => e.id === id)!;
  return plantillas
    .map((p, i): LlamadaDemo => {
      const e = ext(p.ext);
      const inicio = new Date(ahora - p.minutosAtras * MIN).toISOString();
      const otro = p.otro.numero.startsWith("555") ? `+1${p.otro.numero}` : p.otro.numero;
      const yo = "+15550199"; // la línea de la oficina demo
      return {
        id: `demo-${i + 1}`,
        extensionId: e.id,
        driverNumero: e.numero,
        driverNombre: e.nombre,
        direction: p.sentido,
        started_at: inicio,
        duration_s: p.seg,
        from_number: p.sentido === "in" ? otro : yo,
        from_name: p.sentido === "in" ? p.otro.nombre || null : null,
        to_number: p.sentido === "in" ? yo : otro,
        to_name: p.sentido === "in" ? null : p.otro.nombre || null,
        result: p.resultado,
        hasRecording: p.grabada,
        recording_pending: false,
        audio: p.grabada ? wavDeSilencio() : null,
      };
    })
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

/** El estado en memoria del demo: los choferes marcados y las llamadas, que se pueden cambiar en la pantalla. */
let extensiones: ExtensionDemo[] = EXTENSIONES.map((e) => ({ ...e }));
let llamadas: LlamadaDemo[] = llamadasDemo(Date.now());
let ultimaSincronizacion: string | null = new Date(Date.now() - 3 * MIN).toISOString();

const fechaDe = (iso: string) => Date.parse(iso);

export function demoChoferes(): ChoferDeLaLista[] {
  return extensiones.filter((e) => e.esChofer).map((e) => ({ id: e.id, numero: e.numero, nombre: e.nombre }));
}

export function demoExtensiones(): ExtensionDeLaLista[] {
  return extensiones.map((e) => ({ id: e.id, numero: e.numero, nombre: e.nombre, esChofer: e.esChofer }));
}

export function demoGuardarChoferes(lista: ChoferDeLaLista[]): void {
  const ids = new Set(lista.map((c) => c.id));
  extensiones = extensiones.map((e) => ({ ...e, esChofer: ids.has(e.id) }));
}

/** La fila tal como la pide la pantalla: sin el audio del demo. */
function sinAudio(l: LlamadaDemo): FilaDeLlamada {
  return {
    id: l.id, extensionId: l.extensionId, driverNumero: l.driverNumero, driverNombre: l.driverNombre, direction: l.direction,
    started_at: l.started_at, duration_s: l.duration_s, from_number: l.from_number, from_name: l.from_name,
    to_number: l.to_number, to_name: l.to_name, result: l.result, hasRecording: l.hasRecording, recording_pending: l.recording_pending,
  };
}

export function demoLlamadas(f: FiltrosDeLaLista, pagina: number): RespuestaDeLlamadas {
  const desde = f.desde ? Date.parse(f.desde) : Number.NEGATIVE_INFINITY;
  const hasta = f.hasta ? Date.parse(f.hasta) : Number.POSITIVE_INFINITY;
  const filtradas = llamadas.filter((l) =>
    (!f.extension || l.extensionId === f.extension) &&
    (!f.direccion || l.direction === f.direccion) &&
    (!f.conGrabacion || l.hasRecording) &&
    fechaDe(l.started_at) >= desde && fechaDe(l.started_at) <= hasta,
  );
  const tamano = 100;
  const ini = (pagina - 1) * tamano;
  const pagina_ = filtradas.slice(ini, ini + tamano);
  return {
    rows: pagina_.map(sinAudio),
    pagina,
    tamano,
    total: filtradas.length,
    hayMas: ini + pagina_.length < filtradas.length,
    choferes: demoChoferes(),
    estado: { ultimaSincronizacion, sinPermiso: false, esperaSeg: 0 },
  };
}

export function demoAudio(id: string): string | null {
  return llamadas.find((l) => l.id === id)?.audio ?? null;
}

/** Lo que devuelve «Sincronizar ahora» en el demo: nada nuevo, pero el aviso y el sello de la hora se ven igual. */
export function demoSincronizar(): { ok: boolean; llamadas: number; grabaciones: number; pendientes: number } {
  ultimaSincronizacion = new Date().toISOString();
  return { ok: true, llamadas: 0, grabaciones: 0, pendientes: 0 };
}
