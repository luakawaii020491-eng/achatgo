// Component dùng chung: badge trạng thái, modal, nút xác nhận, thẻ số liệu.
import React, { useState } from 'react';
import { ORDER_STATUS_LABELS } from './types';
import { fmtVnd } from './api';

export function StatusBadge({ status }: { status: string }) {
  const label = ORDER_STATUS_LABELS[status] || status;
  const cls =
    status === 'da_giao_hang'
      ? 'badge-ok'
      : status === 'da_huy' || status === 'huy_giao'
        ? 'badge-danger'
        : status === 'dang_giao_hang' || status === 'cho_lay_hang'
          ? 'badge-warn'
          : status === 'cho_duyet'
            ? 'badge-accent'
            : '';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Money({ value }: { value: number | null | undefined }) {
  return <span className="nowrap">{fmtVnd(value)}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(16,24,40,0.5)', zIndex: 80,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 12, width: wide ? 880 : 560, maxWidth: '96vw',
          padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, flex: 1, fontSize: 16 }}>{title}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmButton({
  label,
  confirmText,
  onConfirm,
  className,
  disabled,
}: {
  label: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [arming, setArming] = useState(false);
  return (
    <button
      className={className || 'btn btn-danger'}
      disabled={disabled}
      onClick={async () => {
        if (!arming) {
          setArming(true);
          setTimeout(() => setArming(false), 3000);
          return;
        }
        setArming(false);
        await onConfirm();
      }}
    >
      {arming ? confirmText : label}
    </button>
  );
}
