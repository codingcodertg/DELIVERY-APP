import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extensionDe, nombreDelCv, nombreSeguro } from "./nombre-del-cv";

// D-NEXT · «quiero que todos los resume que suba al cv part upload ahi automaticamente se rename al nombre del
// candidato + resume» (el dueño, 2026-10-19).

describe("nombreDelCv: nombre del candidato + resume + la extensión del fichero", () => {
  it("«Ana Pérez resume.pdf»: el nombre limpio, el sufijo en inglés como lo pidió, la extensión en minúsculas", () => {
    expect(nombreDelCv("  Ana   Pérez ", "Resume_final (2).PDF")).toBe("Ana Pérez resume.pdf");
    expect(nombreDelCv("Juan López", "cv.docx")).toBe("Juan López resume.docx");
  });
  it("sin extensión, sin punto; sin nombre de candidato, el fichero se queda con el suyo", () => {
    expect(nombreDelCv("Ana Pérez", "curriculum")).toBe("Ana Pérez resume");
    expect(nombreDelCv("", "cv.pdf")).toBe("cv.pdf");
    expect(nombreDelCv(null, "cv.pdf")).toBe("cv.pdf");
    expect(nombreDelCv("   ", "cv.pdf")).toBe("cv.pdf");
  });
  it("la extensión: la última, corta y alfanumérica", () => {
    expect(extensionDe("a.b.PDF")).toBe("pdf");
    expect(extensionDe("sin")).toBe("");
    expect(extensionDe("raro.tar.gz ")).toBe("gz");
    expect(extensionDe("punto.")).toBe("");
  });
  it("la ruta del bucket: sin acentos ni espacios, como la limpieza de siempre", () => {
    expect(nombreSeguro("Ana Pérez resume.pdf")).toBe("Ana_Perez_resume.pdf");
    expect(nombreSeguro("José Ñ.pdf")).toBe("Jose_N.pdf");
  });
});

describe("el proveedor renombra al subir, en los tres caminos (fila/ficha, alta, aplicó de nuevo)", () => {
  const prov = readFileSync("src/lib/recruiting-data-provider.tsx", "utf8").split("\r\n").join("\n");
  const modal = readFileSync("src/components/recruiting/ModalHost.tsx", "utf8").split("\r\n").join("\n");
  it("el nombre guardado y la ruta salen de `nombreDelCv`; el nombre del candidato viene de quien llama o de la lista", () => {
    expect(prov).toContain("uploadResume: (candidateId: string, file: File, candidateName?: string) => Promise<void>;");
    expect(prov).toContain("const nombre = nombreDelCv(candidateName ?? candidates.find((c) => c.id === candidateId)?.name, file.name);");
    expect(prov).toContain("const path = `${candidateId}/${Date.now()}_${nombreSeguro(nombre)}`;");
    expect(prov).toContain("await updateCandidate(candidateId, { resume_path: path, resume_name: nombre, resume_passed: true });");
    expect(prov).not.toContain("resume_name: file.name");
  });
  it("al dar de alta y al «aplicó de nuevo» el candidato aún no está en la lista: se pasa su nombre", () => {
    expect(modal).toContain("if (created && resume) await uploadResume(created.id, resume, created.name);");
    expect(modal).toContain("if (resume) await uploadResume(dup.id, resume, dup.name);");
  });
});
