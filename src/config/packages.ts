export interface KhulisaPackage {
  id: string;
  name: string;
  tagline: string;
  description: string;
  listPrice?: number;
  price: number;
  features: string[];
  featureLeadIn?: string;
  extendsPackageId?: string;
  includesAdSpend?: boolean;
  isMostPopular?: boolean;
  outcome: string;
}

export const KHULISA_PACKAGES = [
  {
    id: 'digital-starter-presence',
    name: 'Digital Starter Presence',
    tagline: 'Affordable branding for survival-stage businesses',
    description: 'Affordable branding for survival-stage businesses.',
    listPrice: 1800,
    price: 1500,
    features: [
      '1 page website or landing page',
      'Google My Business setup (Basic)',
      'Basic branding refresh (logo touch-up if needed)',
      'WhatsApp button for direct enquiries',
      '1 flyer or promo graphic',
    ],
    outcome: 'Your business exists online and looks legitimate.',
  },
  {
    id: 'local-growth-engine',
    name: 'Local Growth Engine',
    tagline: 'Visibility + credibility + enquiries',
    description: 'Visibility + credibility + enquiries.',
    listPrice: 4000,
    price: 3500,
    isMostPopular: true,
    features: [
      '4-5 page website',
      'Full Google My Business optimisation',
      'Local SEO setup',
      'Facebook page refresh or setup',
      'Product/Business Photography - Image Optimisation',
      'Contact forms & WhatsApp integration',
      'Professional Email Activation - yourname@yourbusiness.co.za',
    ],
    outcome: 'Customers can find you, trust you, and contact you.',
  },
  {
    id: 'business-brand-expansion',
    name: 'Business Brand Expansion (Premium)',
    tagline: 'Growth through visibility + advertising',
    description: 'Growth through visibility + advertising.',
    listPrice: 7500,
    price: 6500,
    featureLeadIn: 'Local Growth Engine plus:',
    extendsPackageId: 'local-growth-engine',
    features: [
      'Paid Facebook advertising management',
      'R1,500 ad spend included',
      'Campaign setup, targeting, and optimisation',
      'Conversion tracking & performance summary',
    ],
    includesAdSpend: true,
    outcome: 'Your business is actively promoted to new customers.',
  },
] as const satisfies readonly KhulisaPackage[];

export type PackageId = (typeof KHULISA_PACKAGES)[number]['id'];
export type PackageName = (typeof KHULISA_PACKAGES)[number]['name'];

export const DEFAULT_PACKAGE_ID: PackageId = KHULISA_PACKAGES[0].id;

export const getPackageById = (id: string | null | undefined) =>
  KHULISA_PACKAGES.find((pkg) => pkg.id === id);

export const getPackageNameById = (id: string | null | undefined): string =>
  getPackageById(id)?.name || 'Unlinked';

export const getPackageLineage = (id: string | null | undefined): KhulisaPackage[] => {
  const visited = new Set<string>();
  const lineage: KhulisaPackage[] = [];
  let cursor = getPackageById(id);

  while (cursor && !visited.has(cursor.id)) {
    lineage.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.extendsPackageId ? getPackageById(cursor.extendsPackageId) : undefined;
  }

  return lineage;
};

export const getPackageCombinedFeatures = (id: string | null | undefined): string[] => {
  const seen = new Set<string>();
  const combined: string[] = [];
  getPackageLineage(id).forEach((pkg) => {
    pkg.features.forEach((feature) => {
      const key = feature.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      combined.push(feature);
    });
  });
  return combined;
};

const LEGACY_PACKAGE_NAME_TO_ID: Record<string, PackageId> = {
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

export const resolvePackageId = (value: string | null | undefined): PackageId => {
  if (!value) return DEFAULT_PACKAGE_ID;
  const byId = KHULISA_PACKAGES.find((pkg) => pkg.id === value);
  if (byId) return byId.id;

  const normalized = value.trim().toLowerCase();
  const byName = KHULISA_PACKAGES.find((pkg) => pkg.name.toLowerCase() === normalized);
  if (byName) return byName.id;
  const mappedLegacy = LEGACY_PACKAGE_NAME_TO_ID[normalized];
  if (mappedLegacy) return mappedLegacy;

  return DEFAULT_PACKAGE_ID;
};
