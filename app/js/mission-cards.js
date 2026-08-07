// The 11e mission deck as readable rules text, so a game can be played with
// just the app when the physical cards aren't on the table.
//
// Data is a committed static asset built from Game Datacards' extraction of
// GW's own app (see scripts/build-mission-cards.py). It is fetched lazily on
// the first "read the rules" tap, not on page load — 51KB is cheap but nobody
// browsing the games list needs it.

import { el, buildModal, toast } from './components.js';

const DATA_URL = '/data/mission-cards-11e.json';

let cache = null;
let inflight = null;

export function loadMissionCards() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch(DATA_URL, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`mission cards ${res.status}`);
      return res.json();
    })
    .then((json) => { cache = json; inflight = null; return json; })
    .catch((err) => { inflight = null; throw err; });
  return inflight;
}

// GDC title-cases every word ("Bring It Down") where seed.sql follows GW's own
// casing ("Bring it Down"), so every lookup here is case- and punctuation-loose
// rather than exact. Curly apostrophes show up in pasted names too.
function foldName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findIn(list, name) {
  const want = foldName(name);
  if (!want) return null;
  return (list || []).find((c) => foldName(c.name) === want) || null;
}

export function findSecondary(data, name) { return findIn(data?.secondaryMissions, name); }
export function findPrimary(data, name) { return findIn(data?.primaryMissions, name); }

// True when we hold rules text for this card — lets a caller render the name as
// a tappable affordance only when tapping it would actually show something.
export function hasCard(kind, name) {
  if (!cache) return false;
  return !!(kind === 'primary' ? findPrimary(cache, name) : findSecondary(cache, name));
}

/* ── Rules prose ──────────────────────────────────────────────── */

// The source marks keywords with **…**. Rendered as real nodes rather than
// innerHTML, so card text can never inject markup.
function richText(text) {
  const out = [];
  for (const [i, part] of String(text || '').split('**').entries()) {
    if (!part) continue;
    out.push(i % 2 ? el('strong', {}, part) : document.createTextNode(part));
  }
  return out;
}

function scoringRow(row) {
  const vp = row.victoryPoints == null ? '' : `${row.cumulative ? '+' : ''}${row.victoryPoints}`;
  const capNote = row.cap != null ? el('span', { class: 'mc-cap' }, `max ${row.cap}`) : null;
  const mode = row.mode ? el('span', { class: `mc-mode is-${row.mode}` }, row.mode) : null;
  return el('div', { class: 'mc-score' }, [
    el('div', { class: 'mc-vp' }, [vp, el('span', { class: 'mc-vp-unit' }, 'VP')]),
    el('div', { class: 'mc-score-text' }, [
      el('div', {}, richText(row.criteria)),
      mode || capNote ? el('div', { class: 'mc-score-tags' }, [mode, capNote].filter(Boolean)) : null,
    ].filter(Boolean)),
  ]);
}

function objectiveBlock(obj) {
  return el('div', { class: 'mc-objective' }, [
    obj.name ? el('div', { class: 'mc-objective-name' }, obj.name) : null,
    obj.when ? el('div', { class: 'mc-when' }, [el('span', { class: 'mc-when-label' }, 'When:'), ' ', ...richText(obj.when)]) : null,
    ...(obj.scoring || []).map(scoringRow),
  ].filter(Boolean));
}

function actionBlock(act) {
  const line = (label, value) => (value
    ? el('div', { class: 'mc-action-line' }, [el('span', { class: 'mc-action-label' }, label), ' ', ...richText(value)])
    : null);
  return el('div', { class: 'mc-action' }, [
    act.name ? el('div', { class: 'mc-objective-name' }, `Action · ${act.name}`) : null,
    line('Starts:', act.starts),
    line('Completes:', act.completes),
    line('Units:', act.units),
    line('Effect:', act.effect),
    line('Limit:', act.useLimit),
  ].filter(Boolean));
}

