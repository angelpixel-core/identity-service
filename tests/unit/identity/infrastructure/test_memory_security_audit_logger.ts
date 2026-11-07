import { InMemorySecurityAuditLogger } from '../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { SecurityAuditEvent } from '../../../../src/contexts/identity/application/ports/security/audit_logger';

describe('Infrastructure Adapter: InMemorySecurityAuditLogger', () => {
  let logger: InMemorySecurityAuditLogger;

  beforeEach(() => {
    logger = new InMemorySecurityAuditLogger();
  });

  it('should record security audit events and allow retrieving all events', async () => {
    const event: SecurityAuditEvent = {
      eventType: 'client_authenticated',
      clientId: 'order-service',
      timestamp: new Date(),
      ip: '127.0.0.1',
      metadata: { scope: 'identity:read' },
    };

    await logger.logEvent(event);

    const recorded = logger.getEvents();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.eventType).toBe('client_authenticated');
    expect(recorded[0]?.clientId).toBe('order-service');
  });

  it('should filter events by clientId', async () => {
    await logger.logEvent({
      eventType: 'client_authenticated',
      clientId: 'service-a',
      timestamp: new Date(),
    });

    await logger.logEvent({
      eventType: 'client_authentication_failed',
      clientId: 'service-b',
      timestamp: new Date(),
      reason: 'invalid_client',
    });

    const eventsA = logger.getEventsByClientId('service-a');
    expect(eventsA).toHaveLength(1);
    expect(eventsA[0]?.clientId).toBe('service-a');

    const eventsB = logger.getEventsByClientId('service-b');
    expect(eventsB).toHaveLength(1);
    expect(eventsB[0]?.clientId).toBe('service-b');
  });

  it('should clear stored events', async () => {
    await logger.logEvent({
      eventType: 'client_authenticated',
      clientId: 'service-a',
      timestamp: new Date(),
    });

    expect(logger.getEvents()).toHaveLength(1);
    logger.clear();
    expect(logger.getEvents()).toHaveLength(0);
  });
});