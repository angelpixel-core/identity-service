import type { Meta, StoryObj } from '@storybook/react';
import { UserProfileCard } from './user_profile_card';
import { UserProfile } from '../../domain/types';

const meta: Meta<typeof UserProfileCard> = {
  title: 'Identity/UserProfileCard',
  component: UserProfileCard,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof UserProfileCard>;

const mockProfileAcme: UserProfile = {
  id: 'usr_89234b9a-4c21-4f88-8742-1e9a2631ef89',
  userId: 'usr_89234b9a-4c21-4f88-8742-1e9a2631ef89',
  email: 'carlos@acme.com',
  tenantId: 'acme-corp',
  createdAt: new Date('2026-11-04T12:00:00Z'),
  updatedAt: new Date('2026-11-04T12:00:00Z'),
};

const mockProfileBeta: UserProfile = {
  id: 'usr_f17a99c0-9981-42e1-8891-628a8d9b1092',
  userId: 'usr_f17a99c0-9981-42e1-8891-628a8d9b1092',
  email: 'valeria@beta-corp.com',
  tenantId: 'beta-corp',
  createdAt: new Date('2026-11-05T09:30:00Z'),
  updatedAt: new Date('2026-11-05T09:30:00Z'),
};

export const DefaultSuccess: Story = {
  args: {
    initialProfile: mockProfileAcme,
    fetchProfile: async () => mockProfileAcme,
  },
};

export const CustomTenantBeta: Story = {
  args: {
    initialProfile: mockProfileBeta,
    fetchProfile: async () => mockProfileBeta,
  },
};

export const LoadingState: Story = {
  args: {
    fetchProfile: () => new Promise<UserProfile>(() => {}), // Nunca resuelve para simular carga continua
  },
};

export const ErrorWithRetry: Story = {
  args: {
    fetchProfile: async () => {
      throw new Error('401 Unauthorized: Session token has expired or is invalid');
    },
  },
};

