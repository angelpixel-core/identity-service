import {
  WebAuthnCredential,
  WebAuthnDeviceType,
} from '../../../../domain/entities/webauthn_credential/entity';
import { WebAuthnCredentialRepositoryPort } from '../../../../domain/ports/webauthn_credential_repository_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { DatabaseClient } from '../user/repository';

interface WebAuthnCredentialRow {
  readonly id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly credential_id: string;
  readonly public_key_cose: Buffer;
  readonly counter: string | number;
  readonly transports: string[] | null;
  readonly device_type: string;
  readonly backed_up: boolean;
  readonly created_at: Date | string;
}

function mapRowToDomain(row: WebAuthnCredentialRow): WebAuthnCredential {
  const deviceType: WebAuthnDeviceType =
    row.device_type === 'multiDevice' ? 'multiDevice' : 'singleDevice';

  return WebAuthnCredential.reconstitute({
    id: row.id,
    userId: row.user_id,
    tenantId: TenantId.create(row.tenant_id),
    credentialId: row.credential_id,
    publicKeyCose: Buffer.isBuffer(row.public_key_cose)
      ? row.public_key_cose
      : Buffer.from(row.public_key_cose),
    counter: typeof row.counter === 'string' ? Number(row.counter) : row.counter,
    transports: Array.isArray(row.transports) ? row.transports : [],
    deviceType,
    backedUp: Boolean(row.backed_up),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  });
}

/**
 * Secondary Adapter: PostgresWebAuthnCredentialRepository (US-35 / US-36)
 * Persiste claves públicas COSE en webauthn_credentials bajo RLS Fail-Closed.
 */
export class PostgresWebAuthnCredentialRepository implements WebAuthnCredentialRepositoryPort {
  constructor(private readonly db: DatabaseClient) {}

  public withClient(client: DatabaseClient): PostgresWebAuthnCredentialRepository {
    return new PostgresWebAuthnCredentialRepository(client);
  }

  public async save(credential: WebAuthnCredential): Promise<void> {
    const sql = `
      INSERT INTO webauthn_credentials (
        id, user_id, tenant_id, credential_id, public_key_cose,
        counter, transports, device_type, backed_up, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (credential_id) DO UPDATE SET
        counter = EXCLUDED.counter,
        backed_up = EXCLUDED.backed_up,
        transports = EXCLUDED.transports;
    `;
    await this.db.query(sql, [
      credential.getId(),
      credential.getUserId(),
      credential.getTenantId().getValue(),
      credential.getCredentialId(),
      credential.getPublicKeyCose(),
      credential.getCounter(),
      [...credential.getTransports()],
      credential.getDeviceType(),
      credential.isBackedUp(),
      credential.getCreatedAt(),
    ]);
  }

  public async findByUserAndTenant(
    userId: string,
    tenantId: TenantId
  ): Promise<WebAuthnCredential[]> {
    const sql = `
      SELECT id, user_id, tenant_id, credential_id, public_key_cose,
             counter, transports, device_type, backed_up, created_at
      FROM webauthn_credentials
      WHERE user_id = $1 AND tenant_id = $2
      ORDER BY created_at DESC;
    `;
    const result = await this.db.query<WebAuthnCredentialRow>(sql, [
      userId,
      tenantId.getValue(),
    ]);
    return result.rows.map(mapRowToDomain);
  }

  public async findByCredentialId(
    credentialId: string,
    tenantId: TenantId
  ): Promise<WebAuthnCredential | null> {
    const sql = `
      SELECT id, user_id, tenant_id, credential_id, public_key_cose,
             counter, transports, device_type, backed_up, created_at
      FROM webauthn_credentials
      WHERE credential_id = $1 AND tenant_id = $2
      LIMIT 1;
    `;
    const result = await this.db.query<WebAuthnCredentialRow>(sql, [
      credentialId,
      tenantId.getValue(),
    ]);
    const row = result.rows[0];
    return row ? mapRowToDomain(row) : null;
  }

  public async deleteByIdAndUser(
    id: string,
    userId: string,
    tenantId: TenantId
  ): Promise<boolean> {
    const sql = `
      DELETE FROM webauthn_credentials
      WHERE id = $1 AND user_id = $2 AND tenant_id = $3;
    `;
    const result = await this.db.query(sql, [id, userId, tenantId.getValue()]);
    return (result.rowCount ?? 0) > 0;
  }
}
