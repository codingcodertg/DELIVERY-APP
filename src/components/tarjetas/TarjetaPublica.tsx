"use client";

import { useEffect, useRef, useState, type ReactNode, type SVGProps } from "react";
import { preload } from "react-dom";
import { construyeVcard, nombreDeArchivoVcard } from "@/lib/tarjetas/vcard";
import { enlaceCorreo, enlaceHttps, enlaceLlamar, enlaceMensaje, enlaceWhatsApp } from "@/lib/tarjetas/contacto";
import { CLAVE_DE_IDIOMA, IDIOMA_POR_DEFECTO, TEXTOS, idiomaDesdeTexto, mensajeDeWhatsApp, type Idioma } from "@/lib/tarjetas/textos";
import { HORARIO, MARCA, TIENDAS, enlaceDeMapa, enlaceDeResena, idDeVideo, type ClaveDeTienda } from "@/lib/tarjetas/datos";
import { iniciales, primerNombre, type TarjetaPublica as Tarjeta } from "@/lib/tarjetas/tarjeta";
import { ORIGEN_DE_TARJETAS } from "@/lib/tarjetas/host";

// La tarjeta pública de una persona. Mismo diseño que el index.html del contratista (ver tarjeta.css). Los datos llegan
// ya validados desde el servidor; los enlaces se hacen aquí con `lib/tarjetas/contacto`, y React escapa el texto.

const VIDEO = idDeVideo(MARCA.youtube);

