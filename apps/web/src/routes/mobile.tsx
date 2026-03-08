import { createFileRoute } from "@tanstack/react-router";

import MobileSessionBrowser from "../components/MobileSessionBrowser";

function MobileRouteView() {
  return <MobileSessionBrowser />;
}

export const Route = createFileRoute("/mobile")({
  component: MobileRouteView,
});
