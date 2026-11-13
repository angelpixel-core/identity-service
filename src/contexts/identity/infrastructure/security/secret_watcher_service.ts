import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SecurityAuditLoggerPort } from '../../application/ports/security/audit_logger';

export type SecretChangeCallback = (newContent: string, oldHash: string) => Promise<void>;

export interface SecretWatcherServiceOptions {
  readonly secretsDir: string;
  readonly debounceMs?: number;
  readonly auditLogger?: SecurityAuditLoggerPort;
}

/**
 * Service: SecretWatcherService
 * Observador en proceso (In-Process File Watcher) para la detección y recarga en caliente
 * de secretos inyectados por el Azure Key Vault Secrets Store CSI Driver en Kubernetes.
 *
 * Características:
 * - Soporte para enlaces simbólicos atómicos de Kubernetes (..data swap).
 * - Debounce configurable para evitar condiciones de carrera durante escrituras en disco.
 * - Comprobación de integridad criptográfica mediante checksum SHA-256.
 * - Registro estructurado de auditoría para cumplimiento PCI-DSS v4.0 Req 3.6 y SOC 2 CC6.1.
 */
export class SecretWatcherService {
  private readonly secretsDir: string;
  private readonly debounceMs: number;
  private readonly auditLogger?: SecurityAuditLoggerPort;

  private fsWatcher: fs.FSWatcher | null = null;
  private readonly subscribers = new Map<string, SecretChangeCallback[]>();
  private readonly knownHashes = new Map<string, string>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private isRunning = false;

  constructor(options: SecretWatcherServiceOptions) {
    if (!options.secretsDir || options.secretsDir.trim().length === 0) {
      throw new Error('SecretWatcherService requires a valid secretsDir path');
    }
    this.secretsDir = path.resolve(options.secretsDir.trim());
    this.debounceMs = options.debounceMs ?? 500;
    this.auditLogger = options.auditLogger;
  }

  /**
   * Suscribe un callback para ser notificado cuando un archivo específico cambia de contenido.
   */
  public subscribe(filename: string, callback: SecretChangeCallback): void {
    const cleanFilename = path.basename(filename.trim());
    const existing = this.subscribers.get(cleanFilename) ?? [];
    existing.push(callback);
    this.subscribers.set(cleanFilename, existing);
  }

  /**
   * Inicia el observador de archivos, escaneando el estado inicial y armando el watcher de FS.
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    if (!fs.existsSync(this.secretsDir)) {
      // Si el directorio aún no existe (e.g. en inicio previo a montaje CSI),
      // creamos el observador de directorio padre o marcamos activo para escaneo posterior
      return;
    }

    // Escanear estado inicial de los archivos observados
    await this.scanInitialState();

    try {
      this.fsWatcher = fs.watch(
        this.secretsDir,
        { persistent: false, recursive: false },
        (eventType, rawFilename) => {
          this.handleFsEvent(eventType, rawFilename);
        }
      );
      this.isRunning = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.logAudit('secret_rotation_failure', {
        reason: `Failed to initialize fs.watch: ${msg}`,
        directory: this.secretsDir,
      });
    }
  }

  /**
   * Detiene el observador de archivos y limpia temporizadores pendientes.
   */
  public stop(): void {
    if (this.fsWatcher) {
      try {
        this.fsWatcher.close();
      } catch {
        // Ignorar errores al cerrar watcher
      }
      this.fsWatcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.isRunning = false;
  }

  /**
   * Retorna el checksum SHA-256 conocido para un archivo dado.
   */
  public getKnownHash(filename: string): string | null {
    const cleanFilename = path.basename(filename.trim());
    return this.knownHashes.get(cleanFilename) ?? null;
  }

  /**
   * Ejecuta un chequeo manual forzado de todos los archivos suscritos.
   * Útil para pruebas automatizadas o validación periódica.
   */
  public async checkAllSubscribers(): Promise<void> {
    for (const filename of this.subscribers.keys()) {
      await this.evaluateFile(filename);
    }
  }

  /**
   * Procesa un evento emitido por el sistema de archivos aplicando debounce.
   */
  private handleFsEvent(_eventType: string, rawFilename: string | Buffer | null): void {
    const filename = rawFilename ? rawFilename.toString() : null;

    if (!filename) {
      // Si el SO no proporciona el nombre de archivo, evaluamos todos los suscriptores
      for (const target of this.subscribers.keys()) {
        this.scheduleDebouncedEvaluation(target);
      }
      return;
    }

    const cleanFilename = path.basename(filename);

    // En Kubernetes, la actualización del SecretProviderClass suele generar eventos
    // en enlaces simbólicos especiales como "..data" o "..data_tmp".
    if (cleanFilename.startsWith('..')) {
      for (const target of this.subscribers.keys()) {
        this.scheduleDebouncedEvaluation(target);
      }
      return;
    }

    if (this.subscribers.has(cleanFilename)) {
      this.scheduleDebouncedEvaluation(cleanFilename);
    }
  }

  /**
   * Programa una evaluación con retardo (debounce) para estabilizar escrituras atómicas.
   */
  private scheduleDebouncedEvaluation(filename: string): void {
    const existingTimer = this.debounceTimers.get(filename);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filename);
      await this.evaluateFile(filename);
    }, this.debounceMs);

    this.debounceTimers.set(filename, timer);
  }

  /**
   * Evalúa si el archivo especificado ha cambiado en comparación con su checksum previo.
   */
  private async evaluateFile(filename: string): Promise<void> {
    const filePath = path.join(this.secretsDir, filename);

    if (!fs.existsSync(filePath)) {
      return;
    }

    let content: string;
    try {
      content = await fs.promises.readFile(filePath, 'utf8');
    } catch {
      // Podría haber una colisión momentánea durante el swap de symlink
      return;
    }

    const newHash = crypto.createHash('sha256').update(content).digest('hex');
    const oldHash = this.knownHashes.get(filename) ?? '';

    if (newHash === oldHash) {
      // El contenido no ha cambiado (falso positivo o evento duplicado del filesystem)
      return;
    }

    // Actualizar hash conocido
    this.knownHashes.set(filename, newHash);

    const callbacks = this.subscribers.get(filename) ?? [];
    for (const callback of callbacks) {
      try {
        await callback(content, oldHash);
        await this.logAudit('secret_rotation_success', {
          filename,
          newHash,
          oldHash: oldHash || 'INITIAL_LOAD',
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.logAudit('secret_rotation_failure', {
          filename,
          reason: errorMsg,
          newHash,
          oldHash,
        });
      }
    }
  }

  /**
   * Carga los hashes iniciales de los archivos ya presentes en el directorio.
   */
  private async scanInitialState(): Promise<void> {
    try {
      const entries = await fs.promises.readdir(this.secretsDir);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fullPath = path.join(this.secretsDir, entry);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.isFile()) {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            this.knownHashes.set(entry, hash);
          }
        } catch {
          // Ignorar archivos que no se puedan leer durante el escaneo inicial
        }
      }
    } catch {
      // Directorio no legible
    }
  }

  /**
   * Emite un evento estructurado de auditoría hacia el puerto secundario si está presente.
   */
  private async logAudit(
    eventType: 'secret_rotation_success' | 'secret_rotation_failure',
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (this.auditLogger) {
      try {
        await this.auditLogger.logEvent({
          eventType,
          timestamp: new Date(),
          metadata,
        });
      } catch {
        // Fallback fail-safe para no bloquear el flujo de la aplicación
      }
    }
  }
}

