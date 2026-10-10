// Khulisa CRM - Auth Context

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  getDefaultCommissionRatePercentForAgent,
  isSpecialCommissionAgentEmail,
} from '@/config/commission';
import { User, UserRole } from '@/types/models';
import { authService, AuthService } from '@/services/authService';
import { seedAppData } from '@/seed';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  isOwner: boolean;
  isAgent: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

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

      if (existing && existing.id !== payload.id) authService.remove(existing.id);
      if (existing && existing.id === payload.id) {
        const nextCommissionRate =
          payload.role === 'owner'
            ? 0
            : isSpecialCommissionAgentEmail(normalizedEmail)
              ? getDefaultCommissionRatePercentForAgent(normalizedEmail)
              : typeof existing.commissionRate === 'number'
                ? existing.commissionRate
                : getDefaultCommissionRatePercentForAgent(normalizedEmail);

        const updates: Partial<User> = {
          uid: payload.uid,
          name: nextName,
          role: payload.role,
          isActive: true,
          commissionRate: nextCommissionRate,
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
        uid: payload.uid,
        email: normalizedEmail,
        name: nextName,
        role: payload.role,
        isActive: true,
        commissionRate:
          payload.role === 'owner'
            ? 0
            : getDefaultCommissionRatePercentForAgent(normalizedEmail),
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

      const profileIds = new Set(profiles.map((profile) => profile.id));
      authService.getAll().forEach((cached) => {
        if (!profileIds.has(cached.id)) authService.remove(cached.id);
      });

      profiles.forEach((profile) => {
        const normalizedEmail = profile.email.trim().toLowerCase();
        const allUsers = authService.getAll();
        const existingByEmail = allUsers.find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
        const targetId = profile.id;
        const existingByTargetId = authService.getById(targetId);
        const nextName =
          profile.displayName ||
          existingByTargetId?.name ||
          existingByEmail?.name ||
          normalizedEmail.split('@')[0] ||
          'User';
        const defaultCommissionRate =
          profile.role === 'owner'
            ? 0
            : getDefaultCommissionRatePercentForAgent(normalizedEmail);
        const existingCommissionRate =
          profile.commissionRate ?? existingByTargetId?.commissionRate ??
          existingByEmail?.commissionRate;
        const nextCommissionRate =
          profile.role === 'owner'
            ? 0
            : existingCommissionRate ?? defaultCommissionRate;

        if (existingByTargetId) {
          authService.update(existingByTargetId.id, {
            uid: profile.uid,
            email: normalizedEmail,
            name: nextName,
            role: profile.role,
            isActive: profile.isActive,
            commissionRate: nextCommissionRate,
          });
        } else {
          authService.create({
            id: targetId,
            uid: profile.uid,
            email: normalizedEmail,
            name: nextName,
            role: profile.role,
            isActive: profile.isActive,
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

      setAuthError(null);
      const mapped = upsertUserFromFirebase({
        id: firebaseUser.id,
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        role: firebaseUser.role,
      });
      setUser(mapped);
      setIsLoading(false);
      if (mapped?.role === 'owner') {
        void syncUsersFromFirebaseProfiles().then(() => {
          refreshCurrentUserFromCache();
        });
      }
    }, setAuthError);

    return unsubscribe;
  }, [refreshCurrentUserFromCache, syncUsersFromFirebaseProfiles, upsertUserFromFirebase]);

  const login = async (email: string, password: string): Promise<void> => {
    setAuthError(null);
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
    if (mapped.role === 'owner') {
      await syncUsersFromFirebaseProfiles();
      refreshCurrentUserFromCache();
    }
  };

  const logout = () => {
    AuthService.logout().catch(() => undefined);
    authService.clearCurrentUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        authError,
        isOwner: user?.role === 'owner',
        isAgent: user?.role === 'agent',
        login,
        logout,
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
