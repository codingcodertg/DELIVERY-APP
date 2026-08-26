/**
 * Shrink a camera photo before upload. Phone cameras produce 8–12 MB files;
 * on store wifi that upload can take a minute and looks like the app froze.
 * A 1280px JPEG is ~150–300 KB — plenty to verify a face or a dashboard — and
 * uploads in a second or two.
 *
 * Never throws: if anything about the resize fails we just return the original
 * file so a punch is never blocked by a compression problem.
 */
export async function compressImage(file: File, maxPx = 1280, quality = 0.7): Promise<Blob> {
  try {
    if (!file.type.startsWith("image/")) return file;
    // Hard ceiling on the whole resize. On low-end Android, createImageBitmap or
    // canvas.toBlob can simply never call back on a big photo — and with no
    // timeout that hung the punch forever with no error to show.
    return await Promise.race([
      resize(file, maxPx, quality),
      new Promise<Blob>((resolve) => setTimeout(() => resolve(file), 8000)),
    ]);
  } catch {
    return file;
  }
}

async function resize(file: File, maxPx: number, quality: number): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    // Only use the resized version if it actually helped.
    return blob && blob.size > 0 && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
