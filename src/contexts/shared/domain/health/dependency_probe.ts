import { ProbeResult } from './health_types';

export interface DependencyProbe {
  readonly name: string;
  readonly isCritical: boolean;
  readonly timeoutMs: number;
  check(): Promise<ProbeResult>;
}