export function TarjetaPublica({ tarjeta }: { tarjeta: Tarjeta }) {
  const [lang, setLang] = useState<Idioma>(IDIOMA_POR_DEFECTO);
  const [fotoRota, setFotoRota] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [videoAbierto, setVideoAbierto] = useState(false);
  const [indice, setIndice] = useState(0);
  const slidesRef = useRef<HTMLDivElement>(null);
  const fotoRef = useRef<HTMLImageElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // El idioma se recuerda en este navegador (la clave es la de siempre, `rtg-lang`).
  useEffect(() => {
    try { setLang(idiomaDesdeTexto(localStorage.getItem(CLAVE_DE_IDIOMA))); } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${tarjeta.nombre} · ${MARCA.nombre}`;
  }, [lang, tarjeta.nombre]);

  const t = TEXTOS[lang];
  const tienda = tarjeta.tienda ? TIENDAS[tarjeta.tienda as ClaveDeTienda] : null;
  const primero = primerNombre(tarjeta.nombre);
  const celular = tarjeta.celular;
  const lineaTienda = tarjeta.telefono && tarjeta.telefono !== celular ? tarjeta.telefono : null;
  const linkLlamar = enlaceLlamar(celular);
  const linkWa = enlaceWhatsApp(celular, mensajeDeWhatsApp(lang, primero));
  const linkSms = enlaceMensaje(celular);
  const linkMail = enlaceCorreo(tarjeta.correo);
  const fotos = tienda?.fotos ?? [];
  const rol = lang === "en" ? tarjeta.rolEn || tarjeta.rolEs : tarjeta.rolEs || tarjeta.rolEn;

  const avisar = (texto: string) => {
    setToast(texto);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const cambiarIdioma = () => {
    const siguiente: Idioma = lang === "es" ? "en" : "es";
    setLang(siguiente);
    try { localStorage.setItem(CLAVE_DE_IDIOMA, siguiente); } catch { /* sin almacenamiento */ }
  };

  const compartir = async () => {
    const url = `${ORIGEN_DE_TARJETAS}/${tarjeta.slug}`;
    if (navigator.share) {
      try { await navigator.share({ title: `${tarjeta.nombre} · ${MARCA.nombre}`, url }); } catch { /* cancelado */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); avisar(t.copied); } catch { /* sin permiso */ }
  };

  const guardarContacto = () => {
    const url = `${ORIGEN_DE_TARJETAS}/${tarjeta.slug}`;
    const vcf = construyeVcard({
      nombre: tarjeta.nombre,
      rolEs: tarjeta.rolEs,
      rolEn: tarjeta.rolEn,
      idioma: lang,
      marca: MARCA.nombre,
      tienda: tienda ? { ciudad: tienda.ciudad, direccion: tienda.direccion } : null,
      celular: celular ? telefonoParaVcard(celular) : null,
      trabajo: lineaTienda ? telefonoParaVcard(lineaTienda) : null,
      correo: linkMail ? tarjeta.correo : null,
      url,
      fotoBase64: fotoComoJpeg(fotoRef.current),
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([vcf], { type: "text/vcard;charset=utf-8" }));
    a.download = nombreDeArchivoVcard(tarjeta.nombre);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    avisar(t.saved);
  };

  const irA = (i: number) => slidesRef.current?.scrollTo({ left: (slidesRef.current.clientWidth) * i, behavior: "smooth" });
  const alDesplazar = () => {
    const el = slidesRef.current;
    if (el && el.clientWidth) setIndice(Math.round(el.scrollLeft / el.clientWidth));
  };

  const portada = tarjeta.portadaUrl ? { backgroundImage: `url("${tarjeta.portadaUrl}")` } : undefined;
  // La foto de la persona es lo primero que se baja (antes que el resto de la página), y la portada detrás.
  if (tarjeta.fotoUrl && !fotoRota) preload(tarjeta.fotoUrl, { as: "image", crossOrigin: "anonymous", fetchPriority: "high" });
  if (tarjeta.portadaUrl) preload(tarjeta.portadaUrl, { as: "image" });

  return (
    <div className="tj">
      <main className="card" id="app">
        <header className="cover" style={portada}>
          <div className="tj-barra">
            <button className="chip" type="button" onClick={compartir} aria-label={t.share}><IconoCompartir /></button>
            <button className="chip lang" type="button" onClick={cambiarIdioma} aria-label={t.langLabel}>
              <b className={lang === "es" ? "on" : ""}>ES</b><b className={lang === "en" ? "on" : ""}>EN</b>
            </button>
          </div>
          <img className="logo" src="/tarjetas/logo_white.png" alt={MARCA.nombre} />
        </header>

        <section className="who rise">
          <div className={`avatar${tarjeta.fotoUrl && !fotoRota ? "" : " mono"}`}>
            {/* Las iniciales están debajo: se ven mientras llega la foto, y si no hay foto o no carga, se quedan. */}
            <span className="initials">{iniciales(tarjeta.nombre)}</span>
            {tarjeta.fotoUrl && !fotoRota && (
              // eslint-disable-next-line @next/next/no-img-element
              <img ref={fotoRef} src={tarjeta.fotoUrl} alt={tarjeta.nombre} width={140} height={140}
                crossOrigin="anonymous" loading="eager" fetchPriority="high" decoding="async"
                onError={() => setFotoRota(true)} />
            )}
          </div>
          <h1>{tarjeta.nombre}</h1>
          <div className="role">{rol}</div>
          <div className="store">
            <IconoPin />{MARCA.nombre}{tienda ? ` · ${tienda.ciudad}` : " · Rio Grande Valley"}
          </div>
        </section>

        <nav className="quick rise" style={{ animationDelay: ".06s" }}>
          {linkLlamar && <a className="q" href={linkLlamar}><IconoTelefono />{t.call}</a>}
          {linkWa && <a className="q" href={linkWa} target="_blank" rel="noopener noreferrer"><IconoWa />{t.whatsapp}</a>}
          {linkSms && <a className="q" href={linkSms}><IconoMensaje />{t.text}</a>}
          {linkMail && <a className="q" href={linkMail}><IconoCorreo />{t.email}</a>}
        </nav>

        {lineaTienda && (
          <a className="storeline rise" href={enlaceLlamar(lineaTienda) ?? undefined} style={{ animationDelay: ".09s" }}>
            <span className="sl-ic"><IconoTelefono /></span>
            <span className="sl-tx"><strong>{t.storeLine}</strong><small>{tienda?.ciudad ?? ""} · {HORARIO[lang]}</small></span>
            <span className="sl-call">{t.call}</span>
          </a>
        )}

        <button className="save rise" type="button" onClick={guardarContacto} style={{ animationDelay: ".1s" }}>
          <IconoGuardar />{t.save}
        </button>

        {tienda && (
          <section className="sec rise" style={{ animationDelay: ".14s" }}>
            <div className="label">{t.rate}</div>
            <a className="review" href={enlaceDeResena(tienda)} target="_blank" rel="noopener noreferrer">
              <span className="g"><IconoEstrella /></span>
              <span><strong>{t.reviewT}</strong><small>{t.reviewS}</small><span className="stars">{[0, 1, 2, 3, 4].map((k) => <IconoEstrella key={k} />)}</span></span>
              <IconoFlecha />
            </a>
          </section>
        )}

        {tienda && (
          <section className="sec rise" style={{ animationDelay: ".18s" }}>
            <div className="label">{t.showroom}</div>
            <div className="showroom">
              {fotos.length > 0 && (
                <div className="slider">
                  <div className="slides" ref={slidesRef} onScroll={alDesplazar}>
                    {fotos.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt={`Showroom ${tienda.ciudad} ${i + 1}`} loading={i ? "lazy" : "eager"} />
                    ))}
                  </div>
                  {fotos.length > 1 && (
                    <>
                      <span className="count">{indice + 1} / {fotos.length}</span>
                      <button className="nav prev" type="button" onClick={() => irA(Math.max(0, indice - 1))} aria-label={t.prev}><IconoIzquierda /></button>
                      <button className="nav next" type="button" onClick={() => irA(Math.min(fotos.length - 1, indice + 1))} aria-label={t.next}><IconoDerecha /></button>
                      <div className="dots">{fotos.map((_, i) => <i key={i} className={i === indice ? "on" : ""} />)}</div>
                    </>
                  )}
                </div>
              )}
              <div className="info">
                <h3>{tienda.ciudad}</h3>
                <p>{tienda.direccion}</p>
                <div className="hours">{HORARIO[lang]}</div>
              </div>
              <div className="btns">
                <a href={enlaceDeMapa(tienda)} target="_blank" rel="noopener noreferrer"><IconoNavegar />{t.directions}</a>
                <a href={enlaceHttps(MARCA.web) ?? undefined} target="_blank" rel="noopener noreferrer"><IconoGlobo />{t.visit}</a>
              </div>
            </div>
          </section>
        )}

        {VIDEO && (
          <section className="sec rise" style={{ animationDelay: ".22s" }}>
            <div className="label">{t.video}</div>
            {videoAbierto ? (
              <div className="video playing">
                <iframe src={`https://www.youtube.com/embed/${VIDEO}?autoplay=1&playsinline=1&rel=0`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title="YouTube" />
              </div>
            ) : (
              <div className="video" role="button" tabIndex={0} aria-label={t.play}
                style={{ backgroundImage: `url(https://i.ytimg.com/vi/${VIDEO}/maxresdefault.jpg)` }}
                onClick={() => setVideoAbierto(true)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setVideoAbierto(true); } }}>
                <span className="play"><IconoPlay /></span>
                <span className="cap"><IconoYoutube />{t.play}</span>
              </div>
            )}
            <a className="ytlink" href={`https://www.youtube.com/watch?v=${VIDEO}`} target="_blank" rel="noopener noreferrer">
              <IconoYoutube />{t.watch} ↗
            </a>
          </section>
        )}

        <section className="sec rise" style={{ animationDelay: ".26s" }}>
          <div className="follow">
            <h2>{t.followT}</h2>
            <p>{t.followS}</p>
            <div className="socials">
              {MARCA.facebook && <a href={MARCA.facebook} target="_blank" rel="noopener noreferrer"><IconoFacebook />Facebook</a>}
              {MARCA.instagram && <a href={MARCA.instagram} target="_blank" rel="noopener noreferrer"><IconoInstagram />Instagram</a>}
              {MARCA.tiktok && <a href={MARCA.tiktok} target="_blank" rel="noopener noreferrer"><IconoTiktok />TikTok</a>}
            </div>
          </div>
        </section>

        <section className="sec rise" style={{ animationDelay: ".3s" }}>
          <div className="label">{t.allStores}</div>
          <div className="stores">
            {(Object.keys(TIENDAS) as ClaveDeTienda[]).map((clave) => (
              <a key={clave} href={enlaceDeMapa(TIENDAS[clave])} target="_blank" rel="noopener noreferrer"
                className={clave === tarjeta.tienda ? "here" : ""}>
                <IconoPin />{TIENDAS[clave].ciudad}
              </a>
            ))}
          </div>
        </section>

        <footer>
          <img src="/tarjetas/logo_white.png" alt={MARCA.nombre} />
          <p>{t.footer}</p>
        </footer>
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status">{toast ?? ""}</div>
    </div>
  );
}

