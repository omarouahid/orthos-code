import type { AppConfig } from '../types/index.js';
import type { LLMProvider } from '../core/providers/types.js';
import { createProvider, getProviderDisplayName } from '../core/providers/index.js';

export interface PreflightResult {
  /** When set, provider health check failed — app should still launch and show hint to use /provider. */
  initialProviderUnhealthy?: string;
}

/**
 * Runs provider connectivity check. Never throws; on failure returns
 * initialProviderUnhealthy so the app can launch and let the user switch/configure.
 */
export async function checkProviderPreflight(
  config: AppConfig,
  providerFactory: (cfg: AppConfig) => LLMProvider = createProvider
): Promise<PreflightResult> {
  try {
    const provider = providerFactory(config);
    const healthy = await provider.checkHealth();
    if (!healthy) {
      return { initialProviderUnhealthy: getProviderDisplayName(config.provider) };
    }
    return {};
  } catch {
    return { initialProviderUnhealthy: getProviderDisplayName(config.provider) };
  }
}
