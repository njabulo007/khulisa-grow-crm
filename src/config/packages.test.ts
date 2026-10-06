import { expect, it } from 'vitest';
import { KHULISA_PACKAGES, getPackageCombinedFeatures } from './packages';
// The Node endpoint cannot import TypeScript; detect drift between the two catalogs.
import { PACKAGE_CATALOG } from '../../api/_lib/packages.js';

it('keeps conversion prices and milestones aligned with the CRM package catalog', () => {
  expect(Object.keys(PACKAGE_CATALOG).sort()).toEqual(KHULISA_PACKAGES.map((pkg) => pkg.id).sort());
  for (const pkg of KHULISA_PACKAGES) {
    expect(PACKAGE_CATALOG[pkg.id]).toEqual({ name: pkg.name, price: pkg.price, features: getPackageCombinedFeatures(pkg.id) });
  }
});
