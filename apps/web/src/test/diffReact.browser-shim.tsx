import type { ComponentProps, ReactNode } from "react";

export function WorkerPoolContextProvider({
  children,
}: {
  children?: ReactNode;
  poolOptions?: unknown;
  highlighterOptions?: unknown;
}) {
  return <>{children}</>;
}

export function useWorkerPool() {
  return null;
}

export function Virtualizer({ children }: { children?: ComponentProps<"div">["children"] }) {
  return <>{children}</>;
}

export function FileDiff() {
  return null;
}
