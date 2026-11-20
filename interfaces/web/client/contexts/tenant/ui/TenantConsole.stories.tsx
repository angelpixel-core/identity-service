import type { Meta, StoryObj } from '@storybook/react-vite';
import { TenantConsoleView } from './TenantConsoleView';
import { M3Card } from '../../../design-system/components/M3Primitives';

const meta: Meta<typeof TenantConsoleView> = {
  title: 'Surfaces/Tenant Console (US-25)',
  component: TenantConsoleView,
};

export default meta;
type Story = StoryObj<typeof TenantConsoleView>;

export const ActiveTenantConsole: Story = {
  render: () => (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <M3Card variant="elevated">
        <TenantConsoleView
          session={{
            token: 'story-demo-jwt',
            userId: 'usr_acme_01',
            email: 'admin@acme-corp.com',
            tenantId: 'acme-corp',
            roles: ['member'],
          }}
        />
      </M3Card>
    </div>
  ),
};
