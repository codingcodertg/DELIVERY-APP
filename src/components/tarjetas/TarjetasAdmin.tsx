"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { createClient } from "@/lib/supabase/client";
import { usePrefs } from "@/lib/prefs";
import { CLAVES_DE_TIENDA, TIENDAS, esClaveDeTienda } from "@/lib/tarjetas/datos";
import { validaSlug, slugDesdeNombre } from "@/lib/tarjetas/slug";
import { telefonoValido, correoValido } from "@/lib/tarjetas/contacto";
import { nuevoTokenDeEdicion } from "@/lib/tarjetas/token";
import { BUCKET_DE_TARJETAS, TAMANO_MAX_FOTO, esFirmaDeImagen, extensionDeFoto, rutaDeFoto, urlPublicaDeFoto, type ClaseDeFoto } from "@/lib/tarjetas/fotos";
import { ORIGEN_DE_TARJETAS } from "@/lib/tarjetas/host";
import { TARJETAS_DEMO, type FilaDeTarjetaDemo } from "@/lib/tarjetas/demo";
import { compressImage } from "@/lib/clockin/image";
import { ANCHO_FOTO, ANCHO_PORTADA, CALIDAD_FOTO, TAMANO_ORIGINAL_MAX } from "@/lib/tarjetas/reduccion";

// «Tarjetas de presentación», dentro de la app QR Codes (solo admin). Tabla, alta y edición, fotos, QR y enlaces.
// En el demo no hay base: las tarjetas son las inventadas y los cambios viven en la pantalla.

const DEMO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export type FilaAdmin = FilaDeTarjetaDemo;

interface Borrador {
  nombre: string; rolEs: string; rolEn: string; tienda: string; slug: string;
  telefono: string; whatsapp: string; correo: string; perfil: string; activo: boolean;
}

const BORRADOR_VACIO: Borrador = {
  nombre: "", rolEs: "", rolEn: "", tienda: "", slug: "", telefono: "", whatsapp: "", correo: "", perfil: "", activo: true,
};

function borradorDe(f: FilaAdmin): Borrador {
  return {
    nombre: f.full_name, rolEs: f.role_es ?? "", rolEn: f.role_en ?? "", tienda: f.store ?? "", slug: f.slug,
    telefono: f.phone ?? "", whatsapp: f.whatsapp ?? "", correo: f.email ?? "", perfil: f.profile_id ?? "", activo: f.active,
  };
}

/** La URL pública de la tarjeta. En el demo, la del propio sitio (para probarla); en real, el dominio de tarjetas. */
function urlPublica(slug: string): string {
  return DEMO ? `${window.location.origin}/tarjeta/${slug}` : `${ORIGEN_DE_TARJETAS}/${slug}`;
}

/** El enlace privado de edición de una persona. */
function urlDeEdicion(token: string): string {
  return DEMO ? `${window.location.origin}/tarjeta/editar?token=${token}` : `${ORIGEN_DE_TARJETAS}/editar?token=${token}`;
}

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

