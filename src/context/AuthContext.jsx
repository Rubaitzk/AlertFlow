import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, onUnauthorized, connectWebSocket, disconnectWebSocket } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState({
    registrationEnabled: true,
    passwordMinLength: 12,
  });

  // Verify active session on mount
  const checkSession = useCallback(async () => {
    try {
      const [meResponse, configResponse] = await Promise.allSettled([
        api.getMe(),
        api.getAuthConfig(),
      ]);

      if (meResponse.status === 'fulfilled' && meResponse.value?.authenticated) {
        setUser(meResponse.value.user);
        connectWebSocket();
      } else {
        setUser(null);
        disconnectWebSocket();
      }

      if (configResponse.status === 'fulfilled') {
        setAuthConfig(configResponse.value);
      }
    } catch (err) {
      setUser(null);
      disconnectWebSocket();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();

    // Listen for unauthorized responses on protected API calls
    const unsubscribe = onUnauthorized(() => {
      setUser(null);
      disconnectWebSocket();
    });

    return () => {
      unsubscribe();
    };
  }, [checkSession]);

  const login = async (email, password) => {
    const res = await api.login({ email, password });
    if (res.success && res.user) {
      setUser(res.user);
      connectWebSocket();
      return res.user;
    }
    throw new Error(res.error || 'Login failed');
  };

  const register = async (name, email, password) => {
    const res = await api.register({ name, email, password });
    if (res.success && res.user) {
      setUser(res.user);
      connectWebSocket();
      return res.user;
    }
    throw new Error(res.error || 'Registration failed');
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.warn('[Auth] Logout API warning:', err.message);
    } finally {
      setUser(null);
      disconnectWebSocket();
    }
  };

  const refreshUser = async () => {
    try {
      const res = await api.getMe();
      if (res.authenticated) {
        setUser(res.user);
      }
    } catch {}
  };

  const value = {
    user,
    loading,
    authConfig,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
