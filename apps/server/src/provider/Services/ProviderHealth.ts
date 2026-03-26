/**
 * ProviderHealth - compatibility snapshot service.
 *
 * Kept as a thin alias over the provider registry so existing transport/tests
 * that still depend on the older service name continue to typecheck while the
 * runtime uses ProviderRegistry.
 */
import type { ServerProviderStatus } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ProviderHealthShape {
  readonly getStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;
}

export class ProviderHealth extends ServiceMap.Service<ProviderHealth, ProviderHealthShape>()(
  "t3/provider/Services/ProviderHealth",
) {}
