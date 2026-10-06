// Cleanup uses all persisted paths, including old entries beyond the UI limit.
// Invalid or failed entries stay discoverable instead of silently disappearing.
export async function cleanupPortalFiles(media, { deleteBlob, deleteFirebase }) {
  if (!Array.isArray(media)) return { requested: 1, deleted: 0, failed: 1, failedEntries: [media] };
  const outcomes = new Map();
  const failedEntries = [];
  let deleted = 0;
  for (const entry of media) {
    const path = typeof entry?.storagePath === 'string' ? entry.storagePath.trim() : '';
    if (!path || path.startsWith('/') || path.startsWith('\\') || path.includes('..')) {
      failedEntries.push(entry); continue;
    }
    if (!outcomes.has(path)) {
      try {
        if (path.startsWith('vercel-blob:')) {
          const url = new URL(path.slice('vercel-blob:'.length));
          if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.vercel-storage.com')) throw new Error('Invalid Blob URL');
          await deleteBlob(url.toString());
        } else await deleteFirebase(path);
        outcomes.set(path, true); deleted += 1;
      } catch { outcomes.set(path, false); }
    }
    if (!outcomes.get(path)) failedEntries.push(entry);
  }
  return { requested: media.length, deleted, failed: failedEntries.length, failedEntries };
}

export async function revokeAndCleanupShare({ shareRef, shareData, shareUpdateTime, revokedBy, now, deleteFiles }) {
  const precondition = shareUpdateTime ? { lastUpdateTime: shareUpdateTime } : undefined;
  const result = await shareRef.update({
    status: 'revoked', revokedAt: now, revokedBy, updatedAt: now,
  }, ...(precondition ? [precondition] : []));
  const deletion = await deleteFiles(shareData?.media || []);
  const unchanged = result?.writeTime ? { lastUpdateTime: result.writeTime } : undefined;
  if (deletion.failed) {
    await shareRef.update({
      media: deletion.failedEntries, mediaDeleteFailures: deletion.failed, updatedAt: now,
    }, ...(unchanged ? [unchanged] : []));
  } else await shareRef.delete(...(unchanged ? [unchanged] : []));
  return deletion;
}
