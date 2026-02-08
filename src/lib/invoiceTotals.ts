import { getPackageById } from '@/config/packages';
import { Invoice, Project } from '@/types/models';

type ProjectLookup = Map<string, Project>;

const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const getInvoiceTaxRate = (invoice: Invoice): number => {
  if (invoice.subtotal > 0) return invoice.tax / invoice.subtotal;
  const itemSubtotal = invoice.items.reduce((sum, item) => sum + item.total, 0);
  if (itemSubtotal > 0) return invoice.tax / itemSubtotal;
  return 0;
};

const getPackageSubtotal = (invoice: Invoice, projectLookup: ProjectLookup): number | null => {
  if (!invoice.projectId) return null;
  const project = projectLookup.get(invoice.projectId);
  if (!project) return null;
  const pkg = getPackageById(project.packageId);
  return pkg?.price ?? null;
};

export const buildProjectLookup = (projects: Project[]): ProjectLookup =>
  new Map(projects.map((project) => [project.id, project]));

export const getInvoiceEffectiveTotals = (
  invoice: Invoice,
  projectLookup: ProjectLookup,
): { subtotal: number; tax: number; total: number; fromPackagePrice: boolean } => {
  const packageSubtotal = getPackageSubtotal(invoice, projectLookup);
  if (packageSubtotal === null) {
    return {
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      fromPackagePrice: false,
    };
  }

  const taxRate = getInvoiceTaxRate(invoice);
  const subtotal = roundCurrency(packageSubtotal);
  const tax = roundCurrency(subtotal * taxRate);
  const total = roundCurrency(subtotal + tax);

  return {
    subtotal,
    tax,
    total,
    fromPackagePrice: true,
  };
};
