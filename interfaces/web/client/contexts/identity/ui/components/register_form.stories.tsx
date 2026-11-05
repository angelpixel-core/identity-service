import type { Meta, StoryObj } from '@storybook/react';
import { RegisterForm } from './register_form';
import { AuthApiClient } from '../../data/api';
import { AuthSession } from '../../domain/types';

const meta: Meta<typeof RegisterForm> = {
  title: 'Identity/RegisterForm',
  component: RegisterForm,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof RegisterForm>;

// Fake API client con respuesta exitosa
const successMockClient: AuthApiClient = {
  register: async (credentials) => {
    return {
      token: 'mock-jwt-token-ey...',
      userId: 'mock-uuid-1234',
      email: credentials.email,
      tenantId: credentials.tenantId,
    };
  },
};

// Fake API client con error de conflicto (409)
const conflictMockClient: AuthApiClient = {
  register: async (credentials) => {
    throw new Error(`User with email ${credentials.email} already exists in tenant ${credentials.tenantId}`);
  },
};

// Fake API client con retraso para ver estado de carga
const slowMockClient: AuthApiClient = {
  register: async (credentials) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return {
      token: 'mock-jwt-token-ey...',
      userId: 'mock-uuid-1234',
      email: credentials.email,
      tenantId: credentials.tenantId,
    };
  },
};

export const Default: Story = {
  args: {
    defaultTenantId: 'acme-corp',
    apiClient: successMockClient,
    onSuccess: (session: AuthSession) => {
      alert(`Usuario registrado con éxito para tenant: ${session.tenantId}`);
    },
  },
};

export const CustomTenant: Story = {
  args: {
    defaultTenantId: 'beta-corp',
    apiClient: successMockClient,
  },
};

export const ConflictError: Story = {
  args: {
    defaultTenantId: 'acme-corp',
    apiClient: conflictMockClient,
  },
};

export const SlowNetworkLoading: Story = {
  args: {
    defaultTenantId: 'acme-corp',
    apiClient: slowMockClient,
  },
};