export function TarjetasAdmin() {
  const { t, lang } = usePrefs();
  const supabase = useMemo(() => (DEMO ? null : createClient()), []);
  const [filas, setFilas] = useState<FilaAdmin[]>(DEMO ? [...TARJETAS_DEMO] : []);
  const [perfiles, setPerfiles] = useState<{ id: string; full_name: string }[]>([]);
  const [cargando, setCargando] = useState(!DEMO);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<FilaAdmin | "nueva" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!supabase) return;
    setCargando(true);
    const [t1, t2] = await Promise.all([
      supabase.from("business_cards").select("*").order("full_name"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    if (t1.error) setError(t1.error.message);
    else { setFilas((t1.data ?? []) as FilaAdmin[]); setError(null); }
    if (!t2.error) setPerfiles((t2.data ?? []) as { id: string; full_name: string }[]);
    setCargando(false);
  }, [supabase]);

  useEffect(() => { void cargar(); }, [cargar]);

  const avisar = (texto: string) => {
    setAviso(texto);
    setTimeout(() => setAviso(null), 2400);
  };

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return filas;
    return filas.filter((f) => `${f.full_name} ${f.slug} ${f.store ?? ""} ${f.role_es} ${f.role_en}`.toLowerCase().includes(q));
  }, [filas, busqueda]);

  const columnas: ColumnaEstandar<FilaAdmin>[] = [
    { key: "nombre", en: "Name", es: "Nombre", valor: (f) => f.full_name, ancho: 200 },
    { key: "rol", en: "Role", es: "Puesto", valor: (f) => (lang === "en" ? f.role_en || f.role_es : f.role_es || f.role_en), ancho: 190 },
    { key: "tienda", en: "Store", es: "Tienda", valor: (f) => (esClaveDeTienda(f.store) ? TIENDAS[f.store].ciudad : null), ancho: 120 },
    { key: "telefono", en: "Phone", es: "Teléfono", valor: (f) => f.phone || null, ancho: 150 },
    { key: "activa", en: "Active", es: "Activa", valor: (f) => (f.active ? t("Yes", "Sí") : t("No", "No")), ancho: 80 },
    { key: "enlace", en: "Link", es: "Enlace", valor: (f) => f.slug, ancho: 200 },
  ];

  const acciones = (f: FilaAdmin) => (
    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.open(urlPublica(f.slug), "_blank", "noopener")}>↗ {t("Open", "Abrir")}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={async () => avisar((await copiar(urlPublica(f.slug))) ? t("Link copied", "Enlace copiado") : t("Could not copy", "No se pudo copiar"))}>
        📋 {t("Copy link", "Copiar enlace")}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => descargarQr(f.slug)}>⬇ QR</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={async () => avisar((await copiar(urlDeEdicion(f.edit_token))) ? t("Edit link copied", "Enlace de edición copiado") : t("Could not copy", "No se pudo copiar"))}>
        ✏️ {t("Edit link", "Enlace de edición")}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void renovarToken(f)}>🔁 {t("New edit link", "Nuevo enlace de edición")}</button>
    </span>
  );

  async function descargarQr(slug: string) {
    const png = await QRCode.toDataURL(urlPublica(slug), { width: 1024, margin: 2, errorCorrectionLevel: "M" });
    const a = document.createElement("a");
    a.href = png;
    a.download = `tarjeta-${slug}-QR.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function renovarToken(f: FilaAdmin) {
    if (!window.confirm(t(
      `Make a new edit link for ${f.full_name}? The old link stops working.`,
      `¿Hacer un enlace de edición nuevo para ${f.full_name}? El enlace anterior deja de funcionar.`,
    ))) return;
    const nuevo = nuevoTokenDeEdicion();
    if (!supabase) {
      setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, edit_token: nuevo } : x)));
      avisar(t("Demo: new link created", "Demo: enlace nuevo creado"));
      return;
    }
    const { error: e } = await supabase.from("business_cards").update({ edit_token: nuevo, updated_at: new Date().toISOString() }).eq("id", f.id);
    if (e) { setError(e.message); return; }
    await cargar();
    avisar(t("New edit link ready. Copy it again.", "Enlace de edición nuevo listo. Cópialo otra vez."));
  }

  return (
    <div className="tarjetas-admin" style={{ display: "grid", gap: 14, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 800 }}>🪪 {t("Business cards", "Tarjetas de presentación")}</div>
          <div className="hint">{t("One digital card per person, opened from the NFC tag.", "Una tarjeta digital por persona, que se abre desde el NFC.")}
            {DEMO ? ` ${t("Demo data.", "Datos de demostración.")}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={t("Search…", "Buscar…")}
            aria-label={t("Search cards", "Buscar tarjetas")} style={{ height: 36, minWidth: 180 }} />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando("nueva")}>+ {t("New card", "Nueva tarjeta")}</button>
        </div>
      </div>

      {aviso && <div className="card" role="status" data-tarjetas-aviso>{aviso}</div>}
      {error && <div className="card" role="alert" style={{ color: "var(--red)" }}>{error}</div>}

      {editando && (
        <FormularioDeTarjeta
          key={editando === "nueva" ? "nueva" : editando.id}
          fila={editando === "nueva" ? null : editando}
          perfiles={perfiles}
          supabase={supabase}
          filasExistentes={filas}
          onCerrar={() => setEditando(null)}
          onGuardada={async (guardada) => {
            setEditando(null);
            if (!supabase) {
              setFilas((prev) => (prev.some((x) => x.id === guardada.id) ? prev.map((x) => (x.id === guardada.id ? guardada : x)) : [...prev, guardada]));
            } else {
              await cargar();
            }
            avisar(t("Saved ✓", "Guardada ✓"));
          }}
        />
      )}

      <TablaEstandar<FilaAdmin>
        id="tarjetas-de-presentacion"
        data-tabla="tarjetas-de-presentacion"
        columnas={columnas}
        filas={filtradas}
        claveDe={(f) => f.id}
        onFila={(f) => setEditando(f)}
        acciones={acciones}
        anchoDeAcciones={460}
        claseDeFila={(f) => (f.active ? undefined : "off")}
        vacio={cargando ? t("Loading…", "Cargando…") : t("No cards yet.", "Todavía no hay tarjetas.")}
      />
    </div>
  );
}

