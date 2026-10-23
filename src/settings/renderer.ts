// Settings page script. Kept free of imports so tsc emits a plain browser script.
type Def = { key: string; label: string; hint?: string; type: 'boolean' | 'number' | 'enum' | 'stringList' | 'text'; maxLength?: number; options?: string[]; optionLabels?: Record<string, string>; min?: number; max?: number };
type Item = {
  manifest: { id: string; name: string; hint?: string; settings: Def[] };
  enabled: boolean;
  values: Record<string, unknown>;
};
type Bridge = {
  list(): Promise<Item[]>;
  setEnabled(id: string, on: boolean): Promise<void>;
  setValue(id: string, key: string, value: unknown): Promise<void>;
};

const bridge = (window as unknown as { ttd: Bridge }).ttd;

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...children: Node[]): T {
  const node = Object.assign(document.createElement(tag), props) as T;
  node.append(...children);
  return node;
}

// A tooltip for what the user can't see but needs to know; reachable by keyboard too.
function hintIcon(text?: string): Node[] {
  if (!text) return [];
  const i = el('span', { className: 'hint', textContent: 'i', title: text, tabIndex: 0 });
  i.setAttribute('aria-label', text);
  return [i];
}

function control(id: string, def: Def, value: unknown): HTMLElement {
  const inputId = `${id}-${def.key}`;
  const save = (v: unknown) => bridge.setValue(id, def.key, v);
  let input: HTMLElement;
  switch (def.type) {
    case 'boolean': {
      const box = el<HTMLInputElement>('input', { type: 'checkbox', id: inputId, checked: value === true });
      box.addEventListener('change', () => save(box.checked));
      input = box;
      break;
    }
    case 'number': {
      const num = el<HTMLInputElement>('input', { type: 'number', id: inputId, value: String(value) });
      if (def.min !== undefined) num.min = String(def.min);
      if (def.max !== undefined) num.max = String(def.max);
      num.addEventListener('change', () => save(Number(num.value)));
      input = num;
      break;
    }
    case 'enum': {
      const sel = el<HTMLSelectElement>('select', { id: inputId });
      for (const opt of def.options ?? []) sel.append(el('option', { value: opt, textContent: def.optionLabels?.[opt] ?? opt, selected: opt === value }));
      sel.addEventListener('change', () => save(sel.value));
      input = sel;
      break;
    }
    case 'text': {
      const area = el<HTMLTextAreaElement>('textarea', { id: inputId, value: String(value ?? ''), className: 'code', spellcheck: false });
      if (def.maxLength) area.maxLength = def.maxLength;
      area.addEventListener('change', () => save(area.value));
      input = area;
      break;
    }
    case 'stringList': {
      const area = el<HTMLTextAreaElement>('textarea', { id: inputId, value: (value as string[]).join('\n') });
      area.addEventListener('change', () => save(area.value.split('\n').map((s) => s.trim()).filter(Boolean)));
      input = area;
      break;
    }
  }
  return el('div', { className: 'field' }, el('div', { className: 'label' }, el('label', { htmlFor: inputId, textContent: def.label }), ...hintIcon(def.hint)), input);
}

function card(item: Item): HTMLElement {
  const { id, name, hint, settings } = item.manifest;
  const toggle = el<HTMLInputElement>('input', { type: 'checkbox', checked: item.enabled });
  toggle.setAttribute('aria-label', `Enable ${name}`);
  const root = el(
    'section',
    { className: item.enabled ? 'card' : 'card off' },
    el(
      'div',
      { className: 'head' },
      el('div', { className: 'text' }, el('div', { className: 'name' }, document.createTextNode(name), ...hintIcon(hint))),
      el('label', { className: 'switch' }, toggle, el('span')),
    ),
    el('div', { className: 'fields' }, ...settings.map((def) => control(id, def, item.values[def.key]))),
  );
  toggle.addEventListener('change', async () => {
    await bridge.setEnabled(id, toggle.checked);
    root.className = toggle.checked ? 'card' : 'card off';
  });
  return root;
}

bridge.list().then((items) => {
  document.getElementById('plugins')!.append(...items.map(card));
});
