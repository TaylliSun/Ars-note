import React from 'react';
import { useI18n } from '../i18n';

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  confirmTone?: 'primary' | 'danger';
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, onConfirm, onCancel, confirmLabel, confirmTone = 'primary' }) => {
  const { t } = useI18n();
  const confirmClass = confirmTone === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'pre-line', lineHeight: 1.6 }}>
          {message}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>{t.cancel}</button>
          <button type="button" className={confirmClass} onClick={onConfirm}>{confirmLabel || t.ok}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
