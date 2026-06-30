import type { ResolvedOpenDynamicWorkflowConfig } from "../config/types.js";

export interface ProviderHealth {
  provider: string;
  ok: boolean;
  message: string;
  defaultModel?: string | null;
  supportsModelSelection?: boolean;
}

export interface DoctorResult {
  ok: boolean;
  providers: ProviderHealth[];
}

export interface ProviderHealthChecker {
  checkAll(config: ResolvedOpenDynamicWorkflowConfig): Promise<DoctorResult>;
}
