// Tiny DOM toolkit + form controls used across the editor UI.
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function iconEl(name, cls = '') {
  const s = h('span', { class: `ico ${cls}` });
  s.innerHTML = icon(name);
  return s;
}

export function button(label, { icon: ic, onClick, cls = '', title, primary, disabled } = {}) {
  return h(
    'button',
    { class: `btn ${primary ? 'btn-primary' : ''} ${cls}`, title: title || (typeof label === 'string' ? label : ''), onclick: onClick, disabled },
    ic ? iconEl(ic) : null,
    label ? h('span', { class: 'btn-label' }, label) : null
  );
}

export function iconButton(ic, { onClick, title, cls = '', active } = {}) {
  const b = h('button', { class: `icon-btn ${cls} ${active ? 'active' : ''}`, title, 'aria-label': title, onclick: onClick });
  b.innerHTML = icon(ic);
  return b;
}

export function section(title, { open = true, icon: ic, actions } = {}, ...content) {
  const body = h('div', { class: 'section-body' }, ...content);
  const head = h('div', { class: 'section-head' }, h('span', { class: 'chev' }, iconEl('chevron')), ic ? iconEl(ic) : null, h('span', { class: 'section-title' }, title), actions ? h('span', { class: 'section-actions', onclick: (e) => e.stopPropagation() }, actions) : null);
  const el = h('div', { class: `section ${open ? 'open' : ''}` }, head, body);
  head.addEventListener('click', () => el.classList.toggle('open'));
  return el;
}

export function row(label, control, hint) {
  return h('div', { class: 'row' }, h('label', { class: 'row-label', title: hint || label }, label), h('div', { class: 'row-control' }, control));
}

const fmt = (v, step) => {
  if (!Number.isFinite(v)) return '0';
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return v.toFixed(dec);
};

/** Numeric input with drag-to-scrub. */
export function numberInput({ value, step = 0.1, min = -Infinity, max = Infinity, onInput, onChange, suffix = '', width }) {
  const input = h('input', { class: 'num', type: 'text', inputmode: 'decimal', value: fmt(value, step), style: width ? { width } : null });
  let current = value;
  const set = (v, commit) => {
    v = Math.min(max, Math.max(min, v));
    current = v;
    input.value = fmt(v, step);
    onInput?.(v);
    if (commit) onChange?.(v);
  };
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) set(v, true);
    else input.value = fmt(current, step);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(current + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true);
    }
    if (e.key === 'Enter') input.blur();
    e.stopPropagation();
  });
  // scrub
  let drag = null;
  input.addEventListener('pointerdown', (e) => {
    if (document.activeElement === input) return;
    drag = { x: e.clientX, v: current, moved: false };
    input.setPointerCapture(e.pointerId);
  });
  input.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) {
      set(drag.v + Math.round(dx / 2) * step * (e.shiftKey ? 10 : 1), false);
      input.classList.add('scrubbing');
    }
  });
  input.addEventListener('pointerup', (e) => {
    if (!drag) return;
    input.releasePointerCapture(e.pointerId);
    input.classList.remove('scrubbing');
    if (drag.moved) onChange?.(current);
    else {
      input.focus();
      input.select();
    }
    drag = null;
  });
  const wrap = h('div', { class: 'num-wrap' }, input, suffix ? h('span', { class: 'num-suffix' }, suffix) : null);
  wrap.setValue = (v) => {
    current = v;
    if (document.activeElement !== input) input.value = fmt(v, step);
  };
  return wrap;
}

export function vec3Input({ value, step = 0.1, onInput, onChange, labels = ['X', 'Y', 'Z'] }) {
  const v = [...value];
  const parts = labels.map((l, i) =>
    h(
      'div',
      { class: `vec-part axis-${l.toLowerCase()}` },
      h('span', { class: 'vec-label' }, l),
      numberInput({
        value: v[i],
        step,
        onInput: (x) => {
          v[i] = x;
          onInput?.([...v]);
        },
        onChange: (x) => {
          v[i] = x;
          onChange?.([...v]);
        },
      })
    )
  );
  return h('div', { class: 'vec3' }, ...parts);
}

export function slider({ value, min = 0, max = 1, step = 0.01, onInput, onChange, format }) {
  const out = h('span', { class: 'slider-value' }, format ? format(value) : fmt(value, step));
  const input = h('input', { type: 'range', min, max, step, value });
  const paint = () => {
    const k = ((parseFloat(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${k}%`);
  };
  paint();
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = format ? format(v) : fmt(v, step);
    paint();
    onInput?.(v);
  });
  input.addEventListener('change', () => onChange?.(parseFloat(input.value)));
  input.addEventListener('keydown', (e) => e.stopPropagation());
  out.addEventListener('dblclick', () => {
    const r = prompt('Value', input.value);
    if (r === null) return;
    const v = parseFloat(r);
    if (!Number.isFinite(v)) return;
    input.value = v;
    input.dispatchEvent(new Event('input'));
    onChange?.(v);
  });
  return h('div', { class: 'slider' }, input, out);
}

export function toggle({ value, onChange, label }) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!value;
  input.addEventListener('change', () => onChange?.(input.checked));
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), label ? h('span', { class: 'toggle-label' }, label) : null);
}

export function select({ value, options, onChange }) {
  const s = h(
    'select',
    { class: 'select' },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      const opt = h('option', { value: v }, l);
      if (String(v) === String(value)) opt.selected = true;
      return opt;
    })
  );
  s.addEventListener('change', () => onChange?.(s.value));
  s.addEventListener('keydown', (e) => e.stopPropagation());
  return s;
}

export function colorInput({ value, onInput, onChange }) {
  const input = h('input', { type: 'color', value: value || '#ffffff', class: 'color' });
  const label = h('span', { class: 'color-hex' }, (value || '').toUpperCase());
  input.addEventListener('input', () => {
    label.textContent = input.value.toUpperCase();
    onInput?.(input.value);
  });
  input.addEventListener('change', () => onChange?.(input.value));
  return h('label', { class: 'color-wrap' }, input, label);
}

export function textInput({ value, placeholder, onChange, onInput }) {
  const i = h('input', { type: 'text', class: 'text', value: value ?? '', placeholder });
  i.addEventListener('change', () => onChange?.(i.value));
  i.addEventListener('input', () => onInput?.(i.value));
  i.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') i.blur();
  });
  return i;
}

// ---------------------------------------------------------------- toasts & dialogs
let toastHost = null;
export function toast(message, type = 'info', ms = 3500) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: `toast toast-${type}` }, iconEl(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info'), h('span', {}, message));
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const close = () => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  };
  t.addEventListener('click', close);
  setTimeout(close, type === 'error' ? Math.max(ms, 8000) : ms);
}

export function modal({ title, content, actions = [], wide = false, onClose }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 200);
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const box = h(
    'div',
    { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', {}, title), iconButton('close', { title: 'Close', onClick: close })),
    h('div', { class: 'modal-body' }, content),
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null
  );
  backdrop.appendChild(box);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  return { close, box, body: box.querySelector('.modal-body') };
}

export function confirmDialog(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      content: h('p', { class: 'muted' }, text),
      actions: [
        button('Cancel', { onClick: () => m.close() }),
        button(okLabel, {
          primary: true,
          onClick: () => {
            done = true;
            resolve(true);
            m.close();
          },
        }),
      ],
      onClose: () => !done && resolve(false),
    });
  });
}

export function formatBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
