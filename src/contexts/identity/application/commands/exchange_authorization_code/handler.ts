import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { AuthorizationCodeRepositoryPort } from '../../../domain/ports/authorization_code_repository_port';
import { HashProviderPort } from '../../ports/security/hash_provider';
import { AsymmetricKeyProviderPort } from '../../../domain/ports/crypto/asymmetric_key_provider_port';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { ExchangeAuthorizationCodeCommand } from './command';
import { ExchangeAuthorizationCodeResultDto } from './dto';

/**
 * Caso de Uso (Command Slice): ExchangeAuthorizationCodeCommandHandler
 * Realiza el canje seguro de un AuthorizationCode por tokens RS256 cumpliendo RFC 6749 y RFC 7636.
 */
export class ExchangeAuthorizationCodeCommandHandler {
  constructor(
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly authCodeRepository: AuthorizationCodeRepositoryPort,
    private readonly hashProvider: HashProviderPort,
    private readonly asymmetricKeyProvider: AsymmetricKeyProviderPort,
    private readonly auditLogger?: SecurityAuditLoggerPort,
    private readonly tokenLifetimeSeconds: number = 900,
    private readonly issuerUrl: string = 'http://localhost:4000'
  ) {}

  public async execute(command: ExchangeAuthorizationCodeCommand): Promise<ExchangeAuthorizationCodeResultDto> {
    if (command.grantType !== 'authorization_code') {
      throw new OAuth2AuthenticationError(
        'unsupported_grant_type',
        `Unsupported grant_type: "${command.grantType}". Expected "authorization_code".`,
        400
      );
    }

    let clientId: ClientId;
    try {
      clientId = ClientId.create(command.clientId);
    } catch {
      throw new OAuth2AuthenticationError('invalid_client', 'Invalid client_id parameter format', 400);
    }

    const client = await this.clientRepository.findByClientId(clientId);
    if (!client) {
      throw new OAuth2AuthenticationError('invalid_client', 'Client application not found', 401);
    }

    if (!client.isActive()) {
      throw new OAuth2AuthenticationError('invalid_client', 'Client application is deactivated', 401);
    }

    if (!client.hasGrantType('authorization_code')) {
      throw new OAuth2AuthenticationError(
        'unauthorized_client',
        'Client application is not authorized for authorization_code grant type',
        400
      );
    }

    // Si es cliente confidencial, validar credenciales
    if (client.getClientType() === 'confidential') {
      const secretHash = client.getClientSecretHash();
      if (!secretHash || !command.clientSecret) {
        throw new OAuth2AuthenticationError('invalid_client', 'Client authentication failed', 401);
      }

      const isValidSecret = await this.hashProvider.compare(command.clientSecret, secretHash);
      if (!isValidSecret) {
        throw new OAuth2AuthenticationError('invalid_client', 'Invalid client secret', 401);
      }
    }

    if (!command.code || typeof command.code !== 'string' || command.code.trim().length === 0) {
      throw new OAuth2AuthenticationError('invalid_request', 'Missing code parameter', 400);
    }

    const authCode = await this.authCodeRepository.findByCode(command.code.trim());
    if (!authCode) {
      throw new OAuth2AuthenticationError('invalid_grant', 'Authorization code not found or invalid', 400);
    }

    // Mitigación de Ataques de Replay: Si el código ya fue consumido, abortar de inmediato
    if (authCode.isConsumed()) {
      await this.auditLogger?.logEvent({
        eventType: 'code_reuse_violation',
        clientId: client.getClientId().getValue(),
        timestamp: new Date(),
        reason: 'Authorization code has already been consumed (replay attack detected)',
        metadata: {
          tenantId: authCode.getTenantId().getValue(),
          code: authCode.getCode(),
          ip: command.ip,
        },
      });
      throw new OAuth2AuthenticationError(
        'invalid_grant',
        'Authorization code has already been consumed (replay attack detected)',
        400
      );
    }

    if (authCode.isExpired()) {
      throw new OAuth2AuthenticationError('invalid_grant', 'Authorization code has expired', 400);
    }

    // Verificación de cliente vinculado
    if (!authCode.getClientId().equals(client.getClientId())) {
      throw new OAuth2AuthenticationError('invalid_grant', 'Authorization code does not belong to this client', 400);
    }

    // Verificación de coincidencia idéntica de redirect_uri
    if (command.redirectUri && authCode.getRedirectUri() !== command.redirectUri.trim()) {
      throw new OAuth2AuthenticationError(
        'invalid_grant',
        'redirect_uri does not match the URI provided in the authorization request',
        400
      );
    }

    // Validación Criptográfica de PKCE (RFC 7636)
    if (authCode.getCodeChallenge()) {
      if (!command.codeVerifier || command.codeVerifier.trim().length === 0) {
        throw new OAuth2AuthenticationError(
          'invalid_grant',
          'code_verifier is required for PKCE-protected authorization codes',
          400
        );
      }

      const isPkceValid = authCode.verifyCodeChallenge(command.codeVerifier.trim());
      if (!isPkceValid) {
        // Inhabilitar el código de inmediato para evitar ataques de fuerza bruta
        authCode.consume();
        await this.authCodeRepository.save(authCode);

        await this.auditLogger?.logEvent({
          eventType: 'pkce_verification_failed',
          clientId: client.getClientId().getValue(),
          timestamp: new Date(),
          reason: 'code_verifier does not match code_challenge',
          metadata: {
            tenantId: authCode.getTenantId().getValue(),
            code: authCode.getCode(),
            ip: command.ip,
          },
        });

        throw new OAuth2AuthenticationError(
          'invalid_grant',
          'code_verifier does not match code_challenge',
          400
        );
      }
    }

    // Consumir el código (Uso único garantizado)
    authCode.consume();
    await this.authCodeRepository.save(authCode);

    // Emisión de Tokens Asimétricos RS256
    const accessPayload: Record<string, unknown> = {
      sub: authCode.getUserId(),
      iss: this.issuerUrl,
      aud: client.getClientId().getValue(),
      client_id: client.getClientId().getValue(),
      tenant_id: authCode.getTenantId().getValue(),
      scope: authCode.getScope(),
    };

    const idPayload: Record<string, unknown> = {
      sub: authCode.getUserId(),
      iss: this.issuerUrl,
      aud: client.getClientId().getValue(),
      tenantId: authCode.getTenantId().getValue(),
      ...(authCode.getNonce() ? { nonce: authCode.getNonce() } : {}),
    };

    const accessToken = await this.asymmetricKeyProvider.signToken(accessPayload, {
      expiresIn: this.tokenLifetimeSeconds,
    });

    const idToken = await this.asymmetricKeyProvider.signToken(idPayload, {
      expiresIn: this.tokenLifetimeSeconds,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.tokenLifetimeSeconds,
      id_token: idToken,
      scope: authCode.getScope(),
    };
  }
}