import { z } from 'zod';

/**
 * Esquema de validación para el payload de registro de usuario en la API REST.
 * Aplica reglas estrictas de formato para email y longitud mínima de contraseña.
 */
export const RegisterUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  tenantId: z.string().optional(),
});

export type RegisterUserPayload = z.infer<typeof RegisterUserSchema>;
