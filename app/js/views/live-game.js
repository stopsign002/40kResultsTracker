// Live game tracker — the wizard you drive DURING a game.
//
// Setup -> Round 1..5 -> Summary. Everything autosaves to a server-side draft
// (game_drafts), so a dead phone or a closed tab loses nothing and the game can
// be resumed from any device. Nothing here writes to `games` until Submit, so a
// half-played game can never reach the games list, the stats, the war map or
// the rankings.
//
// The draft OWNER may edit anything. An invited opponent may edit only their
// own seat, and their screen follows the owner's round. Both see each other's
// entries live over SSE.

import { drafts, draftImages, reference } from '../api.js';
import { el, clear, toast, confirmModal, choiceModal, promptModal, fmtDuration, selectOptions } from '../components.js';
import { missionLink, openMissionCard, openMissionBrowser } from '../mission-cards.js';
import { shrink } from '../images.js';
import { pushLayer } from '../nav-stack.js';
import { looksLikeYaabCode, normaliseArmyList } from '../army-list.js';
import {
  ROUNDS,
  MATCHED_PLAY_LAYOUTS,
  E11_PRIMARY_CAP,
  E11_SECONDARY_CAP,
  E11_PRIMARY_ROUND_CAP,
  E11_SECONDARY_ROUND_CAP,
  sumSecondaryForRound,
  secondaryRoundHeadroom,
  cumulativeTimeThrough,
  roundTimeFromClock,
  parseDuration,
  FORCE_DISPOSITIONS,
  PRIMARY_MATRIX,
  calcTotal,
  sumPrimary,
  sumSecondaryPoints,
  capLabel,
} from '../game-rules.js';

const E11_PACK_NAME = '2026 - 2027 Chapter Approved';
const STEPS = ['setup', 'round1', 'round2', 'round3', 'round4', 'round5', 'summary'];

// Matches game-detail.js: the browser downscales, so the server never needs an
// image library and a 12MP phone photo never crosses the wire whole.
const FULL_MAX_PX = 2048;
const THUMB_MAX_PX = 400;
const JPEG_QUALITY = 0.82;

// Long enough that a burst of taps is one request, short enough that putting
// the phone down mid-round has already saved.
const AUTOSAVE_MS = 800;
const TIMER_SAVE_MS = 15000;
const localKey = (id) => `tg40k:liveDraft:${id}`;

export async function renderLiveGame(state, draftId) {
  return draftId == null ? renderDraftList(state) : renderWizard(state, draftId);
}

/* ══ Draft list (#/play) ══════════════════════════════════════ */

async function renderDraftList(state) {
  const root = el('div', { class: 'fade-in' });
  const listBody = el('div', {});

  async function refresh() {
    let rows = [];
    try {
      rows = await drafts.list();
    } catch (e) {
      toast(e.message || 'Could not load live games', 'error');
    }
    clear(listBody);
    listBody.appendChild(rows.length
      ? el('div', { class: 'lg-list' }, rows.map((r) => draftRow(r, state, refresh)))
      : el('div', { class: 'lg-empty' }, 'No games in progress. Start one when you sit down to play.'));
  }

  const startBtn = el('button', { class: 'btn primary', type: 'button' }, 'Start new game');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
      const created = await drafts.create(makeEmptyPayload());
      window.__nav('/play/' + created.id);
    } catch (e) {
      startBtn.disabled = false;
      toast(e.message || 'Could not start a game', 'error');
    }
  });

  await refresh();

  // The scores on this list are only worth glancing at if they move. Every
  // accepted PATCH broadcasts draft.updated, so follow it — self-removing once
  // the view's root is gone, per the pattern in views/games-list.js. No `by`
  // filtering needed: unlike the wizard, this view has nothing being typed into
  // it that a re-read could clobber.
  const liveHandler = () => {
    if (!document.body.contains(root)) {
      document.removeEventListener('live:draft.updated', liveHandler);
      return;
    }
    refresh().catch(() => {});
  };
  document.addEventListener('live:draft.updated', liveHandler);

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Live games'),
      startBtn,
    ]),
    el('div', { class: 'panel-body' }, listBody),
  ]));

  root.appendChild(el('div', { class: 'muted', style: { fontSize: '13px' } },
    'Tracking a game as you play it. Already finished? Log it the quick way from New Game.'));

  return root;
}

function draftRow(r, state, refresh) {
  const names = (r.playerNames || []).filter(Boolean);
  const title = names.length === 2 ? `${names[0]} vs ${names[1]}` : (names[0] || 'New game');
  // Whose game it is matters now that the list shows everyone's, not just yours.
  const meta = [
    r.isOwner ? 'Your game' : `${r.owner_name || 'Someone'}'s game`,
    r.viewerSeat === 2 ? 'you were invited' : null,
    stepLabel(r.current_step),
    relativeAge(r.updated_at),
  ].filter(Boolean).join(' · ');

  const isAdmin = state?.user?.role === 'admin';
  const canDelete = r.isOwner || isAdmin;
  const del = canDelete ? el('button', {
    class: 'btn small danger',
    type: 'button',
    'aria-label': `Delete ${title}`,
    title: r.isOwner ? 'Delete this game' : 'Delete as admin',
  }, 'Delete') : null;
  if (del) {
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmModal({
        title: 'Delete this game?',
        body: `Permanently removes "${title}" — ${r.isOwner ? 'your' : `${r.owner_name || 'their'}`} in-progress game and any photos taken. It was never filed to the games list.`,
        danger: true,
        confirmLabel: 'Delete game',
      });
      if (!ok) return;
      del.disabled = true;
      try {
        await drafts.remove(r.id);
        try { localStorage.removeItem(localKey(r.id)); } catch {}
        toast('Game deleted');
        refresh();
      } catch (err) {
        del.disabled = false;
        toast(err.message || 'Could not delete that game', 'error');
      }
    });
  }

  // A game still in setup has nothing to show but 0 – 0, which reads as "they
  // are losing badly" rather than "they haven't started".
  const [a, b] = r.scores || [];
  const score = r.current_step !== 'setup' && Number.isFinite(a) && Number.isFinite(b)
    ? el('div', {
      class: 'lg-list-score',
      'aria-label': `Score ${a} to ${b}`,
      title: 'Running score',
    }, [String(a), el('span', { class: 'lg-list-score-sep' }, '–'), String(b)])
    : null;

  const item = el('div', { class: 'card lg-list-item', role: 'button', tabindex: '0' }, [
    el('div', { class: 'lg-list-main' }, [
      el('div', { class: 'lg-list-title' }, title),
      el('div', { class: 'lg-list-meta' }, meta),
    ]),
    score,
    el('span', { class: 'pill' }, stepShort(r.current_step)),
    del,
  ].filter(Boolean));
  const open = () => window.__nav('/play/' + r.id);
  item.addEventListener('click', open);
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return item;
}

function stepLabel(step) {
  if (step === 'setup') return 'Setting up';
  if (step === 'summary') return 'Ready to submit';
  return `Round ${roundOf(step)} of 5`;
}
function stepShort(step) {
  if (step === 'setup') return 'Setup';
  if (step === 'summary') return 'Summary';
  return 'R' + roundOf(step);
}

/* ══ The wizard (#/play/:id) ══════════════════════════════════ */

