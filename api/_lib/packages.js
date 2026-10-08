const growthFeatures = [
  '4-5 page website', 'Full Google My Business optimisation', 'Local SEO setup',
  'Facebook page refresh or setup', 'Product/Business Photography - Image Optimisation',
  'Contact forms & WhatsApp integration', 'Professional Email Activation - yourname@yourbusiness.co.za',
];
export const PACKAGE_CATALOG = {
  'digital-starter-presence': { name: 'Digital Starter Presence', price: 1500, features: [
    '1 page website or landing page', 'Google My Business setup (Basic)',
    'Basic branding refresh (logo touch-up if needed)', 'WhatsApp button for direct enquiries', '1 flyer or promo graphic',
  ] },
  'local-growth-engine': { name: 'Local Growth Engine', price: 3500, features: growthFeatures },
  'business-brand-expansion': { name: 'Business Brand Expansion (Premium)', price: 6500, features: [
    ...growthFeatures, 'Paid Facebook advertising management', 'R1,500 ad spend included',
    'Campaign setup, targeting, and optimisation', 'Conversion tracking & performance summary',
  ] },
};

const LEGACY_PACKAGE_NAME_TO_ID = {
  'basic website': 'digital-starter-presence',
  'e-commerce website': 'local-growth-engine',
  'seo package': 'local-growth-engine',
  'google my business setup': 'local-growth-engine',
  'social media setup': 'digital-starter-presence',
  'social media management': 'local-growth-engine',
  'facebook ads': 'business-brand-expansion',
  'google ads': 'business-brand-expansion',
  photography: 'local-growth-engine',
  'graphic design': 'digital-starter-presence',
  'monthly retainer': 'business-brand-expansion',
  'custom package': 'local-growth-engine',
  'local growth engine (most popular)': 'local-growth-engine',
  'business brand expansion premium': 'business-brand-expansion',
};

export function resolveServerPackageId(value) {
  const fallback = 'digital-starter-presence';
  if (typeof value !== 'string' || !value) return fallback;
  if (Object.hasOwn(PACKAGE_CATALOG, value)) return value;
  const normalized = value.trim().toLowerCase();
  const byName = Object.entries(PACKAGE_CATALOG).find(([, pkg]) => pkg.name.toLowerCase() === normalized);
  if (byName) return byName[0];
  return Object.hasOwn(LEGACY_PACKAGE_NAME_TO_ID, normalized) ? LEGACY_PACKAGE_NAME_TO_ID[normalized] : fallback;
}
