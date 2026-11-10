import crypto from 'crypto';
import util from 'util';
import { ClientId } from '../../value_objects/client_id/value';
import { TenantId } from '../../value_objects/tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';

export type RefreshSessionStatus = 'active' | 'consumed' | 'revoked';

export interface CreateRefreshSessionProps {
  readonly id?: string;
  readonly familyId?: string;
  readonly userId: string;
  readonly tenantId: TenantId | string;
  readonly clientId: ClientId | string;
  readonly plainToken?: string;
  readonly tokenHash?: string;
  readonly ttlDays?: number;
  readonly expiresAt?: Date;
}

export interface ReconstituteRefreshSessionProps {
  readonly id: string;
  readonly familyId: string;
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly clientId: ClientId;
  readonly tokenHash: string;
  readonly status: RefreshSessionStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revocationReason: string | null;
}

/**
 * Agregado de Dominio: RefreshSession
 * Representa una sesión deslizante (Sliding Session) y su Refresh Token asociado.
 * Soporta rotación estricta 1 a 1 y revocación de familia (Token Family Revocation)
 * ante detección de reuso de tokens consumidos.
 */
export class RefreshSession {
  public static readonly DEFAULT_TTL_DAYS = 30;

  private readonly id: string;
  private readonly familyId: string;
  private readonly userId: string;
  private readonly tenantId: TenantId;
  private readonly clientId: ClientId;
  private readonly tokenHash: string;
  private status: RefreshSessionStatus;
  private readonly expiresAt: Date;
  private readonly createdAt: Date;
  private consumedAt: Date | null;
  private revokedAt: Date | null;
  private revocationReason: string | null;

  private constructor(props: ReconstituteRefreshSessionProps) {
    this.id = props.id;
    this.familyId = props.familyId;
    this.userId = props.userId;
    this.tenantId = props.tenantId;
    this.clientId = props.clientId;
    this.tokenHash = props.tokenHash;
    this.status = props.status;
    this.expiresAt = props.expiresAt;
    this.createdAt = props.createdAt;
    this.consumedAt = props.consumedAt;
    this.revokedAt = props.revokedAt;
    this.revocationReason = props.revocationReason;
  }

  /**
   * Genera un secreto plano de alta entropía (256-bit crypto-random) codificado en hex.
   */
  public static generatePlainToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Calcula el hash criptográfico SHA-256 de un refresh token plano.
   */
  public static hashToken(plainToken: string): string {
    if (!plainToken || typeof plainToken !== 'string' || plainToken.trim().length === 0) {
      throw new DomainValidationError('Plain token cannot be empty');
    }
    if (plainToken.trim().length < 16) {
      throw new DomainValidationError('Plain token must be at least 16 characters long');
    }
    return crypto.createHash('sha256').update(plainToken.trim()).digest('hex');
  }

  /**
   * Compara un token plano con un hash esperado en tiempo constante (Mitigación CWE-208).
   */
  public static verifyHash(plainToken: string, expectedHash: string): boolean {
    if (!plainToken || !expectedHash || typeof plainToken !== 'string' || typeof expectedHash !== 'string') {
      return false;
    }
    try {
      const computedHash = this.hashToken(plainToken);
      const bufComputed = Buffer.from(computedHash, 'ascii');
      const bufExpected = Buffer.from(expectedHash, 'ascii');
      if (bufComputed.length !== bufExpected.length) {
        return false;
      }
      return crypto.timingSafeEqual(bufComputed, bufExpected);
    } catch {
      return false;
    }
  }

