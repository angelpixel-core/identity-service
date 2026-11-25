import { KycLevel } from '../../../domain/entities/kyc_verification/entity';

export interface StartKycSessionInput {
  readonly userId: string;
  readonly tenantId: string;
  readonly level: KycLevel;
}

export interface StartKycSessionResult {
  readonly providerRef: string;
  readonly sessionUrl: string;
  readonly mode: 'deterministic_dev' | 'external_provider';
}

/**
 * Secondary Port (SPI): KycVerificationPort (US-37)
 * Delega la captura y prueba de vida biométrica a un proveedor externo o adaptador dev,
 * sin almacenar biometría en el identity-service.
 */
export interface KycVerificationPort {
  startVerificationSession(input: StartKycSessionInput): Promise<StartKycSessionResult>;
}
