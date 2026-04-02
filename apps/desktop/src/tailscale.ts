import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REMOTE_ACCESS_PORTS = [8443, 8444, 8445, 8446] as const;
const PREFERRED_REMOTE_ACCESS_PORT = 8444;
const TAILSCALE_COMMAND = "tailscale";

interface TailscaleStatusResponse {
  readonly BackendState?: string;
  readonly Self?: {
    readonly DNSName?: string;
    readonly Online?: boolean;
    readonly TailscaleIPs?: readonly string[];
  };
}

export interface TailscaleRemoteAccessSetup {
  readonly preferredOrigin: string;
  readonly origins: readonly string[];
}

export interface TailscaleRemoteAccessUnavailable {
  readonly kind: "unavailable";
  readonly message: string;
}

export interface TailscaleRemoteAccessReady extends TailscaleRemoteAccessSetup {
  readonly kind: "ready";
}

export type TailscaleRemoteAccessResult =
  | TailscaleRemoteAccessReady
  | TailscaleRemoteAccessUnavailable;

function normalizeDnsName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function isConnectedToTailnet(status: TailscaleStatusResponse): boolean {
  if (status.BackendState === "Running") {
    return true;
  }

  return (
    status.Self?.Online === true &&
    Array.isArray(status.Self.TailscaleIPs) &&
    status.Self.TailscaleIPs.length > 0
  );
}

async function runTailscale(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(TAILSCALE_COMMAND, [...args], {
    timeout: 10_000,
  });
  return stdout;
}

export function createTailscaleRemoteAccessHelpers(
  runCommand: (args: readonly string[]) => Promise<string> = runTailscale,
) {
  const setupPrivateTailscaleServe = async (
    backendPort: number,
  ): Promise<TailscaleRemoteAccessResult> => {
    let status: TailscaleStatusResponse;
    try {
      status = JSON.parse(await runCommand(["status", "--json"])) as TailscaleStatusResponse;
    } catch {
      return {
        kind: "unavailable",
        message: "Tailscale CLI is unavailable or not responding.",
      };
    }

    if (!isConnectedToTailnet(status)) {
      return {
        kind: "unavailable",
        message: "Tailscale is installed but not connected.",
      };
    }

    const dnsName = normalizeDnsName(status.Self?.DNSName);
    if (!dnsName) {
      return {
        kind: "unavailable",
        message: "Tailscale did not report a usable tailnet DNS name.",
      };
    }

    for (const externalPort of REMOTE_ACCESS_PORTS) {
      await runCommand([
        "serve",
        "--bg",
        `--https=${externalPort}`,
        `http://127.0.0.1:${backendPort}`,
      ]);
    }

    const origins = REMOTE_ACCESS_PORTS.map(
      (externalPort) => `https://${dnsName}:${externalPort}`,
    );
    const preferredOrigin =
      origins.find((origin) => origin.endsWith(`:${PREFERRED_REMOTE_ACCESS_PORT}`)) ??
      origins[0]!;

    return {
      kind: "ready",
      preferredOrigin,
      origins,
    };
  };

  const clearPrivateTailscaleServe = async (): Promise<void> => {
    await Promise.all(
      REMOTE_ACCESS_PORTS.map(async (externalPort) => {
        try {
          await runCommand(["serve", "clear", String(externalPort)]);
        } catch {
          // Clearing a missing port should be best-effort only.
        }
      }),
    );
  };

  return {
    setupPrivateTailscaleServe,
    clearPrivateTailscaleServe,
  };
}

export const { setupPrivateTailscaleServe, clearPrivateTailscaleServe } =
  createTailscaleRemoteAccessHelpers();