  /**
   * Factoría para crear una nueva sesión de refresco (génesis de una nueva familia).
   */
  public static create(props: CreateRefreshSessionProps): { session: RefreshSession; plainToken: string } {
    if (!props.userId || props.userId.trim().length === 0) {
      throw new DomainValidationError('userId is required for RefreshSession');
    }

    const tenantId =
      props.tenantId instanceof TenantId ? props.tenantId : TenantId.create(props.tenantId);
    const clientId =
      props.clientId instanceof ClientId ? props.clientId : ClientId.create(props.clientId);

    const plainToken = props.plainToken || this.generatePlainToken();
    const tokenHash = props.tokenHash || this.hashToken(plainToken);

    const now = new Date();
    const ttlDays = props.ttlDays ?? this.DEFAULT_TTL_DAYS;
    const expiresAt =
      props.expiresAt ?? new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

    const session = new RefreshSession({
      id: props.id || crypto.randomUUID(),
      familyId: props.familyId || crypto.randomUUID(),
      userId: props.userId.trim(),
      tenantId,
      clientId,
      tokenHash,
      status: 'active',
      expiresAt,
      createdAt: now,
      consumedAt: null,
      revokedAt: null,
      revocationReason: null,
    });

    return { session, plainToken };
  }

  /**
   * Reconstituye una entidad de sesión desde persistencia.
   */
  public static reconstitute(props: ReconstituteRefreshSessionProps): RefreshSession {
    return new RefreshSession(props);
  }

  public getId(): string {
    return this.id;
  }

  public getFamilyId(): string {
    return this.familyId;
  }

  public getUserId(): string {
    return this.userId;
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getClientId(): ClientId {
    return this.clientId;
  }

  public getTokenHash(): string {
    return this.tokenHash;
  }

  public getStatus(): RefreshSessionStatus {
    return this.status;
  }

  public getExpiresAt(): Date {
    return new Date(this.expiresAt.getTime());
  }

  public getCreatedAt(): Date {
    return new Date(this.createdAt.getTime());
  }

  public getConsumedAt(): Date | null {
    return this.consumedAt ? new Date(this.consumedAt.getTime()) : null;
  }

  public getRevokedAt(): Date | null {
    return this.revokedAt ? new Date(this.revokedAt.getTime()) : null;
  }

  public getRevocationReason(): string | null {
    return this.revocationReason;
  }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.expiresAt.getTime();
  }

  public isActive(now: Date = new Date()): boolean {
    return this.status === 'active' && !this.isExpired(now);
  }

  public isConsumed(): boolean {
    return this.status === 'consumed';
  }

  public isRevoked(): boolean {
    return this.status === 'revoked';
  }

  /**
   * Ejecuta la rotación estricta de la sesión (1 a 1).
   * Consume la sesión actual y emite una nueva sesión hija vinculada a la misma familia.
   */
  public rotate(
    newChildTokenHash: string,
    newExpiresAt?: Date,
    now: Date = new Date()
  ): RefreshSession {
    if (this.isConsumed()) {
      throw new DomainValidationError(
        'Refresh token has already been consumed (reuse detected)'
      );
    }

    if (this.isRevoked()) {
      throw new DomainValidationError(
        'Refresh session is revoked'
      );
    }

    if (this.isExpired(now)) {
      throw new DomainValidationError(
        'Refresh session has expired'
      );
    }

    this.status = 'consumed';
    this.consumedAt = now;

    const childExpiresAt =
      newExpiresAt ??
      new Date(now.getTime() + RefreshSession.DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);

    return new RefreshSession({
      id: crypto.randomUUID(),
      familyId: this.familyId,
      userId: this.userId,
      tenantId: this.tenantId,
      clientId: this.clientId,
      tokenHash: newChildTokenHash,
      status: 'active',
      expiresAt: childExpiresAt,
      createdAt: now,
      consumedAt: null,
      revokedAt: null,
      revocationReason: null,
    });
  }

  /**
   * Revoca individualmente la sesión.
   */
  public revoke(reason: string = 'revoked', now: Date = new Date()): void {
    this.status = 'revoked';
    this.revokedAt = now;
    this.revocationReason = reason;
  }

  public toString(): string {
    return `RefreshSession(id=${this.id}, familyId=${this.familyId}, userId=${this.userId}, status=${this.status}, tokenHash=[REDACTED])`;
  }

  public [util.inspect.custom](): string {
    return this.toString();
  }
}
