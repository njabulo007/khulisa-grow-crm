export type DraftOverrides = Record<string, { subject: string; body: string }>;
export function applyDraftOverride(
  defaultDraft: { subject: string; body: string },
  override: { subject: string; body: string } | undefined,
  values: Record<string, string>,
) {
  if (!override?.body.trim()) return defaultDraft;
  const render = (input: string) =>
    input.replace(
      /\{([A-Za-z]+)\}/g,
      (all, key) => values[key] ?? `[Add ${key}]`,
    );
  return {
    subject: override.subject.trim()
      ? render(override.subject)
      : defaultDraft.subject,
    body: render(override.body),
  };
}
