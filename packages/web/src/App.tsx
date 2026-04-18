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
import { CopilotPage } from "./pages/Copilot";
import { TaskDetailPage } from "./pages/TaskDetail";
import { SettingsPage } from "./pages/Settings";
import { KnowledgeBasePage } from "./pages/KnowledgeBase";
import { InboxPage } from "./pages/Inbox";
import { ActionsPage } from "./pages/Actions";
import { AgentsPage } from "./pages/Agents";
import { WorkflowsPage } from "./pages/Workflows";
import { WorkflowDetailPage } from "./pages/WorkflowDetail";
import { WorkflowRunDetailPage } from "./pages/WorkflowRunDetail";
import { WorkflowEditorPage } from "./pages/WorkflowEditor";
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
        <Route path="copilot" element={<CopilotPage />} />
        <Route path="copilot/:sessionId" element={<CopilotPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="knowledge" element={<KnowledgeBasePage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="workflows/:id" element={<WorkflowDetailPage />} />
        <Route path="workflows/:id/edit" element={<WorkflowEditorPage />} />
        <Route path="workflows/:id/runs/:runId" element={<WorkflowRunDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/:tab" element={<SettingsPage />} />
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