/** El teléfono en formato vCard: «+1…» tal cual, validado antes en `contacto`. */
function telefonoParaVcard(texto: string): string {
  return texto.replace(/[^\d+]/g, "");
}

/** La foto ya cargada, recortada al centro a 400 px y en base64 (JPEG). Si el navegador no la deja leer, sin foto. */
function fotoComoJpeg(img: HTMLImageElement | null): string | null {
  if (!img || !img.complete || !img.naturalWidth) return null;
  try {
    const c = document.createElement("canvas");
    const s = 400;
    c.width = s;
    c.height = s;
    const r = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext("2d")?.drawImage(img, (img.naturalWidth - r) / 2, (img.naturalHeight - r) / 2, r, r, 0, 0, s, s);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1] ?? null;
  } catch {
    return null;
  }
}

// ---- iconos (los del original, sin cambios) ----
const Svg = ({ children, ...p }: { children: ReactNode } & SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>
);
function IconoTelefono() { return <Svg><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></Svg>; }
function IconoWa() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.7 11.7 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z" /></svg>; }
function IconoMensaje() { return <Svg><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>; }
function IconoCorreo() { return <Svg><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></Svg>; }
function IconoGuardar() { return <Svg strokeWidth={2}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></Svg>; }
function IconoEstrella() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>; }
function IconoPin() { return <Svg strokeWidth={2}><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></Svg>; }
function IconoNavegar() { return <Svg strokeWidth={2}><path d="m3 11 19-9-9 19-2-8z" /></Svg>; }
function IconoGlobo() { return <Svg><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Svg>; }
function IconoFlecha() { return <Svg strokeWidth={2} className="arrow"><path d="m9 18 6-6-6-6" /></Svg>; }
function IconoIzquierda() { return <Svg strokeWidth={2.2}><path d="m15 18-6-6 6-6" /></Svg>; }
function IconoDerecha() { return <Svg strokeWidth={2.2}><path d="m9 18 6-6-6-6" /></Svg>; }
function IconoCompartir() { return <Svg width={16} height={16}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" /></Svg>; }
function IconoPlay() { return <svg viewBox="0 0 24 24" fill="#0e0e0e" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>; }
function IconoYoutube() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9l5.8 3.1z" /></svg>; }
function IconoFacebook() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 8h3V4h-3a5 5 0 0 0-5 5v2H7v4h2v9h4v-9h3l1-4h-4V9a1 1 0 0 1 1-1z" /></svg>; }
function IconoInstagram() { return <Svg strokeWidth={1.8}><rect x="2.5" y="2.5" width="19" height="19" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.6" cy="6.4" r="1" fill="currentColor" stroke="none" /></Svg>; }
function IconoTiktok() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2-2.8V9.1a6.3 6.3 0 1 0 5.4 6.3V8.6a7.9 7.9 0 0 0 4.4 1.4V6.6A4.4 4.4 0 0 1 16.6 2z" /></svg>; }
