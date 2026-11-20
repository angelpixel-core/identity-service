import React from 'react';

export interface M3CardProps {
  children: React.ReactNode;
  variant?: 'elevated' | 'outlined' | 'tonal';
  className?: string;
  testId?: string;
}

export function M3Card({
  children,
  variant = 'elevated',
  className = '',
  testId,
}: M3CardProps) {
  return (
    <section
      className={`m3-card m3-card--${variant} ${className}`.trim()}
      data-testid={testId}
    >
      {children}
    </section>
  );
}

export interface M3ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text';
}

export function M3Button({
  variant = 'filled',
  className = '',
  type = 'button',
  children,
  ...rest
}: M3ButtonProps) {
  return (
    <button
      type={type}
      className={`m3-btn m3-btn--${variant} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface M3ChipProps {
  label: string;
  tone?: 'primary' | 'success' | 'warning' | 'error' | 'neutral';
  testId?: string;
}

export function M3Chip({ label, tone = 'neutral', testId }: M3ChipProps) {
  return (
    <span className={`m3-chip m3-chip--${tone}`} data-testid={testId}>
      {label}
    </span>
  );
}

export interface M3AlertBannerProps {
  title?: string;
  message: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  testId?: string;
}

export function M3AlertBanner({
  title,
  message,
  severity = 'info',
  testId,
}: M3AlertBannerProps) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      className={`m3-banner m3-banner--${severity}`}
      data-testid={testId}
    >
      {title && <strong className="m3-banner__title">{title}</strong>}
      <span>{message}</span>
    </div>
  );
}
