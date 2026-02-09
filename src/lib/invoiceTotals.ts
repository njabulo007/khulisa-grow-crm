import { getPackageById } from '@/config/packages';
import { Invoice, Project } from '@/types/models';

type ProjectLookup = Map<string, Project>;

const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const getInvoiceItemsSubtotal = (invoice: Invoice): number => {
  const itemsSubtotal = invoice.items.reduce((sum, item) => sum + item.total, 0);
  if (itemsSubtotal > 0) return roundCurrency(itemsSubtotal);
  return roundCurrency(invoice.subtotal);
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
): { subtotal: number; total: number; fromPackagePrice: boolean } => {
  const packageSubtotal = getPackageSubtotal(invoice, projectLookup);
  if (packageSubtotal === null) {
    const subtotal = getInvoiceItemsSubtotal(invoice);
    return {
      subtotal,
      total: subtotal,
      fromPackagePrice: false,
    };
  }

  const subtotal = roundCurrency(packageSubtotal);

  return {
    subtotal,
    total: subtotal,
    fromPackagePrice: true,
  };
};
