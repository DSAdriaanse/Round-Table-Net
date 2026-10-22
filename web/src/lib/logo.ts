// Rules for the group logo uploaded in Settings. Pure so Node can test it (logo.test.mjs).
// The size limit is for sharpness, not storage: the sidebar is at most 256 CSS pixels wide, so
// 512 pixels is still crisp on a 2x screen.

export const MAX_LOGO_PX = 512;
export const MAX_LOGO_BYTES = 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** An explanation of what is wrong with the picked file, or "" when it can be uploaded. */
export function logoProblem(file: { type: string; size: number }, width: number, height: number): string {
  if (!LOGO_TYPES.includes(file.type)) return "Use a PNG, JPG or WebP image. A PNG with a transparent background works well.";
  if (file.size > MAX_LOGO_BYTES) return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The most allowed is ${MAX_LOGO_BYTES / 1024 / 1024} MB.`;
  if (!(width > 0 && height > 0)) return "That image could not be read.";
  if (width > MAX_LOGO_PX || height > MAX_LOGO_PX) return `That image is ${width} x ${height} pixels. The most allowed is ${MAX_LOGO_PX} x ${MAX_LOGO_PX}.`;
  return "";
}
