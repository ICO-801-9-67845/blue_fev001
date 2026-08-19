import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";
import ChatPage from "../pages/ChatPage";
import SchedulePage from "../pages/SchedulePage";
import FocusPage from "../pages/FocusPage";
import CvBuilderPage from "../pages/CvBuilderPage";
import ToolsLayout from "../components/ToolsLayout";

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="app-shell-centered">Cargando...</div>;
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="app-shell-centered">Cargando...</div>;
  }

  return isAuthenticated ? <Navigate to="/chat" replace /> : children;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tools"
        element={
          <ProtectedRoute>
            <ToolsLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/tools/schedule" replace />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="focus" element={<FocusPage />} />
        <Route path="cv" element={<CvBuilderPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
