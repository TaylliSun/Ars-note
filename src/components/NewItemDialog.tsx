import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n';

interface NewItemDialogProps {
  title: string;
  placeholder: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const NewItemDialog: React.FC<NewItemDialogProps> = ({
  title,
  placeholder,
  onConfirm,
  onCancel,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onConfirm(name.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <input
              ref={inputRef}
              className="modal-input"
              placeholder={placeholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>{t.cancel}</button>
            <button type="submit" className="btn btn-accent" disabled={!name.trim()}>
              {t.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewItemDialog;