/** Alta y edición. Valida todo antes de escribir; el slug se propone del nombre al crear. */
function FormularioDeTarjeta({ fila, perfiles, supabase, filasExistentes, onCerrar, onGuardada }: {
  fila: FilaAdmin | null;
  perfiles: { id: string; full_name: string }[];
  supabase: ReturnType<typeof createClient> | null;
  filasExistentes: FilaAdmin[];
  onCerrar: () => void;
  onGuardada: (f: FilaAdmin) => void | Promise<void>;
}) {
  const { t } = usePrefs();
  const [b, setB] = useState<Borrador>(fila ? borradorDe(fila) : BORRADOR_VACIO);
  const [slugTocado, setSlugTocado] = useState(!!fila);
  const [fotos, setFotos] = useState<Partial<Record<ClaseDeFoto, File>>>({});
  const [problema, setProblema] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const motivoSlug = (() => {
    const r = validaSlug(b.slug);
    if (r.ok) return null;
    return { largo: t("2 to 60 characters", "De 2 a 60 caracteres"), formato: t("Only lowercase letters, numbers and single dashes", "Solo minúsculas, números y guiones sueltos"), reservado: t("That word is reserved", "Esa palabra está reservada") }[r.motivo];
  })();
  const slugRepetido = filasExistentes.some((f) => f.slug === b.slug && f.id !== fila?.id);

  const poner = (patch: Partial<Borrador>) => setB((prev) => ({ ...prev, ...patch }));

  const elegirFoto = async (clase: ClaseDeFoto, f: File | undefined) => {
    if (!f) return;
    if (!extensionDeFoto(f.type)) { setProblema(t("Only JPG, PNG or WebP", "Solo JPG, PNG o WebP")); return; }
    if (f.size > TAMANO_ORIGINAL_MAX) { setProblema(t("That photo is too big (over 20 MB)", "Esa foto pesa más de 20 MB")); return; }
    // Una foto de celular pesa 5–12 MB y se ve lenta y pesada en el teléfono de quien la abre: se reduce antes de guardarla.
    const reducida = await reduceFoto(f, clase);
    if (reducida.size > TAMANO_MAX_FOTO || !extensionDeFoto(reducida.type)) { setProblema(t("The photo is still too big", "La foto sigue pesando demasiado")); return; }
    setProblema(null);
    setFotos((prev) => ({ ...prev, [clase]: reducida }));
  };

  const guardar = async () => {
    setProblema(null);
    if (!b.nombre.trim()) { setProblema(t("The name is required", "Falta el nombre")); return; }
    if (motivoSlug) { setProblema(t("Check the link name", "Revisa el nombre del enlace")); return; }
    if (slugRepetido) { setProblema(t("Another card uses that link", "Otra tarjeta usa ese enlace")); return; }
    if (b.telefono && !telefonoValido(b.telefono)) { setProblema(t("Check the work phone", "Revisa el teléfono de la tienda")); return; }
    if (b.whatsapp && !telefonoValido(b.whatsapp)) { setProblema(t("Check the WhatsApp number", "Revisa el número de WhatsApp")); return; }
    if (b.correo && !correoValido(b.correo)) { setProblema(t("Check the email", "Revisa el correo")); return; }
    if (b.tienda && !esClaveDeTienda(b.tienda)) { setProblema(t("Unknown store", "Tienda desconocida")); return; }

    const base: FilaAdmin = {
      id: fila?.id ?? crypto.randomUUID(),
      slug: b.slug,
      full_name: b.nombre.trim(),
      role_es: b.rolEs.trim(),
      role_en: b.rolEn.trim(),
      store: b.tienda || null,
      phone: b.telefono.trim(),
      whatsapp: b.whatsapp.trim(),
      email: b.correo.trim(),
      photo_path: fila?.photo_path ?? null,
      cover_path: fila?.cover_path ?? null,
      active: b.activo,
      profile_id: b.perfil || null,
      edit_token: fila?.edit_token ?? nuevoTokenDeEdicion(),
      created_at: fila?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!supabase) {
      // Demo: lo que se hace aquí vive en la pantalla; las fotos se quedan como vista previa, sin subir.
      void onGuardada(base);
      return;
    }

    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const fila_db = {
        slug: base.slug, full_name: base.full_name, role_es: base.role_es, role_en: base.role_en, store: base.store,
        phone: base.phone, whatsapp: base.whatsapp, email: base.email, active: base.active, profile_id: base.profile_id,
        updated_at: base.updated_at, updated_by: user?.id ?? null,
      };
      let id = fila?.id ?? "";
      if (fila) {
        const { error } = await supabase.from("business_cards").update(fila_db).eq("id", fila.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("business_cards").insert(fila_db).select("id, edit_token").single();
        if (error) throw error;
        id = data.id as string;
        base.id = id;
        base.edit_token = data.edit_token as string;
      }
      // Las fotos: cada una en la carpeta de la tarjeta (su id), con el nombre que valida la base.
      for (const clase of ["foto", "portada"] as const) {
        const archivo = fotos[clase];
        if (!archivo) continue;
        const ext = extensionDeFoto(archivo.type);
        if (!ext) continue;
        const bytes = new Uint8Array(await archivo.arrayBuffer());
        if (!esFirmaDeImagen(bytes, archivo.type)) throw new Error(t("That file is not an image", "Ese archivo no es una imagen"));
        const ruta = rutaDeFoto(id, clase, ext, Date.now());
        const { error: eSub } = await supabase.storage.from(BUCKET_DE_TARJETAS).upload(ruta, bytes, { contentType: archivo.type, upsert: false, cacheControl: "3600" });
        if (eSub) throw eSub;
        const campo = clase === "foto" ? "photo_path" : "cover_path";
        const { error: eUp } = await supabase.from("business_cards").update({ [campo]: ruta }).eq("id", id);
        if (eUp) throw eUp;
        if (clase === "foto") base.photo_path = ruta; else base.cover_path = ruta;
      }
      await onGuardada(base);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setProblema(err.code === "23505"
        ? t("Another card uses that link", "Otra tarjeta usa ese enlace")
        : `${t("Could not save", "No se pudo guardar")}: ${err.message ?? ""}`);
    } finally {
      setGuardando(false);
    }
  };

  const etiqueta = (txt: string) => <label style={{ display: "block", fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{txt}</label>;

  return (
    <div className="card" data-tarjetas-formulario style={{ display: "grid", gap: 12 }}>
      <div style={{ fontWeight: 800 }}>{fila ? `${t("Edit", "Editar")} — ${fila.full_name}` : t("New card", "Nueva tarjeta")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>{etiqueta(t("Full name", "Nombre completo"))}<input value={b.nombre} onChange={(e) => {
          const nombre = e.target.value;
          poner({ nombre, ...(slugTocado ? {} : { slug: slugDesdeNombre(nombre) }) });
        }} style={{ width: "100%", height: 38 }} /></div>
        <div>{etiqueta(t("Role (ES)", "Puesto (ES)"))}<input value={b.rolEs} onChange={(e) => poner({ rolEs: e.target.value })} style={{ width: "100%", height: 38 }} /></div>
        <div>{etiqueta(t("Role (EN)", "Puesto (EN)"))}<input value={b.rolEn} onChange={(e) => poner({ rolEn: e.target.value })} style={{ width: "100%", height: 38 }} /></div>
        <div>{etiqueta(t("Store", "Tienda"))}
          <select value={b.tienda} onChange={(e) => poner({ tienda: e.target.value })} style={{ width: "100%", height: 38 }}>
            <option value="">{t("— No store (floater) —", "— Sin tienda (flotante) —")}</option>
            {CLAVES_DE_TIENDA.map((c) => <option key={c} value={c}>{TIENDAS[c].ciudad}</option>)}
          </select>
        </div>
        <div>{etiqueta(t("Link name (slug)", "Nombre del enlace"))}
          <input value={b.slug} onChange={(e) => { setSlugTocado(true); poner({ slug: e.target.value.trim().toLowerCase() }); }} style={{ width: "100%", height: 38 }} />
          {b.slug && (motivoSlug ? <div className="hint" style={{ color: "var(--red)" }}>{motivoSlug}</div> : slugRepetido ? <div className="hint" style={{ color: "var(--red)" }}>{t("Already used", "Ya lo usa otra tarjeta")}</div> : null)}
        </div>
        <div>{etiqueta(t("Work phone (store line)", "Teléfono de la tienda"))}<input value={b.telefono} onChange={(e) => poner({ telefono: e.target.value })} placeholder="+1 956 000 0000" style={{ width: "100%", height: 38 }} /></div>
        <div>{etiqueta("WhatsApp / " + t("cell", "celular"))}<input value={b.whatsapp} onChange={(e) => poner({ whatsapp: e.target.value })} placeholder="+1 956 000 0000" style={{ width: "100%", height: 38 }} /></div>
        <div>{etiqueta(t("Email", "Correo"))}<input value={b.correo} onChange={(e) => poner({ correo: e.target.value })} style={{ width: "100%", height: 38 }} /></div>
        <div>{etiqueta(t("Hub employee (optional)", "Empleado del hub (opcional)"))}
          <select value={b.perfil} onChange={(e) => poner({ perfil: e.target.value })} style={{ width: "100%", height: 38 }}>
            <option value="">{t("— None —", "— Ninguno —")}</option>
            {perfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input id="tj-activa" type="checkbox" checked={b.activo} onChange={(e) => poner({ activo: e.target.checked })} />
          <label htmlFor="tj-activa">{t("Active (the card is public)", "Activa (la tarjeta es pública)")}</label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <FotoSubida titulo={t("Photo", "Foto")} clase="foto" actual={fila?.photo_path ?? null} pendiente={fotos.foto} onElegir={(f) => elegirFoto("foto", f)} />
        <FotoSubida titulo={t("Cover", "Portada")} clase="portada" actual={fila?.cover_path ?? null} pendiente={fotos.portada} onElegir={(f) => elegirFoto("portada", f)} />
      </div>

      {problema && <div role="alert" style={{ color: "var(--red)" }}>{problema}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? t("Saving…", "Guardando…") : t("Save", "Guardar")}</button>
        <button type="button" className="btn btn-ghost" onClick={onCerrar}>{t("Cancel", "Cancelar")}</button>
      </div>
      {fila && (
        <div className="hint">
          {t("Link:", "Enlace:")} <a href={urlPublica(fila.slug)} target="_blank" rel="noopener noreferrer">{urlPublica(fila.slug)}</a>
        </div>
      )}
    </div>
  );
}

/** La foto de la persona, reducida (círculo, 800 px) o la portada (1200 px), en JPEG ligero. */
async function reduceFoto(f: File, clase: ClaseDeFoto): Promise<File> {
  const blob = await compressImage(f, clase === "foto" ? ANCHO_FOTO : ANCHO_PORTADA, CALIDAD_FOTO);
  return new File([blob], `${clase}.${extensionDeFoto(blob.type) ?? "jpg"}`, { type: blob.type });
}

function FotoSubida({ titulo, clase, actual, pendiente, onElegir }: {
  titulo: string; clase: ClaseDeFoto; actual: string | null; pendiente: File | undefined; onElegir: (f: File | undefined) => void | Promise<void>;
}) {
  const { t } = usePrefs();
  const url = pendiente ? URL.createObjectURL(pendiente) : actual && SUPABASE_URL ? urlPublicaDeFoto(SUPABASE_URL, actual) : null;
  return (
    <div style={{ width: clase === "foto" ? 150 : 260 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>{titulo}</div>
      <div className="foto-hueco" style={{ height: clase === "foto" ? 150 : 110, borderRadius: clase === "foto" ? "50%" : 10, backgroundImage: url ? `url("${url}")` : undefined, marginBottom: 6 }} />
      <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
        {t("Choose file", "Elegir archivo")}
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onElegir(e.target.files?.[0])} />
      </label>
    </div>
  );
}
