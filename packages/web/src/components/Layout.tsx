import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { CommandBar } from "./CommandBar";

export function Layout() {
  const location = useLocation();
  const isCopilotPage = location.pathname.startsWith("/copilot");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Outlet />
        {!isCopilotPage && <CommandBar />}
      </main>
    </div>
  );
}
