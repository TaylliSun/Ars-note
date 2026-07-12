/* ── Wireframe Builder (v1.0.0) ── */
/* Converts simplified UI element descriptions into Excalidraw JSON */
/* Used by the AI create_wireframe tool */

/* ═══════════════════════════════════════════════════════
   Simplified UI Element Input Format
   ═══════════════════════════════════════════════════════
   Each element has:
   - role: container | card | nav | input | button | heading | text |
           divider | image | arrow | circle | checkbox | tab | list
   - x, y: position
   - w, h: width, height
   - label: text label
   - Additional role-specific props
   ═══════════════════════════════════════════════════════ */

let _seed = 1000000 + Math.floor(Math.random() * 9000000);
function uid(): string { return 'el_' + (_seed++).toString(36); }
function seed(): number { return _seed++; }

function charUnits(ch: string): number {
  if (/[\u4e00-\u9fff]/.test(ch)) return 1.05;
  if (/\s/.test(ch)) return 0.35;
  if (/[A-Z0-9]/.test(ch)) return 0.68;
  return 0.58;
}

function wrapTextToWidth(text: string, width: number, fontSize: number): string {
  const maxUnits = Math.max(8, Math.floor(Math.max(40, width - 12) / (fontSize * 0.62)));
  const wrapped: string[] = [];

  for (const rawLine of String(text || '').split('\n')) {
    if (!rawLine.trim()) {
      wrapped.push('');
      continue;
    }

    let line = '';
    let units = 0;
    for (const ch of rawLine) {
      const nextUnits = charUnits(ch);
      if (units + nextUnits > maxUnits && line.trim()) {
        wrapped.push(line.trimEnd());
        line = ch.trimStart();
        units = charUnits(line);
      } else {
        line += ch;
        units += nextUnits;
      }
    }
    if (line) wrapped.push(line.trimEnd());
  }

  return wrapped.join('\n');
}

function textHeightFor(text: string, width: number, fontSize: number): number {
  const wrapped = wrapTextToWidth(text, width, fontSize);
  const lines = Math.max(1, wrapped.split('\n').length);
  return Math.ceil(lines * fontSize * 1.35 + 8);
}

function fittedBoxHeight(text: string, width: number, fontSize: number, paddingY = 24, min = 40): number {
  return Math.max(min, textHeightFor(text, Math.max(40, width - 24), fontSize) + paddingY);
}

function getInputRole(el: any): string {
  return String(el?.role || el?.type || '').toLowerCase();
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function estimateInputElementSize(el: any): { w: number; h: number } {
  const role = getInputRole(el);
  const w = asNumber(el?.w ?? el?.width, role === 'sidebar' || role === 'rail' ? 240 : 240);
  const h = asNumber(el?.h ?? el?.height, 40);

  if (role === 'container' || role === 'card' || role === 'panel') {
    const labelText = String(el?.label || '');
    const bodyText = Array.isArray(el?.items)
      ? el.items.map((item: any) => `- ${typeof item === 'object' ? item.label || item.text || '' : String(item)}`).join('\n')
      : String(el?.text || el?.content || '');
    const titleH = labelText ? textHeightFor(labelText, w - 24, 12) : 0;
    const bodyH = bodyText ? textHeightFor(bodyText, w - 28, 13) : 0;
    return { w, h: labelText ? Math.max(h, titleH + bodyH + (bodyText ? 34 : 24)) : bodyText ? Math.max(h, bodyH + 28) : h };
  }

  if (role === 'list' || role === 'menu') {
    const items = Array.isArray(el?.items) ? el.items : ['Item 1', 'Item 2', 'Item 3'];
    const listW = w || 250;
    const totalH = items.reduce((sum: number, item: any) => {
      const text = typeof item === 'object' ? item.label || item.text || '' : String(item);
      return sum + Math.max(28, textHeightFor(text, listW - 24, 14) + 4);
    }, 0);
    return { w: listW, h: Math.max(h, totalH) };
  }

  if (role === 'table') {
    const cols = Array.isArray(el?.columns) ? el.columns : ['Col 1', 'Col 2', 'Col 3'];
    const rowCount = Array.isArray(el?.rows) ? el.rows.length : asNumber(el?.rows, 3);
    return { w: w || 400, h: Math.max(32, h || 32) * (rowCount + 1) };
  }

  if (role === 'callout' || role === 'note') {
    const text = String(el?.label || el?.text || 'Callout');
    return { w: w || 360, h: Math.max(h || 96, textHeightFor(text, (w || 360) - 36, asNumber(el?.size, 13)) + 32) };
  }

  if (role === 'paragraph' || role === 'text' || role === 'label') {
    const text = String(el?.text || el?.label || '');
    const textW = w || 300;
    return { w: textW, h: Math.max(h, textHeightFor(text, textW, asNumber(el?.size, 14))) };
  }

  if (role === 'sidebar' || role === 'rail') {
    const items = Array.isArray(el?.items) ? el.items.length : 0;
    return { w, h: Math.max(h, (el?.label ? 58 : 20) + items * 42 + 16) };
  }

  return { w, h };
}

function shouldAutoPlaceInputElement(el: any): boolean {
  const role = getInputRole(el);
  return [
    'container', 'card', 'panel',
    'list', 'menu', 'table',
    'callout', 'note', 'metric', 'stat',
    'textarea', 'image',
  ].includes(role);
}

function horizontalOverlapAmount(a: { x: number; w: number }, b: { x: number; w: number }): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
}

