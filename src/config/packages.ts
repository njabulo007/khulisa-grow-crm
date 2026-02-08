export interface KhulisaPackage {
  id: string;
  name: string;
  description: string;
  price: number;
  features: string[];
  includesAdSpend?: boolean;
  outcome: string;
}

export const KHULISA_PACKAGES = [
  {
    id: 'digital-starter-presence',
    name: 'Digital Starter Presence',
    description: 'Basic professional online presence.',
    price: 1500,
    features: [
      '1-page website / landing page',
      'Google My Business setup (Basic)',
      'Basic branding refresh (logo touch-up if needed)',
      'WhatsApp button',
      '1 flyer / promo graphic',
    ],
    outcome: 'Your business exists online and looks legitimate.',
  },
  {
    id: 'local-growth-engine',
    name: 'Local Growth Engine (Most Popular)',
    description: 'Strong local visibility + credibility.',
    price: 3500,
    features: [
      '4-5 page website',
      'Full Google My Business optimisation',
      'Local SEO setup',
      'Facebook page refresh or setup',
      'Product/Business photography (image optimisation)',
      'Contact forms + WhatsApp integration',
      'Professional email activation (yourname@yourbusiness.co.za)',
    ],
    outcome: 'Customers can find you, trust you, and contact you.',
  },
  {
    id: 'business-brand-expansion',
    name: 'Business Brand Expansion (Premium)',
    description:
      'Growth through visibility + advertising. Includes everything in Local Growth Engine plus paid ads.',
    price: 6500,
    features: [
      'Everything in Local Growth Engine',
      'Paid Facebook ads management',
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
