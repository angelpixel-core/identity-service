import {
  KeyVaultProbe,
  KeyVaultProvider,
} from '../../../../../src/contexts/shared/infrastructure/health/probes/keyvault_probe';

describe('Infrastructure Health Probe: KeyVaultProbe (US-22)', () => {
  it('should return status OK when JWKS exposes active cryptographic keys', async () => {
    const mockKeyProvider: KeyVaultProvider = {
      getJwks: async () => ({
        keys: [
          {
            kty: 'RSA',
            use: 'sig',
            alg: 'RS256',
            kid: 'active-key-1',
            n: 'modulus',
            e: 'AQAB',
          },
        ],
      }),
    };

    const probe = new KeyVaultProbe(mockKeyProvider, 1000);
    const result = await probe.check();

    expect(result.name).toBe('keyvault');
    expect(result.status).toBe('OK');
    expect(result.isCritical).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
    expect(result.reason).toBeUndefined();
  });

  it('should return status DOWN when JWKS returns empty keys array', async () => {
    const mockKeyProvider: KeyVaultProvider = {
      getJwks: async () => ({ keys: [] }),
    };

    const probe = new KeyVaultProbe(mockKeyProvider, 1000);
    const result = await probe.check();

    expect(result.name).toBe('keyvault');
    expect(result.status).toBe('DOWN');
    expect(result.isCritical).toBe(true);
    expect(result.reason).toBe('No active signing keys available in JWKS');
  });

  it('should return status DOWN when getJwks throws an exception', async () => {
    const mockKeyProvider: KeyVaultProvider = {
      getJwks: async () => {
        throw new Error('Azure Key Vault secret expired');
      },
    };

    const probe = new KeyVaultProbe(mockKeyProvider, 1000);
    const result = await probe.check();

    expect(result.name).toBe('keyvault');
    expect(result.status).toBe('DOWN');
    expect(result.isCritical).toBe(true);
    expect(result.reason).toBe('Azure Key Vault secret expired');
  });

  it('should return status TIMEOUT when key provider exceeds timeoutMs', async () => {
    const mockKeyProvider: KeyVaultProvider = {
      getJwks: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { keys: [{ kid: 'k1' }] };
      },
    };

    const probe = new KeyVaultProbe(mockKeyProvider, 30);
    const result = await probe.check();

    expect(result.name).toBe('keyvault');
    expect(result.status).toBe('TIMEOUT');
    expect(result.isCritical).toBe(true);
    expect(result.reason).toContain('KeyVault probe timed out after 30ms');
  });
});