function shiftInputElementY(el: any, deltaY: number): void {
  if (!deltaY) return;
  el.y = asNumber(el?.y, 0) + deltaY;
  if (el.y1 !== undefined) el.y1 = asNumber(el.y1, 0) + deltaY;
  if (el.y2 !== undefined) el.y2 = asNumber(el.y2, 0) + deltaY;
}

function normalizeWireframeInputElements(elements: any[]): any[] {
  const normalized = elements.map((el) => el && typeof el === 'object' ? { ...el } : el);
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const gapY = 22;

  const indexedBlocks = normalized
    .map((el, index) => ({ el, index }))
    .filter(({ el }) => el && shouldAutoPlaceInputElement(el))
    .sort((a, b) => asNumber(a.el.y, 0) - asNumber(b.el.y, 0) || asNumber(a.el.x, 0) - asNumber(b.el.x, 0));

  for (const item of indexedBlocks) {
    const el = item.el;
    const size = estimateInputElementSize(el);
    const current = {
      x: asNumber(el.x, 0),
      y: asNumber(el.y, 0),
      w: Math.max(40, size.w),
      h: Math.max(24, size.h),
    };

    let targetY = current.y;
    for (const prev of placed) {
      const overlap = horizontalOverlapAmount(current, prev);
      const relevantOverlap = overlap > Math.min(current.w, prev.w) * 0.18 || overlap > 48;
      if (!relevantOverlap) continue;
      const prevBottom = prev.y + prev.h + gapY;
      if (targetY < prevBottom) targetY = prevBottom;
    }

    const deltaY = Math.ceil(targetY - current.y);
    if (deltaY > 0) {
      shiftInputElementY(el, deltaY);
      current.y += deltaY;
    }
    placed.push(current);
  }

  return normalized;
}

