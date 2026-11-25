import { DomainValidationError } from '../../exceptions/user/error';
import { TenantId } from '../../value_objects/tenant_id/value';

export type KycStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type KycLevel = 'basic' | 'biometric_liveness';

export interface CreateUserKycVerificationProps {
  id: string;
  userId: string;
  tenantId: TenantId;
  status?: KycStatus;
  level?: KycLevel;
  providerRef?: string | null;
  verifiedAt?: Date | null;
  expiresAt?: Date | null;
  updatedAt?: Date;
}

/**
 * Aggregate Root: UserKycVerification (US-37)
 * Máquina de estados KYC: UNVERIFIED -> PENDING -> VERIFIED | REJECTED.
 * Zero-Biometric-PII: jamás almacena fotos, video ni vectores biométricos.
 */
export class UserKycVerification {
  private readonly id: string;
  private readonly userId: string;
  private readonly tenantId: TenantId;
  private status: KycStatus;
  private level: KycLevel;
  private providerRef: string | null;
  private verifiedAt: Date | null;
  private expiresAt: Date | null;
  private updatedAt: Date;

  private constructor(params: {
    id: string;
    userId: string;
    tenantId: TenantId;
    status: KycStatus;
    level: KycLevel;
    providerRef: string | null;
    verifiedAt: Date | null;
    expiresAt: Date | null;
    updatedAt: Date;
  }) {
    this.id = params.id;
    this.userId = params.userId;
    this.tenantId = params.tenantId;
    this.status = params.status;
    this.level = params.level;
    this.providerRef = params.providerRef;
    this.verifiedAt = params.verifiedAt;
    this.expiresAt = params.expiresAt;
    this.updatedAt = params.updatedAt;
  }

  public static create(props: CreateUserKycVerificationProps): UserKycVerification {
    if (!props.id?.trim()) {
      throw new DomainValidationError('UserKycVerification id must be a non-empty string');
    }
    if (!props.userId?.trim()) {
      throw new DomainValidationError('UserKycVerification userId must be a non-empty string');
    }

    const status: KycStatus = props.status ?? 'UNVERIFIED';
    if (!['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'].includes(status)) {
      throw new DomainValidationError(`Invalid KYC status "${String(status)}"`);
    }

    const level: KycLevel = props.level ?? 'basic';
    if (level !== 'basic' && level !== 'biometric_liveness') {
      throw new DomainValidationError(`Invalid KYC level "${String(level)}"`);
    }

    return new UserKycVerification({
      id: props.id.trim(),
      userId: props.userId.trim(),
      tenantId: props.tenantId,
      status,
      level,
      providerRef: props.providerRef?.trim() || null,
      verifiedAt: props.verifiedAt ? new Date(props.verifiedAt.getTime()) : null,
      expiresAt: props.expiresAt ? new Date(props.expiresAt.getTime()) : null,
      updatedAt: props.updatedAt ? new Date(props.updatedAt.getTime()) : new Date(),
    });
  }

  public static reconstitute(props: CreateUserKycVerificationProps): UserKycVerification {
    return UserKycVerification.create(props);
  }

  public startSession(level: KycLevel, providerRef: string): void {
    if (!providerRef?.trim()) {
      throw new DomainValidationError('providerRef must be a non-empty string');
    }
    this.level = level;
    this.providerRef = providerRef.trim();
    this.status = 'PENDING';
    this.verifiedAt = null;
    this.expiresAt = null;
    this.updatedAt = new Date();
  }

  public markVerified(expiresAt?: Date | null): void {
    const now = new Date();
    this.status = 'VERIFIED';
    this.verifiedAt = now;
    this.expiresAt = expiresAt ? new Date(expiresAt.getTime()) : null;
    this.updatedAt = now;
  }

  public markRejected(): void {
    this.status = 'REJECTED';
    this.verifiedAt = null;
    this.expiresAt = null;
    this.updatedAt = new Date();
  }

  public isCurrentlyVerified(now: Date = new Date()): boolean {
    if (this.status !== 'VERIFIED') return false;
    if (!this.expiresAt) return true;
    return this.expiresAt.getTime() > now.getTime();
  }

  public toJwtClaims(now: Date = new Date()): {
    readonly kyc_verified: boolean;
    readonly kyc_status: KycStatus;
  } {
    const verified = this.isCurrentlyVerified(now);
    return {
      kyc_verified: verified,
      kyc_status: verified ? 'VERIFIED' : this.status === 'VERIFIED' ? 'UNVERIFIED' : this.status,
    };
  }

  public getId(): string {
    return this.id;
  }

  public getUserId(): string {
    return this.userId;
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getStatus(): KycStatus {
    return this.status;
  }

  public getLevel(): KycLevel {
    return this.level;
  }

  public getProviderRef(): string | null {
    return this.providerRef;
  }

  public getVerifiedAt(): Date | null {
    return this.verifiedAt ? new Date(this.verifiedAt.getTime()) : null;
  }

  public getExpiresAt(): Date | null {
    return this.expiresAt ? new Date(this.expiresAt.getTime()) : null;
  }

  public getUpdatedAt(): Date {
    return new Date(this.updatedAt.getTime());
  }
}
