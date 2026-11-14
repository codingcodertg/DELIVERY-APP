/**
 * La escena 3D de la regadera (three.js), toda procedural: cajas y losas, sin modelos de archivo.
 *
 * Paredes y base son sólidos (cajas y losas con grosor real), así el corte deja ver las capas como en la lámina. El corte
 * es un plano diagonal que quita la esquina del frente a la izquierda; cada capa tiene su propio desplazamiento, así que
 * cada una termina un poco antes que la de adentro (poste → tablero → malla → impermeable → adhesivo → loseta).
 * Mostrar, ocultar, resaltar y el paso a paso son solo cambios de visibilidad o de emisión.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CAPAS, ORDEN_DE_INSTALACION, type IdCapa } from "@/lib/estimator/visualizador/capas";
import {
  alturaDeLaPendiente, distanciaNormalizada, extremosExpuestos, juntasDePaneles,
  panelesDePared, paredesDeLaDisposicion, repeticionDeLaSuperficie, tamanoEnPulgadas, tornillosEnPanel,
  type DimensionesEscena, type Pared,
} from "@/lib/estimator/visualizador/geometria";
import { pintaAdhesivo, pintaLoseta, type EspecLoseta, colorDeLechada } from "@/lib/estimator/visualizador/texturas";

/** Espesores reales en pies (1 in = 1/12 ft). */
const T = {
  loseta: 0.0313,       // 3/8 in
  adhesivo: 0.0208,     // 1/4 in
  impermeable: 0.0042,  // película
  panel: 0.0417,        // 1/2 in
  liner: 0.0017,        // membrana
  poste: 0.2917,        // 3-1/2 in
  malla: 0.0015,
  ancho_malla: 0.1667,  // 2 in
  poste_ancho: 0.125,   // 1-1/2 in
  poste_separacion: 1.3333, // 16 in
} as const;

const COLOR = {
  loseta: "#e9e7e1",
  madera: "#8b5e34",
  metal: "#9aa0a6",
  silicon: "#4338ca",
  rojo: "#c62828",
  poste: "#d4b48c",
  pared: "#ece7dd",
  encimera: "#e5e1d8",
};

/**
 * Desplazamiento del corte por capa (se suma a la base del corte). Mayor = la capa llega más lejos antes de cortarse.
 * La loseta llega más lejos, luego el adhesivo, el impermeable, el panel y al final el poste: la escalera de la lámina.
 */
const DESPLAZAMIENTO_CORTE: Record<string, number> = {
  "loseta-pared": 0.14, "loseta-piso": 0.14, salpicadero: 0.14, perfiles: 0.14,
  boquilla: 0.12, silicon: 0.12,
  adhesivo: 0.10, niveladores: 0.10,
  impermeable: 0.08,
  tablero: 0.05, malla: 0.05, tornillos: 0.05,
  membrana: 0.02, "mortero-final": 0.02, marco: 0.02,
  "base-mortero": 0, coladera: 0, base: 0,
};

export type SuperficieId = "pared" | "piso" | "salpicadero";

export interface FotoSuperficie {
  /** Cambia cada vez que el vendedor sube una foto nueva (para no reusar la textura de la anterior). */
  id: number;
  img: CanvasImageSource;
}

export interface EntradaEscena {
  dims: DimensionesEscena;
  espec: Record<SuperficieId, EspecLoseta>;
  fotos: Partial<Record<SuperficieId, FotoSuperficie>>;
  morteroIn: number;
  preslopeIn: number;
  subidaIn: number;
  tornillosPorTablero: number;
  tableroAnchoFt: number;
  tableroAltoFt: number;
  salpicaderoLargoFt: number;
  salpicaderoAltoFt: number;
}

interface CapaVista {
  objetos: THREE.Object3D[];
  materiales: THREE.Material[];
  color: string;
}

interface TexturaCache {
  tex: THREE.CanvasTexture;
  bloque: { anchoIn: number; altoIn: number };
}

/** Lo que el vendedor puede cambiar sin reconstruir: solo visibilidad, selección, corte y cámara. */
export interface EstadoVista {
  visibles: ReadonlySet<IdCapa>;
  paso: number;
  seleccion: IdCapa | null;
  corte: boolean;
}

