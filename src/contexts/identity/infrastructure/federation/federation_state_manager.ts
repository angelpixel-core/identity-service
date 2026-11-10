import crypto from 'crypto';
import util from 'util';
import {
  FederatedProviderId,
  FederationStatePayload,
} from '../../domain/ports/external_identity_provider_port';

export interface FederationStateManagerOptions {
  secret?: string;
  ttlSeconds?: number;
  clockToleranceSeconds?: number;
}

export class FederationStateManager {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private readonly clockToleranceSeconds: number;

  constructor(options?: FederationStateManagerOptions) {
    this.secret = options?.secret || process.env.FEDERATION_STATE_SECRET || process.env.JWT_SECRET || 'fed-state-secret-default-key-32chars';
    this.ttlSeconds = options?.ttlSeconds ?? 600; // 10 minutes default TTL
    this.clockToleranceSeconds = options?.clockToleranceSeconds ?? 60; // 60s clock skew allowance
  }

  /**
   * Generates a cryptographic nonce (anti-replay)
   */
  public generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generates a signed, anti-CSRF state token encapsulating the federation context
   */
  public generateState(params: {
    tenantId: string;
    clientId?: string;
    redirectUri: string;
    provider: FederatedProviderId;
    nonce?: string;
  }): { state: string; nonce: string } {
    if (!params.tenantId || params.tenantId.trim() === '') {
      throw new Error('tenantId is required to generate federation state');
    }
    if (!params.redirectUri || params.redirectUri.trim() === '') {
      throw new Error('redirectUri is required to generate federation state');
    }
    if (!params.provider || (params.provider !== 'google' && params.provider !== 'microsoft')) {
      throw new Error(`Invalid provider: "${params.provider}"`);
    }

    const nonce = params.nonce || this.generateNonce();
    const now = Date.now();
    const payload: FederationStatePayload = {
      tenantId: params.tenantId.trim(),
      clientId: params.clientId?.trim(),
      redirectUri: params.redirectUri.trim(),
      provider: params.provider,
      nonce,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
    };

    const payloadJson = JSON.stringify(payload);
    const encodedPayload = Buffer.from(payloadJson).toString('base64url');
    const signature = this.computeHmac(encodedPayload);

    return {
      state: `${encodedPayload}.${signature}`,
      nonce,
    };
  }

  /**
   * Verifies and decodes an anti-CSRF state token using timing-safe comparison
   */
  public verifyState(state: string): FederationStatePayload {
    if (!state || typeof state !== 'string') {
      throw new Error('Invalid state token: state is empty or not a string');
    }

    const parts = state.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid state token: malformed format');
    }

    const [encodedPayload, providedSignature] = parts;
    if (!encodedPayload || !providedSignature) {
      throw new Error('Invalid state token: missing payload or signature');
    }

    const expectedSignature = this.computeHmac(encodedPayload);

    const providedBuf = Buffer.from(providedSignature);
    const expectedBuf = Buffer.from(expectedSignature);

    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new Error('Invalid state token: signature verification failed');
    }

    let payload: FederationStatePayload;
    try {
      const decodedJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
      payload = JSON.parse(decodedJson);
    } catch {
      throw new Error('Invalid state token: failed to parse payload');
    }

    const now = Date.now();
    const toleranceMs = this.clockToleranceSeconds * 1000;

    // Check expiration
    if (now > payload.expiresAt + toleranceMs) {
      throw new Error('Invalid state token: state has expired');
    }

    // Check created_at clock skew
    if (payload.createdAt > now + toleranceMs) {
      throw new Error('Invalid state token: token issued in the future');
    }

    // Defensive validation of required payload fields
    if (!payload.tenantId || !payload.redirectUri || !payload.provider || !payload.nonce) {
      throw new Error('Invalid state token: missing essential payload claims');
    }

    return payload;
  }

  private computeHmac(data: string): string {
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  public toString(): string {
    return `FederationStateManager { ttlSeconds: ${this.ttlSeconds}, clockTolerance: ${this.clockToleranceSeconds}s, secret: [REDACTED] }`;
  }

  public [util.inspect.custom](): string {
    return this.toString();
  }
}
