import util from 'util';
import { FederationStateManager } from '../../../../../src/contexts/identity/infrastructure/federation/federation_state_manager';

describe('Unit: FederationStateManager (Crypto & Anti-CSRF)', () => {
  let stateManager: FederationStateManager;

  beforeEach(() => {
    stateManager = new FederationStateManager({
      secret: 'unit-test-secret-key-at-least-32-chars-long',
      ttlSeconds: 60,
      clockToleranceSeconds: 5,
    });
  });

  describe('generateNonce', () => {
    it('should generate a 32-character hexadecimal random nonce with high entropy', () => {
      const nonce1 = stateManager.generateNonce();
      const nonce2 = stateManager.generateNonce();

      expect(typeof nonce1).toBe('string');
      expect(nonce1).toHaveLength(32);
      expect(nonce1).toMatch(/^[0-9a-f]{32}$/);
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('generateState & verifyState', () => {
    it('should generate a valid state token and verify it correctly', () => {
      const { state, nonce } = stateManager.generateState({
        tenantId: 'alpha-corp',
        clientId: 'web-spa',
        redirectUri: 'https://alpha.io/callback',
        provider: 'google',
      });

      expect(typeof state).toBe('string');
      expect(state.split('.')).toHaveLength(2);
      expect(typeof nonce).toBe('string');

      const payload = stateManager.verifyState(state);
      expect(payload.tenantId).toBe('alpha-corp');
      expect(payload.clientId).toBe('web-spa');
      expect(payload.redirectUri).toBe('https://alpha.io/callback');
      expect(payload.provider).toBe('google');
      expect(payload.nonce).toBe(nonce);
      expect(payload.createdAt).toBeLessThanOrEqual(Date.now());
      expect(payload.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should accept custom nonce when provided', () => {
      const { nonce } = stateManager.generateState({
        tenantId: 'beta-corp',
        redirectUri: 'https://beta.io/callback',
        provider: 'microsoft',
        nonce: 'custom-nonce-12345',
      });

      expect(nonce).toBe('custom-nonce-12345');
    });

    it('should throw when tenantId is empty or whitespace', () => {
      expect(() =>
        stateManager.generateState({
          tenantId: '   ',
          redirectUri: 'https://alpha.io/callback',
          provider: 'google',
        })
      ).toThrow('tenantId is required');
    });

    it('should throw when redirectUri is empty or whitespace', () => {
      expect(() =>
        stateManager.generateState({
          tenantId: 'alpha-corp',
          redirectUri: '',
          provider: 'google',
        })
      ).toThrow('redirectUri is required');
    });

    it('should throw when provider is invalid', () => {
      expect(() =>
        stateManager.generateState({
          tenantId: 'alpha-corp',
          redirectUri: 'https://alpha.io/cb',
          provider: 'github' as any,
        })
      ).toThrow('Invalid provider');
    });

    it('should reject state with invalid format (missing dot or extra segments)', () => {
      expect(() => stateManager.verifyState('invalid-state')).toThrow(
        'Invalid state token: malformed format'
      );
      expect(() => stateManager.verifyState('part1.part2.part3')).toThrow(
        'Invalid state token: malformed format'
      );
    });

    it('should reject state with empty or non-string input', () => {
      expect(() => stateManager.verifyState('')).toThrow(
        'Invalid state token: state is empty or not a string'
      );
      expect(() => stateManager.verifyState(null as any)).toThrow(
        'Invalid state token: state is empty or not a string'
      );
    });

    it('should reject state when signature is tampered', () => {
      const { state } = stateManager.generateState({
        tenantId: 'alpha-corp',
        redirectUri: 'https://alpha.io/callback',
        provider: 'google',
      });

      const [payload, signature] = state.split('.');
      const sig = signature || '';
      const tamperedSignature = sig.slice(0, -2) + (sig.endsWith('a') ? 'b' : 'a');
      const tamperedState = `${payload}.${tamperedSignature}`;

      expect(() => stateManager.verifyState(tamperedState)).toThrow(
        'Invalid state token: signature verification failed'
      );
    });

    it('should reject state signed with a different secret', () => {
      const otherManager = new FederationStateManager({
        secret: 'different-secret-key-32-chars-long-abc',
      });
      const { state } = otherManager.generateState({
        tenantId: 'alpha-corp',
        redirectUri: 'https://alpha.io/callback',
        provider: 'google',
      });

      expect(() => stateManager.verifyState(state)).toThrow(
        'Invalid state token: signature verification failed'
      );
    });

    it('should reject expired state', () => {
      const shortLivedManager = new FederationStateManager({
        secret: 'unit-test-secret-key-at-least-32-chars-long',
        ttlSeconds: -10, // already expired in the past
      });

      const { state } = shortLivedManager.generateState({
        tenantId: 'alpha-corp',
        redirectUri: 'https://alpha.io/callback',
        provider: 'google',
      });

      expect(() => stateManager.verifyState(state)).toThrow(
        'Invalid state token: state has expired'
      );
    });

    it('should redact secret in toString and util.inspect', () => {
      const stringified = stateManager.toString();
      expect(stringified).toContain('[REDACTED]');
      expect(stringified).not.toContain('unit-test-secret-key');

      const inspected = util.inspect(stateManager);
      expect(inspected).toContain('[REDACTED]');
      expect(inspected).not.toContain('unit-test-secret-key');
    });
  });
});