function makeRect(opts: {
  x: number; y: number; w: number; h: number;
  stroke?: string; fill?: string; strokeWidth?: number;
  strokeStyle?: string; roundness?: any; boundLabel?: boolean; id?: string;
}): any {
  const id = opts.id || uid();
  return {
    id,
    type: 'rectangle',
    x: opts.x, y: opts.y,
    width: opts.w, height: opts.h,
    angle: 0,
    strokeColor: opts.stroke || '#8b8fa3',
    backgroundColor: opts.fill || 'transparent',
    fillStyle: 'solid',
    strokeWidth: opts.strokeWidth ?? 1,
    strokeStyle: opts.strokeStyle || 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    index: '',
    roundness: opts.roundness !== undefined ? opts.roundness : { type: 3 },
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: opts.boundLabel ? [{ id: id + '_t', type: 'text' as const }] : null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function makeText(opts: {
  x: number; y: number; text: string;
  size?: number; color?: string; align?: string;
  containerId?: string | null; vAlign?: string; w?: number; h?: number;
  wrap?: boolean;
}): any {
  const fontSize = opts.size || 14;
  /* Estimate text dimensions — roughly 0.6 * fontSize per char for proportional font */
  const lineH = fontSize * 1.4;
  const shouldWrap = opts.wrap !== false && !!opts.w;
  const text = shouldWrap ? wrapTextToWidth(opts.text || '', opts.w || 300, fontSize) : (opts.text || '');
  const lines = text.split('\n');
  const maxLineLen = Math.max(...lines.map(l => l.length));
  const estWidth = opts.w || Math.max(80, Math.min(500, maxLineLen * fontSize * 0.62 + 8));
  const naturalHeight = lines.length * lineH + 6;
  const estHeight = Math.max(opts.h || 0, naturalHeight);

  return {
    id: (opts.containerId || uid()) + '_t',
    type: 'text',
    x: opts.x, y: opts.y,
    width: estWidth, height: estHeight,
    angle: 0,
    strokeColor: opts.color || '#e2e8f0',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    index: '',
    roundness: null,
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text: text,
    fontSize: fontSize,
    fontFamily: 1,
    lineHeight: 1.25,
    textAlign: opts.align || 'left',
    verticalAlign: opts.vAlign || 'top',
    containerId: opts.containerId || null,
    originalText: text,
  };
}

/* ── Build a complete Excalidraw scene from simplified elements ── */

function elementBounds(el: any): { x: number; y: number; w: number; h: number } {
  return {
    x: Number(el?.x) || 0,
    y: Number(el?.y) || 0,
    w: Math.abs(Number(el?.width) || 0),
    h: Math.abs(Number(el?.height) || 0),
  };
}

function overlaps(a: any, b: any, pad = 0): boolean {
  const ab = elementBounds(a);
  const bb = elementBounds(b);
  return ab.x < bb.x + bb.w + pad
    && ab.x + ab.w + pad > bb.x
    && ab.y < bb.y + bb.h + pad
    && ab.y + ab.h + pad > bb.y;
}

function nearestContainingRect(textEl: any, rects: any[]): any | null {
  const tb = elementBounds(textEl);
  let best: any | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const rect of rects) {
    const rb = elementBounds(rect);
    const inside = tb.x >= rb.x - 6 && tb.y >= rb.y - 6 && tb.x <= rb.x + rb.w + 6 && tb.y <= rb.y + rb.h + 12;
    if (!inside) continue;
    const area = rb.w * rb.h;
    if (area < bestArea) {
      best = rect;
      bestArea = area;
    }
  }

  return best;
}

function refitTextInsideRect(textEl: any, rect: any): void {
  const fontSize = Number(textEl?.fontSize) || 14;
  const sourceText = String(textEl?.originalText || textEl?.text || '');
  const boundToContainer = !!textEl.containerId;
  const paddingX = boundToContainer ? 10 : Math.max(8, Number(textEl.x) - Number(rect.x));
  const paddingRight = boundToContainer ? 10 : 14;
  const contentW = Math.max(48, Number(rect.width) - paddingX - paddingRight);
  const wrapped = wrapTextToWidth(sourceText, contentW, fontSize);
  const neededH = textHeightFor(wrapped, contentW, fontSize);

  textEl.text = wrapped;
  textEl.originalText = wrapped;
  textEl.width = contentW;
  textEl.height = Math.max(Number(textEl.height) || 0, neededH);

  if (boundToContainer) {
    textEl.x = Number(rect.x) + paddingX;
    const verticalAlign = String(textEl.verticalAlign || '').toLowerCase();
    textEl.y = verticalAlign === 'middle'
      ? Number(rect.y) + Math.max(6, (Number(rect.height) - textEl.height) / 2)
      : Number(rect.y) + 8;
  }

  const requiredW = Number(textEl.x) + Number(textEl.width) - Number(rect.x) + paddingRight;
  const requiredH = Number(textEl.y) + Number(textEl.height) - Number(rect.y) + 14;
  if (requiredW > Number(rect.width)) rect.width = Math.ceil(requiredW);
  if (requiredH > Number(rect.height)) rect.height = Math.ceil(requiredH);
}

function pushBelowExpandedRects(elements: any[], originalBottomByRectId: Map<string, number>): void {
  const rects = elements.filter((el) => el?.type === 'rectangle');
  for (const rect of rects) {
    const oldBottom = originalBottomByRectId.get(String(rect.id));
    if (!oldBottom) continue;
    const newBottom = (Number(rect.y) || 0) + (Number(rect.height) || 0);
    const delta = newBottom - oldBottom;
    if (delta <= 10) continue;

    /* Only push sibling cards/panels. Screens, tables, and nested UI chrome intentionally overlap. */
    if ((Number(rect.width) || 0) > 780 || rect.roundness === null) continue;

    for (const el of elements) {
      if (!el || el.id === rect.id || el.containerId === rect.id) continue;
      const eb = elementBounds(el);
      if (eb.w <= 0 && eb.h <= 0) continue;
      if (eb.y < oldBottom - 2) continue;
      const overlap = horizontalOverlapAmount(
        { x: Number(rect.x) || 0, w: Number(rect.width) || 0 },
        { x: eb.x, w: eb.w },
      );
      const relevantOverlap = overlap > Math.min(Number(rect.width) || 0, eb.w) * 0.18 || overlap > 48;
      if (!relevantOverlap) continue;
      el.y = (Number(el.y) || 0) + delta + 12;
      if (el.y1 !== undefined) el.y1 = (Number(el.y1) || 0) + delta + 12;
      if (el.y2 !== undefined) el.y2 = (Number(el.y2) || 0) + delta + 12;
    }
  }
}

function repairExcalidrawElements(elements: any[]): any[] {
  const repaired = elements.map((el) => el && typeof el === 'object' ? { ...el } : el);
  const rects = repaired.filter((el) => el?.type === 'rectangle');
  const rectById = new Map(rects.map((rect) => [String(rect.id), rect]));
  const originalBottomByRectId = new Map<string, number>();
  for (const rect of rects) {
    originalBottomByRectId.set(String(rect.id), (Number(rect.y) || 0) + (Number(rect.height) || 0));
  }
  const freeTexts = repaired.filter((el) => el?.type === 'text' && !el.containerId);
  const boundTexts = repaired.filter((el) => el?.type === 'text' && el.containerId);

  const byColumn = new Map<number, any[]>();
  for (const text of freeTexts) {
    const col = Math.round((Number(text.x) || 0) / 48);
    const bucket = byColumn.get(col) || [];
    bucket.push(text);
    byColumn.set(col, bucket);
  }

  for (const bucket of byColumn.values()) {
    bucket.sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0));
    let last: any | null = null;
    for (const text of bucket) {
      if (last && overlaps(last, text, 4)) {
        const lb = elementBounds(last);
        text.y = lb.y + lb.h + 8;
      }
      last = text;
    }
  }

  for (const text of boundTexts) {
    const rect = rectById.get(String(text.containerId));
    if (rect) refitTextInsideRect(text, rect);
  }

  for (const text of freeTexts) {
    const rect = nearestContainingRect(text, rects);
    if (!rect) continue;
    refitTextInsideRect(text, rect);
  }

  pushBelowExpandedRects(repaired, originalBottomByRectId);
  return repaired;
}

