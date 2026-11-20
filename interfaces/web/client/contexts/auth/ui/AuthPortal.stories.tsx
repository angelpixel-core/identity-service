import type { Meta, StoryObj } from '@storybook/react-vite';
import { AuthPortalView } from './AuthPortalView';
import { M3Card } from '../../../design-system/components/M3Primitives';

const meta: Meta<typeof AuthPortalView> = {
  title: 'Surfaces/Auth Portal (US-24)',
  component: AuthPortalView,
};

export default meta;
type Story = StoryObj<typeof AuthPortalView>;

export const UnauthenticatedPortal: Story = {
  render: () => (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <M3Card variant="elevated">
        <AuthPortalView
          session={null}
          onSessionChange={() => {}}
          onLogout={() => {}}
          fetchProfile={async () => ({
            email: 'demo@acme-corp.com',
            tenantId: 'acme-corp',
          })}
        />
      </M3Card>
    </div>
  ),
};