export class EscenaRegadera {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.02, 400);
  private controls: OrbitControls;
  private sol: THREE.DirectionalLight;
  private raiz = new THREE.Group();
  private capas = new Map<IdCapa, CapaVista>();
  private materiales = new Set<THREE.Material>();
  private geometrias = new Set<THREE.BufferGeometry>();
  private texCache = new Map<string, TexturaCache>();
  private texUsadas = new Set<string>();
  private estado: EstadoVista = { visibles: new Set(ORDEN_DE_INSTALACION), paso: ORDEN_DE_INSTALACION.length, seleccion: null, corte: false };
  private dimsVista: { L: number; W: number; H: number } | null = null;
  private frame = 0;
  private texAdhesivo: TexturaCache | null = null;
  private vistaInicial = true;
  private aspectoEncuadre = 0;
  /** El lavabo de afuera: no entra en el encuadre (el sujeto es la regadera). */
  private vanidad: THREE.Object3D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0xe8e6e1, 1);
    this.scene.background = new THREE.Color(0xe8e6e1);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9585, 1.7));
    this.sol = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(2048, 2048);
    this.sol.shadow.bias = -0.0008;
    this.sol.shadow.normalBias = 0.01;
    this.scene.add(this.sol, this.sol.target);
    this.scene.add(this.raiz);
    for (const c of CAPAS) this.capas.set(c.id, { objetos: [], materiales: [], color: c.color });

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.addEventListener("change", () => this.pideRender());
    this.redimensiona();
  }

  /** Reconstruye la escena con estas medidas y estas losetas. Las capas conservan su visibilidad y su selección. */
  actualiza(e: EntradaEscena): void {
    const L = e.dims.largoFt, W = e.dims.anchoFt, H = e.dims.altoFt;
    const cambioDeMedidas = !this.dimsVista || this.dimsVista.L !== L || this.dimsVista.W !== W || this.dimsVista.H !== H;
    this.dimsVista = { L, W, H };
    this.limpiaGeometria();
    this.construye(e);
    for (const [clave, t] of this.texCache) {
      if (!this.texUsadas.has(clave)) { t.tex.dispose(); this.texCache.delete(clave); }
    }
    this.raiz.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.aplicaEstado();
    if (this.vistaInicial || cambioDeMedidas) {
      this.resetVista();
      this.vistaInicial = false;
    }
    this.pideRender();
  }

  /** Solo cambia lo que se ve: visibilidad, paso, selección, corte. No reconstruye nada. */
  pon(estado: EstadoVista): void {
    this.estado = estado;
    this.aplicaEstado();
    this.pideRender();
  }

  /** Encuadra toda la regadera (con la caja de su contenido) en la vista, desde el frente a tres cuartos. */
  resetVista(): void {
    // La caja de la regadera (sin el lavabo): se busca la distancia que la deja ocupando ~80% del lienzo.
    const caja = new THREE.Box3();
    for (const h of this.raiz.children) if (h !== this.vanidad) caja.expandByObject(h);
    if (caja.isEmpty()) return;
    const centro = caja.getCenter(new THREE.Vector3());
    const radio = caja.getSize(new THREE.Vector3()).length() / 2;
    const esquinas: THREE.Vector3[] = [];
    for (const x of [caja.min.x, caja.max.x]) for (const y of [caja.min.y, caja.max.y]) for (const z of [caja.min.z, caja.max.z]) esquinas.push(new THREE.Vector3(x, y, z));
    const dir = new THREE.Vector3(0.6, 0.42, 1).normalize();
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    let distancia = radio / (0.8 * Math.sin(vfov / 2));
    this.camera.near = Math.max(0.01, distancia / 60);
    this.camera.far = distancia * 20;
    this.camera.updateProjectionMatrix();
    for (let it = 0; it < 14; it++) {
      this.camera.position.copy(centro).addScaledVector(dir, distancia);
      this.camera.lookAt(centro);
      this.camera.updateMatrixWorld();
      let m = 0;
      for (const c of esquinas) {
        const p = c.clone().project(this.camera);
        m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
      }
      if (m <= 0 || Math.abs(m - 0.8) < 0.01) break;
      distancia *= m / 0.8;
    }
    this.camera.position.copy(centro).addScaledVector(dir, distancia);
    this.camera.lookAt(centro);
    this.camera.updateMatrixWorld();
    this.controls.target.copy(centro);
    this.controls.minDistance = radio * 0.35;
    this.controls.maxDistance = radio * 6;
    this.controls.update();
    this.sol.target.position.copy(centro);
    this.sol.position.copy(centro).add(new THREE.Vector3(6, 12, 9));
    const r = radio * 1.4;
    Object.assign(this.sol.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: distancia * 4 });
    this.sol.shadow.camera.updateProjectionMatrix();
    this.aspectoEncuadre = this.camera.aspect;
    this.pideRender();
  }

  redimensiona(): void {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.dimsVista && Math.abs(this.camera.aspect - this.aspectoEncuadre) > 0.02) this.resetVista();
    this.pideRender();
  }

  /** La imagen de la vista actual, para mandarla al cliente. */
  fotoPng(): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resuelve) => this.canvas.toBlob((b) => resuelve(b), "image/png"));
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.limpiaGeometria();
    for (const t of this.texCache.values()) t.tex.dispose();
    this.texCache.clear();
    this.texAdhesivo?.tex.dispose();
    this.texAdhesivo = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ---- Render bajo demanda ----------------------------------------------------------------------------------------

  private pideRender(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.ciclo);
  }

  private ciclo = (): void => {
    this.frame = 0;
    const movido = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (movido) this.pideRender();
  };

  // ---- Estado ------------------------------------------------------------------------------------------------------

  private aplicaEstado(): void {
    const { visibles, paso, seleccion, corte } = this.estado;
    CAPAS.forEach((c, i) => {
      const vista = this.capas.get(c.id);
      if (!vista) return;
      const mostrar = visibles.has(c.id) && i < paso;
      for (const o of vista.objetos) o.visible = mostrar;
      for (const m of vista.materiales) {
        if (m instanceof THREE.MeshStandardMaterial) {
          if (c.id === seleccion) {
            m.emissive.set(vista.color);
            m.emissiveIntensity = 0.45;
          } else {
            m.emissive.set(0x000000);
            m.emissiveIntensity = 0;
          }
        }
      }
    });
    // Corte diagonal por la esquina de enfrente a la izquierda: se conserva z - x ≤ k. Cada material tiene su k.
    const kBase = (this.dimsVista?.W ?? 3) * 0.45;
    const planos = new Map<number, THREE.Plane>();
    for (const m of this.materiales) {
      if (!corte) { m.clippingPlanes = null; m.needsUpdate = true; continue; }
      const k = kBase + ((m.userData.corte as number | undefined) ?? 0);
      let p = planos.get(k);
      if (!p) {
        // distancia = (x - z)/√2 + k/√2 ≥ 0  ⇔  z - x ≤ k
        p = new THREE.Plane(new THREE.Vector3(1, 0, -1).normalize(), k / Math.SQRT2);
        planos.set(k, p);
      }
      m.clippingPlanes = [p];
      m.needsUpdate = true;
    }
  }

  // ---- Construcción ------------------------------------------------------------------------------------------------

  private limpiaGeometria(): void {
    this.raiz.clear();
    for (const m of this.materiales) m.dispose();
    this.materiales.clear();
    for (const g of this.geometrias) g.dispose();
    this.geometrias.clear();
    for (const v of this.capas.values()) { v.objetos = []; v.materiales = []; }
    this.texUsadas = new Set();
    this.vanidad = null;
  }

  /** Material de una capa. `clave` decide el desplazamiento del corte (por defecto, la capa). */
  private mat(id: IdCapa | null, p: THREE.MeshStandardMaterialParameters, clave?: string): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...p });
    m.userData.corte = DESPLAZAMIENTO_CORTE[clave ?? id ?? "base"] ?? 0;
    this.materiales.add(m);
    if (id) this.capas.get(id)?.materiales.push(m);
    return m;
  }

  private geo(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geometrias.add(g);
    return g;
  }

  private reg(id: IdCapa, o: THREE.Object3D): void {
    this.capas.get(id)?.objetos.push(o);
  }

  private textura(superficie: SuperficieId, spec: EspecLoseta, foto: FotoSuperficie | undefined, horneada: boolean): TexturaCache {
    const clave = [superficie, spec.fuente, spec.tamano, spec.patron, spec.lechada, spec.juntaIn, foto?.id ?? "", horneada].join("|");
    this.texUsadas.add(clave);
    const previa = this.texCache.get(clave);
    if (previa) return previa;
    const { canvas, bloqueIn } = pintaLoseta(spec, foto?.img ?? null, horneada);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const nueva: TexturaCache = { tex, bloque: bloqueIn };
    this.texCache.set(clave, nueva);
    return nueva;
  }

  private texturaAdhesivo(): TexturaCache {
    if (!this.texAdhesivo) {
      const tex = new THREE.CanvasTexture(pintaAdhesivo());
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.texAdhesivo = { tex, bloque: { anchoIn: 2, altoIn: 2 } };
    }
    return this.texAdhesivo;
  }

  /** Multiplica las UV de las caras que cumplen `filtro` (para que la loseta se repita según su tamaño real). */
  private escalaUV(g: THREE.BufferGeometry, sx: number, sy: number, filtro?: (n: THREE.Vector3) => boolean): void {
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (filtro && !filtro(new THREE.Vector3().fromBufferAttribute(nor, i))) continue;
      uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
    }
    uv.needsUpdate = true;
  }

  private construye(e: EntradaEscena): void {
    const { largoFt: L, anchoFt: W, altoFt: H, disposicion, proyecto } = e.dims;
    const conPared = proyecto !== "Flooring Only";
    const conPiso = proyecto !== "Wall Only";
    const conDrenaje = proyecto === "Shower";

    // Base estructural: el piso de madera bajo la cama, siempre visible (no es una capa de la lista).
    const madera = this.mat(null, { color: COLOR.madera, roughness: 0.9 }, "base");
    const base = new THREE.Mesh(this.geo(new THREE.BoxGeometry(L + 2, 0.5, W + 2)), madera);
    base.position.set(L / 2, -0.25, W / 2);
    this.raiz.add(base);

    if (conPiso) this.construyePiso(e, L, W, conDrenaje);
    if (conPared) {
      const paredes = paredesDeLaDisposicion(disposicion, L, W);
      const expuestos = extremosExpuestos(paredes);
      paredes.forEach((p) => {
        this.raiz.add(this.construyePared(p, e, H));
        for (const ex of expuestos.filter((x) => x.pared === p.nombre)) {
          this.raiz.add(this.perfilDeExtremo(p, ex.extremo, H));
        }
      });
      this.vanidad = this.construyeVanidad(e, L, H);
      this.raiz.add(this.vanidad);
    }
  }

  /**
   * Una losa con grosor real entre dos superficies: arriba `fTop`, abajo `fBot`, y cuatro costados. La cara de arriba va en
   * el grupo 0 (con la textura de la loseta); el resto, en el grupo 1 (color liso).
   */
  private losa(L: number, W: number, fTop: (x: number, z: number) => number, fBot: (x: number, z: number) => number): THREE.BufferGeometry {
    const nx = Math.min(48, Math.max(6, Math.ceil((L * 12) / 4)));
    const nz = Math.min(48, Math.max(6, Math.ceil((W * 12) / 4)));
    const pos: number[] = [];
    const uv: number[] = [];
    const grilla = (f: (x: number, z: number) => number): number => {
      const b = pos.length / 3;
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = (L * i) / nx, z = (W * j) / nz;
        pos.push(x, f(x, z), z);
        uv.push(i / nx, j / nz);
      }
      return b;
    };
    const top = grilla(fTop), bot = grilla(fBot);
    const id = (b: number, i: number, j: number) => b + j * (nx + 1) + i;
    const idx: number[] = [];
    // Cada triángulo se orienta según la normal que se le pide, para que la cara quede hacia afuera.
    const tri = (a: number, b: number, c: number, out: number[]) => {
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * out[0] + cy * out[1] + cz * out[2] < 0) idx.push(a, c, b); else idx.push(a, b, c);
    };
    const quad = (a: number, b: number, c: number, d: number, out: number[]) => { tri(a, b, c, out); tri(a, c, d, out); };
    const topIni = idx.length;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) quad(id(top, i, j), id(top, i + 1, j), id(top, i + 1, j + 1), id(top, i, j + 1), [0, 1, 0]);
    const topFin = idx.length;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) quad(id(bot, i, j), id(bot, i, j + 1), id(bot, i + 1, j + 1), id(bot, i + 1, j), [0, -1, 0]);
    for (let i = 0; i < nx; i++) {
      quad(id(top, i, 0), id(bot, i, 0), id(bot, i + 1, 0), id(top, i + 1, 0), [0, 0, -1]);
      quad(id(top, i, nz), id(top, i + 1, nz), id(bot, i + 1, nz), id(bot, i, nz), [0, 0, 1]);
    }
    for (let j = 0; j < nz; j++) {
      quad(id(top, 0, j), id(top, 0, j + 1), id(bot, 0, j + 1), id(bot, 0, j), [-1, 0, 0]);
      quad(id(top, nx, j), id(bot, nx, j), id(bot, nx, j + 1), id(top, nx, j + 1), [1, 0, 0]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.addGroup(topIni, topFin - topIni, 0);
    g.addGroup(topFin, idx.length - topFin, 1);
    g.computeVertexNormals();
    return this.geo(g);
  }

  private construyePiso(e: EntradaEscena, L: number, W: number, conDrenaje: boolean): void {
    const dn = (x: number, z: number) => distanciaNormalizada(x, z, L, W);
    const grosorPre = (x: number, z: number) => alturaDeLaPendiente(dn(x, z), e.preslopeIn);
    const grosorBed = (x: number, z: number) => alturaDeLaPendiente(dn(x, z), e.morteroIn);
    const cero = () => 0;
    const hPre = grosorPre;
    const hLiner = (x: number, z: number) => hPre(x, z) + T.liner;
    const hBed = (x: number, z: number) => hLiner(x, z) + grosorBed(x, z);
    const hWP = (x: number, z: number) => hBed(x, z) + T.impermeable;
    const hTS = (x: number, z: number) => hWP(x, z) + T.adhesivo;
    const hTile = (x: number, z: number) => hTS(x, z) + T.loseta;
    const hGrout = (x: number, z: number) => hTile(x, z) - 0.002;

    // 0. Base con pendiente: losa con grosor, sobre la estructura de madera.
    const pre = new THREE.Mesh(this.losa(L, W, hPre, cero), [
      this.mat("base-mortero", { color: "#a8a29e", roughness: 0.95 }),
      this.mat("base-mortero", { color: "#8f8a85", roughness: 0.95 }),
    ]);
    this.raiz.add(pre); this.reg("base-mortero", pre);

    // Coladera (solo en la ducha).
    if (conDrenaje) this.raiz.add(this.drenaje(L, W, hPre(L / 2, W / 2)));

    // 1. Membrana.
    const membrana = new THREE.Mesh(this.losa(L, W, hLiner, hPre), [
      this.mat("membrana", { color: "#2b5fd9", roughness: 0.8 }),
      this.mat("membrana", { color: "#1e4bb8", roughness: 0.8 }),
    ]);
    this.raiz.add(membrana); this.reg("membrana", membrana);

    // 4. Cama final de mortero.
    const bed = new THREE.Mesh(this.losa(L, W, hBed, hLiner), [
      this.mat("mortero-final", { color: "#c9b99a", roughness: 0.95 }),
      this.mat("mortero-final", { color: "#b5a78a", roughness: 0.95 }),
    ]);
    this.raiz.add(bed); this.reg("mortero-final", bed);

    // 6. Impermeabilizante del piso (rojo).
    const wp = new THREE.Mesh(this.losa(L, W, hWP, hBed), [
      this.mat("impermeable", { color: COLOR.rojo, roughness: 0.5 }),
      this.mat("impermeable", { color: "#9f1c1c", roughness: 0.5 }),
    ]);
    this.raiz.add(wp); this.reg("impermeable", wp);

    // 7. Adhesivo con surcos de peine (la cara de arriba lleva el relieve).
    const ads = this.texturaAdhesivo();
    const adsGeo = this.losa(L, W, hTS, hWP);
    this.escalaUV(adsGeo, (L * 12) / ads.bloque.anchoIn, (W * 12) / ads.bloque.altoIn);
    const adhesivo = new THREE.Mesh(adsGeo, [
      this.mat("adhesivo", { color: "#ffffff", map: ads.tex, roughness: 0.9 }),
      this.mat("adhesivo", { color: "#d9d3c3", roughness: 0.9 }),
    ]);
    this.raiz.add(adhesivo); this.reg("adhesivo", adhesivo);

    // Loseta de piso (losa: la cara de arriba con la textura, con sus juntas transparentes).
    const piso = this.textura("piso", e.espec.piso, e.fotos.piso, false);
    const pisoGeo = this.losa(L, W, hTile, hTS);
    const { x: rx, y: ry } = repeticionDeLaSuperficie(piso.bloque, L, W);
    this.escalaUV(pisoGeo, rx, ry);
    const pisoMesh = new THREE.Mesh(pisoGeo, [
      this.mat("loseta-piso", { color: "#ffffff", map: piso.tex, alphaTest: 0.5, roughness: 0.3 }),
      this.mat("loseta-piso", { color: COLOR.loseta, roughness: 0.3 }),
    ]);
    this.raiz.add(pisoMesh); this.reg("loseta-piso", pisoMesh);

    // Boquilla del piso: justo debajo de la loseta, visible por sus juntas.
    const grout = new THREE.Mesh(this.superficie(L, W, hGrout), this.mat("boquilla", { color: colorDeLechada(e.espec.piso.lechada), side: THREE.DoubleSide, roughness: 0.85 }));
    this.raiz.add(grout); this.reg("boquilla", grout);

    // Niveladores y cuñas en las intersecciones de la cuadrícula de loseta.
    const [tamW, tamH] = tamanoEnPulgadas(e.espec.piso.tamano);
    const tw = tamW / 12, th = tamH / 12;
    const puntos: { x: number; z: number }[] = [];
    for (let x = 0; x <= L + 1e-9 && puntos.length < 300; x += tw) {
      for (let z = 0; z <= W + 1e-9 && puntos.length < 300; z += th) puntos.push({ x, z });
    }
    if (puntos.length > 0) {
      const clipG = this.geo(new THREE.BoxGeometry(0.03, 0.025, 0.03));
      const cunaG = this.geo(new THREE.BoxGeometry(0.02, 0.03, 0.014));
      const clips = new THREE.InstancedMesh(clipG, this.mat("niveladores", { color: "#f8fafc" }), puntos.length);
      const cunas = new THREE.InstancedMesh(cunaG, this.mat("niveladores", { color: "#2563eb" }), puntos.length);
      const m = new THREE.Matrix4();
      puntos.forEach((p, i) => {
        const y = hTile(p.x, p.z);
        clips.setMatrixAt(i, m.makeTranslation(p.x, y + 0.0125, p.z));
        cunas.setMatrixAt(i, m.makeTranslation(p.x + 0.015, y + 0.015, p.z));
      });
      this.raiz.add(clips, cunas);
      this.reg("niveladores", clips); this.reg("niveladores", cunas);
    }
  }

  /** Una superficie plana con altura por punto (la boquilla), sin grosor: queda dentro de la losa de loseta. */
  private superficie(L: number, W: number, fn: (x: number, z: number) => number): THREE.BufferGeometry {
    const nx = Math.min(48, Math.max(6, Math.ceil((L * 12) / 4)));
    const nz = Math.min(48, Math.max(6, Math.ceil((W * 12) / 4)));
    const g = new THREE.PlaneGeometry(L, W, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate(L / 2, 0, W / 2);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, fn(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return this.geo(g);
  }

  private drenaje(L: number, W: number, yBase: number): THREE.Group {
    const g = new THREE.Group();
    const cuerpo = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 22)), this.mat("coladera", { color: COLOR.metal, metalness: 0.4, roughness: 0.5 }));
    cuerpo.position.set(L / 2, yBase - 0.15, W / 2);
    const rejilla = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.26, 0.006, 0.26)), this.mat("coladera", { color: "#2b2f36", metalness: 0.3, roughness: 0.4 }));
    rejilla.position.set(L / 2, yBase + 0.003, W / 2);
    g.add(cuerpo, rejilla);
    this.reg("coladera", cuerpo); this.reg("coladera", rejilla);
    return g;
  }

  /** Una pared: el marco local (x a lo largo, y arriba, z hacia afuera) y las capas de adentro hacia afuera. */
  private construyePared(p: Pared, e: EntradaEscena, H: number): THREE.Group {
    const ejeX = new THREE.Vector3(p.fin.x - p.inicio.x, 0, p.fin.z - p.inicio.z).normalize();
    const ejeY = new THREE.Vector3(0, 1, 0);
    const ejeZ = new THREE.Vector3().crossVectors(ejeX, ejeY);
    const hacia = new THREE.Vector3(p.hacia.x, 0, p.hacia.z);
    const s = ejeZ.dot(hacia) >= 0 ? 1 : -1;
    const g = new THREE.Group();
    g.position.set(p.inicio.x, 0, p.inicio.z);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ejeX, ejeY, ejeZ));
    const largo = p.largo;
    // Distancia `a` medida desde la cara del cuarto hacia afuera → coordenada z local.
    const zA = (a: number) => -s * a;
    const caraDentro = s > 0 ? 4 : 5; // índice de la cara +z/-z del BoxGeometry que mira al cuarto

    // id = null: la pieza no es de ninguna capa de la lista (el poste va con la clave «marco»).
    const caja = (id: IdCapa | null, ancho: number, alto: number, prof: number, x: number, y: number, a0: number,
      mats: THREE.Material | THREE.Material[]): THREE.Mesh => {
      const geom = this.geo(new THREE.BoxGeometry(ancho, alto, prof));
      const mesh = new THREE.Mesh(geom, mats);
      mesh.position.set(x, y, zA(a0 + prof / 2));
      g.add(mesh);
      if (id) this.reg(id, mesh);
      return mesh;
    };
    const aTile = 0;
    const aAdh = aTile + T.loseta;
    const aWP = aAdh + T.adhesivo;
    const aPanel = aWP + T.impermeable;
    const aLiner = aPanel + T.panel;
    const aPoste = aLiner + T.liner;

    // Azulejo de pared (la cara de dentro con la textura; la boquilla va detrás, visible por las juntas).
    const loseta = this.textura("pared", e.espec.pared, e.fotos.pared, false);
    const bordeLoseta = this.mat("loseta-pared", { color: COLOR.loseta, roughness: 0.3 });
    const matLoseta = this.mat("loseta-pared", { color: "#ffffff", map: loseta.tex, alphaTest: 0.5, roughness: 0.3 });
    const arrLoseta = Array.from({ length: 6 }, () => bordeLoseta);
    arrLoseta[caraDentro] = matLoseta;
    const mLoseta = caja("loseta-pared", largo, H, T.loseta, largo / 2, H / 2, aTile, arrLoseta);
    this.escalaUV(mLoseta.geometry, (largo * 12) / loseta.bloque.anchoIn, (H * 12) / loseta.bloque.altoIn, (n) => Math.abs(n.z) > 0.5);

    // Boquilla: detrás de la loseta, visible por sus juntas.
    caja("boquilla", largo, H, T.loseta - 0.006, largo / 2, H / 2, aTile + 0.006,
      this.mat("boquilla", { color: colorDeLechada(e.espec.pared.lechada), roughness: 0.85 }));

    // Adhesivo con surcos.
    const adh = this.texturaAdhesivo();
    const arrAdh = Array.from({ length: 6 }, () => this.mat("adhesivo", { color: "#d9d3c3", roughness: 0.9 }));
    arrAdh[caraDentro] = this.mat("adhesivo", { color: "#ffffff", map: adh.tex, roughness: 0.9 });
    const mAdh = caja("adhesivo", largo, H, T.adhesivo, largo / 2, H / 2, aAdh, arrAdh);
    this.escalaUV(mAdh.geometry, (largo * 12) / adh.bloque.anchoIn, (H * 12) / adh.bloque.altoIn, (n) => Math.abs(n.z) > 0.5);

    // Impermeabilizante rojo.
    caja("impermeable", largo, H, T.impermeable, largo / 2, H / 2, aWP, this.mat("impermeable", { color: COLOR.rojo, roughness: 0.5 }));

    // Paneles de tablero: uno por panel (las juntas se ven como cortes).
    const tablero = this.mat("tablero", { color: "#cbbb9a", roughness: 0.95 });
    const paneles = panelesDePared(largo, H, e.tableroAnchoFt, e.tableroAltoFt);
    for (const pn of paneles) {
      caja("tablero", pn.x1 - pn.x0, pn.y1 - pn.y0, T.panel, (pn.x0 + pn.x1) / 2, (pn.y0 + pn.y1) / 2, aPanel, tablero);
    }

    // Tornillos: una malla instanciada por pared. Van en la cara del panel, donde pega el impermeabilizante.
    const tornillos: { x: number; y: number }[] = [];
    for (const pn of paneles) {
      const r = tornillosEnPanel(e.tornillosPorTablero, pn.x1 - pn.x0, pn.y1 - pn.y0);
      for (const pt of r.puntos) tornillos.push({ x: pn.x0 + pt.x, y: pn.y0 + pt.z });
    }
    if (tornillos.length > 0) {
      const cab = new THREE.CylinderGeometry(0.0125, 0.0125, 0.0025, 10);
      cab.rotateX(Math.PI / 2);
      const inst = new THREE.InstancedMesh(this.geo(cab), this.mat("tornillos", { color: "#dc2626", metalness: 0.5, roughness: 0.4 }), tornillos.length);
      const m = new THREE.Matrix4();
      tornillos.forEach((t, i) => inst.setMatrixAt(i, m.makeTranslation(t.x, t.y, zA(aPanel))));
      g.add(inst);
      this.reg("tornillos", inst);
    }

    // Malla en las juntas de paneles.
    const juntas = juntasDePaneles(largo, H, e.tableroAnchoFt, e.tableroAltoFt);
    const malla = this.mat("malla", { color: "#f5f3ee", roughness: 0.9 });
    for (const x of juntas.verticales) caja("malla", T.ancho_malla, H, T.malla, x, H / 2, aPanel - 0.0007, malla);
    for (const y of juntas.horizontales) caja("malla", largo, T.ancho_malla, T.malla, largo / 2, y, aPanel - 0.0007, malla);

    // Membrana: subida detrás del panel, en la base.
    if (e.subidaIn > 0) {
      const sub = Math.min(H, e.subidaIn / 12);
      caja("membrana", largo, sub, T.liner, largo / 2, sub / 2, aLiner, this.mat("membrana", { color: "#2b5fd9", roughness: 0.8 }));
    }

    // Postes a 16 in (sin capa en la lista: siempre visibles, con su propio corte).
    const posiciones: number[] = [];
    for (let x = T.poste_ancho / 2; x < largo - T.poste_ancho / 2 + 1e-9; x += T.poste_separacion) posiciones.push(x);
    if (posiciones.length === 0 || largo - posiciones[posiciones.length - 1] > T.poste_ancho) posiciones.push(largo - T.poste_ancho / 2);
    const poste = this.mat(null, { color: COLOR.poste, roughness: 0.8 }, "marco");
    for (const x of posiciones) caja(null, T.poste_ancho, H, T.poste, x, H / 2, aPoste, poste);

    // Silicón en las esquinas y en la unión con el piso.
    const sil = this.mat("silicon", { color: COLOR.silicon, roughness: 0.4 });
    const cil = (r: number, l: number, x: number, y: number, z: number, eje: "x" | "y") => {
      const geom = this.geo(new THREE.CylinderGeometry(r, r, l, 10));
      if (eje === "x") geom.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geom, sil);
      mesh.position.set(x, y, z);
      g.add(mesh);
      this.reg("silicon", mesh);
    };
    cil(0.0125, H, 0, H / 2, zA(0.01), "y");
    cil(0.0125, H, largo, H / 2, zA(0.01), "y");
    cil(0.0125, largo, largo / 2, 0.05, zA(0.012), "x");

    return g;
  }

  /**
   * El lavabo de afuera, a la derecha de la regadera: pared de tocador, encimera y el salpicadero (la capa 10) sobre la
   * encimera, en la cara que da hacia afuera. Así el salpicadero se ve como en la lámina, fuera de la ducha.
   */
  private construyeVanidad(e: EntradaEscena, L: number, H: number): THREE.Group {
    const g = new THREE.Group();
    const x0 = L + 0.7;
    const largo = 4;
    const pared = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.3, H, largo)), this.mat(null, { color: COLOR.pared, roughness: 0.9 }, "base"));
    pared.position.set(x0 + 0.15, H / 2, largo / 2 - 0.2);
    const encimera = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.2, 0.12, largo)), this.mat(null, { color: COLOR.encimera, roughness: 0.3 }, "base"));
    encimera.position.set(x0 + 0.3 + 0.6, 2.94, largo / 2 - 0.2);
    g.add(pared, encimera);

    const alto = Math.min(1.2, Math.max(0.5, e.salpicaderoAltoFt));
    const ancho = Math.min(largo - 0.4, Math.max(1, e.salpicaderoLargoFt));
    const sal = this.textura("salpicadero", e.espec.salpicadero, e.fotos.salpicadero, true);
    const borde = this.mat("salpicadero", { color: "#0f766e", roughness: 0.3 });
    const cara = this.mat("salpicadero", { color: "#ffffff", map: sal.tex, roughness: 0.3 });
    const arr = Array.from({ length: 6 }, () => borde);
    arr[0] = cara; // cara +x: la que mira hacia afuera
    const patch = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.02, alto, ancho)), arr);
    patch.position.set(x0 + 0.3 + 0.01, 3.06 + alto / 2, largo / 2 - 0.2);
    this.escalaUV(patch.geometry, (ancho * 12) / sal.bloque.anchoIn, (alto * 12) / sal.bloque.altoIn, (n) => Math.abs(n.x) > 0.5);
    g.add(patch);
    this.reg("salpicadero", patch);
    return g;
  }

  /** Un perfil (tira) en el extremo expuesto de una pared. */
  private perfilDeExtremo(p: Pared, extremo: 0 | 1, H: number): THREE.Group {
    const g = new THREE.Group();
    const ejeX = new THREE.Vector3(p.fin.x - p.inicio.x, 0, p.fin.z - p.inicio.z).normalize();
    const ejeY = new THREE.Vector3(0, 1, 0);
    const ejeZ = new THREE.Vector3().crossVectors(ejeX, ejeY);
    const s = ejeZ.dot(new THREE.Vector3(p.hacia.x, 0, p.hacia.z)) >= 0 ? 1 : -1;
    g.position.set(p.inicio.x, 0, p.inicio.z);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ejeX, ejeY, ejeZ));
    const x = extremo === 0 ? -0.0104 : p.largo + 0.0104;
    const mesh = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(0.0208, H, T.loseta + 0.002)),
      this.mat("perfiles", { color: "#92400e", roughness: 0.5 }),
    );
    mesh.position.set(x, H / 2, -s * (T.loseta / 2));
    g.add(mesh);
    this.reg("perfiles", mesh);
    return g;
  }
}
