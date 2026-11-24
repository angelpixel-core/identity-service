import { TenantId } from '../../value_objects/tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';

export type KycMinLevel = 'basic' | 'biometric_liveness';

export interface TenantRequiredAttributes {
  readonly phone: boolean;
}

export interface TenantKycPolicy {
  readonly required: boolean;
  readonly minLevel: KycMinLevel;
}

export interface TenantAllowedAuthMethods {
  readonly password: boolean;
  readonly passkeys: boolean;
  readonly federatedOidc: boolean;
}

export interface CreateTenantPolicyProps {
  tenantId: TenantId;
  requiredAttributes?: Partial<TenantRequiredAttributes>;
  kycPolicy?: Partial<TenantKycPolicy>;
  allowedAuthMethods?: Partial<TenantAllowedAuthMethods>;
  updatedBy?: string;
  updatedAt?: Date;
}

export class InvalidTenantPolicyError extends DomainValidationError {
  public readonly errorCode = 'invalid_tenant_policy';
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Aggregate Root: TenantPolicy (US-30)
 * Define las capacidades configurables de onboarding y autenticación por inquilino.
 */
export class TenantPolicy {
  private readonly tenantId: TenantId;
  private requiredAttributes: TenantRequiredAttributes;
  private kycPolicy: TenantKycPolicy;
  private allowedAuthMethods: TenantAllowedAuthMethods;
  private updatedAt: Date;
  private updatedBy: string;

  private constructor(params: {
    tenantId: TenantId;
    requiredAttributes: TenantRequiredAttributes;
    kycPolicy: TenantKycPolicy;
    allowedAuthMethods: TenantAllowedAuthMethods;
    updatedAt: Date;
    updatedBy: string;
  }) {
    this.tenantId = params.tenantId;
    this.requiredAttributes = params.requiredAttributes;
    this.kycPolicy = params.kycPolicy;
    this.allowedAuthMethods = params.allowedAuthMethods;
    this.updatedAt = params.updatedAt;
    this.updatedBy = params.updatedBy;
  }

  public static defaultFor(tenantId: TenantId): TenantPolicy {
    return new TenantPolicy({
      tenantId,
      requiredAttributes: { phone: false },
      kycPolicy: { required: false, minLevel: 'basic' },
      allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
      updatedAt: new Date(),
      updatedBy: 'system-default',
    });
  }

  private static validateAndNormalize(props: CreateTenantPolicyProps): {
    requiredAttributes: TenantRequiredAttributes;
    kycPolicy: TenantKycPolicy;
    allowedAuthMethods: TenantAllowedAuthMethods;
  } {
    const requiredAttributes: TenantRequiredAttributes = {
      phone: Boolean(props.requiredAttributes?.phone ?? false),
    };

    const minLevel: KycMinLevel = props.kycPolicy?.minLevel ?? 'basic';
    if (minLevel !== 'basic' && minLevel !== 'biometric_liveness') {
      throw new InvalidTenantPolicyError(
        `Invalid kycPolicy.minLevel "${String(minLevel)}". Allowed: basic, biometric_liveness`
      );
    }
    const kycPolicy: TenantKycPolicy = {
      required: Boolean(props.kycPolicy?.required ?? false),
      minLevel,
    };

    const allowedAuthMethods: TenantAllowedAuthMethods = {
      password: props.allowedAuthMethods?.password ?? true,
      passkeys: props.allowedAuthMethods?.passkeys ?? false,
      federatedOidc: props.allowedAuthMethods?.federatedOidc ?? true,
    };

    if (
      !allowedAuthMethods.password &&
      !allowedAuthMethods.passkeys &&
      !allowedAuthMethods.federatedOidc
    ) {
      throw new InvalidTenantPolicyError(
        'At least one authentication method (password, passkeys, or federatedOidc) must be enabled'
      );
    }

    return { requiredAttributes, kycPolicy, allowedAuthMethods };
  }

  public static create(props: CreateTenantPolicyProps): TenantPolicy {
    const normalized = TenantPolicy.validateAndNormalize(props);
    return new TenantPolicy({
      tenantId: props.tenantId,
      ...normalized,
      updatedAt: props.updatedAt ?? new Date(),
      updatedBy: props.updatedBy?.trim() || 'system',
    });
  }

  public static reconstitute(props: CreateTenantPolicyProps): TenantPolicy {
    return TenantPolicy.create(props);
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getRequiredAttributes(): TenantRequiredAttributes {
    return { ...this.requiredAttributes };
  }

  public getKycPolicy(): TenantKycPolicy {
    return { ...this.kycPolicy };
  }

  public getAllowedAuthMethods(): TenantAllowedAuthMethods {
    return { ...this.allowedAuthMethods };
  }

  public getUpdatedAt(): Date {
    return this.updatedAt;
  }

  public getUpdatedBy(): string {
    return this.updatedBy;
  }

  public update(params: {
    requiredAttributes?: Partial<TenantRequiredAttributes>;
    kycPolicy?: Partial<TenantKycPolicy>;
    allowedAuthMethods?: Partial<TenantAllowedAuthMethods>;
    updatedBy: string;
  }): void {
    const next = TenantPolicy.validateAndNormalize({
      tenantId: this.tenantId,
      requiredAttributes: {
        ...this.requiredAttributes,
        ...params.requiredAttributes,
      },
      kycPolicy: {
        ...this.kycPolicy,
        ...params.kycPolicy,
      },
      allowedAuthMethods: {
        ...this.allowedAuthMethods,
        ...params.allowedAuthMethods,
      },
    });

    this.requiredAttributes = next.requiredAttributes;
    this.kycPolicy = next.kycPolicy;
    this.allowedAuthMethods = next.allowedAuthMethods;
    this.updatedBy = params.updatedBy.trim() || 'system';
    this.updatedAt = new Date();
  }
}
