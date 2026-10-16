import crypto from "node:crypto";
import { createHttpError } from "./http.js";
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function preparePortalUpload(p) {
  if (
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 160 ||
    /[\x00-\x1f<>:"|?*\u202a-\u202e\u2066-\u2069/\\]/.test(p.name)
  )
    throw createHttpError(400, "Use a short file name without folders.");
  const extensions = {
    "image/png": /\.png$/i,
    "image/jpeg": /\.jpe?g$/i,
    "image/webp": /\.webp$/i,
    "application/pdf": /\.pdf$/i,
  };
  if (!extensions[p.mimeType]?.test(p.name))
    throw createHttpError(
      400,
      "Use a PNG, JPG, WebP or PDF with a matching file extension.",
    );
  if (
    typeof p.base64 !== "string" ||
    p.base64.length > 2800000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(p.base64)
  )
    throw createHttpError(413, "Choose a file up to 2 MB.");
  const bytes = Buffer.from(p.base64, "base64");
  const valid = {
    "image/png": bytes
      .subarray(0, 8)
      .equals(Buffer.from("89504e470d0a1a0a", "hex")),
    "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    "image/webp":
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP",
    "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
  };
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || !valid[p.mimeType])
    throw createHttpError(
      400,
      "Use a valid PNG, JPG, WebP or PDF file, up to 2 MB.",
    );
  return {
    bytes,
    sha: digest(bytes),
    id: crypto.randomUUID(),
    key: crypto.randomBytes(32).toString("hex"),
  };
}
