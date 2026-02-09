// Khulisa CRM - Auth Context
// TODO: Replace bootstrap/login/logout internals with Firebase Auth:
// - onAuthStateChanged for session bootstrap
// - signInWithEmailAndPassword for login
// - signOut for logout

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, UserRole } from '@/types/models';
import { authService, AuthService } from '@/services/authService';
import { seedAppData } from '@/seed';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOwner: boolean;
  isAgent: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  switchRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCurrentUserFromCache = React.useCallback(() => {
    setUser((previous) => {
      if (!previous) return previous;

      const normalizedEmail = previous.email.trim().toLowerCase();
      const exactById = authService.getById(previous.id);
      const byEmail = authService
        .getAll()
        .find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
      const resolved = exactById || byEmail;
      if (!resolved) return previous;

      authService.setCurrentUser(resolved.id);
      return { ...resolved };
    });
  }, []);

  const upsertUserFromFirebase = React.useCallback(
    (payload: {
      id: string;
      uid: string;
      email: string | null;
      displayName: string | null;
      role: UserRole;
    }): User | null => {
      if (!payload.email) return null;

      const normalizedEmail = payload.email.trim().toLowerCase();
      const existing = authService
        .getAll()
        .find((candidate) => candidate.email.toLowerCase() === normalizedEmail);

      const nextName =
        payload.displayName ||
        existing?.name ||
        normalizedEmail.split('@')[0] ||
        'User';

      if (existing) {
        const updates: Partial<User> = {
          name: nextName,
          role: payload.role,
          isActive: true,
        };
        const updated = authService.update(existing.id, updates) || existing;
        authService.setCurrentUser(updated.id);
        void AuthService.ensureUserProfile({
          uid: payload.uid,
          email: normalizedEmail,
          displayName: nextName,
          role: payload.role,
          appUserId: updated.id,
        });
        return updated;
      }

      const created = authService.create({
        id: payload.id,
        email: normalizedEmail,
        name: nextName,
        role: payload.role,
        isActive: true,
        commissionRate: payload.role === 'owner' ? 0 : 15,
      });
      authService.setCurrentUser(created.id);
      void AuthService.ensureUserProfile({
        uid: payload.uid,
        email: normalizedEmail,
        displayName: nextName,
        role: payload.role,
        appUserId: created.id,
      });
      return created;
    },
    []
  );

  const syncUsersFromFirebaseProfiles = React.useCallback(async (): Promise<void> => {
    try {
      const profiles = await AuthService.listUserProfiles();
      if (profiles.length === 0) return;

      profiles.forEach((profile) => {
        const normalizedEmail = profile.email.trim().toLowerCase();
        const allUsers = authService.getAll();
        const existingByEmail = allUsers.find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
        const targetId =
          !profile.hasAppUserId && existingByEmail
            ? existingByEmail.id
            : profile.id;
        const existingByTargetId = authService.getById(targetId);
        const nextName =
          profile.displayName ||
          existingByTargetId?.name ||
          existingByEmail?.name ||
          normalizedEmail.split('@')[0] ||
          'User';
        const nextCommissionRate =
          existingByTargetId?.commissionRate ??
          existingByEmail?.commissionRate ??
          (profile.role === 'owner' ? 0 : 15);

        if (existingByTargetId) {
          authService.update(existingByTargetId.id, {
            email: normalizedEmail,
            name: nextName,
            role: profile.role,
            isActive: true,
            commissionRate: nextCommissionRate,
          });
        } else {
          authService.create({
            id: targetId,
            email: normalizedEmail,
            name: nextName,
            role: profile.role,
            isActive: true,
            commissionRate: nextCommissionRate,
          });
        }

        if (existingByEmail && existingByEmail.id !== targetId) {
          if (profile.hasAppUserId) {
            authService.remove(existingByEmail.id);
          } else {
            void AuthService.ensureUserProfile({
              uid: profile.uid,
              email: normalizedEmail,
              displayName: nextName,
              role: profile.role,
              appUserId: existingByEmail.id,
            });
          }
        }
      });
    } catch (error) {
      console.error('[AuthContext] Failed to synchronize users from Firestore profiles.', error);
    }
  }, []);

  useEffect(() => {
    seedAppData();

    const unsubscribe = AuthService.subscribeToAuthChanges((firebaseUser) => {
      if (!firebaseUser) {
        authService.clearCurrentUser();
        setUser(null);
        setIsLoading(false);
        return;
      }

      const mapped = upsertUserFromFirebase({
        id: firebaseUser.id,
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        role: firebaseUser.role,
      });
      setUser(mapped);
      setIsLoading(false);
      void syncUsersFromFirebaseProfiles().then(() => {
        refreshCurrentUserFromCache();
      });
    });

    return unsubscribe;
  }, [refreshCurrentUserFromCache, syncUsersFromFirebaseProfiles, upsertUserFromFirebase]);

  const login = async (email: string, password: string): Promise<void> => {
    const firebaseUser = await AuthService.loginWithPassword(email, password);
    const mapped = upsertUserFromFirebase({
      id: firebaseUser.id,
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      role: firebaseUser.role,
    });
    if (!mapped) {
      throw new Error('Authenticated user has no valid email.');
    }
    setUser(mapped);
    await syncUsersFromFirebaseProfiles();
    refreshCurrentUserFromCache();
  };

  const signup = async (email: string, password: string, displayName?: string): Promise<void> => {
    const firebaseUser = await AuthService.signupWithPassword(email, password, displayName);
    const mapped = upsertUserFromFirebase({
      id: firebaseUser.id,
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      role: firebaseUser.role,
    });
    if (!mapped) {
      throw new Error('Registered user has no valid email.');
    }
    setUser(mapped);
    await syncUsersFromFirebaseProfiles();
    refreshCurrentUserFromCache();
  };

  const logout = () => {
    AuthService.logout().catch(() => undefined);
    authService.clearCurrentUser();
    setUser(null);
  };

  const switchRole = (role: UserRole) => {
    if (!user) return;
    // Dev-only role switching. Persisted in localStorage for testing permissions.
    const switchedUser = authService.switchRole(role);
    setUser(switchedUser);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isOwner: user?.role === 'owner',
        isAgent: user?.role === 'agent',
        login,
        signup,
        logout,
        switchRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
