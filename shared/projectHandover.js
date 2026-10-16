// Additive project field. Missing data never implies that support was purchased.
export const emptyHandover = () => ({
  published: false,
  websiteUrl: "",
  instructions: "",
  outstanding: "",
  supportScope: "",
  supportUntil: "",
  version: 0,
  publishedAt: null,
  updatedAt: null,
});
export function handoverFields(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Please complete the handover form before saving.");
  const result = emptyHandover();
  for (const [key, max] of Object.entries({
    websiteUrl: 1000,
    instructions: 6000,
    outstanding: 3000,
    supportScope: 3000,
    supportUntil: 10,
  })) {
    if (typeof value[key] !== "string" || value[key].length > max)
      throw new Error(
        "Please check the handover details and shorten any long answers.",
      );
    result[key] = value[key].trim();
  }
  if (result.websiteUrl) {
    let url;
    try {
      url = new URL(result.websiteUrl);
    } catch {
      throw new Error("Enter a complete website link starting with https://.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Use an https:// website link without login details.");
    result.websiteUrl = url.href;
  }
  if (
    result.supportUntil &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(result.supportUntil) ||
      !Number.isFinite(Date.parse(result.supportUntil + "T00:00:00Z")) ||
      new Date(result.supportUntil + "T00:00:00Z")
        .toISOString()
        .slice(0, 10) !== result.supportUntil)
  )
    throw new Error("Choose a valid support end date.");
  if (result.supportUntil && !result.supportScope)
    throw new Error("Describe the agreed support before adding its end date.");
  if (typeof value.published !== "boolean")
    throw new Error("Choose whether to share this handover with the client.");
  result.published = value.published;
  if (result.published && !result.instructions)
    throw new Error(
      "Add instructions for the client before sharing the handover.",
    );
  return result;
}
export function handoverView(value, staff = false) {
  if (!value || (!staff && value.published !== true)) return emptyHandover();
  try {
    return {
      ...handoverFields(value),
      version: Number.isSafeInteger(value.version) ? value.version : 0,
      publishedAt:
        typeof value.publishedAt === "string" ? value.publishedAt : null,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    };
  } catch {
    return emptyHandover();
  }
}
