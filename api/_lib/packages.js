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