async function renderWizard(state, draftId) {
  const root = el('div', { class: 'fade-in' });
  const token = hashParam('token');

  let d;
  try {
    d = await drafts.get(draftId, token);
  } catch (e) {
    if (e.status === 404) return notAllowedPanel('That game no longer exists.');
    if (e.status === 403 || e.status === 401) return notAllowedPanel("You don't have access to that game.");
    throw e;
  }

  // Arrived on a share link without a seat yet: claim the opponent seat.
  if (d.viewerSeat == null && token) {
    try {
      await drafts.join(draftId, token);
      d = await drafts.get(draftId, token);
    } catch (e) {
      toast(e.message || 'Could not join that game', 'error');
    }
  }
  // submitted_at, not submitted_game_id: the pointer is ON DELETE SET NULL, so
  // a game that was submitted and later deleted leaves the draft with no game
  // to point at. It's still finished, and must not reopen as an editable game.
  if (d.submitted_at) {
    if (d.submitted_game_id) {
      window.__nav('/games/' + d.submitted_game_id);
      return el('div', {});
    }
    return notAllowedPanel('This game was submitted, and the game it created has since been deleted.');
  }

  const isOwner = !!d.isOwner;
  // No seat means a spectator: the whole view goes read-only and follows the
  // owner's round. Anyone can watch a game in progress; only the two players
  // can write to it, and the server enforces that independently.
  const isSpectator = d.viewerSeat == null;
  const isAdmin = state.user?.role === 'admin';
  // Admins can move around someone else's game (to reach setup and delete it);
  // a plain opponent or spectator stays pinned to whatever round the owner is on.
  const canNavigate = isOwner || isAdmin;
  const mySeatIdx = isSpectator ? null : d.viewerSeat - 1;
  const theirSeatIdx = isOwner ? 1 : 0;
  const canEditSeat = (i) => !isSpectator && (isOwner || i === mySeatIdx);

  const payload = normalisePayload(d.payload);
  let step = STEPS.includes(d.current_step) ? d.current_step : 'setup';
  let rev = d.rev;
  let images = d.images || [];
  let activeSeat = mySeatIdx ?? 0;
  // Where the OWNER is. Tracked separately from `step`, because the opponent's
  // screen deliberately does not follow it.
  let ownerStep = step;

  // Reference data, loaded once like game-form does.
  const [factions, packs, playerNames, users] = await Promise.all([
    reference.factions().catch(() => []),
    reference.missionPacks().catch(() => []),
    reference.playerNames().catch(() => []),
    isOwner ? reference.users().catch(() => []) : Promise.resolve([]),
  ]);
  if (!payload.missionPackId) {
    const pack11 = packs.find((p) => p.name === E11_PACK_NAME);
    if (pack11) payload.missionPackId = pack11.id;
  }
  let missionDetails = await loadMissionDetails(payload.missionPackId);
  const detachmentsByFaction = {};
  await Promise.all(payload.players.map((p) => cacheDetachments(p.factionId)));

  async function loadMissionDetails(packId) {
    if (!packId) return { primaryMissions: [], deploymentMaps: [], missionRules: [], secondaryCards: [], challengerCards: [] };
    try { return await reference.missionDetails(packId); }
    catch { return { primaryMissions: [], deploymentMaps: [], missionRules: [], secondaryCards: [], challengerCards: [] }; }
  }
  async function cacheDetachments(factionId) {
    if (!factionId || detachmentsByFaction[factionId]) return;
    try { detachmentsByFaction[factionId] = await reference.detachments(factionId); }
    catch { detachmentsByFaction[factionId] = []; }
  }

  /* ── Autosave ─────────────────────────────────────────────── */

  const clientId = newClientId();
  const saveChip = el('span', { class: 'lg-save is-saved' }, 'Saved');
  let saveTimer = null;
  let saving = false;
  let pending = false;
  let inflight = null;
  let closed = false;
  let retryMs = AUTOSAVE_MS;
  let lastTimerSave = 0;

  function setSaveState(cls, text) {
    saveChip.className = 'lg-save ' + cls;
    saveChip.textContent = text;
  }

  // Written on EVERY mutation, unlike game-form's localStorage draft which only
  // lands on a structural rerender — typing a whole game's scores there never
  // touched storage. Cleared once the server has the change, so its presence on
  // load means "this device has edits the server never got".
  function mirrorLocal() {
    try {
      localStorage.setItem(localKey(draftId), JSON.stringify({ savedAt: Date.now(), rev, step, payload }));
    } catch { /* quota / disabled: the server copy is the real one anyway */ }
  }
  function clearLocal() {
    try { localStorage.removeItem(localKey(draftId)); } catch {}
  }

  function touch({ immediate = false } = {}) {
    if (isSpectator || closed) return;
    mirrorLocal();
    pending = true;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (immediate) flush();
    else saveTimer = setTimeout(flush, AUTOSAVE_MS);
  }

  function buildPatch() {
    if (isOwner) {
      const { players, ...game } = payload;
      return { ...game, players: { 0: players[0], 1: players[1] } };
    }
    return { players: { [mySeatIdx]: payload.players[mySeatIdx] } };
  }

  async function sendPatch() {
    saving = true;
    pending = false;
    setSaveState('is-saving', 'Saving…');
    try {
      const body = { baseRev: rev, clientId, patch: buildPatch() };
      if (isOwner) body.currentStep = step;
      const res = await drafts.patch(draftId, body);
      rev = res.rev;
      retryMs = AUTOSAVE_MS;
      setSaveState('is-saved', 'Saved');
      if (!pending) clearLocal();
      return true;
    } catch (e) {
      pending = true;
      if (e.code === 'network') setSaveState('is-offline', 'Offline — kept on this device');
      else setSaveState('is-error', e.message || 'Save failed');
      retryMs = Math.min(30000, Math.max(2000, retryMs * 2));
      return false;
    } finally {
      saving = false;
      if (pending && !saveTimer) saveTimer = setTimeout(flush, retryMs);
    }
  }

  // Resolves only once the server actually has everything typed so far, which
  // is what Submit and pagehide need it to mean. The old version bailed out
  // while a PATCH was in flight, so tapping Submit right after typing raced its
  // own autosave and submitted the *previous* payload — that's how a game with
  // both names filled in came back "player 2 still needs a name".
  // Bounded at two sends so a failing request can't spin.
  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (closed) return true;
    for (let attempts = 0; attempts < 2; attempts++) {
      if (saving) { await inflight?.catch(() => {}); continue; }
      if (!pending) return true;
      inflight = sendPatch();
      if (!(await inflight)) return false;
    }
    return !pending;
  }

  // A phone locking mid-game is the normal case, not the edge case.
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  const onPageHide = () => flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  const stray = isSpectator ? null : readLocal(draftId);
  if (stray && stray.payload) {
    const restore = await confirmModal({
      title: 'Unsaved changes on this device',
      body: `This phone has changes from ${relativeAge(stray.savedAt)} that never reached the server. Restore them?`,
      confirmLabel: 'Restore',
      cancelLabel: 'Discard',
    });
    if (restore) {
      Object.assign(payload, normalisePayload(stray.payload));
      if (STEPS.includes(stray.step)) step = stray.step;
      touch({ immediate: true });
    } else {
      clearLocal();
    }
  }

  /* ── Live updates from the other phone ────────────────────── */

  const onLive = (e) => {
    const det = e.detail || {};
    if (Number(det.id) !== Number(draftId)) return;
    if (det.by && det.by === clientId) return;
    if (det.rev != null && det.rev <= rev) return;
    adoptRemote();
  };
  document.addEventListener('live:draft.updated', onLive);

  async function adoptRemote() {
    let fresh;
    try {
      fresh = await drafts.get(draftId, token);
    } catch (e) {
      if (e.status === 404) {
        closed = true;
        toast('That game was deleted');
        window.__nav('/play');
      }
      return;
    }
    if (fresh.submitted_at) {
      toast('That game was submitted');
      window.__nav(fresh.submitted_game_id ? '/games/' + fresh.submitted_game_id : '/play');
      return;
    }
    const remote = normalisePayload(fresh.payload);
    if (pending || saving) {
      // Keep my own edits; take only the seat the other person writes.
      payload.players[theirSeatIdx] = remote.players[theirSeatIdx];
    } else {
      Object.assign(payload, remote);
    }
    rev = fresh.rev;
    images = fresh.images || images;
    if (STEPS.includes(fresh.current_step)) ownerStep = fresh.current_step;
    // A spectator follows along — they have nothing to type, and watching means
    // watching. The OPPONENT is not dragged: when the owner hits Next you may
    // still be entering the round you just played, and having the screen yanked
    // out from under you mid-number is worse than being a round behind. They
    // get a tappable nudge in the header instead.
    if (isSpectator && ownerStep !== step) {
      step = ownerStep;
      activeSeat = mySeatIdx ?? 0;
    }
    rerender();
  }

  /* ── Teardown ─────────────────────────────────────────────── */

  document.body.classList.add('live-game-mode');
  // Only THIS draft's own URL keeps the mount alive. `#/play` (the list) and
  // `#/play/<other id>` are different views: leaving the body class on makes the
  // list render edge-to-edge, and leaving the listeners on leaks a 1s ticker and
  // an SSE subscription onto a detached tree for every draft you open.
  const onHash = () => {
    const m = /^#\/play\/(\d+)/.exec(location.hash);
    if (m && Number(m[1]) === draftId) return;
    if (closePicker) { closePicker(); closePicker = null; }
    document.body.classList.remove('live-game-mode');
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('live:draft.updated', onLive);
    document.removeEventListener('visibilitychange', onHide);
    stopTicker();
    flush();
  };
  window.addEventListener('hashchange', onHash);

  /* ── Round timer ──────────────────────────────────────────── */

  let timer = null;
  let ticker = null;
  // The card picker parents itself to <body>, so a hash change (back button, or
  // the redirect adoptRemote() does when the other phone submits) would leave it
  // stranded over the next screen still listening for Escape.
  let closePicker = null;

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }
  function toggleTimer(seatIdx, n) {
    if (timer && timer.seat === seatIdx && timer.round === n) {
      timer = null;
      stopTicker();
      touch({ immediate: true });
      return;
    }
    timer = { seat: seatIdx, round: n };
    lastTimerSave = Date.now();
    if (!ticker) ticker = setInterval(tick, 1000);
  }
  // Seconds are banked into the round as they elapse rather than computed from
  // a start stamp on stop, so a crash mid-round loses at most one autosave.
  function tick() {
    if (!timer) { stopTicker(); return; }
    const r = roundRec(payload.players[timer.seat], timer.round);
    r.timeSeconds = (r.timeSeconds || 0) + 1;
    // Keyed on seat AND round: a clock left running while you jump back to fix
    // an earlier round would otherwise paint its seconds into that round's
    // readout, which shows a number the stored data doesn't have.
    const node = root.querySelector(`[data-lg-timer="${timer.seat}-${timer.round}"]`);
    if (node) node.textContent = fmtDuration(r.timeSeconds) ?? '0:00';
    mirrorLocal();
    if (Date.now() - lastTimerSave > TIMER_SAVE_MS) {
      lastTimerSave = Date.now();
      touch();
    }
  }

  /* ── Photos ───────────────────────────────────────────────── */

  // Two inputs, not one. `capture` forces the camera and hides the photo
  // library outright, so a single input can offer one or the other but never
  // both. Camera for the board shot you're taking right now; library (and
  // multi-select) for the ones already on your phone.
  const cameraInput = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden',
  });
  const libraryInput = el('input', {
    type: 'file', accept: 'image/*', multiple: true, class: 'hidden',
  });
  let photoRound = null;
  let photoEndOfRound = false;
  let photoAsMap = false;

  async function uploadFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const n = photoRound;
    const endOfRound = photoEndOfRound;
    const asMap = photoAsMap;
    const caption = asMap ? 'Terrain layout'
      : n ? (endOfRound ? `End of round ${n}` : `Round ${n}`) : null;
    let saved = 0;
    for (const [i, file] of list.entries()) {
      toast(list.length > 1 ? `Uploading ${i + 1} of ${list.length}…` : 'Uploading photo…');
      try {
        const [full, thumb] = await Promise.all([
          shrink(file, FULL_MAX_PX, JPEG_QUALITY),
          shrink(file, THUMB_MAX_PX, JPEG_QUALITY),
        ]);
        // Only the first of a batch claims the map tag. The library input is
        // `multiple` and a game has one table, so tagging every file would let
        // the server's clear-then-set hand it to whichever happened to land
        // last — picking four photos of your board should not be a lottery.
        const created = await draftImages.upload(draftId, {
          dataUrl: full.dataUrl,
          thumbDataUrl: thumb.dataUrl,
          width: full.width,
          height: full.height,
          roundNumber: n,
          isMap: asMap && i === 0,
          caption,
        });
        if (created.is_map) for (const im of images) im.is_map = false;
        images.push(created);
        saved += 1;
      } catch (e) {
        // Keep going: one bad file shouldn't cost you the rest of the batch.
        toast(e.message || 'Photo upload failed', 'error');
      }
    }
    if (saved) {
      rerender();
      toast(saved > 1 ? `${saved} photos saved` : 'Photo saved');
    }
  }

  for (const input of [cameraInput, libraryInput]) {
    input.addEventListener('change', async () => {
      const files = input.files;
      const copy = Array.from(files || []);
      input.value = '';
      await uploadFiles(copy);
    });
    root.appendChild(input);
  }

  function pickPhoto(n, { endOfRound = false, source = 'camera', asMap = false } = {}) {
    photoRound = n;
    photoEndOfRound = endOfRound;
    photoAsMap = asMap;
    (source === 'library' ? libraryInput : cameraInput).click();
  }

  /* ── Step navigation ──────────────────────────────────────── */

  // Each move pushes a history entry, so back returns to the screen you came
  // from — round 3 → round 2, or out of setup back to the round you were on —
  // instead of leaving the game entirely. `fromHistory` is the back-button
  // path and must not push an entry of its own.
  function goStep(next, { fromHistory = false } = {}) {
    if (!STEPS.includes(next) || next === step) return;
    const cameFrom = step;
    step = next;
    activeSeat = mySeatIdx ?? 0;
    if (isOwner) touch({ immediate: true });
    // `reason === 'route'` means we're leaving the view entirely, and nav-stack
    // unwinds EVERY step layer on the way out. Rewinding then would walk the
    // owner backwards through every screen they visited, PATCHing a rewound
    // `current_step` to the server each time — and after Submit, PATCHing an
    // already-submitted draft (409). Only a real back press should move a step.
    if (!fromHistory) {
      pushLayer((reason) => {
        if (reason === 'route') return;
        goStep(cameFrom, { fromHistory: true });
      });
    }
    rerender();
    window.scrollTo(0, 0);
  }

  // "hey snap a photo!" between rounds, opt-out per account so it can't nag
  // someone who finds it intrusive. The round screen keeps its own upload
  // control either way.
  //
  // Asking once per round is the whole contract: taking the photo leaves you on
  // the round screen (the camera has to close first), and without this the very
  // next tap on Next would ask again.
  const prompted = new Set();
  async function advance(next, fromRound) {
    if (fromRound && !prompted.has(fromRound) && state.user?.promptRoundPhoto !== false) {
      prompted.add(fromRound);
      // Both ways in, same as the round screen's own pair of buttons: one
      // <input type="file"> can offer the camera OR the library but never both
      // (`capture` hides the library outright), so the choice has to be made
      // before the picker opens. Offering only the camera meant a shot already
      // taken on the phone couldn't answer the nudge.
      const source = await choiceModal({
        title: 'Snap a photo?',
        body: `Grab a shot of the board at the end of round ${fromRound} — it goes into the game report. Easy to forget later.`,
        choices: [
          { label: '\u{1F4F7} Take photo', value: 'camera' },
          { label: '\u{1F5BC} Upload', value: 'library' },
        ],
        cancelLabel: 'Skip',
      });
      // Either picker has to close before anything else happens, so both stay
      // on the round screen rather than advancing.
      if (source) { pickPhoto(fromRound, { endOfRound: true, source }); return; }
    }
    goStep(next);
  }

  /* ── Render ───────────────────────────────────────────────── */

  const screen = el('div', {});
  root.appendChild(screen);

  function rerender() {
    clear(screen);
    screen.appendChild(buildScreen());
  }

  function buildScreen() {
    if (step === 'setup') return buildSetup();
    if (step === 'summary') return buildSummary();
    return buildRound(roundOf(step));
  }

  // Totals move on nearly every tap; rebuilding the screen for them would steal
  // focus from whatever input the user is in (CLAUDE.md pitfall #2), so the
  // readouts are patched in place through data- anchors instead.
  function refreshTotals() {
    payload.players.forEach((p, i) => {
      const total = screen.querySelector(`[data-lg-total="${i}"]`);
      if (total) total.textContent = String(calcTotal(p, '11'));
      const split = screen.querySelector(`[data-lg-split="${i}"]`);
      if (split) split.textContent = splitLabel(p);
      const head = screen.querySelector(`[data-lg-head="${i}"]`);
      if (head) head.textContent = String(calcTotal(p, '11'));
    });
    const [a, b] = payload.players.map((p) => calcTotal(p, '11'));
    const aEl = screen.querySelector('[data-lg-head="0"]');
    const bEl = screen.querySelector('[data-lg-head="1"]');
    if (aEl && bEl) {
      aEl.classList.toggle('is-behind', a < b);
      bEl.classList.toggle('is-behind', b < a);
    }
  }

  function splitLabel(p) {
    return `${capLabel(sumPrimary(p), E11_PRIMARY_CAP)} pri · ${capLabel(sumSecondaryPoints(p), E11_SECONDARY_CAP)} sec`;
  }

  /* ── Shared chrome ────────────────────────────────────────── */

  // A round counts as played if anything was actually recorded in it. Better
  // than "n < currentRound": that marks rounds you skipped past as done, and
  // blanks every pip the moment you step back to setup.
  function roundHasData(n) {
    return payload.players.some((p) => {
      const r = (p.rounds || []).find((x) => x.roundNumber === n);
      if (r && ((r.primaryScore || 0) > 0 || r.cpRemaining != null || (r.timeSeconds || 0) > 0)) return true;
      return (p.secondaries || []).some((sec) => sec.drawnRound === n || sec.roundNumber === n);
    });
  }
  function lastPlayedRound() {
    let last = 0;
    for (const n of ROUNDS) if (roundHasData(n)) last = n;
    return last;
  }

  function buildTopbar(title, currentRound) {
    const scores = payload.players.map((p, i) =>
      el('span', { class: 'lg-sc', 'data-lg-head': String(i) }, String(calcTotal(p, '11'))));
    const pips = ROUNDS.map((n) => {
      const isCurrent = currentRound === n;
      const done = !isCurrent && roundHasData(n);
      const pip = el('button', {
        class: `lg-pip ${isCurrent ? 'is-current' : ''} ${done ? 'is-done' : ''}`.trim(),
        type: 'button',
        title: `Go to round ${n}`,
        'aria-label': `Go to round ${n}${done ? ' (played)' : ''}`,
        'aria-current': isCurrent ? 'step' : null,
      });
      // Free navigation, not just prev/next: fixing a number typed into the
      // wrong round is the single most likely correction mid-game.
      if (canNavigate) pip.addEventListener('click', () => goStep('round' + n));
      else pip.disabled = true;
      return pip;
    });

    const onSetup = step === 'setup';
    const setupBtn = el('button', {
      class: `lg-pip-setup ${onSetup ? 'is-current' : ''}`.trim(),
      type: 'button',
      title: 'Game setup',
      'aria-label': 'Game setup',
      'aria-current': onSetup ? 'step' : null,
    }, '\u2699');
    if (canNavigate) setupBtn.addEventListener('click', () => goStep('setup'));
    else setupBtn.disabled = true;

    // The whole deck, readable by anyone watching — the point is to be able to
    // play off the app when the physical cards aren't on the table.
    const deckBtn = el('button', {
      class: 'lg-pip-setup',
      type: 'button',
      title: 'Mission cards',
      'aria-label': 'Read the mission cards',
      onClick: () => openMissionBrowser({ onMissing: (m) => toast(m, 'error') }),
    }, '\u{1F4D6}');

    return el('div', { class: 'lg-topbar' }, [
      el('div', { class: 'lg-topline' }, [
        el('h1', { class: 'lg-step-title' }, title),
        el('div', { class: 'lg-scoreline' }, [scores[0], el('span', { class: 'lg-sc-sep' }, '–'), scores[1]]),
      ]),
      el('div', { class: 'lg-progress' }, [setupBtn, ...pips, deckBtn]),
      el('div', { class: 'lg-statusline' }, [
        isSpectator
          ? el('span', { class: 'hint', style: { marginTop: '0' } }, 'Updates live as they play')
          : saveChip,
        isSpectator
          ? el('span', { class: 'pill' }, 'Watching')
          : isOwner ? null : buildFollowChip(),
      ].filter(Boolean)),
    ]);
  }

  // Shown to the invited opponent when the owner has moved on without them.
  // Tapping catches up; ignoring it is fine and keeps you where you were.
  function buildFollowChip() {
    if (isOwner || isSpectator || ownerStep === step) {
      return el('span', { class: 'dim', style: { fontSize: '11px' } }, 'Your seat only');
    }
    const label = ownerStep === 'summary' ? 'Summary'
      : ownerStep === 'setup' ? 'Setup'
      : `Round ${roundOf(ownerStep)}`;
    const chip = el('button', { class: 'lg-follow', type: 'button' }, `They're on ${label} →`);
    chip.addEventListener('click', () => goStep(ownerStep));
    return chip;
  }

  function buildSeatTabs() {
    const tabs = payload.players.map((p, i) => {
      const btn = el('button', {
        class: `lg-seat-tab ${i === activeSeat ? 'is-active' : ''}`.trim(),
        type: 'button',
        'aria-pressed': String(i === activeSeat),
      }, seatName(p, i));
      btn.addEventListener('click', () => { activeSeat = i; rerender(); });
      return btn;
    });
    return el('div', { class: 'lg-seat-tabs' }, tabs);
  }

  function seatName(p, i) {
    return (p.guestName && p.guestName.trim()) || `Player ${i + 1}`;
  }

  function buildFooter(children) {
    return el('div', { class: 'lg-footer' }, children);
  }

  function navFooter(prev, next, label, fromRound, nextLabel) {
    if (isSpectator) return watchFooter(label);
    const back = el('button', { class: 'btn lg-nav-btn is-icon', type: 'button', 'aria-label': 'Back' }, '←');
    back.disabled = !prev || !isOwner;
    back.addEventListener('click', () => goStep(prev));
    const fwd = el('button', { class: 'btn primary lg-nav-btn', type: 'button' },
      nextLabel || (next === 'summary' ? 'Finish →' : 'Next →'));
    fwd.disabled = !isOwner;
    fwd.addEventListener('click', () => advance(next, fromRound));
    return buildFooter([back, el('span', { class: 'lg-footer-label' }, label), fwd]);
  }

  // A spectator has nothing to press: the round they see is the round the
  // owner is on, pushed over SSE.
  function watchFooter(label) {
    return buildFooter([
      el('a', { class: 'btn lg-nav-btn', href: '#/play' }, '← Live games'),
      el('span', { class: 'lg-footer-label' }, label),
    ]);
  }

  /* ── Setup screen ─────────────────────────────────────────── */

  function buildSetup() {
    const wrap = el('div', { class: 'lg' });
    wrap.appendChild(buildTopbar('Game setup', null));
    const body = el('div', { class: 'lg-body' });

    const ro = !isOwner;

    const dateInp = el('input', { type: 'date', value: payload.playedAt || '' });
    dateInp.disabled = ro;
    dateInp.addEventListener('change', () => { payload.playedAt = dateInp.value || null; touch(); });

    const ptsInp = el('input', { type: 'number', inputmode: 'numeric', min: '0', step: '5', value: payload.pointsLimit ?? '' });
    ptsInp.disabled = ro;
    ptsInp.addEventListener('input', () => { payload.pointsLimit = parseInt(ptsInp.value, 10) || null; touch(); });

    const fmtSel = el('select', {}, selectOptions(
      [['matched', 'Matched'], ['tournament', 'Tournament'], ['narrative', 'Narrative'], ['crusade', 'Crusade'], ['open', 'Open']]
        .map(([id, name]) => ({ id, name })), 'id', 'name', false));
    fmtSel.value = payload.gameFormat || 'matched';
    fmtSel.disabled = ro;
    fmtSel.addEventListener('change', () => { payload.gameFormat = fmtSel.value; touch(); });

    const medSel = el('select', {}, selectOptions(
      [{ id: 'physical', name: 'In person' }, { id: 'digital', name: 'Tabletop Simulator' }], 'id', 'name', false));
    medSel.value = payload.playMedium || 'physical';
    medSel.disabled = ro;
    medSel.addEventListener('change', () => { payload.playMedium = medSel.value; touch(); });

    // Defaulted to the 11e pack on creation; still selectable so next year's
    // pack works without a code change.
    const packSel = el('select', {}, selectOptions(packs));
    packSel.value = payload.missionPackId ?? '';
    packSel.disabled = ro;
    packSel.addEventListener('change', async () => {
      payload.missionPackId = packSel.value ? parseInt(packSel.value, 10) : null;
      payload.deploymentMapId = null;
      payload.deploymentMapName = null;
      missionDetails = await loadMissionDetails(payload.missionPackId);
      applyPrimaryMatrix();
      touch();
      rerender();
    });

    body.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, el('h2', {}, 'The game')),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'form-row cols-2' }, [
          field('Date', dateInp),
          field('Points', ptsInp),
        ]),
        el('div', { class: 'form-row cols-2' }, [
          field('Format', fmtSel),
          field('Played', medSel),
        ]),
        field('Mission pack', packSel),
        buildLayoutField(ro),
      ]),
    ]));

    body.appendChild(buildMapPhotoPanel());

    body.appendChild(buildSeatTabs());
    body.appendChild(el('div', { class: 'lg-seats' },
      payload.players.map((p, i) => buildSetupSeat(p, i))));

    if (isOwner) body.appendChild(buildInvitePanel());
    if (isOwner || isAdmin) body.appendChild(buildDangerPanel());

    wrap.appendChild(body);
    const resume = lastPlayedRound();
    wrap.appendChild(navFooter(
      null,
      resume ? 'round' + resume : 'round1',
      'Setup',
      null,
      resume ? `Round ${resume} →` : 'Next →',
    ));
    return wrap;
  }

  function buildLayoutField(ro) {
    const layouts = (missionDetails.deploymentMaps || []);
    const isCustom = payload.mapMode === 'custom';
    const modeSel = el('select', {}, selectOptions(
      [{ id: 'matched', name: 'Matched play layout' }, { id: 'custom', name: 'Custom table' }], 'id', 'name', false));
    modeSel.value = isCustom ? 'custom' : 'matched';
    modeSel.disabled = ro;
    modeSel.addEventListener('change', () => {
      payload.mapMode = modeSel.value;
      payload.deploymentMapId = null;
      payload.deploymentMapName = null;
      touch();
      rerender();
    });

    let control;
    if (isCustom) {
      control = el('input', { type: 'text', placeholder: 'Your table', value: payload.deploymentMapName || '' });
      control.disabled = ro;
      control.addEventListener('input', () => { payload.deploymentMapName = control.value || null; touch(); });
    } else {
      const options = layouts.filter((m) => MATCHED_PLAY_LAYOUTS.includes(m.name));
      control = el('select', {}, selectOptions(options.length ? options : layouts));
      control.value = payload.deploymentMapId ?? '';
      control.disabled = ro;
      control.addEventListener('change', () => {
        payload.deploymentMapId = control.value ? parseInt(control.value, 10) : null;
        payload.deploymentMapName = null;
        touch();
      });
    }

    return el('div', { class: 'form-row cols-2' }, [
      field('Terrain', modeSel),
      field(isCustom ? 'Table name' : 'Layout', control),
    ]);
  }

  function buildSetupSeat(p, i) {
    const editable = canEditSeat(i);
    const seat = el('div', {
      class: `lg-seat ${i === activeSeat ? '' : 'is-inactive'} ${editable ? '' : 'is-readonly'}`.trim(),
    });

    const nameId = `lg-names-${i}`;
    const nameInp = el('input', { type: 'text', list: nameId, placeholder: 'Player name', value: p.guestName || '' });
    nameInp.disabled = !editable;
    nameInp.addEventListener('input', () => { p.guestName = nameInp.value || null; touch(); });
    // `change` fires on blur, so a rerender here destroys whatever control the
    // user just tabbed or tapped into. Patch the two places the name shows,
    // the same way refreshTotals() patches the scores (pitfall #2).
    nameInp.addEventListener('change', () => {
      const heading = seat.querySelector('.lg-seat-name');
      if (heading) heading.textContent = seatName(p, i);
      const tab = screen.querySelectorAll('.lg-seat-tab')[i];
      if (tab) tab.textContent = seatName(p, i);
    });
    const nameList = el('datalist', { id: nameId },
      (playerNames || []).map((n) => el('option', { value: typeof n === 'string' ? n : n.name }, '')));

    const facSel = el('select', {}, selectOptions(factions));
    facSel.value = p.factionId ?? '';
    facSel.disabled = !editable;
    facSel.addEventListener('change', async () => {
      p.factionId = facSel.value ? parseInt(facSel.value, 10) : null;
      await cacheDetachments(p.factionId);
      touch();
      rerender();
    });

    const dispSel = el('select', {}, selectOptions(
      FORCE_DISPOSITIONS.map((n) => ({ id: n, name: n })), 'id', 'name', true, '— Disposition —'));
    dispSel.value = p.forceDisposition || '';
    dispSel.disabled = !editable;
    dispSel.addEventListener('change', () => {
      p.forceDisposition = dispSel.value || null;
      applyPrimaryMatrix();
      touch();
      rerender();
    });

    const primaryName = primaryNameFor(p);
    const primary = el('div', { class: 'muted', style: { fontSize: '13px', minHeight: '18px' } },
      primaryName
        ? missionLink('primary', primaryName)
        : 'Set both dispositions to fill this in.');

    const firstBtn = el('button', {
      class: `btn ${p.wentFirst ? 'primary' : ''}`.trim(),
      type: 'button',
      style: { width: '100%', justifyContent: 'center', minHeight: '44px' },
    }, p.wentFirst ? 'Went first' : 'Went second');
    firstBtn.disabled = !editable;
    firstBtn.addEventListener('click', () => {
      const now = !p.wentFirst;
      payload.players.forEach((other) => { other.wentFirst = false; });
      p.wentFirst = now;
      touch();
      rerender();
    });

    seat.appendChild(el('div', { class: 'lg-seat-head' }, [
      el('div', {}, [
        el('h2', { class: 'lg-seat-name' }, seatName(p, i)),
        el('div', { class: 'lg-seat-faction' }, factionName(p.factionId) || 'No faction yet'),
      ]),
      editable ? null : el('span', { class: 'pill' }, 'Locked'),
    ].filter(Boolean)));

    seat.appendChild(el('div', { class: 'lg-field' }, [el('label', {}, 'Name'), nameInp, nameList]));
    seat.appendChild(el('div', { class: 'lg-field' }, [el('label', {}, 'Faction'), facSel]));
    seat.appendChild(buildDetachments(p, i, editable));
    seat.appendChild(el('div', { class: 'lg-field' }, [el('label', {}, 'Force disposition'), dispSel, primary]));
    seat.appendChild(el('div', { class: 'lg-field' }, firstBtn));
    seat.appendChild(buildArmyList(p, editable));
    return seat;
  }

  function buildDetachments(p, i, editable) {
    if (!Array.isArray(p.detachments)) p.detachments = p.detachmentName ? [p.detachmentName] : [];
    if (!p.detachments.length) p.detachments.push('');
    const listId = `lg-det-${i}`;
    const datalist = el('datalist', { id: listId },
      (detachmentsByFaction[p.factionId] || []).map((dt) => el('option', { value: dt.name }, '')));

    const rows = p.detachments.map((val, idx) => {
      const inp = el('input', { type: 'text', list: listId, placeholder: 'Detachment', value: val || '' });
      inp.disabled = !editable;
      inp.addEventListener('input', () => {
        p.detachments[idx] = inp.value;
        p.detachmentName = p.detachments.map((x) => (x || '').trim()).filter(Boolean).join(', ') || null;
        touch();
      });
      if (p.detachments.length > 1 && editable) {
        const rm = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Remove detachment' }, '×');
        rm.addEventListener('click', () => { p.detachments.splice(idx, 1); touch(); rerender(); });
        return el('div', { class: 'lg-det-row' }, [inp, rm]);
      }
      return el('div', { class: 'lg-det-row' }, inp);
    });

    const add = el('button', { class: 'btn small', type: 'button' }, '+ Add detachment');
    add.addEventListener('click', () => { p.detachments.push(''); touch(); rerender(); });

    return el('div', { class: 'lg-field' }, [
      el('label', {}, 'Detachments'),
      ...rows,
      datalist,
      editable ? add : null,
      el('div', { class: 'hint' }, '11e allows more than one.'),
    ].filter(Boolean));
  }

  // GW's own app hides your list the moment the game ends. Keeping it is the
  // whole point; the box takes a plain paste, a YAAB share code or a YAAB
  // share URL. A code is expanded to readable text on blur so the stored list
  // is legible and the games-list free-text search matches unit names rather
  // than base64.
  function buildArmyList(p, editable) {
    const ta = el('textarea', {
      class: 'lg-armylist',
      placeholder: 'Paste your army list, or a YAAB share code / link',
      rows: '18',
    });
    ta.value = p.armyListCode || '';
    ta.disabled = !editable;
    const hint = el('div', { class: 'hint' }, armyHint(p.armyListCode));

    ta.addEventListener('input', () => {
      p.armyListCode = ta.value || null;
      hint.textContent = armyHint(p.armyListCode);
      touch();
    });
    ta.addEventListener('change', async () => {
      const before = ta.value;
      if (!looksLikeYaabCode(before) && !before.trim().startsWith('{')) return;
      hint.textContent = 'Decoding…';
      const { value, decoded } = await normaliseArmyList(before);
      if (ta.value !== before) return;
      ta.value = value || before;
      p.armyListCode = ta.value || null;
      hint.textContent = decoded
        ? 'Decoded from YAAB — the code is kept on the last line.'
        : "Couldn't read that code; stored exactly as pasted.";
      touch();
    });

    return el('div', { class: 'lg-field' }, [el('label', {}, 'Army list'), ta, hint]);
  }

  function armyHint(text) {
    if (!text) return 'Optional — kept with the game so you can look it up later.';
    if (looksLikeYaabCode(text)) return 'YAAB code — tap out of the box to expand it.';
    const lines = String(text).split('\n').filter((l) => l.trim()).length;
    return `${lines} line${lines === 1 ? '' : 's'} saved.`;
  }

  // Two ways in, because only one of them always works: pick their account if
  // they have one, otherwise hand them a link. A guest opponent can't co-edit
  // at all — you track both sides, exactly as you would in the old form.
  function buildInvitePanel() {
    const body = el('div', { class: 'panel-body' });

    const invitedName = d.opponent_name
      || users.find((u) => u.id === d.opponent_user_id)?.display_name;
    if (d.opponent_user_id) {
      const clear = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
      clear.addEventListener('click', async () => {
        try {
          await drafts.uninvite(draftId);
          d.opponent_user_id = null;
          rerender();
        } catch (e) { toast(e.message || 'Could not remove', 'error'); }
      });
      body.appendChild(el('div', { class: 'lg-inline-row' }, [
        el('div', { class: 'lg-grow' }, [
          el('div', {}, invitedName || 'Invited'),
          el('div', { class: 'muted', style: { fontSize: '12px' } }, 'Can score their own side from their phone.'),
        ]),
        clear,
      ]));
    } else {
      const sel = el('select', {}, selectOptions(
        users.filter((u) => u.id !== state.user?.id),
        'id', 'display_name', true, '— Pick their account —'));
      const send = el('button', { class: 'btn', type: 'button' }, 'Invite');
      send.addEventListener('click', async () => {
        if (!sel.value) return;
        send.disabled = true;
        try {
          await drafts.invite(draftId, parseInt(sel.value, 10));
          d.opponent_user_id = parseInt(sel.value, 10);
          toast('Invited — it will show up in their Live Game list');
          rerender();
        } catch (e) {
          send.disabled = false;
          toast(e.message || 'Could not invite', 'error');
        }
      });
      body.appendChild(el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '10px' } },
        'Optional. If your opponent has an account they can enter their own scores; otherwise just track both sides yourself.'));
      body.appendChild(el('div', { class: 'lg-inline-row' }, [
        el('div', { class: 'lg-grow' }, sel),
        send,
      ]));
    }

    const link = `${location.origin}/#/play/${draftId}?token=${encodeURIComponent(d.share_token || '')}`;
    const copy = el('button', { class: 'btn small', type: 'button' }, 'Copy invite link');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
      catch { toast(link, 'error'); }
    });
    body.appendChild(el('div', { style: { marginTop: '12px' } }, [
      el('div', { class: 'hint', style: { marginBottom: '6px' } },
        "Or send a link — whoever opens it while signed in takes the opponent seat."),
      copy,
    ]));

    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, el('h2', {}, 'Opponent')),
      body,
    ]);
  }

  // Abandoning an in-progress game, not deleting a result: nothing has reached
  // the games list yet, so there is no /games row to tidy up afterwards.
  function buildDangerPanel() {
    const del = el('button', { class: 'btn small danger', type: 'button' }, 'Delete this game');
    del.addEventListener('click', async () => {
      const played = lastPlayedRound();
      const photos = images.length;
      const bits = [
        played ? `${played} round${played === 1 ? '' : 's'} of scoring` : null,
        photos ? `${photos} photo${photos === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      const ok = await confirmModal({
        title: 'Delete this game?',
        body: bits.length
          ? `Permanently removes this live game, including ${bits.join(' and ')}. It was never filed to the games list, so there is nothing to recover it from.`
          : 'Permanently removes this live game. It was never filed to the games list.',
        danger: true,
        confirmLabel: 'Delete game',
      });
      if (!ok) return;
      del.disabled = true;
      try {
        await drafts.remove(draftId);
        closed = true;
        pending = false;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        clearLocal();
        toast('Game deleted');
        window.__nav('/play');
      } catch (e) {
        del.disabled = false;
        toast(e.message || 'Could not delete that game', 'error');
      }
    });
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, el('h2', {}, 'Danger zone')),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '10px' } },
          'Abandon this game without recording it.'),
        del,
      ]),
    ]);
  }

  function applyPrimaryMatrix() {
    const [a, b] = payload.players;
    if (!a || !b) return;
    const setFor = (me, opp) => {
      const name = PRIMARY_MATRIX[me.forceDisposition]?.[opp.forceDisposition];
      if (!name) return;
      const match = (missionDetails.primaryMissions || [])
        .find((m) => (m.name || '').toLowerCase() === name.toLowerCase());
      me.primaryMissionId = match ? match.id : null;
      me.primaryMissionName = match ? null : name;
    };
    setFor(a, b);
    setFor(b, a);
  }

  function primaryNameFor(p) {
    if (p.primaryMissionName) return p.primaryMissionName;
    const m = (missionDetails.primaryMissions || []).find((x) => x.id === p.primaryMissionId);
    return m ? m.name : null;
  }

  function factionName(id) {
    const f = (factions || []).find((x) => x.id === id);
    return f ? f.name : null;
  }

  /* ── Round screen ─────────────────────────────────────────── */

  function buildRound(n) {
    const wrap = el('div', { class: 'lg' });
    wrap.appendChild(buildTopbar(`Round ${n}`, n));
    wrap.appendChild(buildSeatTabs());

    const body = el('div', { class: 'lg-body' });
    body.appendChild(el('div', { class: 'lg-seats' },
      payload.players.map((p, i) => buildRoundSeat(p, i, n))));
    body.appendChild(buildPhotoPanel(n));
    wrap.appendChild(body);

    const prev = n === 1 ? 'setup' : 'round' + (n - 1);
    const next = n === 5 ? 'summary' : 'round' + (n + 1);
    wrap.appendChild(navFooter(prev, next, `Round ${n} of 5`, n));
    return wrap;
  }

  function buildRoundSeat(p, i, n) {
    const editable = canEditSeat(i);
    const r = roundRec(p, n);
    const seat = el('div', {
      class: `lg-seat ${i === activeSeat ? '' : 'is-inactive'} ${editable ? '' : 'is-readonly'}`.trim(),
    });

    seat.appendChild(el('div', { class: 'lg-seat-head' }, [
      el('div', {}, [
        el('h2', { class: 'lg-seat-name' }, seatName(p, i)),
        el('div', { class: 'lg-seat-faction' }, factionName(p.factionId) || '—'),
      ]),
      el('div', {}, [
        el('div', { class: 'lg-seat-total', 'data-lg-total': String(i) }, String(calcTotal(p, '11'))),
        el('div', { class: 'lg-seat-split', 'data-lg-split': String(i) }, splitLabel(p)),
      ]),
    ]));

    const primaryName = primaryNameFor(p);
    seat.appendChild(el('div', { class: 'lg-field' }, [
      el('label', {}, [
        `Primary VP · round ${n}`,
        el('span', { class: 'lg-cap' }, `max ${E11_PRIMARY_ROUND_CAP}`),
      ]),
      // The primary is decided at setup and then never shown again, which is
      // exactly backwards when you're mid-round trying to remember what scores.
      primaryName
        ? el('div', { class: 'lg-card-meta', style: { marginBottom: '6px' } }, missionLink('primary', primaryName))
        : null,
      stepper({
        get: () => r.primaryScore || 0,
        set: (v) => { r.primaryScore = v; },
        // 15 per battle round, not just 45 per game. The stepper clamps on
        // commit, so this is a real ceiling and not merely an <input max> hint
        // a phone keyboard would ignore.
        min: 0, max: E11_PRIMARY_ROUND_CAP, editable,
        label: `primary VP, round ${n}, ${seatName(p, i)}`,
      }),
    ].filter(Boolean)));

    seat.appendChild(el('div', { class: 'lg-field' }, [
      el('label', {}, 'CP remaining'),
      stepper({
        get: () => r.cpRemaining,
        set: (v) => { r.cpRemaining = v; },
        min: 0, max: 30, editable, blankable: true,
        label: `CP remaining, round ${n}, ${seatName(p, i)}`,
      }),
    ]));

    seat.appendChild(buildSecondaries(p, i, n, editable));

    seat.appendChild(el('div', { class: 'lg-field' }, [
      el('label', {}, 'Round clock'),
      buildTimer(p, i, n, editable),
    ]));

    // Two ways to the same `timeSeconds`, because people time games two ways.
    // The app's own stopwatch banks seconds as they elapse; this is for a
    // physical clock you read off at the end of the round.
    seat.appendChild(el('div', { class: 'lg-field' }, [
      el('label', {}, [
        'Chess clock reading',
        el('span', { class: 'lg-cap' }, 'counts up all game'),
      ]),
      buildClockEntry(p, i, n, editable),
    ]));

    return seat;
  }

  // `label` is not decoration: a round screen holds four steppers (two seats ×
  // primary/CP), so without it a screen reader reads eight identical
  // "Increase"/"Decrease" buttons.
  function stepper({ get, set, min = 0, max = 99, editable = true, blankable = false, label = 'value' }) {
    const cur = get();
    const input = el('input', {
      type: 'number', inputmode: 'numeric', min: String(min), max: String(max),
      value: cur == null ? '' : String(cur),
      placeholder: blankable ? '–' : '0',
      'aria-label': label,
    });
    input.disabled = !editable;

    const commit = (v, { fromInput = false } = {}) => {
      let next = v;
      if (next == null) next = blankable ? null : min;
      else next = Math.min(max, Math.max(min, next));
      set(next);
      if (!fromInput) input.value = next == null ? '' : String(next);
      refreshTotals();
      touch();
    };

    const bump = (delta) => {
      const base = parseInt(input.value, 10);
      commit((Number.isFinite(base) ? base : 0) + delta);
    };

    const minus = el('button', { class: 'lg-step-btn', type: 'button', 'aria-label': `Decrease ${label}` }, '−');
    const plus = el('button', { class: 'lg-step-btn', type: 'button', 'aria-label': `Increase ${label}` }, '+');
    minus.addEventListener('click', () => bump(-1));
    plus.addEventListener('click', () => bump(1));
    minus.disabled = !editable;
    plus.disabled = !editable;

    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (raw === '') { set(blankable ? null : 0); refreshTotals(); touch(); return; }
      const parsed = parseInt(raw, 10);
      commit(Number.isFinite(parsed) ? parsed : null, { fromInput: true });
    });
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      commit(raw === '' ? null : parseInt(raw, 10));
    });

    return el('div', { class: 'lg-stepper' }, [minus, input, plus]);
  }

  /* ── Secondaries: the hand ────────────────────────────────── */

  function buildSecondaries(p, i, n, editable) {
    const hand = (p.secondaries || []).filter((s) =>
      s.drawnRound != null && s.drawnRound <= n && s.roundNumber == null);
    const settled = (p.secondaries || []).filter((s) => s.roundNumber === n);

    const rows = [];

    for (const s of hand) {
      const actions = el('div', { class: 'lg-card-actions' }, [
        cardBtn('Score', 'is-score', async () => {
          // The 15 is a ceiling on the ROUND, not on the card, so what's left
          // depends on what has already scored this round. No `exclude` needed:
          // a card in hand has no roundNumber yet, so it isn't in the sum.
          const headroom = secondaryRoundHeadroom(p, n);
          if (headroom <= 0) {
            toast(`Round ${n} is already at the ${E11_SECONDARY_ROUND_CAP} VP secondary cap`, 'error');
            return;
          }
          const vp = await promptModal({
            title: s.cardName,
            label: `Victory points scored — ${headroom} of ${E11_SECONDARY_ROUND_CAP} left this round`,
            defaultValue: String(Math.min(5, headroom)),
            type: 'number',
          });
          if (vp == null) return;
          const asked = Math.max(0, parseInt(vp, 10) || 0);
          const scored = Math.min(asked, headroom);
          if (scored < asked) {
            toast(`Capped at ${scored} — round ${n} only had ${headroom} secondary VP left`);
          }
          s.roundNumber = n;
          s.score = scored;
          s.wasDiscarded = false;
          touch();
          rerender();
        }),
        cardBtn('Discard', 'is-discard', () => {
          // Recorded on the round it left the hand so the game reads back
          // chronologically; score stays 0 so it can't affect the total.
          s.roundNumber = n;
          s.score = 0;
          s.wasDiscarded = true;
          touch();
          rerender();
        }),
        removeBtn(p, s),
      ]);
      rows.push(el('div', { class: 'lg-card' }, [
        el('div', { class: 'lg-card-main' }, [
          el('div', { class: 'lg-card-name' }, missionLink('secondary', s.cardName) || s.cardName),
          el('div', { class: 'lg-card-meta' }, s.drawnRound === n ? 'drawn this round' : `held since R${s.drawnRound}`),
        ]),
        editable ? actions : null,
      ].filter(Boolean)));
    }

    for (const s of settled) {
      const undo = cardBtn('Undo', 'is-discard', () => {
        s.roundNumber = null;
        s.score = 0;
        s.wasDiscarded = false;
        touch();
        rerender();
      });
      rows.push(el('div', { class: `lg-card ${s.wasDiscarded ? 'is-discarded' : 'is-scored'}` }, [
        el('div', { class: 'lg-card-main' }, [
          el('div', { class: 'lg-card-name' }, missionLink('secondary', s.cardName) || s.cardName),
          el('div', { class: 'lg-card-meta' }, s.wasDiscarded ? 'discarded' : `scored · drawn R${s.drawnRound ?? '?'}`),
        ]),
        s.wasDiscarded ? null : el('div', { class: 'lg-card-vp' }, String(s.score || 0)),
        editable ? el('div', { class: 'lg-card-actions' }, [undo, removeBtn(p, s)]) : null,
      ].filter(Boolean)));
    }

    if (!rows.length) {
      rows.push(el('div', { class: 'lg-empty' }, 'No cards in hand. Draw one when you do.'));
    }

    const draw = el('button', { class: 'btn lg-draw', type: 'button' }, '+ Draw a card');
    draw.addEventListener('click', () => openDrawPicker(p, n));

    const scoredThisRound = sumSecondaryForRound(p, n);
    return el('div', { class: 'lg-field' }, [
      el('label', {}, [
        'Secondary missions',
        el('span', {
          class: `lg-cap ${scoredThisRound >= E11_SECONDARY_ROUND_CAP ? 'is-full' : ''}`.trim(),
        }, `${scoredThisRound} / ${E11_SECONDARY_ROUND_CAP} this round`),
      ]),
      el('div', { class: 'lg-cards' }, rows),
      editable ? draw : null,
    ].filter(Boolean));
  }

  // cardId may be null — a card the seeded deck doesn't carry still records
  // fine by name, which is what player_secondaries stores anyway.
  function drawCard(p, n, card, { announce = false } = {}) {
    p.secondaries.push({
      cardId: card.id ?? null,
      cardName: card.name,
      drawnRound: n,
      roundNumber: null,
      score: 0,
      wasDiscarded: false,
    });
    touch();
    rerender();
    if (announce) toast(`Drew ${card.name}`);
  }

  function cardBtn(label, cls, onClick, attrs = {}) {
    const b = el('button', { class: `lg-card-btn ${cls}`, type: 'button', ...attrs }, label);
    b.addEventListener('click', onClick);
    return b;
  }

  // Distinct from Discard: a discard is a real game event and stays on the
  // record, this is "that card never happened" for a mis-tap in the picker.
  function removeBtn(p, s) {
    return cardBtn('✕', 'is-remove', () => removeCard(p, s), {
      'aria-label': `Remove ${s.cardName}`,
      title: 'Remove — drawn by mistake',
    });
  }

  async function removeCard(p, s) {
    const ok = await confirmModal({
      title: 'Remove this card?',
      body: `"${s.cardName}" comes off the record entirely, as if it was never drawn. `
        + 'If it really was drawn and then thrown away, use Discard instead so the game reads back right.',
      danger: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    const list = p.secondaries || [];
    const i = list.indexOf(s);
    if (i < 0) return;
    list.splice(i, 1);
    touch();
    rerender();
  }


  function openDrawPicker(p, n) {
    // Discarded cards go back to the deck and can genuinely come up again, so
    // only cards in hand or already scored are filtered out. A redraw pushes a
    // second row, which player_secondaries allows (no unique constraint).
    const taken = new Set((p.secondaries || [])
      .filter((s) => !s.wasDiscarded)
      .map((s) => (s.cardName || '').toLowerCase()));
    const deck = (missionDetails.secondaryCards || [])
      .filter((c) => !taken.has((c.name || '').toLowerCase()))
      .slice()
      .sort((a, b) => {
        const x = (a.name || '').toLowerCase();
        const y = (b.name || '').toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      });

    const overlay = el('div', { class: 'modal-overlay' });
    let pickerLayer = null;
    let torn = false;
    const teardown = () => {
      if (torn) return;
      torn = true;
      closePicker = null;
      overlay.classList.remove('show');
      document.removeEventListener('keydown', esc);
      setTimeout(() => overlay.remove(), 150);
    };
    const close = () => { teardown(); pickerLayer?.done(); };
    closePicker = close;
    const esc = (e) => { if (e.key === 'Escape') close(); };

    // `items` stays the list of *pick* buttons — the focus target below and the
    // "is the deck empty" test both key off it — while each row also carries a
    // reader, so you can check what a card does without committing to it.
    const items = [];
    const rows = deck.map((c) => {
      const pick = el('button', { class: 'lg-picker-item', type: 'button' }, c.name);
      pick.addEventListener('click', () => { drawCard(p, n, c); close(); });
      items.push(pick);
      const info = el('button', {
        class: 'lg-picker-info',
        type: 'button',
        title: `Read the rules for ${c.name}`,
        'aria-label': `Read the rules for ${c.name}`,
        onClick: () => openMissionCard({ kind: 'secondary', name: c.name, onMissing: (m) => toast(m, 'error') }),
      }, '\u{2139}');
      return el('div', { class: 'lg-picker-row' }, [pick, info]);
    });

    // Top of the list, where your thumb already is when the picker opens.
    // Tactical secondaries are drawn blind, so picking one off an alphabetical
    // list is the unusual case and this is the normal one.
    const rando = el('button', { class: 'lg-picker-item is-random', type: 'button' },
      '\u{1F3B2} Draw at random');
    rando.addEventListener('click', () => {
      if (!deck.length) return;
      drawCard(p, n, deck[Math.floor(Math.random() * deck.length)], { announce: true });
      close();
    });

    const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);

    overlay.appendChild(el('div', { class: 'modal-dialog', role: 'dialog' }, [
      el('div', { class: 'modal-header' }, el('h2', {}, `Draw · round ${n}`)),
      el('div', { class: 'modal-body' }, items.length
        ? el('div', { class: 'lg-picker' }, [rando, ...rows])
        : el('div', { class: 'lg-empty' }, 'Every card in the pack has been drawn.')),
      el('div', { class: 'modal-footer' },
        el('div', { class: 'btn-group', style: { justifyContent: 'flex-end', width: '100%' } }, cancel)),
    ]));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(overlay);
    pickerLayer = pushLayer(teardown);
    requestAnimationFrame(() => overlay.classList.add('show'));
    // Same 100ms deferral buildModal() uses, so focus doesn't land behind the
    // overlay while it is still transitioning in.
    setTimeout(() => (items[0] || cancel).focus(), 100);
  }

  /* ── Timer + photos ───────────────────────────────────────── */

  function buildTimer(p, i, n, editable) {
    const r = roundRec(p, n);
    const running = !!(timer && timer.seat === i && timer.round === n);
    const val = el('span', { class: 'lg-timer-val', 'data-lg-timer': `${i}-${n}` },
      fmtDuration(r.timeSeconds) ?? '0:00');
    const btn = el('button', { class: 'btn lg-timer-btn', type: 'button' }, running ? 'Stop' : 'Start');
    btn.disabled = !editable;
    btn.addEventListener('click', () => { toggleTimer(i, n); rerender(); });
    return el('div', { class: `lg-timer ${running ? 'is-running' : ''}`.trim() }, [val, btn]);
  }

  // For a physical chess clock left counting up all game. You read the number
  // off the device and type it in; the round's own duration is the difference
  // against what the clock stood at when the previous round was banked.
  //
  // The field shows the READING, not the round, because that is what you are
  // copying — matching it against the clock in front of you is the whole point.
  function buildClockEntry(p, i, n, editable) {
    const r = roundRec(p, n);
    const prior = cumulativeTimeThrough(p, n - 1);
    const reading = Number.isFinite(r.timeSeconds) ? prior + r.timeSeconds : null;

    const derived = el('div', { class: 'lg-clock-derived' },
      Number.isFinite(r.timeSeconds)
        ? `Round ${n} took ${fmtDuration(r.timeSeconds)}${prior ? ` · ${fmtDuration(prior)} banked before it` : ''}`
        : (prior ? `Clock stood at ${fmtDuration(prior)} after round ${n - 1}` : 'Enter what the clock reads now.'));

    const input = el('input', {
      // The placeholder is the floor the reading has to clear, which for round 1
      // is nothing — so show the format there instead of a meaningless 0:00.
      type: 'text', inputmode: 'numeric', placeholder: prior ? `> ${fmtDuration(prior)}` : 'm:ss',
      value: fmtDuration(reading) ?? '',
      'aria-label': `Chess clock reading after round ${n}, ${seatName(p, i)}`,
      style: { textAlign: 'center' },
    });
    input.disabled = !editable;

    input.addEventListener('change', () => {
      const raw = input.value.trim();
      if (!raw) {
        r.timeSeconds = null;
        touch();
        rerender();
        return;
      }
      // parseDuration takes m:ss, h:mm:ss, or a bare number as MINUTES, and
      // rejects nonsense like 12:99 rather than coercing it.
      const seconds = parseDuration(raw);
      if (seconds == null) {
        toast('Enter the clock as m:ss or h:mm:ss', 'error');
        input.value = fmtDuration(reading) ?? '';
        return;
      }
      const round = roundTimeFromClock(p, n, seconds);
      if (round == null) {
        // A count-up clock cannot go backwards, so this is a typo — say so
        // instead of recording a negative round or silently zeroing it.
        toast(`The clock read ${fmtDuration(prior)} after round ${n - 1}, so it can't read ${fmtDuration(seconds)} now`, 'error');
        input.value = fmtDuration(reading) ?? '';
        return;
      }
      r.timeSeconds = round;
      touch();
      rerender();
    });

    return el('div', { class: 'lg-clock' }, [input, derived]);
  }

  // The table you're playing on, shot at setup. It carries `is_map` all the way
  // onto the finished game, which is what puts it in the games list's second
  // thumbnail slot — otherwise that falls back to the picture shared by every
  // game played on the layout.
  function buildMapPhotoPanel() {
    const setupPhotos = images.filter((im) => im.round_number == null);
    setupPhotos.sort((a, b) => (b.is_map === true) - (a.is_map === true) || a.id - b.id);
    const tiles = setupPhotos.map((im) => el('div', { class: 'lg-photo' }, [
      el('img', {
        src: draftImages.url(draftId, im.thumb_name || im.file_name),
        alt: im.caption || 'Terrain layout', loading: 'lazy',
      }),
      im.is_map
        ? el('span', { class: 'photo-badge is-map' }, 'MAP')
        : im.caption
          ? el('span', { class: 'photo-badge is-round', title: im.caption }, im.caption)
          : null,
    ].filter(Boolean)));

    const take = el('button', { class: 'btn', type: 'button', style: { minHeight: '44px' } }, [
      el('span', { 'aria-hidden': 'true' }, '\u{1F4F7}'), ' Take photo',
    ]);
    take.addEventListener('click', () => pickPhoto(null, { source: 'camera', asMap: true }));
    const upload = el('button', { class: 'btn', type: 'button', style: { minHeight: '44px' } }, [
      el('span', { 'aria-hidden': 'true' }, '\u{1F5BC}'), ' Upload',
    ]);
    upload.addEventListener('click', () => pickPhoto(null, { source: 'library', asMap: true }));

    if (!tiles.length && isSpectator) return el('div', {});
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, [
        el('h2', {}, 'Terrain layout'),
        isSpectator ? null : el('div', { class: 'btn-group' }, [take, upload]),
      ].filter(Boolean)),
      el('div', { class: 'panel-body' }, [
        tiles.length
          ? el('div', { class: 'lg-photos' }, tiles)
          : el('div', { class: 'lg-card-meta' },
              'A shot of the table before you deploy. It files with the game tagged MAP.'),
      ]),
    ]);
  }

  function buildPhotoPanel(n) {
    const mine = images.filter((im) => im.round_number === n);
    const tiles = mine.map((im) => el('div', { class: 'lg-photo' }, [
      el('img', { src: draftImages.url(draftId, im.thumb_name || im.file_name), alt: im.caption || `Round ${n}`, loading: 'lazy' }),
      im.caption ? el('span', { class: 'photo-badge is-round', title: im.caption }, im.caption) : null,
    ].filter(Boolean)));
    const take = el('button', { class: 'btn', type: 'button', style: { minHeight: '44px' } }, [
      el('span', { 'aria-hidden': 'true' }, '\u{1F4F7}'), ' Take photo',
    ]);
    take.addEventListener('click', () => pickPhoto(n, { source: 'camera' }));
    const upload = el('button', { class: 'btn', type: 'button', style: { minHeight: '44px' } }, [
      el('span', { 'aria-hidden': 'true' }, '\u{1F5BC}'), ' Upload',
    ]);
    upload.addEventListener('click', () => pickPhoto(n, { source: 'library' }));

    if (!tiles.length && isSpectator) return el('div', {});
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, [
        el('h2', {}, `Round ${n} photos`),
        isSpectator ? null : el('div', { class: 'btn-group' }, [take, upload]),
      ].filter(Boolean)),
      tiles.length ? el('div', { class: 'panel-body' }, el('div', { class: 'lg-photos' }, tiles)) : null,
    ].filter(Boolean));
  }

  /* ── Summary ──────────────────────────────────────────────── */

  function buildSummary() {
    const wrap = el('div', { class: 'lg' });
    wrap.appendChild(buildTopbar('Summary', null));
    const body = el('div', { class: 'lg-body' });

    const [a, b] = payload.players;
    const sa = calcTotal(a, '11');
    const sb = calcTotal(b, '11');
    const verdict = sa === sb ? 'Draw' : `${seatName(sa > sb ? a : b, sa > sb ? 0 : 1)} wins`;
    body.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'lg-winner' }, `${sa} – ${sb} · ${verdict}`),
    ]));

    body.appendChild(el('div', { class: 'lg-seats' },
      payload.players.map((p, i) => buildSummarySeat(p, i))));

    body.appendChild(buildWrapUpPanel());

    const photos = images.slice().sort((x, y) => (x.round_number || 0) - (y.round_number || 0));
    if (photos.length) {
      body.appendChild(el('div', { class: 'panel' }, [
        el('div', { class: 'panel-header' }, el('h2', {}, `Photos (${photos.length})`)),
        el('div', { class: 'panel-body' }, el('div', { class: 'lg-photos' },
          photos.map((im) => el('div', { class: 'lg-photo' }, [
            el('img', { src: draftImages.url(draftId, im.thumb_name || im.file_name), alt: im.caption || 'Game photo', loading: 'lazy' }),
            im.is_map
              ? el('span', { class: 'photo-badge is-map' }, 'MAP')
              : im.caption
                ? el('span', { class: 'photo-badge is-round', title: im.caption }, im.caption)
                : null,
          ].filter(Boolean))))),
      ]));
    }

    wrap.appendChild(body);
    wrap.appendChild(buildSubmitFooter());
    return wrap;
  }

  function buildSummarySeat(p, i) {
    const rows = ROUNDS.map((n) => {
      const r = roundRec(p, n);
      const cards = (p.secondaries || []).filter((s) => s.roundNumber === n && !s.wasDiscarded);
      const secPts = cards.reduce((sum, s) => sum + (s.score || 0), 0);
      return el('tr', {}, [
        el('td', {}, `R${n}`),
        el('td', { class: 'tabular' }, String(r.primaryScore || 0)),
        el('td', { class: 'tabular' }, String(secPts)),
        el('td', { class: 'tabular' }, r.cpRemaining == null ? '–' : String(r.cpRemaining)),
        el('td', { class: 'tabular' }, fmtDuration(r.timeSeconds) ?? '–'),
      ]);
    });

    const cardLines = (p.secondaries || [])
      .slice()
      .sort((x, y) => (x.drawnRound || 0) - (y.drawnRound || 0))
      .map((s) => el('div', { class: 'lg-card-meta' },
        `${s.cardName} — drawn R${s.drawnRound ?? '?'}${s.wasDiscarded ? ', discarded' : s.roundNumber ? `, scored R${s.roundNumber} for ${s.score}` : ', never scored'}`));

    return el('div', { class: 'lg-seat' }, [
      el('div', { class: 'lg-seat-head' }, [
        el('div', {}, [
          el('h2', { class: 'lg-seat-name' }, seatName(p, i)),
          el('div', { class: 'lg-seat-faction' }, [factionName(p.factionId), p.detachmentName].filter(Boolean).join(' · ') || '—'),
        ]),
        el('div', {}, [
          el('div', { class: 'lg-seat-total', 'data-lg-total': String(i) }, String(calcTotal(p, '11'))),
          el('div', { class: 'lg-seat-split', 'data-lg-split': String(i) }, splitLabel(p)),
        ]),
      ]),
      el('div', { class: 'lg-table-wrap' }, el('table', { class: 'lg-summary-table' }, [
        el('thead', {}, el('tr', {}, ['', 'Pri', 'Sec', 'CP', 'Time'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows),
      ])),
      cardLines.length ? el('div', { style: { marginTop: '10px' } }, cardLines) : null,
    ].filter(Boolean));
  }

  function buildWrapUpPanel() {
    const ro = !isOwner;

    const turnInp = el('input', { type: 'number', inputmode: 'numeric', min: '1', max: '5', value: payload.turnCount ?? '' });
    turnInp.disabled = ro;
    turnInp.addEventListener('input', () => { payload.turnCount = parseInt(turnInp.value, 10) || null; touch(); });

    const endSel = el('select', {}, selectOptions(
      [{ id: 'normal', name: 'Played to the end' }, { id: 'concession', name: 'Concession' }, { id: 'tabled', name: 'Tabled' }],
      'id', 'name', false));
    endSel.value = payload.endCondition || 'normal';
    endSel.disabled = ro;
    endSel.addEventListener('change', () => { payload.endCondition = endSel.value; touch(); });

    const locInp = el('input', { type: 'text', placeholder: 'Where', value: payload.location || '' });
    locInp.disabled = ro;
    locInp.addEventListener('input', () => { payload.location = locInp.value || null; touch(); });

    const notes = el('textarea', { placeholder: 'How it went…' });
    notes.value = payload.notes || '';
    notes.disabled = ro;
    notes.addEventListener('input', () => { payload.notes = notes.value || null; touch(); });

    const winnerRow = payload.players.map((p, i) => {
      const b = el('button', {
        class: `btn ${p.manualWinner ? 'primary' : ''}`.trim(),
        type: 'button',
        style: { flex: '1', justifyContent: 'center', minHeight: '44px' },
      }, `${seatName(p, i)} won`);
      b.disabled = ro;
      b.addEventListener('click', () => { p.manualWinner = !p.manualWinner; touch(); rerender(); });
      return b;
    });

    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, el('h2', {}, 'Wrap up')),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'form-row cols-2' }, [
          field('Turns played', turnInp),
          field('Ended', endSel),
        ]),
        field('Location', locInp),
        field('Notes', notes),
        el('div', { class: 'lg-field' }, [
          el('label', {}, 'Override the winner (optional)'),
          el('div', { class: 'btn-group' }, winnerRow),
          el('div', { class: 'hint' },
            'Leave both off to go by score. Both on records a draw.'),
        ]),
      ]),
    ]);
  }

  function buildSubmitFooter() {
    if (isSpectator) return watchFooter('Summary');
    const back = el('button', { class: 'btn lg-nav-btn is-icon', type: 'button', 'aria-label': 'Back' }, '←');
    back.disabled = !isOwner;
    back.addEventListener('click', () => goStep('round5'));

    const keep = el('button', { class: 'btn lg-nav-btn', type: 'button' }, 'Save draft');
    keep.addEventListener('click', async () => {
      const saved = await flush();
      toast(saved ? 'Draft saved — pick it up from Live Game'
                  : 'Kept on this device — it will sync when you are back online',
            saved ? 'info' : 'error');
      window.__nav('/play');
    });

    const submit = el('button', { class: 'btn primary lg-nav-btn', type: 'button' }, 'Submit');
    submit.disabled = !isOwner;
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      try {
        if (!(await flush())) {
          submit.disabled = false;
          toast("Couldn't save your latest changes — check your connection and try again", 'error');
          return;
        }
        const res = await drafts.submit(draftId);
        clearLocal();
        toast('Game submitted');
        window.__nav('/games/' + res.gameId);
      } catch (e) {
        submit.disabled = false;
        toast(e.message || 'Could not submit', 'error');
      }
    });

    return buildFooter(isOwner ? [back, keep, submit] : [back, keep]);
  }

  /* ── Kick off ─────────────────────────────────────────────── */

  rerender();
  return root;
}

