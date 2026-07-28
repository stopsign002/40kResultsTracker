// Full-screen image viewer. Opens with a FLIP zoom from the thumbnail that was
// clicked, then lets you cycle the set with arrows, swipe or the on-screen
// chevrons, and zooms back down into whichever thumbnail is showing when you
// close it.
//
// Why FLIP (transform) rather than animating width/height/top/left: transform +
// opacity are the only two properties the compositor can animate without
// re-running layout every frame, which is the difference between smooth and
// janky on a phone. The thumbnail is object-fit:cover and the full image is
// object-fit:contain, so their aspect ratios differ — a uniform scale can't
// match both edges exactly, so we scale to cover the thumb box and fade in over
// the difference. Reads as "the picture grew out of the tile" without the
// fiddliness of a true crop morph.
import { el } from './components.js';

const OPEN_MS = 280;
const CLOSE_MS = 220;
const EASE = 'cubic-bezier(.2,.7,.3,1)';

const reduceMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * @param {object} opts
 * @param {Array<{full: string, thumb: string, caption?: string}>} opts.items
 * @param {number} opts.startIndex
 * @param {(index: number) => Element|null} [opts.thumbFor]
 *   Element to fly from/to for a given index. Re-queried on close because the
 *   user may have cycled to a different image than the one they opened.
 */
export function openLightbox({ items, startIndex = 0, thumbFor }) {
  if (!items || !items.length) return;

  let index = Math.max(0, Math.min(startIndex, items.length - 1));
  let closing = false;

  const overlay = el('div', {
    class: 'lb-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Photo viewer',
  });

  const img = el('img', { class: 'lb-img', alt: items[index].caption || 'Photo' });
  const stage = el('div', { class: 'lb-stage' }, img);

  const counter = el('div', { class: 'lb-counter' }, '');
  const caption = el('div', { class: 'lb-caption' }, '');
  const closeBtn = el('button', { class: 'lb-btn lb-close', type: 'button', 'aria-label': 'Close' }, '✕');
  const prevBtn = el('button', { class: 'lb-btn lb-prev', type: 'button', 'aria-label': 'Previous photo' }, '‹');
  const nextBtn = el('button', { class: 'lb-btn lb-next', type: 'button', 'aria-label': 'Next photo' }, '›');

  const multiple = items.length > 1;
  overlay.append(
    stage,
    el('div', { class: 'lb-chrome' }, [counter, closeBtn]),
    caption,
    ...(multiple ? [prevBtn, nextBtn] : []),
  );

  // Neighbours are fetched eagerly so cycling doesn't flash an empty frame.
  // /uploads is served immutable, so this costs one request per image, ever.
  function preload(i) {
    const item = items[i];
    if (!item) return;
    const pre = new Image();
    pre.src = item.full;
  }

  function paint(direction = 0) {
    const item = items[index];
    img.src = item.full;
    img.alt = item.caption || 'Photo';
    counter.textContent = multiple ? `${index + 1} / ${items.length}` : '';
    caption.textContent = item.caption || '';
    caption.style.visibility = item.caption ? 'visible' : 'hidden';
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    preload(index + 1);
    preload(index - 1);

    // Cycling gets a short directional slide, not the open zoom — the zoom is
    // reserved for "this came from that tile".
    if (direction && !reduceMotion()) {
      img.animate(
        [
          { transform: `translateX(${direction * 26}px)`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    }
  }

  function go(delta) {
    if (!multiple) return;
    index = (index + delta + items.length) % items.length;
    paint(delta > 0 ? 1 : -1);
  }

  // Maps the image's laid-out rect onto the thumbnail's rect. Returns null when
  // there's nothing sensible to fly from (thumb scrolled out of view, missing).
  function flipTransform(thumb) {
    if (!thumb) return null;
    const from = thumb.getBoundingClientRect();
    const to = img.getBoundingClientRect();
    if (!from.width || !to.width) return null;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    const scale = Math.max(from.width / to.width, from.height / to.height);
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }

  function animateOpen() {
    const start = flipTransform(thumbFor?.(index));
    if (!start || reduceMotion()) {
      overlay.classList.add('is-open');
      return;
    }
    img.style.transform = start;
    img.style.opacity = '0.4';
    // Two frames: one to commit the start state, one to start the transition.
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      requestAnimationFrame(() => {
        img.style.transition = `transform ${OPEN_MS}ms ${EASE}, opacity ${Math.round(OPEN_MS * 0.7)}ms ease-out`;
        img.style.transform = 'none';
        img.style.opacity = '1';
      });
    });
  }

  function close() {
    if (closing) return;
    closing = true;
    document.removeEventListener('keydown', onKey);
    const end = flipTransform(thumbFor?.(index));

    const finish = () => {
      overlay.remove();
      document.body.classList.remove('lb-lock');
      previouslyFocused?.focus?.();
    };

    if (!end || reduceMotion()) {
      overlay.classList.remove('is-open');
      setTimeout(finish, reduceMotion() ? 0 : CLOSE_MS);
      return;
    }
    img.style.transition = `transform ${CLOSE_MS}ms ${EASE}, opacity ${CLOSE_MS}ms ease-in`;
    img.style.transform = end;
    img.style.opacity = '0.2';
    overlay.classList.remove('is-open');
    setTimeout(finish, CLOSE_MS);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }

  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  // Backdrop closes; the image itself must not, or every mis-tap exits.
  overlay.addEventListener('click', close);
  stage.addEventListener('click', (e) => e.stopPropagation());
  img.addEventListener('click', (e) => e.stopPropagation());

  // Horizontal swipe cycles, vertical swipe-down closes (the phone gesture
  // people expect from a photo viewer).
  let touchX = 0, touchY = 0, touching = false;
  overlay.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { touching = false; return; }
    touching = true;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', (e) => {
    if (!touching) return;
    touching = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
  }, { passive: true });

  const previouslyFocused = document.activeElement;
  document.addEventListener('keydown', onKey);
  document.body.classList.add('lb-lock');
  document.body.appendChild(overlay);

  paint();
  // The zoom needs the image's final rect, which only exists once it has
  // decoded and laid out. Cached images resolve immediately.
  if (img.complete) animateOpen();
  else img.addEventListener('load', animateOpen, { once: true });
  img.addEventListener('error', () => overlay.classList.add('is-open'), { once: true });

  closeBtn.focus({ preventScroll: true });
  return { close };
}
