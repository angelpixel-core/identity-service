import { WebAuthnCredential } from '../../../../domain/entities/webauthn_credential/entity';
import { WebAuthnCredentialRepositoryPort } from '../../../../domain/ports/webauthn_credential_repository_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';

export class InMemoryWebAuthnCredentialRepository implements WebAuthnCredentialRepositoryPort {
  private readonly items = new Map<string, WebAuthnCredential>();

  public async save(credential: WebAuthnCredential): Promise<void> {
    this.items.set(`${credential.getTenantId().getValue()}:${credential.getCredentialId()}`, credential);
  }

  public async findByUserAndTenant(
    userId: string,
    tenantId: TenantId
  ): Promise<WebAuthnCredential[]> {
    const targetTenant = tenantId.getValue();
    return Array.from(this.items.values()).filter(
      (c) => c.getUserId() === userId && c.getTenantId().getValue() === targetTenant
    );
  }

  public async findByCredentialId(
    credentialId: string,
    tenantId: TenantId
  ): Promise<WebAuthnCredential | null> {
    return this.items.get(`${tenantId.getValue()}:${credentialId}`) ?? null;
  }

  public async deleteByIdAndUser(
    id: string,
    userId: string,
    tenantId: TenantId
  ): Promise<boolean> {
    const targetTenant = tenantId.getValue();
    for (const [key, cred] of this.items.entries()) {
      if (
        cred.getId() === id &&
        cred.getUserId() === userId &&
        cred.getTenantId().getValue() === targetTenant
      ) {
        this.items.delete(key);
        return true;
      }
    }
    return false;
  }
}
