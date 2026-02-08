// Khulisa CRM - Auth Context
// TODO: Replace bootstrap/login/logout internals with Firebase Auth:
// - onAuthStateChanged for session bootstrap
// - signInWithEmailAndPassword for login
// - signOut for logout

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, UserRole } from '@/types/models';
import { authService } from '@/services';
import { seedAppData } from '@/seed';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOwner: boolean;
  isAgent: boolean;
  login: (email: string, password: string) => boolean;
  logout: () => void;
  switchRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Seed first-load local data and load current user
    seedAppData();
    const currentUser = authService.getCurrentUser();
    setUser(currentUser);
    setIsLoading(false);
  }, []);

  const login = (email: string, password: string): boolean => {
    const signedInUser = authService.loginWithPassword(email, password);
    setUser(signedInUser);
    return !!signedInUser;
  };

  const logout = () => {
    // TODO: Replace with Firebase signOut call.
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
