import {
  sanitizeAuditDetails,
  sanitizeAuditValue,
  isSensitiveKey,
  sanitizeString,
  REDACTED_VALUE,
} from '../../../../../src/contexts/identity/domain/security/audit_sanitizer';

describe('Domain Security: AuditSanitizer (PCI-DSS 3.4 / 10.5 & SOC 2 CC7.2)', () => {
  describe('isSensitiveKey', () => {
    it('should identify sensitive keys in various naming conventions (camelCase, snake_case, kebab-case)', () => {
      const sensitiveKeys = [
        'password',
        'user_password',
        'currentPassword',
        'clientSecret',
        'client_secret',
        'shared_secret',
        'token',
        'accessToken',
        'access_token',
        'refreshToken',
        'refresh_token',
        'idToken',
        'authorizationCode',
        'auth_code',
        'code',
        'privateKey',
        'private_key',
        'secretKey',
        'apiKey',
        'api_key',
        'pan',
        'cardNumber',
        'card_number',
        'cvv',
        'cvc',
        'pin',
        'ssn',
      ];

      for (const key of sensitiveKeys) {
        expect(isSensitiveKey(key)).toBe(true);
      }
    });

    it('should allow legitimate non-sensitive keys', () => {
      const benignKeys = [
        'tenantId',
        'userId',
        'clientId',
        'email',
        'scope',
        'ip',
        'requestId',
        'correlationId',
        'action',
        'status',
        'statusCode',
        'timestamp',
      ];

      for (const key of benignKeys) {
        expect(isSensitiveKey(key)).toBe(false);
      }
    });
  });

  describe('sanitizeString', () => {
    it('should redact JWT tokens embedded within text', () => {
      const sampleJwt =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const input = `Authorization header failed with Bearer ${sampleJwt} in request`;
      const result = sanitizeString(input);

      expect(result).not.toContain(sampleJwt);
      expect(result).toContain(REDACTED_VALUE);
    });

    it('should redact PEM private keys embedded within text', () => {
      const samplePem =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y7Vv...\n-----END RSA PRIVATE KEY-----';
      const input = `Error reading file:\n${samplePem}`;
      const result = sanitizeString(input);

      expect(result).not.toContain('MIIEowIBAAKCAQEA0Y7Vv');
      expect(result).toContain(REDACTED_VALUE);
    });

    it('should redact credit card PANs embedded within text', () => {
      const samplePan1 = '4111 2222 3333 4444';
      const samplePan2 = '5500000000000004';
      const input = `Payment rejected for PAN: ${samplePan1} and alternate: ${samplePan2}`;
      const result = sanitizeString(input);

      expect(result).not.toContain(samplePan1);
      expect(result).not.toContain(samplePan2);
      expect(result).toContain(REDACTED_VALUE);
    });

    it('should leave non-sensitive text unaltered', () => {
      const input = 'User usr_123 successfully authenticated from 192.168.1.1';
      expect(sanitizeString(input)).toBe(input);
    });
  });

  describe('sanitizeAuditValue & sanitizeAuditDetails', () => {
    it('should redact direct sensitive keys in flat objects', () => {
      const input = {
        tenantId: 'alpha-corp',
        userId: 'usr_abc123',
        password: 'SuperSecretPassword123!',
        clientSecret: 'secret_xyz987',
        refreshToken: 'rt_mock_token_abc',
      };

      const sanitized = sanitizeAuditDetails(input);

      expect(sanitized.tenantId).toBe('alpha-corp');
      expect(sanitized.userId).toBe('usr_abc123');
      expect(sanitized.password).toBe(REDACTED_VALUE);
      expect(sanitized.clientSecret).toBe(REDACTED_VALUE);
      expect(sanitized.refreshToken).toBe(REDACTED_VALUE);
    });

    it('should recursively redact sensitive keys in deeply nested objects', () => {
      const input = {
        meta: {
          client: {
            id: 'mobile-app',
            secret: 'raw-client-secret',
          },
          auth: {
            credentials: {
              password: 'nested-secret-password',
            },
          },
        },
      };

      const sanitized = sanitizeAuditDetails(input) as any;

      expect(sanitized.meta.client.id).toBe('mobile-app');
      expect(sanitized.meta.client.secret).toBe(REDACTED_VALUE);
      expect(sanitized.meta.auth.credentials.password).toBe(REDACTED_VALUE);
    });

    it('should redact sensitive elements within arrays of objects and strings', () => {
      const input = {
        tokens: ['plain-token-1', 'plain-token-2'],
        users: [
          { name: 'Alice', password: 'alice-secret' },
          { name: 'Bob', password: 'bob-secret' },
        ],
      };

      const sanitized = sanitizeAuditDetails(input) as any;

      expect(sanitized.tokens).toBe(REDACTED_VALUE); // 'tokens' key matches /token/i
      expect(sanitized.users[0].name).toBe('Alice');
      expect(sanitized.users[0].password).toBe(REDACTED_VALUE);
      expect(sanitized.users[1].name).toBe('Bob');
      expect(sanitized.users[1].password).toBe(REDACTED_VALUE);
    });

    it('should handle circular references gracefully without stack overflow', () => {
      const circularObj: any = {
        tenantId: 'alpha-corp',
        nested: { count: 42 },
      };
      circularObj.self = circularObj;
      circularObj.nested.parent = circularObj;

      const sanitized = sanitizeAuditDetails(circularObj) as any;

      expect(sanitized.tenantId).toBe('alpha-corp');
      expect(sanitized.nested.count).toBe(42);
      expect(sanitized.self).toBe('[CIRCULAR]');
      expect(sanitized.nested.parent).toBe('[CIRCULAR]');
    });

    it('should preserve original input immutability', () => {
      const original = {
        password: 'TopSecretPassword!',
        data: {
          token: 'active_token',
        },
      };

      const clonedOriginal = JSON.parse(JSON.stringify(original));
      sanitizeAuditDetails(original);

      expect(original).toEqual(clonedOriginal);
    });

    it('should format Date objects to ISO strings and redact Error objects', () => {
      const date = new Date('2026-11-16T12:00:00.000Z');
      const error = new Error('Database connection failed with pass=secret_123 in url');

      const input = {
        timestamp: date,
        failureReason: error,
      };

      const sanitized = sanitizeAuditDetails(input) as any;

      expect(sanitized.timestamp).toBe('2026-11-16T12:00:00.000Z');
      expect(sanitized.failureReason.name).toBe('Error');
      expect(sanitized.failureReason.message).not.toContain('secret_123');
    });

    it('should handle primitives, null and undefined gracefully', () => {
      expect(sanitizeAuditValue(null)).toBeNull();
      expect(sanitizeAuditValue(undefined)).toBeUndefined();
      expect(sanitizeAuditValue(12345)).toBe(12345);
      expect(sanitizeAuditValue(true)).toBe(true);
      expect(sanitizeAuditDetails(undefined)).toEqual({});
    });
  });
});
