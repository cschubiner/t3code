import type { ServerProvider } from "@t3tools/contracts";
import { Effect, PubSub, Ref, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { makeManagedServerProvider } from "./makeManagedServerProvider";

const codexSnapshot = (authType: "apiKey" | "chatgpt"): ServerProvider => ({
  provider: "codex",
  enabled: true,
  installed: true,
  status: "ready",
  version: "1.0.0",
  checkedAt: "2026-04-07T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  auth: {
    status: "authenticated",
    type: authType,
    label: authType === "apiKey" ? "OpenAI API Key" : "ChatGPT Pro Subscription",
  },
});

describe("makeManagedServerProvider", () => {
  it("runs the manual refresh hook before recomputing the provider snapshot", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const settingsRef = yield* Ref.make({ enabled: true });
          const authTypeRef = yield* Ref.make<"apiKey" | "chatgpt">("apiKey");
          const refreshCountRef = yield* Ref.make(0);
          const changes = yield* PubSub.unbounded<{ enabled: boolean }>();

          const provider = yield* makeManagedServerProvider({
            getSettings: Ref.get(settingsRef),
            streamSettings: Stream.fromPubSub(changes),
            haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
            initialSnapshot: () => codexSnapshot("apiKey"),
            checkProvider: Ref.get(authTypeRef).pipe(Effect.map(codexSnapshot)),
            beforeRefresh: Ref.update(refreshCountRef, (count) => count + 1).pipe(
              Effect.flatMap(() => Ref.set(authTypeRef, "chatgpt")),
            ),
          });

          const initial = yield* provider.getSnapshot;
          const refreshed = yield* provider.refresh;
          const refreshCount = yield* Ref.get(refreshCountRef);

          expect(initial.auth.type).toBe("apiKey");
          expect(refreshed.auth.type).toBe("chatgpt");
          expect(refreshCount).toBe(1);
        }),
      ),
    );
  });
});
