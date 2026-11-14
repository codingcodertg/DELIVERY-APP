/**
 * La escena 3D de la regadera (three.js), toda procedural: cajas y superficies, sin modelos de archivo.
 *
 * Las paredes son cajas apiladas hacia afuera (loseta, adhesivo, impermeabilizante, panel, membrana, postes), así el
 * corte diagonal de «Corte» deja ver las capas como en la lámina. La base son superficies con la altura que da la
 * pendiente. Cada capa lleva sus objetos: mostrar, ocultar, resaltar y el paso a paso son solo cambios de visibilidad
 * o de emisión; la geometría se reconstruye solo cuando cambian medidas o losetas.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CAPAS, ORDEN_DE_INSTALACION, type IdCapa } from "@/lib/estimator/visualizador/capas";
import {
  alturaDeLaPendiente, bloqueDeLaLoseta, bloqueDelPatron, distanciaNormalizada, extremosExpuestos, juntasDePaneles,
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

/** Color de cada capa (el número de la lámina), y el de las partes que no van en la lista. */
const COLOR_BORDE = {
  loseta: "#e9e7e1",
  cuerpo: "#c4bcae",
  madera: "#8b5e34",
  metal: "#9aa0a6",
  silicon: "#4338ca",
  rojo: "#c62828",
  poste: "#d4b48c",
  verde: "#2f855a",
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
  private camera = new THREE.PerspectiveCamera(34, 1, 0.02, 200);
  private controls: OrbitControls;
  private raiz = new THREE.Group();
  private capas = new Map<IdCapa, CapaVista>();
  private materiales = new Set<THREE.Material>();
  private geometrias = new Set<THREE.BufferGeometry>();
  private texCache = new Map<string, TexturaCache>();
  private texUsadas = new Set<string>();
  private plano = new THREE.Plane(new THREE.Vector3(-1, 0, -1).normalize(), 0);
  private estado: EstadoVista = { visibles: new Set(ORDEN_DE_INSTALACION), paso: ORDEN_DE_INSTALACION.length, seleccion: null, corte: false };
  private dimsVista: { L: number; W: number; H: number } | null = null;
  private frame = 0;
  private texAdhesivo: TexturaCache | null = null;
  private vistaInicial = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0xe8e6e1, 1);
    this.scene.background = new THREE.Color(0xe8e6e1);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8576, 1.25));
    const sol = new THREE.DirectionalLight(0xffffff, 1.5);
    sol.position.set(6, 12, 9);
    this.scene.add(sol);
    this.scene.add(this.raiz);
    for (const c of CAPAS) this.capas.set(c.id, { objetos: [], materiales: [], color: c.color });

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 90;
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

  resetVista(): void {
    const { L, W, H } = this.dimsVista ?? { L: 5, W: 3, H: 8 };
    const centro = new THREE.Vector3(L / 2, H * 0.42, W / 2);
    const dist = Math.max(L, W, H) * 2.1 + 1.5;
    const dir = new THREE.Vector3(0.45, 0.4, 1).normalize(); // desde el frente abierto de la ducha
    this.camera.position.copy(centro).addScaledVector(dir, dist);
    this.controls.target.copy(centro);
    this.controls.update();
    this.pideRender();
  }

  redimensiona(): void {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
    // Corte diagonal: se deja la mitad de atrás (la de la coladera) y se quita la esquina de enfrente, como en la lámina.
    const { L, W } = this.dimsVista ?? { L: 5, W: 3 };
    this.plano.constant = corte ? ((L + W) / 2) / Math.SQRT2 : 1e6;
    for (const m of this.materiales) {
      m.clippingPlanes = corte ? [this.plano] : null;
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
  }

  private mat(id: IdCapa | null, p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...p });
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
    const madera = this.mat(null, { color: COLOR_BORDE.madera, roughness: 0.9 });
    const base = new THREE.Mesh(this.geo(new THREE.BoxGeometry(L + 2, 0.5, W + 2)), madera);
    base.position.set(L / 2, -0.25, W / 2);
    this.raiz.add(base);

    if (conPiso) this.construyePiso(e, L, W, conDrenaje);
    if (conPared) {
      const paredes = paredesDeLaDisposicion(disposicion, L, W);
      const expuestos = extremosExpuestos(paredes);
      paredes.forEach((p, idx) => {
        this.raiz.add(this.construyePared(p, e, H, idx === 0));
        // Perfiles de los extremos a la vista.
        for (const ex of expuestos.filter((x) => x.pared === p.nombre)) {
          this.raiz.add(this.perfilDeExtremo(p, ex.extremo, H));
        }
      });
    }
  }

  private construyePiso(e: EntradaEscena, L: number, W: number, conDrenaje: boolean): void {
    const dn = (x: number, z: number) => distanciaNormalizada(x, z, L, W);
    const grosorPre = (x: number, z: number) => alturaDeLaPendiente(dn(x, z), e.preslopeIn);
    const grosorBed = (x: number, z: number) => alturaDeLaPendiente(dn(x, z), e.morteroIn);
    const hPre = grosorPre;
    const hLiner = (x: number, z: number) => hPre(x, z) + T.liner;
    const hBed = (x: number, z: number) => hLiner(x, z) + grosorBed(x, z);
    const hWP = (x: number, z: number) => hBed(x, z) + T.impermeable;
    const hTS = (x: number, z: number) => hWP(x, z) + T.adhesivo;
    const hTile = (x: number, z: number) => hTS(x, z) + T.loseta;
    const hGrout = (x: number, z: number) => hTile(x, z) - 0.002;

    const nx = Math.min(48, Math.max(6, Math.ceil((L * 12) / 4)));
    const nz = Math.min(48, Math.max(6, Math.ceil((W * 12) / 4)));
    const superficie = (fn: (x: number, z: number) => number): THREE.BufferGeometry => {
      const g = new THREE.PlaneGeometry(L, W, nx, nz);
      g.rotateX(-Math.PI / 2);
      g.translate(L / 2, 0, W / 2);
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, fn(pos.getX(i), pos.getZ(i)));
      g.computeVertexNormals();
      return this.geo(g);
    };

    // 0. Base con pendiente.
    const pre = new THREE.Mesh(superficie(hPre), this.mat("base-mortero", { color: "#a8a29e", side: THREE.DoubleSide }));
    this.raiz.add(pre); this.reg("base-mortero", pre);

    // Coladera (solo en la ducha).
    if (conDrenaje) this.raiz.add(this.drenaje(L, W, hPre(L / 2, W / 2)));

    // 1. Membrana.
    const membrana = new THREE.Mesh(superficie(hLiner), this.mat("membrana", { color: "#2b5fd9", side: THREE.DoubleSide, roughness: 0.8 }));
    this.raiz.add(membrana); this.reg("membrana", membrana);

    // 4. Cama final.
    const bed = new THREE.Mesh(superficie(hBed), this.mat("mortero-final", { color: "#c9b99a", side: THREE.DoubleSide, roughness: 0.95 }));
    this.raiz.add(bed); this.reg("mortero-final", bed);

    // 6. Impermeabilizante del piso (rojo).
    const wpMat = this.mat("impermeable", { color: COLOR_BORDE.rojo, side: THREE.DoubleSide, roughness: 0.5 });
    const wp = new THREE.Mesh(superficie(hWP), wpMat);
    this.raiz.add(wp); this.reg("impermeable", wp);

    // 7. Adhesivo con surcos de peine.
    const ads = this.texturaAdhesivo();
    const tsGeo = superficie(hTS);
    this.escalaUV(tsGeo, (L * 12) / ads.bloque.anchoIn, (W * 12) / ads.bloque.altoIn);
    const tsMesh = new THREE.Mesh(tsGeo, this.mat("adhesivo", { color: "#ffffff", map: ads.tex, side: THREE.DoubleSide, roughness: 0.9 }));
    this.raiz.add(tsMesh); this.reg("adhesivo", tsMesh);

    // Loseta de piso y boquilla del piso (la boquilla va justo debajo de la loseta, visible por las juntas).
    const piso = this.textura("piso", e.espec.piso, e.fotos.piso, false);
    const pisoGeo = superficie(hTile);
    const { x: rx, y: ry } = repeticionDeLaSuperficie(piso.bloque, L, W);
    this.escalaUV(pisoGeo, rx, ry);
    const pisoMesh = new THREE.Mesh(pisoGeo, this.mat("loseta-piso", { color: "#ffffff", map: piso.tex, alphaTest: 0.5, roughness: 0.3 }));
    this.raiz.add(pisoMesh); this.reg("loseta-piso", pisoMesh);

    const grout = new THREE.Mesh(superficie(hGrout), this.mat("boquilla", { color: colorDeLechada(e.espec.piso.lechada), side: THREE.DoubleSide, roughness: 0.85 }));
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

  private drenaje(L: number, W: number, yBase: number): THREE.Group {
    const g = new THREE.Group();
    const cuerpo = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.25, 22)), this.mat("coladera", { color: COLOR_BORDE.metal, metalness: 0.4, roughness: 0.5 }));
    cuerpo.position.set(L / 2, yBase - 0.12, W / 2);
    const rejilla = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.26, 0.006, 0.26)), this.mat("coladera", { color: "#2b2f36", metalness: 0.3, roughness: 0.4 }));
    rejilla.position.set(L / 2, yBase + 0.003, W / 2);
    g.add(cuerpo, rejilla);
    this.reg("coladera", cuerpo); this.reg("coladera", rejilla);
    return g;
  }

  /** Una pared: el marco local (x a lo largo, y arriba, z hacia adentro del cuarto) y las capas de adentro hacia afuera. */
  private construyePared(p: Pared, e: EntradaEscena, H: number, esTrasera: boolean): THREE.Group {
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

    // id = null: la pieza no es de ninguna capa de la lista (postes): siempre visible.
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

    // 10/9. Azulejo de pared (cara de dentro con la textura; la boquilla va detrás, visible por las juntas).
    const loseta = this.textura("pared", e.espec.pared, e.fotos.pared, false);
    const bordeLoseta = this.mat("loseta-pared", { color: COLOR_BORDE.loseta, roughness: 0.3 });
    const matLoseta = this.mat("loseta-pared", { color: "#ffffff", map: loseta.tex, alphaTest: 0.5, roughness: 0.3 });
    const arrLoseta = Array.from({ length: 6 }, () => bordeLoseta);
    arrLoseta[caraDentro] = matLoseta;
    const mLoseta = caja("loseta-pared", largo, H, T.loseta, largo / 2, H / 2, aTile, arrLoseta);
    const sxL = (largo * 12) / loseta.bloque.anchoIn, syL = (H * 12) / loseta.bloque.altoIn;
    this.escalaUV(mLoseta.geometry, sxL, syL, (n) => Math.abs(n.z) > 0.5);

    // Boquilla: detrás de la loseta, visible por sus juntas.
    const boquilla = this.mat("boquilla", { color: colorDeLechada(e.espec.pared.lechada), roughness: 0.85 });
    caja("boquilla", largo, H, T.loseta - 0.006, largo / 2, H / 2, aTile + 0.006, boquilla);

    // 7. Adhesivo con surcos.
    const adh = this.texturaAdhesivo();
    const arrAdh = Array.from({ length: 6 }, () => this.mat("adhesivo", { color: "#d9d3c3", roughness: 0.9 }));
    arrAdh[caraDentro] = this.mat("adhesivo", { color: "#ffffff", map: adh.tex, roughness: 0.9 });
    const mAdh = caja("adhesivo", largo, H, T.adhesivo, largo / 2, H / 2, aAdh, arrAdh);
    this.escalaUV(mAdh.geometry, (largo * 12) / adh.bloque.anchoIn, (H * 12) / adh.bloque.altoIn, (n) => Math.abs(n.z) > 0.5);

    // 6. Impermeabilizante rojo.
    caja("impermeable", largo, H, T.impermeable, largo / 2, H / 2, aWP, this.mat("impermeable", { color: COLOR_BORDE.rojo, roughness: 0.5 }));

    // 2. Paneles de tablero: uno por panel (las juntas se ven como cortes).
    const tablero = this.mat("tablero", { color: "#cbbb9a", roughness: 0.95 });
    const paneles = panelesDePared(largo, H, e.tableroAnchoFt, e.tableroAltoFt);
    for (const pn of paneles) {
      caja("tablero", pn.x1 - pn.x0, pn.y1 - pn.y0, T.panel, (pn.x0 + pn.x1) / 2, (pn.y0 + pn.y1) / 2, aPanel, tablero);
    }

    // 3. Tornillos: una sola malla instanciada por pared. Van en la cara del panel, donde pega el impermeabilizante.
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

    // 5. Malla en las juntas de paneles.
    const juntas = juntasDePaneles(largo, H, e.tableroAnchoFt, e.tableroAltoFt);
    const malla = this.mat("malla", { color: "#f5f3ee", roughness: 0.9 });
    for (const x of juntas.verticales) caja("malla", T.ancho_malla, H, T.malla, x, H / 2, aPanel - 0.0007, malla);
    for (const y of juntas.horizontales) caja("malla", largo, T.ancho_malla, T.malla, largo / 2, y, aPanel - 0.0007, malla);

    // 1. Membrana: subida detrás del panel, en la base.
    if (e.subidaIn > 0) {
      const sub = Math.min(H, e.subidaIn / 12);
      caja("membrana", largo, sub, T.liner, largo / 2, sub / 2, aLiner, this.mat("membrana", { color: "#2b5fd9", roughness: 0.8 }));
    }

    // Postes: a 16 in, cada uno con su cara en el panel (sin plata de dibujo de madera).
    const posiciones: number[] = [];
    for (let x = T.poste_ancho / 2; x < largo - T.poste_ancho / 2 + 1e-9; x += T.poste_separacion) posiciones.push(x);
    if (posiciones.length === 0 || largo - posiciones[posiciones.length - 1] > T.poste_ancho) posiciones.push(largo - T.poste_ancho / 2);
    const poste = this.mat(null, { color: COLOR_BORDE.poste, roughness: 0.8 });
    for (const x of posiciones) caja(null, T.poste_ancho, H, T.poste, x, H / 2, aPoste, poste);

    // Salpicadero: solo en la pared trasera (la primera).
    if (esTrasera && e.salpicaderoLargoFt > 0 && e.salpicaderoAltoFt > 0) {
      const sl = Math.min(largo, e.salpicaderoLargoFt);
      const sa = Math.min(H, e.salpicaderoAltoFt);
      const y0 = Math.max(0, Math.min(H - sa, H * 0.42));
      const sal = this.textura("salpicadero", e.espec.salpicadero, e.fotos.salpicadero, true);
      const bordeSal = this.mat("salpicadero", { color: "#0f766e", roughness: 0.3 });
      const matSal = this.mat("salpicadero", { color: "#ffffff", map: sal.tex, roughness: 0.3 });
      const arrSal = Array.from({ length: 6 }, () => bordeSal);
      arrSal[caraDentro] = matSal;
      const mSal = caja("salpicadero", sl, sa, 0.0042, largo / 2, y0 + sa / 2, -0.0042, arrSal);
      this.escalaUV(mSal.geometry, (sl * 12) / sal.bloque.anchoIn, (sa * 12) / sal.bloque.altoIn, (n) => Math.abs(n.z) > 0.5);
    }

    // 13/14. Boquilla y silicón: el silicón en las esquinas y en la unión con el piso.
    const sil = this.mat("silicon", { color: COLOR_BORDE.silicon, roughness: 0.4 });
    const cilH = (r: number, l: number, x: number, y: number, z: number, eje: "x" | "y") => {
      const geom = this.geo(new THREE.CylinderGeometry(r, r, l, 10));
      if (eje === "x") geom.rotateZ(Math.PI / 2); // el eje del cilindro pasa a ser x
      const mesh = new THREE.Mesh(geom, sil);
      mesh.position.set(x, y, z);
      g.add(mesh);
      this.reg("silicon", mesh);
    };
    cilH(0.0125, H, 0, H / 2, zA(0.01), "y");
    cilH(0.0125, H, largo, H / 2, zA(0.01), "y");
    const yBase = 0.05;
    cilH(0.0125, largo, largo / 2, yBase, zA(0.012), "x");

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
