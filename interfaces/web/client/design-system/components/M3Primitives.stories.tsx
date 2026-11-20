import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  M3AlertBanner,
  M3Button,
  M3Card,
  M3Chip,
  M3JsonViewer,
  M3NavigationRail,
  M3TextField,
} from './M3Primitives';

const meta: Meta<typeof M3Card> = {
  title: 'Design System M3/Primitives',
  component: M3Card,
};

export default meta;
type Story = StoryObj<typeof M3Card>;

export const ButtonsAndChips: Story = {
  render: () => (
    <M3Card variant="elevated">
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <M3Button variant="filled">Primary Action</M3Button>
        <M3Button variant="outlined">Secondary Action</M3Button>
        <M3Chip label="system · superadmin" tone="primary" />
        <M3Chip label="acme-corp" tone="neutral" />
      </div>
    </M3Card>
  ),
};

export const TextFieldsAndBanners: Story = {
  render: () => (
    <M3Card variant="outlined">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <M3TextField
          id="story-tenant"
          label="Tenant ID"
          defaultValue="acme-corp"
          helperText="Identificador aislado por RLS"
        />
        <M3TextField
          id="story-email"
          label="Email Corporativo"
          errorText="Formato de correo inválido"
        />
        <M3AlertBanner
          severity="error"
          title="403 Forbidden — Acceso Denegado (ADR-0009)"
          message="Requiere operador Root Tenant (system:superadmin)."
        />
      </div>
    </M3Card>
  ),
};

export const NavigationRailAndJsonViewer: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
      <M3NavigationRail
        ariaLabel="Storybook Platform Rail"
        items={[
          { id: 'overview', label: 'Resumen', shortCode: 'OV', href: '#overview', active: true },
          { id: 'audit', label: 'Auditoría', shortCode: 'AU', href: '#audit' },
          { id: 'metrics', label: 'Métricas', shortCode: 'MT', href: '#metrics' },
        ]}
      />
      <div style={{ flex: 1 }}>
        <M3JsonViewer
          title="W3C Trace & Telemetry Payload"
          badge="traceparent"
          data={{
            status: 'UP',
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-d91d81ccca879309-01',
          }}
        />
      </div>
    </div>
  ),
};
