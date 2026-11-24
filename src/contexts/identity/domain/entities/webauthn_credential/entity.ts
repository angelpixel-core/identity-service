import { DomainValidationError } from '../../exceptions/user/error';
import { TenantId } from '../../value_objects/tenant_id/value';

export type WebAuthnDeviceType = 'singleDevice' | 'multiDevice';

export interface CreateWebAuthnCredentialProps {
  id: string;
  userId: string;
  tenantId: TenantId;
  credentialId: string;
  publicKeyCose: Buffer;
  counter?: number;
  transports?: string[];
  deviceType?: WebAuthnDeviceType;
  backedUp?: boolean;
  createdAt?: Date;
}

/**
 * Entity: WebAuthnCredential (US-35 / US-36)
 * Almacena únicamente la clave pública COSE y metadatos no biométricos de una Passkey FIDO2.
 * Zero-Biometric-PII: jamás almacena huellas, vectores faciales ni biometría cruda.
 */
export class WebAuthnCredential {
  private readonly id: string;
  private readonly userId: string;
  private readonly tenantId: TenantId;
  private readonly credentialId: string;
  private readonly publicKeyCose: Buffer;
  private counter: number;
  private readonly transports: readonly string[];
  private readonly deviceType: WebAuthnDeviceType;
  private readonly backedUp: boolean;
  private readonly createdAt: Date;

  private constructor(params: {
    id: string;
    userId: string;
    tenantId: TenantId;
    credentialId: string;
    publicKeyCose: Buffer;
    counter: number;
    transports: readonly string[];
    deviceType: WebAuthnDeviceType;
    backedUp: boolean;
    createdAt: Date;
  }) {
    this.id = params.id;
    this.userId = params.userId;
    this.tenantId = params.tenantId;
    this.credentialId = params.credentialId;
    this.publicKeyCose = params.publicKeyCose;
    this.counter = params.counter;
    this.transports = params.transports;
    this.deviceType = params.deviceType;
    this.backedUp = params.backedUp;
    this.createdAt = params.createdAt;
  }

  public static create(props: CreateWebAuthnCredentialProps): WebAuthnCredential {
    if (!props.id?.trim()) {
      throw new DomainValidationError('WebAuthnCredential id must be a non-empty string');
    }
    if (!props.userId?.trim()) {
      throw new DomainValidationError('WebAuthnCredential userId must be a non-empty string');
    }
    if (!props.credentialId?.trim()) {
      throw new DomainValidationError('WebAuthnCredential credentialId must be a non-empty string');
    }
    if (!Buffer.isBuffer(props.publicKeyCose) || props.publicKeyCose.length === 0) {
      throw new DomainValidationError('WebAuthnCredential publicKeyCose must be a non-empty Buffer');
    }
    const counter = props.counter ?? 0;
    if (!Number.isInteger(counter) || counter < 0) {
      throw new DomainValidationError('WebAuthnCredential counter must be a non-negative integer');
    }

    const deviceType: WebAuthnDeviceType =
      props.deviceType === 'multiDevice' ? 'multiDevice' : 'singleDevice';

    return new WebAuthnCredential({
      id: props.id.trim(),
      userId: props.userId.trim(),
      tenantId: props.tenantId,
      credentialId: props.credentialId.trim(),
      publicKeyCose: Buffer.from(props.publicKeyCose),
      counter,
      transports: Object.freeze(
        (props.transports ?? []).map((t) => t.trim()).filter((t) => t.length > 0)
      ),
      deviceType,
      backedUp: Boolean(props.backedUp ?? false),
      createdAt: props.createdAt ? new Date(props.createdAt.getTime()) : new Date(),
    });
  }

  public static reconstitute(props: CreateWebAuthnCredentialProps): WebAuthnCredential {
    return WebAuthnCredential.create(props);
  }

  public updateCounter(nextCounter: number): void {
    if (!Number.isInteger(nextCounter) || nextCounter < 0) {
      throw new DomainValidationError('Counter must be a non-negative integer');
    }
    if (this.counter > 0 && nextCounter <= this.counter) {
      throw new DomainValidationError(
        `WebAuthn counter regression detected (current=${this.counter}, received=${nextCounter})`
      );
    }
    this.counter = nextCounter;
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

  public getCredentialId(): string {
    return this.credentialId;
  }

  public getPublicKeyCose(): Buffer {
    return Buffer.from(this.publicKeyCose);
  }

  public getCounter(): number {
    return this.counter;
  }

  public getTransports(): readonly string[] {
    return this.transports;
  }

  public getDeviceType(): WebAuthnDeviceType {
    return this.deviceType;
  }

  public isBackedUp(): boolean {
    return this.backedUp;
  }

  public getCreatedAt(): Date {
    return new Date(this.createdAt.getTime());
  }
}