/* ══ Helpers ══════════════════════════════════════════════════ */

function field(label, control) {
  return el('div', { class: 'form-group lg-field' }, [el('label', {}, label), control]);
}

function roundOf(step) {
  const m = /^round(\d)$/.exec(String(step || ''));
  return m ? parseInt(m[1], 10) : 1;
}

function roundRec(p, n) {
  if (!Array.isArray(p.rounds)) p.rounds = [];
  let r = p.rounds.find((x) => x.roundNumber === n);
  if (!r) {
    r = { roundNumber: n, primaryScore: 0, secondaryScore: 0, cpRemaining: null, timeSeconds: null };
    p.rounds.push(r);
    p.rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  }
  return r;
}

function emptyPlayer() {
  return {
    userId: null, guestName: null,
    factionId: null, detachmentId: null, detachmentName: null,
    primaryMissionId: null, primaryMissionName: null, forceDisposition: null,
    detachments: [], timeSeconds: null, armyListCode: null,
    wentFirst: false, isAttacker: null, manualWinner: false,
    finalScore: 0, result: null,
    rounds: ROUNDS.map((n) => ({ roundNumber: n, primaryScore: 0, secondaryScore: 0, cpRemaining: null, timeSeconds: null })),
    secondaries: [], challengers: [],
  };
}