export function renderCardBody(card, kind) {
  const dispositions = (card.dispositions || [])
    .map((d) => `${d.yours} vs ${d.theirs}`)
    .join(' · ');

  return el('div', { class: 'mc-card' }, [
    kind === 'primary' && dispositions
      ? el('div', { class: 'mc-dispositions' }, dispositions)
      : null,
    card.detachment ? el('div', { class: 'mc-dispositions' }, card.detachment) : null,
    card.lore ? el('div', { class: 'mc-lore' }, card.lore) : null,
    card.description ? el('div', { class: 'mc-description' }, richText(card.description)) : null,
    ...(card.objectives || []).map(objectiveBlock),
    ...(card.actions || []).map(actionBlock),
  ].filter(Boolean));
}

/* ── Modals ───────────────────────────────────────────────────── */

function simpleModal({ title, body, extraButtons = [] }) {
  let modal;
  const close = el('button', { class: 'btn', type: 'button', onClick: () => modal.close() }, 'Close');
  modal = buildModal({
    title,
    body,
    footer: el('div', { class: 'btn-group', style: { justifyContent: 'flex-end', width: '100%' } },
      [...extraButtons, close]),
    onClose: () => modal.close(),
  });
  return modal;
}

// A mission name rendered as its own reader. Always a button: the deck loads
// lazily on first tap, so at render time we can't know whether we hold this
// card, and openMissionCard says so if we don't. Reading is not an edit, so
// spectators and signed-out visitors get it too.
export function missionLink(kind, name, { onMissing = (m) => toast(m, 'error') } = {}) {
  if (!name) return null;
  return el('button', {
    class: 'mc-open',
    type: 'button',
    title: 'Read this mission’s rules',
    onClick: () => openMissionCard({ kind, name, onMissing }),
  }, name);
}

export async function openMissionCard({ kind, name, onMissing }) {
  let data;
  try {
    data = await loadMissionCards();
  } catch {
    if (onMissing) onMissing('Could not load the mission cards.');
    return;
  }
  const card = kind === 'primary' ? findPrimary(data, name) : findSecondary(data, name);
  if (!card) {
    if (onMissing) onMissing(`No rules text on file for "${name}".`);
    return;
  }
  simpleModal({ title: card.name, body: renderCardBody(card, kind) });
}

// The whole deck, for playing off the app with no physical cards to hand.
export async function openMissionBrowser({ kind = 'secondary', onMissing } = {}) {
  let data;
  try {
    data = await loadMissionCards();
  } catch {
    if (onMissing) onMissing('Could not load the mission cards.');
    return;
  }

  let active = kind;
  const listWrap = el('div', { class: 'mc-list' });

  const meta = (card) => (active === 'primary'
    ? (card.dispositions || []).map((d) => `${d.yours} vs ${d.theirs}`).join(' · ')
    : (card.objectives || []).map((o) => o.name).filter(Boolean).join(' · '));

  const detail = el('div', { class: 'mc-detail' });
  const showCard = (card) => {
    detail.replaceChildren(
      el('h3', { class: 'mc-detail-title' }, card.name),
      renderCardBody(card, active),
    );
    detail.scrollIntoView({ block: 'nearest' });
  };

  const paint = () => {
    const cards = active === 'primary' ? data.primaryMissions : data.secondaryMissions;
    listWrap.replaceChildren(...cards.map((card) => {
      const b = el('button', { class: 'mc-list-item', type: 'button', onClick: () => showCard(card) }, [
        el('div', { class: 'mc-list-name' }, card.name),
        el('div', { class: 'mc-list-meta' }, meta(card)),
      ]);
      return b;
    }));
    detail.replaceChildren(el('div', { class: 'mc-detail-empty' }, 'Pick a card to read its rules.'));
    for (const t of tabs) t.classList.toggle('is-active', t.dataset.kind === active);
  };

  const tabs = ['secondary', 'primary'].map((k) => el('button', {
    class: 'mc-tab',
    type: 'button',
    'data-kind': k,
    onClick: () => { active = k; paint(); },
  }, k === 'secondary' ? `Secondaries (${data.secondaryMissions.length})` : `Primaries (${data.primaryMissions.length})`));

  paint();

  simpleModal({
    title: data.pack || 'Mission cards',
    body: el('div', { class: 'mc-browser' }, [
      el('div', { class: 'mc-tabs' }, tabs),
      listWrap,
      detail,
    ]),
  });
}
