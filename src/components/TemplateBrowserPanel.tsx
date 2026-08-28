import React, { useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { getCategories, getTemplates } from '../templates';

const RECENT_KEY = 'ars-note.recentTemplates';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // A blocked localStorage should not prevent the template library from opening.
  }
  return [];
}

interface TemplateBrowserPanelProps {
  onCreateFromTemplate: (templateId: string) => void;
}

const TemplateBrowserPanel: React.FC<TemplateBrowserPanelProps> = ({ onCreateFromTemplate }) => {
  const { t, language } = useI18n();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const categories = getCategories(t, language);
  const templates = getTemplates(t, language);
  const recentIds = useMemo(() => loadRecent(), []);
  const recentTemplates = useMemo(
    () => recentIds
      .map((id) => templates.find((template) => template.id === id))
      .filter((template) => Boolean(template)),
    [recentIds, templates],
  );

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((previous) => {
      const next = new Set(previous);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  return (
    <div className="template-grid">
      <div className="template-grid-hint">{t.createFromTemplate}</div>
      {recentTemplates.length > 0 && (
        <div className="tmpl-rp-group">
          <div className="tmpl-rp-group-header">
            <span className="tmpl-rp-toggle">▾</span>
            <span className="tmpl-rp-group-name">{t.recentlyUsed}</span>
            <span className="tmpl-rp-group-count">{recentTemplates.length}</span>
          </div>
          <div className="tmpl-rp-cards">
            {recentTemplates.map((template) => template && (
              <div key={template.id} className="template-card" onClick={() => onCreateFromTemplate(template.id)}>
                <div className="template-card-name">{template.name}</div>
                <div className="template-card-desc">{template.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {categories.map((category) => {
        const categoryTemplates = templates.filter((template) => template.category === category.id);
        if (categoryTemplates.length === 0) return null;
        const collapsed = collapsedCategories.has(category.id);
        return (
          <div key={category.id} className="tmpl-rp-group">
            <div className="tmpl-rp-group-header" onClick={() => toggleCategory(category.id)}>
              <span className="tmpl-rp-toggle">{collapsed ? '▸' : '▾'}</span>
              <span className="tmpl-rp-group-name">{category.name}</span>
              <span className="tmpl-rp-group-count">{categoryTemplates.length}</span>
            </div>
            {!collapsed && (
              <div className="tmpl-rp-cards">
                {categoryTemplates.map((template) => (
                  <div key={template.id} className="template-card" onClick={() => onCreateFromTemplate(template.id)}>
                    <div className="template-card-name">{template.name}</div>
                    <div className="template-card-desc">{template.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TemplateBrowserPanel;
