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

export interface M3NavItem {
  readonly id: string;
  readonly label: string;
  readonly shortCode: string;
  readonly href: string;
  readonly active?: boolean;
}

export interface M3NavigationRailProps {
  ariaLabel: string;
  items: readonly M3NavItem[];
  testId?: string;
}

export function M3NavigationRail({
  ariaLabel,
  items,
  testId,
}: M3NavigationRailProps) {
  return (
    <nav aria-label={ariaLabel} className="m3-nav-rail" data-testid={testId}>
      <ul className="m3-nav-rail__list">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={`m3-nav-item ${item.active ? 'm3-nav-item--active' : ''}`.trim()}
            >
              <span className="m3-nav-item__pill" aria-hidden="true">
                {item.shortCode}
              </span>
              <span className="m3-nav-item__label">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface M3TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  helperText?: string;
  errorText?: string;
}

export function M3TextField({
  id,
  label,
  helperText,
  errorText,
  className = '',
  ...rest
}: M3TextFieldProps) {
  const hasError = Boolean(errorText);
  return (
    <div className={`m3-field ${hasError ? 'm3-field--error' : ''} ${className}`.trim()}>
      <label htmlFor={id} className="m3-field__label">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={hasError || undefined}
        aria-describedby={errorText ? `${id}-error` : helperText ? `${id}-helper` : undefined}
        className="m3-field__input"
        {...rest}
      />
      {errorText ? (
        <span id={`${id}-error`} role="alert" className="m3-field__error">
          {errorText}
        </span>
      ) : helperText ? (
        <span id={`${id}-helper`} className="m3-field__helper">
          {helperText}
        </span>
      ) : null}
    </div>
  );
}

export interface M3JsonViewerProps {
  title?: string;
  data: unknown;
  badge?: string;
  testId?: string;
}

export function M3JsonViewer({ title, data, badge, testId }: M3JsonViewerProps) {
  const formatted =
    typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return (
    <div className="m3-json-viewer" data-testid={testId}>
      {(title || badge) && (
        <div className="m3-json-viewer__header">
          {title && <span className="m3-json-viewer__title">{title}</span>}
          {badge && <M3Chip label={badge} tone="primary" />}
        </div>
      )}
      <pre className="m3-json-viewer__pre">
        <code>{formatted}</code>
      </pre>
    </div>
  );
}
