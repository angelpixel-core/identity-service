import fs from 'fs';
import path from 'path';
import os from 'os';
import { SecretWatcherService } from '../../../../../src/contexts/identity/infrastructure/security/secret_watcher_service';
import {
  SecurityAuditEvent,
  SecurityAuditLoggerPort,
} from '../../../../../src/contexts/identity/application/ports/security/audit_logger';

class MockAuditLogger implements SecurityAuditLoggerPort {
  public loggedEvents: SecurityAuditEvent[] = [];

  public async logEvent(event: SecurityAuditEvent): Promise<void> {
    this.loggedEvents.push(event);
  }
}

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 25
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor condition timed out after ${timeoutMs}ms`);
};

describe('Unit: SecretWatcherService (US-16 In-Process File Watcher)', () => {
  let tempDir: string;
  let mockAuditLogger: MockAuditLogger;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'secret-watcher-test-'));
    mockAuditLogger = new MockAuditLogger();
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  it('should throw an error if secretsDir is empty or whitespace', () => {
    expect(() => new SecretWatcherService({ secretsDir: '' })).toThrow(
      'SecretWatcherService requires a valid secretsDir path'
    );
    expect(() => new SecretWatcherService({ secretsDir: '   ' })).toThrow(
      'SecretWatcherService requires a valid secretsDir path'
    );
  });

  it('should scan initial files without triggering callbacks on start()', async () => {
    const initialDbPass = 'initial_password_123';
    await fs.promises.writeFile(path.join(tempDir, 'database-password'), initialDbPass, 'utf8');

    const watcher = new SecretWatcherService({
      secretsDir: tempDir,
      debounceMs: 50,
      auditLogger: mockAuditLogger,
    });

    const callback = jest.fn().mockResolvedValue(undefined);
    watcher.subscribe('database-password', callback);

    await watcher.start();

    // The initial hash must be recorded, but callback should not be invoked yet
    expect(watcher.getKnownHash('database-password')).toBeTruthy();
    expect(callback).not.toHaveBeenCalled();

    watcher.stop();
  });

  it('should trigger callback and log audit event when a subscribed file is modified', async () => {
    const filePath = path.join(tempDir, 'database-password');
    await fs.promises.writeFile(filePath, 'version-1', 'utf8');

    const watcher = new SecretWatcherService({
      secretsDir: tempDir,
      debounceMs: 50,
      auditLogger: mockAuditLogger,
    });

    const callback = jest.fn().mockResolvedValue(undefined);
    watcher.subscribe('database-password', callback);

    await watcher.start();

    // Modify file
    await fs.promises.writeFile(filePath, 'version-2-rotated', 'utf8');

    // Wait for debounce timer to fire
    await waitFor(() => callback.mock.calls.length > 0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('version-2-rotated', expect.any(String));

    expect(mockAuditLogger.loggedEvents).toHaveLength(1);
    expect(mockAuditLogger.loggedEvents[0]?.eventType).toBe('secret_rotation_success');
    expect(mockAuditLogger.loggedEvents[0]?.metadata?.filename).toBe('database-password');

    watcher.stop();
  });

  it('should debounce multiple rapid writes and only fire once with final content', async () => {
    const filePath = path.join(tempDir, 'jwt-secret');
    await fs.promises.writeFile(filePath, 'initial', 'utf8');

    const watcher = new SecretWatcherService({
      secretsDir: tempDir,
      debounceMs: 80,
      auditLogger: mockAuditLogger,
    });

    const callback = jest.fn().mockResolvedValue(undefined);
    watcher.subscribe('jwt-secret', callback);

    await watcher.start();

    // Trigger rapid successive writes
    await fs.promises.writeFile(filePath, 'rapid-write-1', 'utf8');
    await new Promise((r) => setTimeout(r, 20));
    await fs.promises.writeFile(filePath, 'rapid-write-2', 'utf8');
    await new Promise((r) => setTimeout(r, 20));
    await fs.promises.writeFile(filePath, 'final-stable-write', 'utf8');

    // Wait past the debounce delay until callback fires
    await waitFor(() => callback.mock.calls.length > 0);

    // Wait a short extra interval to confirm no second call arrives
    await new Promise((r) => setTimeout(r, 100));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('final-stable-write', expect.any(String));

    watcher.stop();
  });

  it('should not invoke callback if file is overwritten with identical content (hash deduplication)', async () => {
    const filePath = path.join(tempDir, 'database-url');
    const content = 'postgresql://user:pass@localhost:5432/id_db';
    await fs.promises.writeFile(filePath, content, 'utf8');

    const watcher = new SecretWatcherService({
      secretsDir: tempDir,
      debounceMs: 50,
      auditLogger: mockAuditLogger,
    });

    const callback = jest.fn().mockResolvedValue(undefined);
    watcher.subscribe('database-url', callback);

    await watcher.start();

    // Overwrite with identical content
    await fs.promises.writeFile(filePath, content, 'utf8');
    await new Promise((r) => setTimeout(r, 120));

    expect(callback).not.toHaveBeenCalled();

    watcher.stop();
  });

  it('should log secret_rotation_failure audit event if subscriber callback throws', async () => {
    const filePath = path.join(tempDir, 'database-password');
    await fs.promises.writeFile(filePath, 'version-1', 'utf8');

    const watcher = new SecretWatcherService({
      secretsDir: tempDir,
      debounceMs: 50,
      auditLogger: mockAuditLogger,
    });

    const failingCallback = jest.fn().mockRejectedValue(new Error('Pool connection test failed'));
    watcher.subscribe('database-password', failingCallback);

    await watcher.start();

    await fs.promises.writeFile(filePath, 'version-bad', 'utf8');
    await waitFor(() => failingCallback.mock.calls.length > 0);

    expect(failingCallback).toHaveBeenCalledTimes(1);
    expect(mockAuditLogger.loggedEvents).toHaveLength(1);
    expect(mockAuditLogger.loggedEvents[0]?.eventType).toBe('secret_rotation_failure');
    expect(mockAuditLogger.loggedEvents[0]?.metadata?.reason).toContain('Pool connection test failed');

    watcher.stop();
  });

  it('should simulate Kubernetes atomic symlink swap and detect secret rotation', async () => {
    // Kubernetes CSI mounts create a structure like:
    // /mnt/secrets-store/
    //   ..data -> ..2026_01_01_dir
    //   secret.txt -> ..data/secret.txt
    const dataDirV1 = path.join(tempDir, '..data_v1');
    const dataDirV2 = path.join(tempDir, '..data_v2');
    const symlinkData = path.join(tempDir, '..data');
    const fileTarget = path.join(tempDir, 'api-key.txt');

    await fs.promises.mkdir(dataDirV1);
    await fs.promises.writeFile(path.join(dataDirV1, 'api-key.txt'), 'key_version_1', 'utf8');

    await fs.promises.mkdir(dataDirV2);
    await fs.promises.writeFile(path.join(dataDirV2, 'api-key.txt'), 'key_version_2_rotated', 'utf8');

    // Create initial symlinks
    await fs.promises.symlink(dataDirV1, symlinkData);
    await fs.promises.symlink(path.join(symlinkData, 'api-key.txt'), fileTarget);

    const watcher = new SecretWatcherService({
      secretsDir: tempDir,
      debounceMs: 50,
      auditLogger: mockAuditLogger,
    });

    const callback = jest.fn().mockResolvedValue(undefined);
    watcher.subscribe('api-key.txt', callback);

    await watcher.start();

    // Perform atomic symlink swap: update ..data to point to dataDirV2
    const tempSymlink = path.join(tempDir, '..data_tmp');
    await fs.promises.symlink(dataDirV2, tempSymlink);
    await fs.promises.rename(tempSymlink, symlinkData);

    // Wait for watcher debounce to trigger
    await waitFor(() => callback.mock.calls.length > 0);

    expect(callback).toHaveBeenCalledWith('key_version_2_rotated', expect.any(String));

    watcher.stop();
  });

  it('should stop cleanly and prevent any callbacks from firing after stop()', async () => {
    const filePath = path.join(tempDir, 'redis-url');
    await fs.promises.writeFile(filePath, 'redis://localhost:6379', 'utf8');

    const watcher = new SecretWatcherService({
      secretsDir: tempDir,
      debounceMs: 50,
      auditLogger: mockAuditLogger,
    });

    const callback = jest.fn().mockResolvedValue(undefined);
    watcher.subscribe('redis-url', callback);

    await watcher.start();
    watcher.stop();

    await fs.promises.writeFile(filePath, 'redis://rotated:6379', 'utf8');
    await new Promise((r) => setTimeout(r, 120));

    expect(callback).not.toHaveBeenCalled();
  });
});
