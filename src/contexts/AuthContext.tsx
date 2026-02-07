// Khulisa CRM - Auth Context
// TODO: Replace with Firebase Auth

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types/models';
import { userStore, initializeStore } from '@/store/mockStore';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isOwner: boolean;
  isAgent: boolean;
  login: (userId: string) => void;
  logout: () => void;
  switchRole: () => void; // For demo purposes
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initialize store and load current user
    initializeStore();
    const currentUser = userStore.getCurrentUser();
    setUser(currentUser);
    setIsLoading(false);
  }, []);

  const login = (userId: string) => {
    userStore.setCurrentUser(userId);
    const currentUser = userStore.getById(userId);
    setUser(currentUser || null);
  };

  const logout = () => {
    // TODO: Implement Firebase logout
    // For now, we'll just clear the current user display
    console.log('Logout clicked - in production this would sign out');
  };

  const switchRole = () => {
    // Demo function to switch between owner and agent
    const users = userStore.getAll();
    const currentIndex = users.findIndex(u => u.id === user?.id);
    const nextUser = users[(currentIndex + 1) % users.length];
    login(nextUser.id);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
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
