import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n';

interface PromptDialogProps {
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const PromptDialog: React.FC<PromptDialogProps> = ({
  title,
  message,
  defaultValue = '',
  placeholder = '',
  onConfirm,
  onCancel,
}) => {
  const { t } = useI18n();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="prompt-message">{message}</p>
        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <input
              ref={inputRef}
              className="modal-input prompt-input"
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>{t.cancel}</button>
            <button type="submit" className="btn btn-accent" disabled={!value.trim()}>
              {t.ok}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PromptDialog;
