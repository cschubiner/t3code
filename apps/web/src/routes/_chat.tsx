import { ThreadId } from "@t3tools/contracts";
import { Outlet, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import ThreadSidebar from "../components/Sidebar";
import { useThreadNavigationHistoryStore } from "../threadNavigationHistoryStore";
import { Sidebar, SidebarProvider } from "~/components/ui/sidebar";

function ThreadNavigationHistoryTracker() {
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const recordVisit = useThreadNavigationHistoryStore((store) => store.recordVisit);

  useEffect(() => {
    if (!routeThreadId) return;
    recordVisit(routeThreadId);
  }, [recordVisit, routeThreadId]);

  return null;
}

function ChatRouteLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen>
      <ThreadNavigationHistoryTracker />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
      >
        <ThreadSidebar />
      </Sidebar>
      <DiffWorkerPoolProvider>
        <Outlet />
      </DiffWorkerPoolProvider>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
