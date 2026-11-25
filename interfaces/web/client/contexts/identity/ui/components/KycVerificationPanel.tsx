import { useEffect, useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3Chip,
} from '../../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../../shared/api_client';
import { AuthSession } from '../../domain/types';
import { KycBadgeStatus } from './user_profile_card';

export interface KycStatusSnapshot {
  readonly status: KycBadgeStatus;
  readonly level: string;
  readonly kycVerified: boolean;
  readonly providerRef: string | null;
}

export interface KycVerificationPanelProps {
  readonly session: AuthSession;
  readonly kycMinLevel?: string;
  readonly kycRequired?: boolean;
  readonly onStatusChange?: (status: KycBadgeStatus) => void;
}

/**
 * Panel de Verificación KYC / Prueba de Vida en /auth -> Cuenta (US-37).
 * Delega la captura al adaptador externo (Zero-Biometric-PII).
 */
export function KycVerificationPanel({
  session,
  kycMinLevel = 'basic',
  kycRequired = false,
  onStatusChange,
}: KycVerificationPanelProps) {
  const [snapshot, setSnapshot] = useState<KycStatusSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const res = await apiRequest<KycStatusSnapshot>('/api/v1/auth/kyc/status', {
        token: session.token,
        tenantId: session.tenantId,
      });
      if (res.ok && res.data?.status) {
        setSnapshot(res.data);
        onStatusChange?.(res.data.status);
      }
    } catch {
      // ignore offline/mocked environments
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [session.token, session.tenantId]);

  const handleStartKyc = async () => {
    setStarting(true);
    setError(null);
    setNotice(null);
    try {
      // Verificación opcional de cámara en cliente (sin enviar ni almacenar video en el core)
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          // Fallback limpio a flujo determinista cuando no hay cámara o permisos
        }
      }

      const res = await apiRequest<
        KycStatusSnapshot & { sessionUrl?: string; mode?: string; message?: string; error?: string }
      >('/api/v1/auth/kyc/sessions', {
        method: 'POST',
        token: session.token,
        tenantId: session.tenantId,
        body: { level: kycMinLevel === 'biometric_liveness' ? 'biometric_liveness' : 'basic' },
      });

      if (!res.ok) {
        setError(res.data?.message ?? res.data?.error ?? 'No se pudo iniciar la verificación KYC');
        return;
      }

      setSnapshot(res.data);
      onStatusChange?.(res.data.status);
      setNotice(
        `Sesión KYC iniciada (${res.data.providerRef ?? 'pending'}). Completa la verificación con el proveedor.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error iniciando verificación KYC');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      className="m3-card m3-card--outlined"
      style={{ padding: '1rem', marginTop: '1rem' }}
      data-testid="kyc-verification-panel"
    >
      <div className="m3-row-between" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.2rem' }}>
            Verificación de Identidad (KYC)
          </h3>
          <p className="m3-workspace-subtitle">
            {kycRequired
              ? `Requerida por la política del tenant (nivel: ${kycMinLevel}).`
              : 'Verificación de identidad desacoplada (Zero-Biometric-PII).'}
          </p>
        </div>
        {snapshot?.status !== 'VERIFIED' && (
          <M3Button
            variant="tonal"
            onClick={handleStartKyc}
            disabled={starting}
            data-testid="start-kyc-btn"
          >
            {starting ? 'Iniciando...' : 'Iniciar Verificación KYC'}
          </M3Button>
        )}
      </div>

      {snapshot && (
        <div className="m3-cluster" style={{ marginBottom: '0.5rem' }}>
          <M3Chip
            label={`Estado: ${snapshot.status}`}
            tone={
              snapshot.status === 'VERIFIED'
                ? 'success'
                : snapshot.status === 'PENDING'
                  ? 'warning'
                  : snapshot.status === 'REJECTED'
                    ? 'error'
                    : 'neutral'
            }
            testId="kyc-panel-status-chip"
          />
          <M3Chip label={`Nivel: ${snapshot.level}`} tone="neutral" />
        </div>
      )}

      {error && (
        <M3AlertBanner severity="error" title="Error KYC" message={error} testId="kyc-error" />
      )}
      {notice && (
        <M3AlertBanner
          severity="info"
          title="Sesión KYC en Curso"
          message={notice}
          testId="kyc-session-notice"
        />
      )}
    </div>
  );
}
