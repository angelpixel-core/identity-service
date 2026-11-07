import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { TenantSessionContext } from '../../../domain/value_objects/tenant_session_context/value';
import { DatabaseClient } from '../../../infrastructure/persistence/repositories/user/repository';

/**
 * Secondary Port (SPI): TenantTransactionRunnerPort
 * Contrato de ejecución transaccional vinculado a un contexto multi-tenant.
 * Orquesta transacciones PostgreSQL donde se establece la variable de sesión
 * `app.current_tenant_id` con alcance LOCAL, garantizando que el motor
 * aplique políticas de Row-Level Security (RLS) de forma determinista y fail-closed.
 */
export interface TenantTransactionRunnerPort {
  /**
   * Ejecuta una operación atómica dentro del contexto transaccional del tenant indicado.
   *
   * @param tenant Identificador del tenant (TenantSessionContext, TenantId o string no vacío).
   * @param operation Callback transaccional que recibe la conexión de base de datos activa y el contexto de sesión.
   * @returns Resultado tipado devuelto por el callback de la operación.
   */
  runInTenantContext<T>(
    tenant: TenantSessionContext | TenantId | string,
    operation: (client: DatabaseClient, session: TenantSessionContext) => Promise<T>
  ): Promise<T>;
}
