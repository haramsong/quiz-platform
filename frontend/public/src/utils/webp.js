// Convert image File/Blob to WebP via OffscreenCanvas/Canvas.
// Returns { blob, width, height }.
export async function toWebp(file, { maxWidth = 1200, quality = 0.82 } = {}) {
  const bmp = await createImageBitmap(file);
  let w = bmp.width, h = bmp.height;
  if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  return { blob, width: w, height: h };
}
