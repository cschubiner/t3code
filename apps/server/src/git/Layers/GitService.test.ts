import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { GitCommandError } from "../Errors.ts";
import { GitServiceLive } from "./GitService.ts";
import { GitService } from "../Services/GitService.ts";

const layer = it.layer(Layer.provideMerge(GitServiceLive, NodeServices.layer));

layer("GitServiceLive", (it) => {
  it.effect("runGit executes successful git commands", () =>
    Effect.gen(function* () {
      const gitService = yield* GitService;
      const result = yield* gitService.execute({
        operation: "GitProcess.test.version",
        cwd: process.cwd(),
        args: ["--version"],
      });

      assert.equal(result.code, 0);
      assert.ok(result.stdout.toLowerCase().includes("git version"));
    }),
  );

  it.effect("runGit can return non-zero exit codes when allowed", () =>
    Effect.gen(function* () {
      const gitService = yield* GitService;
      const result = yield* gitService.execute({
        operation: "GitProcess.test.allowNonZero",
        cwd: process.cwd(),
        args: ["rev-parse", "--verify", "__definitely_missing_ref__"],
        allowNonZeroExit: true,
      });

      assert.notEqual(result.code, 0);
    }),
  );

  it.effect("runGit fails with GitCommandError when non-zero exits are not allowed", () =>
    Effect.gen(function* () {
      const gitService = yield* GitService;
      const result = yield* Effect.result(
        gitService.execute({
          operation: "GitProcess.test.failOnNonZero",
          cwd: process.cwd(),
          args: ["rev-parse", "--verify", "__definitely_missing_ref__"],
        }),
      );

      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.ok(Schema.is(GitCommandError)(result.failure));
        assert.equal(result.failure.operation, "GitProcess.test.failOnNonZero");
        assert.equal(result.failure.command, "git rev-parse --verify __definitely_missing_ref__");
      }
    }),
  );

  it.effect("runGit terminates timed out git aliases instead of leaking child processes", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") {
        return;
      }

      const gitService = yield* GitService;
      const tempDir = mkdtempSync(join(tmpdir(), "git-service-timeout-"));
      const pidFile = join(tempDir, "sleep.pid");
      const slowAlias = `!sh -c 'echo $$ > "$0"; trap "exit 0" TERM INT; sleep 30' '${pidFile}'`;

      try {
        const result = yield* Effect.result(
          gitService.execute({
            operation: "GitProcess.test.timeoutCleanup",
            cwd: process.cwd(),
            args: ["slow"],
            timeoutMs: 500,
            env: {
              ...process.env,
              GIT_CONFIG_COUNT: "1",
              GIT_CONFIG_KEY_0: "alias.slow",
              GIT_CONFIG_VALUE_0: slowAlias,
            },
          }),
        );

        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.ok(Schema.is(GitCommandError)(result.failure));
          assert.equal(result.failure.operation, "GitProcess.test.timeoutCleanup");
          assert.ok(result.failure.detail.includes("timed out"));
        }

        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 150);
            }),
        );

        for (let attempts = 0; attempts < 10 && !existsSync(pidFile); attempts += 1) {
          yield* Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                setTimeout(resolve, 50);
              }),
          );
        }

        assert.ok(existsSync(pidFile), "expected timed-out alias to record a pid before cleanup");
        const pid = Number(readFileSync(pidFile, "utf8").trim());
        assert.ok(Number.isInteger(pid));
        assert.throws(() => process.kill(pid, 0));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );
});
