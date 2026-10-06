import { describe, expect, it } from 'vitest';
import { canAccessLead, canAccessProject, getAgentLinkedClientIds } from './permissions';
import type { Client, Lead, Project, User } from '@/types/models';

describe('approved legacy identities', () => {
  const user = { id: 'legacy-agent', uid: 'firebase-agent', role: 'agent' } as User;
  it('allows both UID assignments and approved legacy assignments, rejecting another agent', () => {
    for (const assignedTo of [user.id, user.uid]) {
      expect(canAccessLead(user, { assignedTo } as Lead)).toBe(true);
      expect(canAccessProject(user, { assignedTo } as Project)).toBe(true);
    }
    expect(canAccessLead(user, { assignedTo: 'other-agent' } as Lead)).toBe(false);
    expect(canAccessProject(user, { assignedTo: 'other-agent' } as Project)).toBe(false);
  });
  it('collects clients linked through either assignment key', () => {
    const leads = [{ id: 'lead-1', assignedTo: user.uid }] as Lead[];
    const clients = [{ id: 'client-1', leadId: 'lead-1' }] as Client[];
    const projects = [{ clientId: 'client-2', assignedTo: user.id }, { clientId: 'other', assignedTo: 'other-agent' }] as Project[];
    expect([...getAgentLinkedClientIds(user.id, leads, clients, projects, user.uid)].sort()).toEqual(['client-1', 'client-2']);
  });
});
