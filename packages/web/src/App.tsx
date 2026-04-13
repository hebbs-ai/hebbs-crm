import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { BriefPage } from "./pages/Brief";
import { PipelinePage } from "./pages/Pipeline";
import { DealsPage } from "./pages/Deals";
import { ContactsPage } from "./pages/Contacts";
import { CompaniesPage } from "./pages/Companies";
import { ContactDetailPage } from "./pages/ContactDetail";
import { CompanyDetailPage } from "./pages/CompanyDetail";
import { DealDetailPage } from "./pages/DealDetail";
import { TasksPage } from "./pages/Tasks";
import { TaskDetailPage } from "./pages/TaskDetail";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";
import { SignupPage } from "./pages/Signup";
import type { ReactNode } from "react";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-text-secondary">Loading...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-text-secondary">Loading...</p>
      </div>
    );
  }

  if (user) return <Navigate to="/brief" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/brief" replace />} />
        <Route path="brief" element={<BriefPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="deals" element={<DealsPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="contacts/:id" element={<ContactDetailPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="companies/:id" element={<CompanyDetailPage />} />
        <Route path="deals/:id" element={<DealDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="settings/team" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/brief" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