export function buildExcalidrawScene(elements: any[]): object {
  const result: any[] = [];
  const normalizedElements = normalizeWireframeInputElements(Array.isArray(elements) ? elements : []);

  for (const el of normalizedElements) {
    const role = getInputRole(el);
    const x = el.x || 0;
    const y = el.y || 0;
    const w = el.w || el.width || 200;
    const h = el.h || el.height || 40;

    switch (role) {

      /* ── Container / Card / Panel ── */
      case 'container':
      case 'card':
      case 'panel': {
        const labelText = String(el.label || '');
        const bodyText = Array.isArray(el.items)
          ? el.items.map((item: any) => `- ${typeof item === 'object' ? item.label || item.text || '' : String(item)}`).join('\n')
          : String(el.text || el.content || '');
        const titleH = labelText ? textHeightFor(labelText, w - 24, 12) : 0;
        const bodyH = bodyText ? textHeightFor(bodyText, w - 28, 13) : 0;
        const boxH = labelText
          ? Math.max(h, titleH + bodyH + (bodyText ? 34 : 24))
          : bodyText
            ? Math.max(h, bodyH + 28)
          : h;
        result.push(makeRect({
          x, y, w, h: boxH,
          stroke: el.stroke || '#3b4256',
          fill: el.fill || el.background || (role === 'card' ? '#1b2030' : 'transparent'),
          roundness: { type: 3 },
          boundLabel: false,
        }));
        if (labelText) {
          result.push(makeText({
            x: x + 12, y: y + 10,
            text: labelText, size: 12, color: '#9ca3af',
            w: w - 24,
          }));
        }
        if (bodyText) {
          result.push(makeText({
            x: x + 14, y: y + 14 + titleH + (labelText ? 8 : 0),
            text: bodyText, size: 13, color: '#e2e8f0',
            w: w - 28,
          }));
        }
        break;
      }

      /* ── Navigation bar ── */
      case 'screen':
      case 'frame': {
        result.push(makeRect({
          x, y, w, h,
          stroke: el.stroke || '#2f3a52',
          fill: el.fill || el.background || '#0f1117',
          strokeWidth: 1,
          roundness: { type: 3 },
        }));
        if (el.label) {
          result.push(makeText({
            x: x + 20, y: y + 16,
            text: el.label, size: 14, color: '#cbd5e1',
            w: w - 40,
          }));
        }
        break;
      }

      case 'sidebar':
      case 'rail': {
        result.push(makeRect({
          x, y, w, h,
          stroke: el.stroke || '#2f3a52',
          fill: el.fill || '#121827',
          strokeWidth: 1,
          roundness: { type: 3 },
        }));
        if (el.label) {
          result.push(makeText({ x: x + 16, y: y + 18, text: el.label, size: 15, color: '#f8fafc', w: w - 32 }));
        }
        const items = Array.isArray(el.items) ? el.items : [];
        let iy = y + (el.label ? 58 : 20);
        for (const item of items) {
          const active = typeof item === 'object' ? !!item.active : false;
          const label = typeof item === 'object' ? item.label : String(item);
          result.push(makeRect({
            x: x + 12, y: iy, w: w - 24, h: 34,
            stroke: 'transparent',
            fill: active ? '#27345a' : 'transparent',
            strokeWidth: 0,
            roundness: { type: 3 },
          }));
          result.push(makeText({ x: x + 24, y: iy + 8, text: label, size: 13, color: active ? '#ffffff' : '#94a3b8', w: w - 48 }));
          iy += 42;
        }
        break;
      }

      case 'nav':
      case 'navbar':
      case 'toolbar': {
        result.push(makeRect({
          x, y, w, h: h || 48,
          stroke: 'transparent', fill: '#1b2030',
          strokeWidth: 0, roundness: null,
        }));
        if (el.label) {
          result.push(makeText({
            x: x + 16, y: y + 12,
            text: el.label, size: 16, color: '#f3f4f6', w: w - 32,
          }));
        }
        if (el.items) {
          let ix = x + (el.label ? Math.min(el.label.length * 10 + 32, 200) : 16);
          for (const item of el.items) {
            result.push(makeText({
              x: ix, y: y + 14,
              text: item, size: 13, color: '#9ca3af',
              w: item.length * 8 + 8,
            }));
            ix += item.length * 8 + 24;
          }
        }
        break;
      }

      /* ── Input field ── */
      case 'input':
      case 'textarea':
      case 'search': {
        // Label above
        if (el.label) {
          result.push(makeText({
            x, y: y - 18,
            text: el.label, size: 12, color: '#9ca3af',
          }));
        }
        result.push(makeRect({
          x, y, w, h: h || 34,
          stroke: '#4b5563', fill: '#0f1117',
          roundness: { type: 3 },
          boundLabel: !!el.placeholder,
        }));
        if (el.placeholder) {
          result.push(makeText({
            x: x + 10, y: y + 8,
            text: el.placeholder, size: 13, color: '#4b5563',
            containerId: result[result.length - 1].id,
            w: w - 20,
          }));
        }
        break;
      }

      /* ── Button ── */
      case 'button': {
        const bg = el.color || el.fill || '#7c5cff';
        const variant = el.variant || 'filled'; // filled | outlined | ghost
        const label = String(el.label || 'Button');
        const btnW = Math.max(w || 120, Math.min(260, label.length * 8 + 34));
        const btnH = h || 38;
        result.push(makeRect({
          x, y, w: btnW, h: btnH,
          stroke: variant === 'outlined' ? bg : 'transparent',
          fill: variant === 'filled' ? bg : 'transparent',
          strokeWidth: variant === 'outlined' ? 1 : 0,
          roundness: { type: 3 },
          boundLabel: true,
        }));
        result.push(makeText({
          x, y,
          text: label, size: 13,
          color: variant === 'filled' ? '#ffffff' : bg,
          align: 'center', vAlign: 'middle',
          containerId: result[result.length - 1].id,
          w: btnW, h: btnH,
          wrap: false,
        }));
        break;
      }

      /* ── Heading ── */
      case 'heading':
      case 'title': {
        result.push(makeText({
          x, y,
          text: el.text || el.label || 'Title',
          size: el.size || 24, color: '#f3f4f6',
          w: w || 760,
        }));
        break;
      }

      /* ── Plain text ── */
      case 'text':
      case 'label':
      case 'paragraph': {
        const textContent = el.text || el.label || '';
        /* Wrap long text to fit within specified width */
        const maxW = w || 300;
        const fontSize = el.size || 14;
        const charsPerLine = Math.floor(maxW / (fontSize * 0.6));
        let wrappedText = textContent;
        if (textContent.length > charsPerLine) {
          /* Simple word-wrap: break at spaces or force-break long words */
          const words = textContent.split('');
          let line = '';
          const lines: string[] = [];
          for (const ch of words) {
            if (line.length >= charsPerLine) {
              lines.push(line);
              line = ch;
            } else {
              line += ch;
            }
          }
          if (line) lines.push(line);
          wrappedText = lines.join('\n');
        }
        result.push(makeText({
          x, y,
          text: wrappedText,
          size: fontSize,
          color: el.color || '#e2e8f0',
          align: el.align || 'left',
          w: maxW,
        }));
        break;
      }

      /* ── Divider / separator ── */
      case 'divider':
      case 'hr':
      case 'separator': {
        result.push({
          id: uid(), type: 'line',
          x, y, width: w || 300, height: 0,
          angle: 0, strokeColor: '#2b3245',
          backgroundColor: 'transparent', fillStyle: 'solid',
          strokeWidth: 1, strokeStyle: 'solid', roughness: 0,
          opacity: 100, groupIds: [], frameId: null, index: '',
          roundness: null, seed: seed(), version: 1, versionNonce: seed(),
          isDeleted: false, boundElements: null, updated: Date.now(),
          link: null, locked: false,
          points: [[0, 0], [w || 300, 0]],
          startBinding: null, endBinding: null,
          startArrowhead: null, endArrowhead: null,
        });
        break;
      }

      /* ── Image placeholder ── */
      case 'image':
      case 'avatar':
      case 'icon': {
        const isCircle = role === 'avatar' || role === 'icon';
        result.push(makeRect({
          x, y, w: w || 80, h: h || 80,
          stroke: '#4b5563', fill: '#252b3d',
          strokeStyle: 'dashed',
          roundness: isCircle ? null : { type: 3 },
          boundLabel: !!el.label,
        }));
        if (isCircle) {
          // Override type to ellipse for avatar/icon
          result[result.length - 1].type = 'ellipse';
        }
        if (el.label) {
          result.push(makeText({
            x: x + (w || 80) / 2 - 30, y: y + (h || 80) / 2 - 8,
            text: el.label, size: 11, color: '#6b7280', align: 'center',
            w: 60,
          }));
        }
        break;
      }

      /* ── Arrow / connection ── */
      case 'arrow':
      case 'connector': {
        const x1 = el.x1 ?? x;
        const y1 = el.y1 ?? y;
        const x2 = el.x2 ?? (x + 100);
        const y2 = el.y2 ?? y;
        result.push({
          id: uid(), type: 'arrow',
          x: x1, y: y1,
          width: x2 - x1, height: y2 - y1,
          angle: 0, strokeColor: el.color || '#7c5cff',
          backgroundColor: 'transparent', fillStyle: 'solid',
          strokeWidth: 1, strokeStyle: 'solid', roughness: 0,
          opacity: 100, groupIds: [], frameId: null, index: '',
          roundness: { type: 2 }, seed: seed(), version: 1, versionNonce: seed(),
          isDeleted: false, boundElements: null, updated: Date.now(),
          link: null, locked: false,
          points: [[0, 0], [x2 - x1, y2 - y1]],
          startBinding: null, endBinding: null,
          startArrowhead: null, endArrowhead: 'arrow',
        });
        if (el.label) {
          result.push(makeText({
            x: (x1 + x2) / 2 - 20, y: (y1 + y2) / 2 - 10,
            text: el.label, size: 11, color: '#9ca3af', align: 'center',
          }));
        }
        break;
      }

      /* ── Checkbox / Toggle ── */
      case 'checkbox':
      case 'toggle':
      case 'switch': {
        const sz = el.size || 16;
        result.push(makeRect({
          x, y, w: sz, h: sz,
          stroke: '#4b5563',
          fill: el.checked ? '#7c5cff' : 'transparent',
          roundness: { type: 3 },
        }));
        if (el.label) {
          result.push(makeText({
            x: x + sz + 8, y: y - 1,
            text: el.label, size: 14, color: '#e2e8f0',
          }));
        }
        break;
      }

      /* ── Tab bar ── */
      case 'tab':
      case 'tabs': {
        if (el.items) {
          let tx = x;
          for (const item of el.items) {
            const active = item === el.active || item === (el.items as string[])[0];
            const tw = item.length * 10 + 24;
            result.push(makeRect({
              x: tx, y, w: tw, h: h || 32,
              stroke: 'transparent',
              fill: active ? '#7c5cff' : '#252b3d',
              strokeWidth: 0, roundness: { type: 3 },
              boundLabel: true,
            }));
            result.push(makeText({
              x: tx, y,
              text: item, size: 13,
              color: active ? '#ffffff' : '#9ca3af',
              align: 'center', vAlign: 'middle',
              containerId: result[result.length - 2].id,
              w: tw, h: h || 32,
              wrap: false,
            }));
            tx += tw + 4;
          }
        }
        break;
      }

      /* ── List (bullet list) ── */
      case 'list':
      case 'menu': {
        const items = el.items || ['Item 1', 'Item 2', 'Item 3'];
        const listW = w || 250;
        const itemH = 28;
        let iy = y;
        for (const item of items) {
          // Bullet dot
          result.push({
            id: uid(), type: 'ellipse',
            x: x + 4, y: iy + 6, width: 5, height: 5,
            angle: 0, strokeColor: 'transparent',
            backgroundColor: '#7c5cff', fillStyle: 'solid',
            strokeWidth: 0, strokeStyle: 'solid', roughness: 0,
            opacity: 100, groupIds: [], frameId: null, index: '',
            roundness: null, seed: seed(), version: 1, versionNonce: seed(),
            isDeleted: false, boundElements: null, updated: Date.now(),
            link: null, locked: false,
          });
          const wrapped = wrapTextToWidth(String(item), listW - 24, 14);
          result.push(makeText({
            x: x + 18, y: iy,
            text: wrapped, size: 14, color: '#e2e8f0',
            w: listW - 24,
          }));
          iy += Math.max(itemH, textHeightFor(wrapped, listW - 24, 14) + 4);
        }
        break;
      }

      /* ── Table ── */
      case 'table': {
        const cols = el.columns || ['Col 1', 'Col 2', 'Col 3'];
        const rowData = Array.isArray(el.rows)
          ? el.rows
          : Array.from({ length: el.rows || 3 }, () => []);
        const totalW = w || 400;
        const colW = totalW / cols.length;
        const baseRowH = h || 32;
        // Header
        for (let ci = 0; ci < cols.length; ci++) {
          result.push(makeRect({
            x: x + ci * colW, y, w: colW, h: baseRowH,
            stroke: '#3b4256', fill: '#1b2030', strokeWidth: 1,
            roundness: null,
          }));
          /* Truncate header text to fit column width */
          const maxLen = Math.floor((colW - 16) / 7);
          const headerText = cols[ci].length > maxLen ? cols[ci].slice(0, maxLen) + '…' : cols[ci];
          result.push(makeText({
            x: x + ci * colW + 8, y: y + 8,
            text: headerText, size: 12, color: '#f3f4f6',
            w: colW - 16,
          }));
        }
        // Rows
        let rowY = y + baseRowH;
        for (let ri = 0; ri < rowData.length; ri++) {
          const row = rowData[ri];
          const getCell = (ci: number) => {
            if (Array.isArray(row)) return row[ci] ?? '';
            if (row && typeof row === 'object') return row[cols[ci]] ?? row[String(cols[ci])] ?? row[`col${ci + 1}`] ?? '';
            return '';
          };
          const cellTexts = cols.map((_: any, ci: number) => wrapTextToWidth(String(getCell(ci)), colW - 16, 12));
          const rowH = Math.max(baseRowH, ...cellTexts.map((text: string) => textHeightFor(text, colW - 16, 12) + 8));
          for (let ci = 0; ci < cols.length; ci++) {
            result.push(makeRect({
              x: x + ci * colW, y: rowY, w: colW, h: rowH,
              stroke: '#2b3245', fill: 'transparent', strokeWidth: 1,
              roundness: null,
            }));
            if (cellTexts[ci]) {
              result.push(makeText({
                x: x + ci * colW + 8,
                y: rowY + 8,
                text: cellTexts[ci],
                size: 12,
                color: '#cbd5e1',
                w: colW - 16,
              }));
            }
          }
          rowY += rowH;
        }
        break;
      }

      /* ── Progress bar ── */
      case 'statusbar':
      case 'footerbar': {
        result.push(makeRect({
          x, y, w, h: h || 32,
          stroke: 'transparent',
          fill: el.fill || '#0b1020',
          strokeWidth: 0,
          roundness: null,
        }));
        if (el.label) {
          result.push(makeText({ x: x + 14, y: y + 8, text: el.label, size: 11, color: '#94a3b8', w: w - 28 }));
        }
        break;
      }

      case 'badge':
      case 'chip':
      case 'pill': {
        const label = String(el.label || el.text || 'Label');
        const chipW = w || Math.max(64, label.length * 8 + 26);
        const chipH = h || 26;
        const fill = el.fill || el.color || '#27345a';
        result.push(makeRect({
          x, y, w: chipW, h: chipH,
          stroke: el.stroke || '#3b4a70',
          fill,
          strokeWidth: 1,
          roundness: { type: 3 },
          boundLabel: true,
        }));
        result.push(makeText({
          x, y: y + 1,
          text: label,
          size: el.size || 11,
          color: el.textColor || '#dbeafe',
          align: 'center',
          vAlign: 'middle',
          containerId: result[result.length - 1].id,
          w: chipW,
          h: chipH,
        }));
        break;
      }

      case 'metric':
      case 'stat': {
        const metricW = w || 180;
        const metricH = h || 92;
        result.push(makeRect({
          x, y, w: metricW, h: metricH,
          stroke: el.stroke || '#334155',
          fill: el.fill || '#151c2d',
          strokeWidth: 1,
          roundness: { type: 3 },
        }));
        result.push(makeText({ x: x + 16, y: y + 14, text: el.label || 'Metric', size: 11, color: '#94a3b8', w: metricW - 32 }));
        result.push(makeText({ x: x + 16, y: y + 38, text: String(el.value || '0'), size: el.size || 28, color: el.color || '#f8fafc', w: metricW - 32 }));
        if (el.hint) result.push(makeText({ x: x + 16, y: y + metricH - 24, text: el.hint, size: 10, color: '#64748b', w: metricW - 32 }));
        break;
      }

      case 'callout':
      case 'note': {
        const calloutW = w || 360;
        const calloutText = String(el.label || el.text || 'Callout');
        const calloutH = Math.max(h || 96, textHeightFor(calloutText, calloutW - 36, el.size || 13) + 32);
        const accent = el.color || '#7c5cff';
        result.push(makeRect({
          x, y, w: calloutW, h: calloutH,
          stroke: el.stroke || '#34415f',
          fill: el.fill || '#141b2d',
          strokeWidth: 1,
          roundness: { type: 3 },
        }));
        result.push(makeRect({
          x, y, w: 5, h: calloutH,
          stroke: 'transparent',
          fill: accent,
          strokeWidth: 0,
          roundness: { type: 3 },
        }));
        result.push(makeText({
          x: x + 18,
          y: y + 14,
          text: calloutText,
          size: el.size || 13,
          color: el.textColor || '#dbeafe',
          w: calloutW - 36,
        }));
        break;
      }

      case 'progress':
      case 'slider': {
        result.push(makeRect({
          x, y, w, h: h || 8,
          stroke: 'transparent', fill: '#2b3245',
          strokeWidth: 0, roundness: { type: 3 },
        }));
        const pct = el.percent || 50;
        result.push(makeRect({
          x, y, w: w * pct / 100, h: h || 8,
          stroke: 'transparent', fill: el.color || '#7c5cff',
          strokeWidth: 0, roundness: { type: 3 },
        }));
        if (el.label) {
          result.push(makeText({
            x, y: y - 16,
            text: el.label, size: 11, color: '#9ca3af',
          }));
        }
        break;
      }

    } // switch
  } // for

  const repaired = repairExcalidrawElements(result);

  return {
    type: 'excalidraw',
    version: 2,
    elements: repaired,
    appState: { viewBackgroundColor: '#12141c', theme: 'dark' },
    files: {},
  };
}
