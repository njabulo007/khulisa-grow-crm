import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), signIn: vi.fn(), setDoc: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('./apiClient', () => ({ authenticatedPost: mocks.post }));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mocks.signIn, createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(), onAuthStateChanged: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), doc: vi.fn(), getDocs: vi.fn(), setDoc: mocks.setDoc }));
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
