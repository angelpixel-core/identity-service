/**
 * Global Jest Test Environment Setup
 *
 * Enforces strict environment isolation, prevents dotenv from hijacking NODE_ENV,
 * and ensures tests always run with in-memory adapters and zero external network leaks.
 */

// 1. Inicializar por defecto NODE_ENV='test' permitiendo mutabilidad controlada en pruebas
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// 2. Silenciar mensajes de diagnóstico ruidosos de dotenv en entorno de pruebas
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('injected env') || args[0].includes('dotenv'))
  ) {
    return;
  }
  originalConsoleError(...args);
};
