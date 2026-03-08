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
  };
}

export interface TailscaleRemoteAccessSetup {
  readonly preferredOrigin: string;
  readonly origins: readonly string[];
}

function normalizeDnsName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

async function runTailscale(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(TAILSCALE_COMMAND, [...args], {
    timeout: 10_000,
  });
  return stdout;
}

export async function setupPrivateTailscaleServe(
  backendPort: number,
): Promise<TailscaleRemoteAccessSetup | null> {
  let status: TailscaleStatusResponse;
  try {
    status = JSON.parse(await runTailscale(["status", "--json"])) as TailscaleStatusResponse;
  } catch {
    return null;
  }

  if (status.BackendState !== "Running") {
    return null;
  }

  const dnsName = normalizeDnsName(status.Self?.DNSName);
  if (!dnsName) {
    return null;
  }

  for (const externalPort of REMOTE_ACCESS_PORTS) {
    try {
      await runTailscale([
        "serve",
        "--bg",
        `--https=${externalPort}`,
        `http://127.0.0.1:${backendPort}`,
      ]);
    } catch {
      return null;
    }
  }

  const origins = REMOTE_ACCESS_PORTS.map((externalPort) => `https://${dnsName}:${externalPort}`);
  const preferredOrigin =
    origins.find((origin) => origin.endsWith(`:${PREFERRED_REMOTE_ACCESS_PORT}`)) ?? origins[0];

  if (!preferredOrigin) {
    return null;
  }

  return {
    preferredOrigin,
    origins,
  };
}