function makeEmptyPayload() {
  return {
    playedAt: new Date().toISOString().slice(0, 10),
    gameFormat: 'matched',
    pointsLimit: 2000,
    missionPackId: null,
    primaryMissionId: null, primaryMissionName: null,
    deploymentMapId: null, deploymentMapName: null,
    missionRuleId: null, missionRuleName: null,
    turnCount: null, endCondition: 'normal',
    tournamentName: null, tournamentRound: null, tournamentTable: null,
    location: null, notes: null,
    playMedium: 'physical',
    edition: '11',
    mapMode: 'matched',
    players: [emptyPlayer(), emptyPlayer()],
  };
}

// A draft can be older than the current shape (or arrive from another client
// mid-edit), so every array the UI indexes into is guaranteed here rather than
// guarded at each use.
function normalisePayload(raw) {
  const base = makeEmptyPayload();
  const p = { ...base, ...(raw || {}) };
  p.edition = '11';
  const players = Array.isArray(raw?.players) ? raw.players : [];
  p.players = [0, 1].map((i) => {
    const src = players[i] || {};
    const player = { ...emptyPlayer(), ...src };
    player.rounds = ROUNDS.map((n) => {
      const r = (Array.isArray(src.rounds) ? src.rounds : []).find((x) => x.roundNumber === n) || {};
      return {
        roundNumber: n,
        primaryScore: r.primaryScore || 0,
        secondaryScore: r.secondaryScore || 0,
        cpRemaining: r.cpRemaining ?? null,
        timeSeconds: r.timeSeconds ?? null,
      };
    });
    player.secondaries = (Array.isArray(src.secondaries) ? src.secondaries : []).map((s) => ({
      cardId: s.cardId ?? null,
      cardName: s.cardName,
      drawnRound: s.drawnRound ?? null,
      roundNumber: s.roundNumber ?? null,
      score: s.score || 0,
      wasDiscarded: !!s.wasDiscarded,
    })).filter((s) => s.cardName);
    player.detachments = Array.isArray(src.detachments) ? src.detachments.slice() : [];
    player.challengers = [];
    return player;
  });
  return p;
}

function readLocal(id) {
  try {
    const raw = localStorage.getItem(`tg40k:liveDraft:${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function newClientId() {
  try { return crypto.randomUUID().slice(0, 12); }
  catch { return Math.random().toString(36).slice(2, 14); }
}

function hashParam(name) {
  const h = window.location.hash || '';
  const q = h.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(h.slice(q + 1)).get(name);
}

function relativeAge(ts) {
  const then = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(then)) return 'recently';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function notAllowedPanel(message) {
  return el('div', { class: 'panel fade-in' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Live game')),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'muted' }, message),
      el('div', { class: 'btn-group', style: { marginTop: '12px' } },
        el('a', { class: 'btn', href: '#/play' }, 'Your live games')),
    ]),
  ]);
}
