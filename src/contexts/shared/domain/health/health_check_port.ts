import { DependencyProbe } from './dependency_probe';
import { HealthReport } from './health_types';

export interface HealthCheckPort {
  registerProbe(probe: DependencyProbe): void;
  checkLiveness(): Promise<HealthReport>;
  checkReadiness(): Promise<HealthReport>;
  checkHealth(): Promise<HealthReport>;
}
