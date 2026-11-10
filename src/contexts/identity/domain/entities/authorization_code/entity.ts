import crypto from 'crypto';
import util from 'util';
import { ClientId } from '../../value_objects/client_id/value';
import { TenantId } from '../../value_objects/tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';
import { PkceValidator } from '../../services/pkce_validator';

export interface CreateAuthorizationCodeProps {
  readonly code?: string;
  readonly clientId: ClientId | string;
  readonly userId: string;
  readonly tenantId: TenantId | string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly codeChallenge?: string | null;
  readonly codeChallengeMethod?: string | null;
  readonly ttlSeconds?: number;
  readonly nonce?: string | null;
}

export interface ReconstituteAuthorizationCodeProps {
  readonly code: string;
  readonly clientId: ClientId;
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly redirectUri: string;
  readonly scope: string;
  readonly codeChallenge: string | null;
  readonly codeChallengeMethod: string | null;
  readonly expiresAt: Date;
  readonly consumed: boolean;
  readonly nonce: string | null;
  readonly createdAt: Date;
}

/**
 * Entidad de Dominio: AuthorizationCode
 * Representa un código de autorización efímero emitido según RFC 6749 y protegido con PKCE (RFC 7636).
 * Posee un ciclo de vida de un solo uso (*One-Time Use*) con TTL corto (60 segundos por defecto).
 */
export class AuthorizationCode {
  public static readonly DEFAULT_TTL_SECONDS = 60;

  private readonly code: string;
  private readonly clientId: ClientId;
  private readonly userId: string;
  private readonly tenantId: TenantId;
  private readonly redirectUri: string;
  private readonly scope: string;
  private readonly codeChallenge: string | null;
  private readonly codeChallengeMethod: string | null;
  private readonly expiresAt: Date;
  private consumed: boolean;
  private readonly nonce: string | null;
  private readonly createdAt: Date;

  private constructor(props: ReconstituteAuthorizationCodeProps) {
    this.code = props.code;
    this.clientId = props.clientId;
    this.userId = props.userId;
    this.tenantId = props.tenantId;
    this.redirectUri = props.redirectUri;
    this.scope = props.scope;
    this.codeChallenge = props.codeChallenge;
    this.codeChallengeMethod = props.codeChallengeMethod;
    this.expiresAt = props.expiresAt;
    this.consumed = props.consumed;
    this.nonce = props.nonce;
    this.createdAt = props.createdAt;
  }

  public static create(props: CreateAuthorizationCodeProps): AuthorizationCode {
    if (!props.userId || typeof props.userId !== 'string' || props.userId.trim().length === 0) {
      throw new DomainValidationError('userId must be a non-empty string');
    }

    if (!props.redirectUri || typeof props.redirectUri !== 'string' || props.redirectUri.trim().length === 0) {
      throw new DomainValidationError('redirectUri must be a non-empty string');
    }

    const clientId =
      props.clientId instanceof ClientId
        ? props.clientId
        : ClientId.create(props.clientId);

    const tenantId =
      props.tenantId instanceof TenantId
        ? props.tenantId
        : TenantId.create(props.tenantId);

    const code = props.code || crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const ttlSeconds = props.ttlSeconds ?? AuthorizationCode.DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    return new AuthorizationCode({
      code,
      clientId,
      userId: props.userId.trim(),
      tenantId,
      redirectUri: props.redirectUri.trim(),
      scope: (props.scope || 'openid').trim(),
      codeChallenge: props.codeChallenge ? props.codeChallenge.trim() : null,
      codeChallengeMethod: props.codeChallengeMethod ? props.codeChallengeMethod.trim() : null,
      expiresAt,
      consumed: false,
      nonce: props.nonce ? props.nonce.trim() : null,
      createdAt: now,
    });
  }

  public static reconstitute(props: ReconstituteAuthorizationCodeProps): AuthorizationCode {
    return new AuthorizationCode(props);
  }

  public getCode(): string {
    return this.code;
  }

  public getClientId(): ClientId {
    return this.clientId;
  }

  public getUserId(): string {
    return this.userId;
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getRedirectUri(): string {
    return this.redirectUri;
  }

  public getScope(): string {
    return this.scope;
  }

  public getCodeChallenge(): string | null {
    return this.codeChallenge;
  }

  public getCodeChallengeMethod(): string | null {
    return this.codeChallengeMethod;
  }

  public getExpiresAt(): Date {
    return this.expiresAt;
  }

  public isConsumed(): boolean {
    return this.consumed;
  }

  public getNonce(): string | null {
    return this.nonce;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.expiresAt.getTime();
  }

  /**
   * Consume el código de autorización marcándolo como utilizado.
   * Lanza excepción si ya fue consumido o si está expirado.
   */
  public consume(now: Date = new Date()): void {
    if (this.consumed) {
      throw new DomainValidationError('Authorization code has already been consumed (re-use detected)');
    }

    if (this.isExpired(now)) {
      throw new DomainValidationError('Authorization code has expired');
    }

    this.consumed = true;
  }

  /**
   * Verifica el code_verifier contra el code_challenge utilizando el método configurado.
   */
  public verifyCodeChallenge(codeVerifier: string): boolean {
    if (!this.codeChallenge) {
      // Si el código no requirió PKCE, la verificación es positiva solo si no se envió verifier
      return true;
    }

    const method = this.codeChallengeMethod || 'S256';
    return PkceValidator.verify(codeVerifier, this.codeChallenge, method);
  }

  /**
   * Representación segura en cadena con redacción del código confidencial.
   */
  public toString(): string {
    return `AuthorizationCode(clientId=${this.clientId.getValue()}, userId=${this.userId}, consumed=${this.consumed}, code=[REDACTED])`;
  }

  /**
   * Rediseño de inspección personalizada de Node.js para prevenir fugas en logging y debugging.
   */
  public [util.inspect.custom](): Record<string, unknown> {
    return {
      clientId: this.clientId.getValue(),
      userId: this.userId,
      tenantId: this.tenantId.getValue(),
      redirectUri: this.redirectUri,
      scope: this.scope,
      hasCodeChallenge: Boolean(this.codeChallenge),
      codeChallengeMethod: this.codeChallengeMethod,
      expiresAt: this.expiresAt,
      consumed: this.consumed,
      createdAt: this.createdAt,
      code: '[REDACTED]',
    };
  }
}