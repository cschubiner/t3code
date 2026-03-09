import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTailscaleRemoteAccessHelpers } from "./tailscale";

describe("tailscale remote access helpers", () => {
  const runCommand = vi.fn<(args: readonly string[]) => Promise<string>>();
  const { setupPrivateTailscaleServe, clearPrivateTailscaleServe } =
    createTailscaleRemoteAccessHelpers(runCommand);

  beforeEach(() => {
    runCommand.mockReset();
  });

  it("reports unavailable when tailscale is not running", async () => {
    runCommand.mockImplementation(async (args) => {
      expect(args).toEqual(["status", "--json"]);
      return JSON.stringify({ BackendState: "Stopped" });
    });

    await expect(setupPrivateTailscaleServe(3810)).resolves.toEqual({
      kind: "unavailable",
      message: "Tailscale is installed but not connected.",
    });
  });

  it("configures all reserved ports when tailscale is ready", async () => {
    const calls: string[][] = [];
    runCommand.mockImplementation(async (args) => {
      calls.push([...args]);
      if (args[0] === "status") {
        return JSON.stringify({
          BackendState: "Running",
          Self: {
            DNSName: "macbookpro.tail744884.ts.net.",
          },
        });
      }

      return "";
    });

    await expect(setupPrivateTailscaleServe(3810)).resolves.toEqual({
      kind: "ready",
      preferredOrigin: "https://macbookpro.tail744884.ts.net:8444",
      origins: [
        "https://macbookpro.tail744884.ts.net:8443",
        "https://macbookpro.tail744884.ts.net:8444",
        "https://macbookpro.tail744884.ts.net:8445",
        "https://macbookpro.tail744884.ts.net:8446",
      ],
    });

    expect(calls).toEqual([
      ["status", "--json"],
      ["serve", "--bg", "--https=8443", "http://127.0.0.1:3810"],
      ["serve", "--bg", "--https=8444", "http://127.0.0.1:3810"],
      ["serve", "--bg", "--https=8445", "http://127.0.0.1:3810"],
      ["serve", "--bg", "--https=8446", "http://127.0.0.1:3810"],
    ]);
  });

  it("clears the reserved ports without failing when a port is missing", async () => {
    const calls: string[][] = [];
    runCommand.mockImplementation(async (args) => {
      calls.push([...args]);
      if (args[2] === "8445") {
        throw new Error("missing");
      }
      return "";
    });

    await expect(clearPrivateTailscaleServe()).resolves.toBeUndefined();
    expect(calls).toEqual([
      ["serve", "clear", "8443"],
      ["serve", "clear", "8444"],
      ["serve", "clear", "8445"],
      ["serve", "clear", "8446"],
    ]);
  });
});
