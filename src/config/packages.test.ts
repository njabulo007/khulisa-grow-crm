import { expect, it } from 'vitest';
import { KHULISA_PACKAGES, getPackageCombinedFeatures, resolvePackageId } from './packages';
// The Node endpoint cannot import TypeScript; detect drift between the two catalogs.
import { PACKAGE_CATALOG, resolveServerPackageId } from '../../api/_lib/packages.js';

it('keeps conversion prices and milestones aligned with the CRM package catalog', () => {
  expect(Object.keys(PACKAGE_CATALOG).sort()).toEqual(KHULISA_PACKAGES.map((pkg) => pkg.id).sort());
  for (const pkg of KHULISA_PACKAGES) {
    expect(PACKAGE_CATALOG[pkg.id]).toEqual({ name: pkg.name, price: pkg.price, features: getPackageCombinedFeatures(pkg.id) });
  }
});

it('keeps server reminder totals aligned with legacy project package normalization', () => {
  for (const value of [undefined, null, '', 'unknown', 'Basic Website', 'SEO Package', 'Google My Business Setup', 'E-commerce Website', 'Social Media Setup', 'Social Media Management', 'Facebook Ads', 'Google Ads', 'Photography', 'Graphic Design', 'Monthly Retainer', 'Custom Package', 'Local Growth Engine (Most Popular)', 'Business Brand Expansion Premium', ...KHULISA_PACKAGES.flatMap(pkg => [pkg.id, pkg.name])]) {
    expect(resolveServerPackageId(value)).toBe(resolvePackageId(value));
  }
});
