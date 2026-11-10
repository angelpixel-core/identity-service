import {
  ExternalIdentityProviderPort,
  FederatedProviderId,
} from '../../../domain/ports/external_identity_provider_port';
import { FederationStateManager } from '../../../infrastructure/federation/federation_state_manager';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { ProcessFederatedCallbackCommand } from './command';
import { ProcessFederatedCallbackResult } from './dto';

export class ProcessFederatedCallbackCommandHandler {
  private readonly providers: Map<FederatedProviderId, ExternalIdentityProviderPort>;
  private readonly stateManager: FederationStateManager;
  private readonly auditLogger?: SecurityAuditLoggerPort;

  constructor(
    providers: ExternalIdentityProviderPort[],
    stateManager: FederationStateManager,
    auditLogger?: SecurityAuditLoggerPort
  ) {
    this.providers = new Map(providers.map((p) => [p.providerId, p]));
    this.stateManager = stateManager;
    this.auditLogger = auditLogger;
  }

  public async execute(
    command: ProcessFederatedCallbackCommand
  ): Promise<ProcessFederatedCallbackResult> {
    if (!command.code || command.code.trim() === '') {
      throw new Error('Authorization code is required');
    }
    if (!command.state || command.state.trim() === '') {
      throw new Error('State parameter is required');
    }

    let statePayload;
    try {
      statePayload = this.stateManager.verifyState(command.state);
    } catch (err: any) {
      await this.auditLogger?.logEvent({
        eventType: 'federation_callback_failed',
        timestamp: new Date(),
        reason: `Anti-CSRF state verification failed: ${err.message}`,
      });
      throw err;
    }

    const providerId = command.provider || statePayload.provider;
    if (command.provider && command.provider !== statePayload.provider) {
      await this.auditLogger?.logEvent({
        eventType: 'federation_callback_failed',
        timestamp: new Date(),
        reason: `Provider mismatch: expected ${statePayload.provider}, got ${command.provider}`,
      });
      throw new Error(`Provider mismatch between URL (${command.provider}) and state (${statePayload.provider})`);
    }

    const adapter = this.providers.get(providerId);
    if (!adapter) {
      throw new Error(`Unsupported identity provider: "${providerId}"`);
    }

    try {
      const userProfile = await adapter.exchangeCodeAndVerifyToken({
        code: command.code,
        redirectUri: statePayload.redirectUri,
        nonce: statePayload.nonce,
      });

      await this.auditLogger?.logEvent({
        eventType: 'federation_callback_processed',
        timestamp: new Date(),
        clientId: statePayload.clientId,
        metadata: {
          provider: providerId,
          tenantId: statePayload.tenantId,
          email: userProfile.email,
          externalSubjectId: userProfile.externalSubjectId,
        },
      });

      return {
        userProfile,
        statePayload,
      };
    } catch (err: any) {
      await this.auditLogger?.logEvent({
        eventType: 'federation_callback_failed',
        timestamp: new Date(),
        reason: `External IdP token exchange failed: ${err.message}`,
        metadata: {
          provider: providerId,
          tenantId: statePayload.tenantId,
        },
      });
      throw err;
    }
  }
}
