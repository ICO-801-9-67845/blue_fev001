import { createContext, useEffect, useState } from "react";
import { loginRequest, meRequest, registerRequest } from "../api/authApi";

export const AuthContext = createContext(null);

const TOKEN_KEY = "blue_fev_token";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      setLoading(false);
      return;
    }

    meRequest()
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function login(values) {
    const result = await loginRequest(values);
    localStorage.setItem(TOKEN_KEY, result.token);
    setUser(result.user);
    return result;
  }

  async function register(values) {
    const result = await registerRequest(values);
    localStorage.setItem(TOKEN_KEY, result.token);
    setUser(result.user);
    return result;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    isAuthenticated: Boolean(user),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
