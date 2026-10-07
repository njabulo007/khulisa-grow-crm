import { describe, expect, it } from 'vitest';
import { getAgentPerformance } from './agentPerformance';
import type { Client, Invoice, Lead, Project, User } from '@/types/models';

describe('consistent agent rankings', () => {
  const athi = { id: 'athi', uid: 'athi-uid', name: 'Athi', role: 'agent' } as User;
  const other = { id: 'other', uid: 'other-uid', name: 'Other', role: 'agent' } as User;
  it('puts Athi first for a won lead even when every agent has zero revenue', () => {
    const results = getAgentPerformance([other, athi], [{ id: 'won', assignedTo: athi.uid, stage: 'won' }] as Lead[], [], [], []);
    expect(results.map((agent) => [agent.name, agent.dealsWon])).toEqual([['Athi', 1], ['Other', 0]]);
  });
  it('excludes archived agents and deduplicates canonical identities', () => {
    const results = getAgentPerformance([athi, { ...athi, id: 'old-athi' }, { ...other, isActive: false }], [], [], [], []);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Athi');
  });
  it('attributes invoice revenue once to the project assignee, not also the lead assignee', () => {
    const leads = [{ id: 'lead', stage: 'won', assignedTo: athi.id }] as Lead[];
    const clients = [{ id: 'client', leadId: 'lead' }] as Client[];
    const projects = [{ id: 'project', clientId: 'client', assignedTo: other.uid }] as Project[];
    const invoices = [{ id: 'invoice', status: 'paid', clientId: 'client', projectId: 'project', subtotal: 200, items: [] }] as unknown as Invoice[];
    expect(getAgentPerformance([athi, other], leads, clients, projects, invoices).map((agent) => [agent.name, agent.revenue]))
      .toEqual([['Athi', 0], ['Other', 200]]);
  });
});
