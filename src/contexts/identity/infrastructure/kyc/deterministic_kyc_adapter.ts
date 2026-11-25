import { randomUUID } from 'crypto';
import {
  KycVerificationPort,
  StartKycSessionInput,
  StartKycSessionResult,
} from '../../application/ports/kyc/kyc_verification_port';

/**
 * Secondary Adapter: DeterministicKycAdapter (US-37)
 * Adaptador determinista para desarrollo/local que delega la captura biométrica fuera del núcleo
 * sin almacenar fotos ni video.
 */
export class DeterministicKycAdapter implements KycVerificationPort {
  public async startVerificationSession(
    input: StartKycSessionInput
  ): Promise<StartKycSessionResult> {
    const providerRef = `kyc_ref_${input.tenantId}_${randomUUID().slice(0, 12)}`;
    return {
      providerRef,
      sessionUrl: `/auth?kyc_session=${encodeURIComponent(providerRef)}&level=${encodeURIComponent(input.level)}`,
      mode: 'deterministic_dev',
    };
  }
}
