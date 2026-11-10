import { z } from 'zod';

export const FederatedLoginQuerySchema = z.object({
  tenant_id: z.string({ error: 'tenant_id is required' }).min(1, 'tenant_id is required'),
  client_id: z.string().optional(),
  redirect_uri: z.string({ error: 'redirect_uri is required' }).min(1, 'redirect_uri is required'),
  prompt: z.string().optional(),
  login_hint: z.string().optional(),
  format: z.enum(['json', 'redirect']).optional(),
});

export const FederatedCallbackQuerySchema = z.object({
  code: z.string({ error: 'code is required' }).min(1, 'code is required'),
  state: z.string({ error: 'state is required' }).min(1, 'state is required'),
});

export const ProviderParamSchema = z.enum(['google', 'microsoft']);
