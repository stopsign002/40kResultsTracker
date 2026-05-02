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
