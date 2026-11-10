import { IssueAuthorizationCodeCommandHandler } from '../../../../../src/contexts/identity/application/commands/issue_authorization_code/handler';
import { InMemoryClientApplicationRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemoryAuthorizationCodeRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/authorization_code/in_memory_repository';
import { InMemorySecurityAuditLogger } from '../../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';

describe('Application Command: IssueAuthorizationCodeCommandHandler (RFC 6749 & RFC 7636)', () => {
  let clientRepository: InMemoryClientApplicationRepository;
  let authCodeRepository: InMemoryAuthorizationCodeRepository;
  let auditLogger: InMemorySecurityAuditLogger;
  let handler: IssueAuthorizationCodeCommandHandler;

  const validChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  beforeEach(async () => {
    clientRepository = new InMemoryClientApplicationRepository(true);
    authCodeRepository = new InMemoryAuthorizationCodeRepository();
    auditLogger = new InMemorySecurityAuditLogger();

    // Client e-commerce-spa is already seeded as public client with allowed redirect https://shop.local/callback
    handler = new IssueAuthorizationCodeCommandHandler(clientRepository, authCodeRepository, auditLogger);
  });

  it('should successfully issue authorization code and return callback URL for valid public client with PKCE', async () => {
    const result = await handler.execute({
      clientId: 'e-commerce-spa',
      redirectUri: 'https://shop.local/callback',
      responseType: 'code',
      scope: 'openid profile',
      state: 'state-abc',
      codeChallenge: validChallenge,
      codeChallengeMethod: 'S256',
      userId: 'user-id-123',
      tenantId: 'tenant-123',
      nonce: 'nonce-123',
    });

    expect(result.code).toBeDefined();
    expect(result.redirectUri).toBe('https://shop.local/callback');
    expect(result.state).toBe('state-abc');
    expect(result.callbackUrl).toContain('https://shop.local/callback?code=');
    expect(result.callbackUrl).toContain('state=state-abc');

    const savedCode = await authCodeRepository.findByCode(result.code);
    expect(savedCode).not.toBeNull();
    expect(savedCode?.getClientId().getValue()).toBe('e-commerce-spa');

    const events = auditLogger.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe('client_authenticated');
  });

  it('should throw unsupported_response_type when responseType is not code', async () => {
    await expect(
      handler.execute({
        clientId: 'e-commerce-spa',
        redirectUri: 'https://shop.local/callback',
        responseType: 'token',
        userId: 'user-1',
        tenantId: 'tenant-1',
      })
    ).rejects.toThrow(OAuth2AuthenticationError);

    try {
      await handler.execute({
        clientId: 'e-commerce-spa',
        redirectUri: 'https://shop.local/callback',
        responseType: 'token',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
    } catch (err: any) {
      expect(err.errorCode).toBe('unsupported_response_type');
    }
  });

  it('should throw invalid_client when client is not found', async () => {
    try {
      await handler.execute({
        clientId: 'unknown-client',
        redirectUri: 'https://shop.local/callback',
        responseType: 'code',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_client');
      expect(err.statusCode).toBe(401);
    }
  });

  it('should throw invalid_client when client is deactivated', async () => {
    try {
      await handler.execute({
        clientId: 'legacy-app', // legacy-app is deactivated in seed
        redirectUri: 'https://legacy.angelpixel.io/callback',
        responseType: 'code',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_client');
      expect(err.statusCode).toBe(401);
    }
  });

  it('should throw invalid_request when redirect_uri is not pre-registered', async () => {
    try {
      await handler.execute({
        clientId: 'e-commerce-spa',
        redirectUri: 'https://malicious.attacker.com/steal',
        responseType: 'code',
        codeChallenge: validChallenge,
        codeChallengeMethod: 'S256',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_request');
      expect(err.statusCode).toBe(400);
    }
  });

  it('should throw invalid_request when public client omits code_challenge', async () => {
    try {
      await handler.execute({
        clientId: 'e-commerce-spa',
        redirectUri: 'https://shop.local/callback',
        responseType: 'code',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_request');
      expect(err.errorDescription).toContain('code_challenge is required for public clients');
    }
  });

  it('should throw invalid_request when code_challenge_method is not S256 for public client', async () => {
    try {
      await handler.execute({
        clientId: 'e-commerce-spa',
        redirectUri: 'https://shop.local/callback',
        responseType: 'code',
        codeChallenge: validChallenge,
        codeChallengeMethod: 'plain',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_request');
      expect(err.errorDescription).toContain('must be S256');
    }
  });
});
