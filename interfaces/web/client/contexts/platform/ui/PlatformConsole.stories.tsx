import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlatformConsoleView } from './PlatformConsoleView';
import { M3Card } from '../../../design-system/components/M3Primitives';

const meta: Meta<typeof PlatformConsoleView> = {
  title: 'Surfaces/Platform Console (US-26)',
  component: PlatformConsoleView,
};

export default meta;
type Story = StoryObj<typeof PlatformConsoleView>;

export const RootSuperadminConsole: Story = {
  render: () => (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <M3Card variant="elevated">
        <PlatformConsoleView
          session={{
            token: 'story-root-superadmin-jwt',
            userId: 'usr_root_01',
            email: 'admin@angelpixel.io',
            tenantId: 'system',
            roles: ['superadmin', 'member'],
          }}
        />
      </M3Card>
    </div>
  ),
};
