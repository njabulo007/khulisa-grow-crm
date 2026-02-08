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

  const upsertUserFromFirebase = React.useCallback(
    (payload: { email: string | null; displayName: string | null; role: UserRole }): User | null => {
      if (!payload.email) return null;

      const normalizedEmail = payload.email.trim().toLowerCase();
      const existing = authService
        .getAll()
        .find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
      if (existing) {
        const nextName =
          payload.displayName ||
          existing.name ||
          normalizedEmail.split('@')[0] ||
          'User';
        const updates: Partial<User> = {
          name: nextName,
          role: payload.role,
          isActive: true,
        };
        const updated = authService.update(existing.id, updates) || existing;
        authService.setCurrentUser(updated.id);
        return updated;
      }

      const created = authService.create({
        email: normalizedEmail,
        name: payload.displayName || normalizedEmail.split('@')[0] || 'User',
        role: payload.role,
        isActive: true,
        commissionRate: payload.role === 'owner' ? 0 : 15,
      });
      authService.setCurrentUser(created.id);
      return created;
    },
    []
  );

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
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        role: firebaseUser.role,
      });
      setUser(mapped);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [upsertUserFromFirebase]);

  const login = async (email: string, password: string): Promise<void> => {
    const firebaseUser = await AuthService.loginWithPassword(email, password);
    const mapped = upsertUserFromFirebase({
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      role: firebaseUser.role,
    });
    if (!mapped) {
      throw new Error('Authenticated user has no valid email.');
    }
    setUser(mapped);
  };

  const signup = async (email: string, password: string, displayName?: string): Promise<void> => {
    const firebaseUser = await AuthService.signupWithPassword(email, password, displayName);
    const mapped = upsertUserFromFirebase({
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      role: firebaseUser.role,
    });
    if (!mapped) {
      throw new Error('Registered user has no valid email.');
    }
    setUser(mapped);
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
