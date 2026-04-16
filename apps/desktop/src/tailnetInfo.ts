/**
 * Minimal Tailscale-network-awareness helper.
 *
 * The desktop app can optionally surface the machine's Tailnet DNS name and
 * IPv4 in the UI so users can copy a "reach this install from elsewhere on
 * my tailnet" URL without running the full `tailscale serve` proxy. If the
 * user has already set serverExposureMode to "network-accessible", the
 * backend is already listening on the Tailnet interface and this URL will
 * Just Work.
 *
 * Keeps the heavier {@link ./tailscale.ts} (tailscale serve orchestration)
 * untouched — that is still available for a future full-lifecycle port.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TAILSCALE_COMMAND = "tailscale";

export interface TailnetInfo {
  readonly available: boolean;
  readonly connected: boolean;
  readonly hostname: string | null;
  readonly ipv4: string | null;
  readonly error: string | null;
}

const UNAVAILABLE: TailnetInfo = {
  available: false,
  connected: false,
  hostname: null,
  ipv4: null,
  error: null,
};

function normalizeDnsName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function pickIpv4(ips: readonly string[] | undefined): string | null {
  if (!ips || ips.length === 0) return null;
  for (const ip of ips) {
    if (ip.includes(".") && !ip.includes(":")) return ip;
  }
  return null;
}

interface TailscaleStatus {
  readonly BackendState?: string;
  readonly Self?: {
    readonly DNSName?: string;
    readonly Online?: boolean;
    readonly TailscaleIPs?: readonly string[];
  };
}

/**
 * Probe the locally-installed `tailscale` binary for the machine's tailnet
 * identity. Never throws — callers always get a well-formed TailnetInfo.
 */
export async function readTailnetInfo(
  runCommand: (args: readonly string[]) => Promise<string> = runTailscale,
): Promise<TailnetInfo> {
  let raw: string;
  try {
    raw = await runCommand(["status", "--json"]);
  } catch (cause) {
    if (isCommandNotFound(cause)) {
      return UNAVAILABLE;
    }
    return {
      available: true,
      connected: false,
      hostname: null,
      ipv4: null,
      error: `tailscale status failed: ${String(cause)}`,
    };
  }

  let parsed: TailscaleStatus;
  try {
    parsed = JSON.parse(raw) as TailscaleStatus;
  } catch (cause) {
    return {
      available: true,
      connected: false,
      hostname: null,
      ipv4: null,
      error: `tailscale status returned unparseable JSON: ${String(cause)}`,
    };
  }

  const connected =
    parsed.BackendState === "Running" ||
    Boolean(parsed.Self?.Online && (parsed.Self.TailscaleIPs?.length ?? 0) > 0);

  return {
    available: true,
    connected,
    hostname: normalizeDnsName(parsed.Self?.DNSName),
    ipv4: pickIpv4(parsed.Self?.TailscaleIPs),
    error: null,
  };
}

async function runTailscale(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(TAILSCALE_COMMAND, [...args], {
    timeout: 5_000,
  });
  return stdout;
}

function isCommandNotFound(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const message = String((cause as { message?: unknown }).message ?? "");
  if (/ENOENT|not found|no such file/i.test(message)) return true;
  const code = (cause as { code?: unknown }).code;
  return code === "ENOENT";
}
