import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function MobileRouteView() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return (
    <div className="flex h-screen items-center justify-center bg-background px-6 text-sm text-muted-foreground">
      Redirecting to your live sessions...
    </div>
  );
}

export const Route = createFileRoute("/mobile")({
  component: MobileRouteView,
});
