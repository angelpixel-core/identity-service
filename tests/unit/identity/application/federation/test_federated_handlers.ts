import { GenerateFederatedLoginUrlQueryHandler } from '../../../../../src/contexts/identity/application/queries/generate_federated_login_url/handler';
import { ProcessFederatedCallbackCommandHandler } from '../../../../../src/contexts/identity/application/commands/process_federated_callback/handler';
import { FederationStateManager } from '../../../../../src/contexts/identity/infrastructure/federation/federation_state_manager';
import { InMemorySecurityAuditLogger } from '../../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import {
  ExternalIdentityProviderPort,
  FederatedUserProfile,
} from '../../../../../src/contexts/identity/domain/ports/external_identity_provider_port';

describe('Unit: Federated Application Handlers (US-10)', () => {
  let stateManager: FederationStateManager;
  let auditLogger: InMemorySecurityAuditLogger;
  let mockGoogleAdapter: ExternalIdentityProviderPort;
  let mockMicrosoftAdapter: ExternalIdentityProviderPort;

  beforeEach(() => {
    stateManager = new FederationStateManager({ secret: 'application-test-secret-key-32-chars' });
    auditLogger = new InMemorySecurityAuditLogger();

    mockGoogleAdapter = {
      providerId: 'google',
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://accounts.google.com/auth?mocked=true'),
      exchangeCodeAndVerifyToken: jest.fn().mockResolvedValue({
        provider: 'google',
        externalSubjectId: 'google-sub-1',
        email: 'user@google.com',
        emailVerified: true,
      } as FederatedUserProfile),
    };

    mockMicrosoftAdapter = {
      providerId: 'microsoft',
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://login.microsoftonline.com/auth?mocked=true'),
      exchangeCodeAndVerifyToken: jest.fn().mockResolvedValue({
        provider: 'microsoft',
        externalSubjectId: 'msft-oid-1',
        email: 'user@microsoft.com',
        emailVerified: true,
      } as FederatedUserProfile),
    };
  });

  describe('GenerateFederatedLoginUrlQueryHandler', () => {
    it('should generate URL and cryptographic state for Google provider', async () => {
      const handler = new GenerateFederatedLoginUrlQueryHandler(
        [mockGoogleAdapter, mockMicrosoftAdapter],
        stateManager
      );

      const result = await handler.execute({
        provider: 'google',
        tenantId: 'tenant-alpha',
        clientId: 'web-portal',
        redirectUri: 'https://alpha.io/cb',
      });

      expect(result.url).toBe('https://accounts.google.com/auth?mocked=true');
      expect(result.state).toBeDefined();
      expect(result.nonce).toBeDefined();

      const decoded = stateManager.verifyState(result.state);
      expect(decoded.tenantId).toBe('tenant-alpha');
      expect(decoded.provider).toBe('google');
      expect(mockGoogleAdapter.getAuthorizationUrl).toHaveBeenCalled();
    });

    it('should throw when provider is unsupported', async () => {
      const handler = new GenerateFederatedLoginUrlQueryHandler(
        [mockGoogleAdapter],
        stateManager
      );

      await expect(
        handler.execute({
          provider: 'microsoft' as any,
          tenantId: 'tenant-alpha',
          redirectUri: 'https://alpha.io/cb',
        })
      ).rejects.toThrow('Unsupported identity provider: "microsoft"');
    });

    it('should throw when tenantId is missing or empty', async () => {
      const handler = new GenerateFederatedLoginUrlQueryHandler(
        [mockGoogleAdapter],
        stateManager
      );

      await expect(
        handler.execute({
          provider: 'google',
          tenantId: '   ',
          redirectUri: 'https://alpha.io/cb',
        })
      ).rejects.toThrow('tenantId is required');
    });

    it('should throw when redirectUri is missing or empty', async () => {
      const handler = new GenerateFederatedLoginUrlQueryHandler(
        [mockGoogleAdapter],
        stateManager
      );

      await expect(
        handler.execute({
          provider: 'google',
          tenantId: 'tenant-alpha',
          redirectUri: '',
        })
      ).rejects.toThrow('redirectUri is required');
    });
  });

  describe('ProcessFederatedCallbackCommandHandler', () => {
    it('should successfully process callback, exchange code, and log audit event', async () => {
      const handler = new ProcessFederatedCallbackCommandHandler(
        [mockGoogleAdapter, mockMicrosoftAdapter],
        stateManager,
        auditLogger
      );

      const { state } = stateManager.generateState({
        tenantId: 'tenant-alpha',
        clientId: 'client-123',
        redirectUri: 'https://alpha.io/cb',
        provider: 'google',
      });

      const result = await handler.execute({
        code: 'valid-google-code',
        state,
        provider: 'google',
      });

      expect(result.userProfile.email).toBe('user@google.com');
      expect(result.statePayload.tenantId).toBe('tenant-alpha');
      expect(mockGoogleAdapter.exchangeCodeAndVerifyToken).toHaveBeenCalledWith({
        code: 'valid-google-code',
        redirectUri: 'https://alpha.io/cb',
        nonce: expect.any(String),
      });

      const events = await auditLogger.getEvents();
      expect(events).toHaveLength(1);
      const firstEvent = events[0]!;
      expect(firstEvent.eventType).toBe('federation_callback_processed');
      expect(firstEvent.clientId).toBe('client-123');
    });

    it('should throw and log audit failure when state is tampered', async () => {
      const handler = new ProcessFederatedCallbackCommandHandler(
        [mockGoogleAdapter],
        stateManager,
        auditLogger
      );

      await expect(
        handler.execute({
          code: 'valid-code',
          state: 'tampered.state.payload',
        })
      ).rejects.toThrow();

      const events = await auditLogger.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('federation_callback_failed');
    });

    it('should throw and log audit failure on provider mismatch', async () => {
      const handler = new ProcessFederatedCallbackCommandHandler(
        [mockGoogleAdapter, mockMicrosoftAdapter],
        stateManager,
        auditLogger
      );

      const { state } = stateManager.generateState({
        tenantId: 'tenant-alpha',
        redirectUri: 'https://alpha.io/cb',
        provider: 'google',
      });

      await expect(
        handler.execute({
          code: 'valid-code',
          state,
          provider: 'microsoft',
        })
      ).rejects.toThrow('Provider mismatch');

      const events = await auditLogger.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('federation_callback_failed');
    });

    it('should throw and log failure when adapter exchange fails', async () => {
      (mockGoogleAdapter.exchangeCodeAndVerifyToken as jest.Mock).mockRejectedValueOnce(
        new Error('Google 500 Internal Error')
      );

      const handler = new ProcessFederatedCallbackCommandHandler(
        [mockGoogleAdapter],
        stateManager,
        auditLogger
      );

      const { state } = stateManager.generateState({
        tenantId: 'tenant-alpha',
        redirectUri: 'https://alpha.io/cb',
        provider: 'google',
      });

      await expect(
        handler.execute({
          code: 'failed-code',
          state,
        })
      ).rejects.toThrow('Google 500 Internal Error');

      const events = await auditLogger.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('federation_callback_failed');
      expect(events[0]?.reason).toContain('External IdP token exchange failed');
    });
  });
});
