import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { createRequestAttachmentStorage } from "../api/_lib/requestAttachmentStorage.js";
function fixture() {
  const state = { bytes: null, deleted: null };
  const files = createRequestAttachmentStorage({
    configured: () => true,
    putBlob: async (path, bytes, options) => {
      state.bytes = Buffer.from(bytes);
      state.options = options;
    },
    headBlob: async () => ({
      size: state.bytes.length,
      url: "https://test.public.blob.vercel-storage.com/file.enc",
    }),
    fetchBlob: async () => ({ ok: true, arrayBuffer: async () => state.bytes }),
    deleteBlob: async (path) => {
      state.deleted = path;
    },
  });
  return {
    ...state,
    files,
    state,
    file: {
      path: `client-requests/request-1/${crypto.randomUUID()}.enc`,
      key: crypto.randomBytes(32).toString("hex"),
    },
  };
}
test("public Blob stores authenticated ciphertext; authorized adapter round-trips plaintext and deletes by saved path", async () => {
  const f = fixture();
  const content = Buffer.from("Confidential client content");
  await f.files.upload(f.file, content);
  assert(!f.state.bytes.includes(content));
  assert.equal(f.state.bytes.length, content.length + 28);
  assert.equal(f.state.options.access, "public");
  assert.equal(f.state.options.contentType, "application/octet-stream");
  assert.deepEqual(await f.files.download(f.file), content);
  await f.files.remove(f.file);
  assert.equal(f.state.deleted, f.file.path);
});
test("wrong keys, tampering and unsafe storage references cannot return plaintext", async () => {
  const f = fixture();
  await f.files.upload(f.file, Buffer.from("client"));
  await assert.rejects(() =>
    f.files.download({
      ...f.file,
      key: crypto.randomBytes(32).toString("hex"),
    }),
  );
  f.state.bytes[28] ^= 1;
  await assert.rejects(() => f.files.download(f.file));
  await assert.rejects(() =>
    f.files.upload(
      { ...f.file, path: "../private/file" },
      Buffer.from("client"),
    ),
  );
});
