/**
 * TurnQueueReactor - Durable queued-turn reaction service interface.
 *
 * Owns background workers that promote server-owned queued follow-ups into
 * normal orchestration turn-start commands when a thread becomes dispatchable.
 *
 * @module TurnQueueReactor
 */
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface TurnQueueReactorShape {
  /**
   * Start reacting to queued-turn orchestration state changes.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class TurnQueueReactor extends ServiceMap.Service<TurnQueueReactor, TurnQueueReactorShape>()(
  "t3/orchestration/Services/TurnQueueReactor",
) {}
