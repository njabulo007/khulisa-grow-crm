import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), setDoc: vi.fn(), getDocs: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('./apiClient', () => ({ authenticatedPost: mocks.post }));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mocks.signIn, createUserWithEmailAndPassword: vi.fn(),
  signOut: mocks.signOut, onAuthStateChanged: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), doc: vi.fn(), getDocs: mocks.getDocs, setDoc: mocks.setDoc }));
vi.mock('./storage', () => ({
  LocalStorageCollection: class {}, STORAGE_KEYS: {}, generateId: vi.fn(), getTimestamp: vi.fn(),
  readStoredValue: vi.fn(), removeStoredValue: vi.fn(), writeStoredValue: vi.fn(),
}));
import { AuthService } from './authService';

describe('owner recovery at sign-in', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const firebaseUser = () => ({
    uid: 'owner-uid', email: 'owner@example.com', displayName: 'Owner',
    getIdToken: vi.fn().mockResolvedValue('refreshed-token'),
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'owner', appUserId: 'owner-uid' } }),
  });

  it('recovers the server role and refreshes claims before entering the CRM', async () => {
    const user = firebaseUser();
    mocks.signIn.mockResolvedValue({ user });
    mocks.post.mockResolvedValue({ uid: user.uid, role: 'owner', appUserId: user.uid, displayName: 'Owner' });
    await expect(AuthService.loginWithPassword(user.email, 'password')).resolves.toMatchObject({ role: 'owner', id: user.uid });
    expect(mocks.post).toHaveBeenCalledWith('/api/auth/ensure-role', {}, user);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('creates invitations through the owner endpoint without signing the owner out', async () => {
    mocks.post.mockResolvedValue({ email: 'new@example.com', setupLink: 'private-link', uid: 'new' });
    await expect(AuthService.inviteAgent(' NEW@example.com ', ' New Agent ')).resolves.toMatchObject({ setupLink: 'private-link' });
    expect(mocks.post).toHaveBeenCalledWith('/api/auth/ensure-role', { action: 'invite', email: 'new@example.com', displayName: 'New Agent' });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(AuthService).not.toHaveProperty('signupWithPassword');
  });

  it('shows a recovery failure instead of silently assigning the agent role', async () => {
    mocks.signIn.mockResolvedValue({ user: firebaseUser() });
    mocks.post.mockRejectedValue(new Error('Check the Vercel Firebase Admin configuration.'));
    await expect(AuthService.loginWithPassword('owner@example.com', 'password')).rejects.toThrow('Check the Vercel Firebase Admin configuration.');
  });

  it('rejects a server role that does not match refreshed Firebase claims', async () => {
    mocks.signIn.mockResolvedValue({ user: firebaseUser() });
    mocks.post.mockResolvedValue({ uid: 'owner-uid', role: 'agent', appUserId: 'owner-uid' });
    await expect(AuthService.loginWithPassword('owner@example.com', 'password')).rejects.toThrow('role could not be synchronized');
  });
});

describe('canonical agent roster', () => {
  it('prefers the UID profile over legacy duplicates and retains archived status', async () => {
    const profile = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
    mocks.getDocs.mockResolvedValue({ docs: [
      profile('legacy-doc', { uid: 'athi-uid', email: 'athi@example.com', role: 'agent', displayName: 'Duplicate', isActive: true }),
      profile('athi-uid', { uid: 'athi-uid', appUserId: 'athi', email: 'athi@example.com', role: 'agent', displayName: 'Athi', isActive: false }),
    ] });
    await expect(AuthService.listUserProfiles()).resolves.toMatchObject([
      { id: 'athi', uid: 'athi-uid', email: 'athi@example.com', role: 'agent', displayName: 'Athi', isActive: false, hasAppUserId: true },
    ]);
  });
});
