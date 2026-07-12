import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { getCategories, getTemplates } from '../templates';
import { useI18n } from '../i18n';
import type { TemplateDef } from '../types';

/* ── Recent templates persistence ── */
const RECENT_KEY = 'ars-note.recentTemplates';
const MAX_RECENT = 6;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveRecent(id: string): void {
  const list = loadRecent().filter((x) => x !== id);
  list.unshift(id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch { /* ignore */ }
}

export function addRecentTemplate(id: string): void {
  saveRecent(id);
}

/* ── Component ── */

interface TemplateDialogProps {
  onSelect: (templateId: string) => void;
  onCancel: () => void;
}

const TemplateDialog: React.FC<TemplateDialogProps> = ({ onSelect, onCancel }) => {
  const { t, language } = useI18n();
  const categories = getCategories(t, language);
  const templates = getTemplates(t, language);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDef | null>(null);

  /* Recent templates */
  const recentIds = useMemo(() => loadRecent(), []);
  const recentTemplates = useMemo(
    () => recentIds.map((id) => templates.find((t) => t.id === id)).filter(Boolean) as TemplateDef[],
    [recentIds, templates],
  );

  /* Filtered template list */
  const filteredTemplates = useMemo(() => {
    let list = templates;
    if (selectedCategory) {
      list = list.filter((tmpl) => tmpl.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((tmpl) => {
        const cat = categories.find((c) => c.id === tmpl.category);
        return (
          tmpl.name.toLowerCase().includes(q) ||
          tmpl.description.toLowerCase().includes(q) ||
          tmpl.folder.toLowerCase().includes(q) ||
          (cat && cat.name.toLowerCase().includes(q))
        );
      });
    }
    return list;
  }, [templates, selectedCategory, searchQuery, categories]);

  /* Category counts */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tmpl of templates) {
      counts[tmpl.category] = (counts[tmpl.category] || 0) + 1;
    }
    return counts;
  }, [templates]);

  /* Preview path for selected template */
  const previewPath = useMemo(() => {
    if (!selectedTemplate) return '';
    return selectedTemplate.folder + '/' + selectedTemplate.defaultFileName;
  }, [selectedTemplate]);

  /* Content preview: first 8 lines */
  const contentPreview = useMemo(() => {
    if (!selectedTemplate) return '';
    const lines = selectedTemplate.content.split('\n').slice(0, 8);
    return lines.join('\n');
  }, [selectedTemplate]);

  const handleSelect = useCallback((tmpl: TemplateDef) => {
    setSelectedTemplate(tmpl);
  }, []);

  const handleCreate = useCallback(() => {
    if (selectedTemplate) {
      saveRecent(selectedTemplate.id);
      onSelect(selectedTemplate.id);
    }
  }, [selectedTemplate, onSelect]);

  /* Keyboard: Enter to create, Escape to cancel */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal tmpl-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="tmpl-dialog-header">
          <h3>{t.newFromTemplate}</h3>
          <div className="tmpl-search-wrapper">
            <input
              className="tmpl-search-input"
              placeholder={t.templateSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>

        <div className="tmpl-dialog-body">
          {/* Left: Categories + Recent */}
          <div className="tmpl-categories">
            {/* Recently Used */}
            {recentTemplates.length > 0 && !searchQuery && !selectedCategory && (
              <div className="tmpl-recent-section">
                <div className="tmpl-recent-header">{t.recentlyUsed}</div>
                {recentTemplates.map((tmpl) => (
                  <div
                    key={'recent-' + tmpl.id}
                    className={`tmpl-cat-item ${selectedTemplate?.id === tmpl.id ? 'active' : ''}`}
                    onClick={() => handleSelect(tmpl)}
                  >
                    <span className="tmpl-cat-name">{tmpl.name}</span>
                  </div>
                ))}
                <div className="tmpl-cat-separator" />
              </div>
            )}

            {/* All / Categories */}
            <div
              className={`tmpl-cat-item ${!selectedCategory ? 'active' : ''}`}
              onClick={() => { setSelectedCategory(null); setSearchQuery(''); }}
            >
              <span className="tmpl-cat-name">{t.allTemplates}</span>
              <span className="tmpl-cat-count">{templates.length}</span>
            </div>
            {categories.map((cat) => (
              <div
                key={cat.id}
                className={`tmpl-cat-item ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => { setSelectedCategory(cat.id); setSearchQuery(''); }}
              >
                <span className="tmpl-cat-name">{cat.name}</span>
                <span className="tmpl-cat-count">{categoryCounts[cat.id] || 0}</span>
              </div>
            ))}
          </div>

          {/* Center: Template list */}
          <div className="tmpl-list">
            {filteredTemplates.length === 0 ? (
              <div className="tmpl-list-empty">{t.noResults}</div>
            ) : (
              filteredTemplates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className={`tmpl-card ${selectedTemplate?.id === tmpl.id ? 'selected' : ''}`}
                  onClick={() => handleSelect(tmpl)}
                  onDoubleClick={() => { saveRecent(tmpl.id); onSelect(tmpl.id); }}
                >
                  <div className="tmpl-card-name">{tmpl.name}</div>
                  <div className="tmpl-card-desc">{tmpl.description}</div>
                  <div className="tmpl-card-folder">{tmpl.folder}/</div>
                </div>
              ))
            )}
          </div>

          {/* Right: Detail panel */}
          <div className="tmpl-detail">
            {selectedTemplate ? (
              <>
                <div className="tmpl-detail-name">{selectedTemplate.name}</div>
                <div className="tmpl-detail-desc">{selectedTemplate.description}</div>

                <div className="tmpl-detail-row">
                  <span className="tmpl-detail-label">{t.templateDefaultFolder}</span>
                  <span className="tmpl-detail-value">{selectedTemplate.folder}/</span>
                </div>
                <div className="tmpl-detail-row">
                  <span className="tmpl-detail-label">{t.templateDefaultFile}</span>
                  <span className="tmpl-detail-value">{selectedTemplate.defaultFileName}</span>
                </div>

                <div className="tmpl-detail-path">
                  <span className="tmpl-detail-label">{t.createAt}</span>
                  <span className="tmpl-detail-path-value">{previewPath}</span>
                </div>

                <div className="tmpl-detail-preview-label">{t.templateContentPreview}</div>
                <pre className="tmpl-detail-preview">{contentPreview}</pre>

                <button className="btn btn-primary tmpl-create-btn" onClick={handleCreate}>
                  {t.create}
                </button>
              </>
            ) : (
              <div className="tmpl-detail-empty">{t.selectTemplate}</div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{t.cancel}</button>
        </div>
      </div>
    </div>
  );
};

export default TemplateDialog;
