import crypto from "node:crypto";
import { put, del, head } from "@vercel/blob";
import { createHttpError } from "./http.js";

export function createRequestAttachmentStorage({
  putBlob = put,
  deleteBlob = del,
  headBlob = head,
  fetchBlob = fetch,
  configured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
} = {}) {
  const check = (file) => {
    if (
      !/^client-requests\/[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\.enc$/.test(
        file.path,
      ) ||
      !/^[a-f0-9]{64}$/.test(file.key)
    )
      throw createHttpError(400, "Invalid attachment reference.");
    if (!configured())
      throw createHttpError(
        503,
        "Request attachments need the existing Blob storage connection.",
      );
  };
  return {
    async upload(file, bytes) {
      check(file);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        Buffer.from(file.key, "hex"),
        iv,
      );
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
      await putBlob(
        file.path,
        Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/octet-stream",
          abortSignal: AbortSignal.timeout(15000),
          cacheControlMaxAge: 60,
        },
      );
    },
    async download(file) {
      check(file);
      const blob = await headBlob(file.path);
      if (blob.size > 2 * 1024 * 1024 + 28)
        throw createHttpError(413, "Attachment too large.");
      const url = new URL(blob.url);
      if (
        url.protocol !== "https:" ||
        !url.hostname.endsWith(".public.blob.vercel-storage.com")
      )
        throw createHttpError(502, "Attachment storage unavailable.");
      const response = await fetchBlob(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw createHttpError(502, "Attachment could not be downloaded.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 28 || bytes.length > 2 * 1024 * 1024 + 28)
        throw createHttpError(502, "Invalid attachment.");
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        Buffer.from(file.key, "hex"),
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]);
    },
    async remove(file) {
      check(file);
      await deleteBlob(file.path);
    },
  };
}
export const requestAttachmentStorage = createRequestAttachmentStorage();
