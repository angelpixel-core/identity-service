import { WebAuthnCredential } from '../entities/webauthn_credential/entity';
import { TenantId } from '../value_objects/tenant_id/value';

/**
 * Secondary Port (SPI): WebAuthnCredentialRepositoryPort (US-35 / US-36)
 */
export interface WebAuthnCredentialRepositoryPort {
  save(credential: WebAuthnCredential): Promise<void>;
  findByUserAndTenant(userId: string, tenantId: TenantId): Promise<WebAuthnCredential[]>;
  findByCredentialId(credentialId: string, tenantId: TenantId): Promise<WebAuthnCredential | null>;
  deleteByIdAndUser(id: string, userId: string, tenantId: TenantId): Promise<boolean>;
}
