// Tiny DOM helpers shared by views

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

let toastTimer = null;
export function toast(message, kind = 'info') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.toggle('error', kind === 'error');
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

export function pill(text, kind) {
  return el('span', { class: `pill ${kind || ''}` }, text);
}

export function fmtDate(d) {
  if (!d) return '';
  // Date strings come back as YYYY-MM-DD; render in local order without timezone shift
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  if (!y) return s;
  return `${y}-${m}-${day}`;
}

export function fmtScore(n) {
  if (n == null) return '–';
  return String(n);
}

export function selectOptions(items, valueKey = 'id', labelKey = 'name', includeBlank = true, blankLabel = '— Select —') {
  const opts = [];
  if (includeBlank) opts.push(el('option', { value: '' }, blankLabel));
  for (const it of items || []) {
    opts.push(el('option', { value: it[valueKey] }, it[labelKey]));
  }
  return opts;
}

// Replacement for native confirm() / prompt() that matches the project's
// dark Warhammer aesthetic. Returns a Promise that resolves to:
//   confirm: true | false
//   prompt:  string | null  (null on cancel)
// Usage:
//   await confirmModal({ title, body, danger: true })
//   await promptModal({ title, label, defaultValue, placeholder })

function buildModal({ title, body, footer, onClose }) {
  const overlay = el('div', { class: 'modal-overlay' });
  const dialog = el('div', { class: 'modal-dialog', role: 'dialog' }, [
    el('div', { class: 'modal-header' }, el('h2', {}, title)),
    el('div', { class: 'modal-body' }, body),
    el('div', { class: 'modal-footer' }, footer),
  ]);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) onClose(); });
  document.addEventListener('keydown', escListener);
  function escListener(e) { if (e.key === 'Escape') onClose(); }
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return {
    close: () => {
      document.removeEventListener('keydown', escListener);
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 150);
    },
  };
}

export function confirmModal({ title = 'Confirm', body = '', danger = false, confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    let modal;
    const cancelBtn = el('button', { class: 'btn', type: 'button', onClick: () => { modal.close(); resolve(false); } }, cancelLabel);
    const confirmBtn = el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onClick: () => { modal.close(); resolve(true); } }, confirmLabel);
    modal = buildModal({
      title,
      body: el('div', {}, body),
      footer: el('div', { class: 'btn-group', style: { justifyContent: 'flex-end', width: '100%' } }, [cancelBtn, confirmBtn]),
      onClose: () => { modal.close(); resolve(false); },
    });
    setTimeout(() => confirmBtn.focus(), 100);
  });
}

export function promptModal({ title = 'Enter value', label = '', defaultValue = '', placeholder = '', confirmLabel = 'OK', cancelLabel = 'Cancel', type = 'text' } = {}) {
  return new Promise((resolve) => {
    let modal;
    const input = el('input', { type, value: defaultValue, placeholder, autocomplete: 'off' });
    const submit = () => { modal.close(); resolve(input.value); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const cancelBtn = el('button', { class: 'btn', type: 'button', onClick: () => { modal.close(); resolve(null); } }, cancelLabel);
    const confirmBtn = el('button', { class: 'btn primary', type: 'button', onClick: submit }, confirmLabel);
    const body = el('div', {}, [
      label ? el('label', { style: { marginBottom: '6px' } }, label) : null,
      input,
    ].filter(Boolean));
    modal = buildModal({
      title,
      body,
      footer: el('div', { class: 'btn-group', style: { justifyContent: 'flex-end', width: '100%' } }, [cancelBtn, confirmBtn]),
      onClose: () => { modal.close(); resolve(null); },
    });
    setTimeout(() => input.focus(), 100);
  });
}
