import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { AuthorizationCodeRepositoryPort } from '../../../domain/ports/authorization_code_repository_port';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { AuthorizationCode } from '../../../domain/entities/authorization_code/entity';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { IssueAuthorizationCodeCommand } from './command';
import { IssueAuthorizationCodeResultDto } from './dto';

/**
 * Caso de Uso (Command Slice): IssueAuthorizationCodeCommandHandler
 * Orquesta la solicitud de autorización interactiva emitiendo un AuthorizationCode protegido con PKCE.
 */
export class IssueAuthorizationCodeCommandHandler {
  constructor(
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly authCodeRepository: AuthorizationCodeRepositoryPort,
    private readonly auditLogger?: SecurityAuditLoggerPort
  ) {}

  public async execute(command: IssueAuthorizationCodeCommand): Promise<IssueAuthorizationCodeResultDto> {
    if (command.responseType !== 'code') {
      throw new OAuth2AuthenticationError(
        'unsupported_response_type',
        `Unsupported response_type: "${command.responseType}". Expected "code".`,
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
        'Client is not authorized to use authorization_code grant type',
        400
      );
    }

    if (!client.isRedirectUriAllowed(command.redirectUri)) {
      throw new OAuth2AuthenticationError(
        'invalid_request',
        `The redirect_uri "${command.redirectUri}" is not authorized for this client.`,
        400
      );
    }

    // Obligatoriedad de PKCE para clientes públicos (RFC 7636 y ADR-0006)
    if (client.getClientType() === 'public') {
      if (!command.codeChallenge || command.codeChallenge.trim().length === 0) {
        throw new OAuth2AuthenticationError(
          'invalid_request',
          'code_challenge is required for public clients (RFC 7636 PKCE)',
          400
        );
      }

      if (command.codeChallengeMethod !== 'S256') {
        throw new OAuth2AuthenticationError(
          'invalid_request',
          'Transform algorithm not supported: code_challenge_method must be S256',
          400
        );
      }
    }

    const authCode = AuthorizationCode.create({
      clientId: client.getClientId(),
      userId: command.userId,
      tenantId: command.tenantId,
      redirectUri: command.redirectUri,
      scope: command.scope || 'openid',
      codeChallenge: command.codeChallenge,
      codeChallengeMethod: command.codeChallengeMethod,
      nonce: command.nonce,
    });

    await this.authCodeRepository.save(authCode);

    if (this.auditLogger) {
      await this.auditLogger.logEvent({
        eventType: 'client_authenticated',
        clientId: client.getClientId().getValue(),
        timestamp: new Date(),
        metadata: {
          action: 'issue_authorization_code',
          redirectUri: command.redirectUri,
        },
      });
    }

    // Construcción segura de la URL de redirección
    const callbackUrl = new URL(command.redirectUri);
    callbackUrl.searchParams.set('code', authCode.getCode());
    if (command.state) {
      callbackUrl.searchParams.set('state', command.state);
    }

    return {
      code: authCode.getCode(),
      redirectUri: command.redirectUri,
      state: command.state,
      callbackUrl: callbackUrl.toString(),
    };
  }
}