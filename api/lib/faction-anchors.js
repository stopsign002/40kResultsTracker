// @ts-check
// Server-side mirror of the FACTION_HOMES table that lives in
// app/js/views/warmap.js. Both copies must stay in sync — anchors are part
// of the frozen invariants (see CLAUDE.md). The frontend renders the map
// using the table in warmap.js; the server uses this copy to pick spare
// anchors for displaced banners (the 2nd+ player of a faction).
export const FACTION_HOMES = {
  'Space Marines':       [0.50, 0.48],
  'Adeptus Custodes':    [0.50, 0.50],
  'Imperial Agents':     [0.52, 0.49],
  'Adepta Sororitas':    [0.45, 0.52],
  'Adeptus Mechanicus':  [0.46, 0.46],
  'Astra Militarum':     [0.48, 0.43],
  'Grey Knights':        [0.54, 0.46],
  'Deathwatch':          [0.55, 0.42],
  'Imperial Knights':    [0.43, 0.50],
  'Black Templars':      [0.48, 0.40],
  'Blood Angels':        [0.58, 0.52],
  'Dark Angels':         [0.40, 0.46],
  'Space Wolves':        [0.36, 0.40],
  'Aeldari':             [0.30, 0.42],
  'Drukhari':            [0.28, 0.55],
  'Necrons':             [0.74, 0.60],
  'Orks':                [0.62, 0.36],
  'Tyranids':            [0.86, 0.66],
  "T'au Empire":         [0.80, 0.56],
  'Genestealer Cults':   [0.66, 0.55],
  'Leagues of Votann':   [0.34, 0.62],
  'Chaos Space Marines': [0.18, 0.50],
  'Chaos Daemons':       [0.20, 0.46],
  'Chaos Knights':       [0.22, 0.55],
  'Death Guard':         [0.16, 0.58],
  'Thousand Sons':       [0.18, 0.42],
  'World Eaters':        [0.21, 0.38],
  "Emperor's Children":  [0.15, 0.48],
  'Salamanders':         [0.60, 0.46],
};

// Open-territory spawn pool. Slots are between FACTION_HOMES entries so
// displaced banners read as "spilling into open land" rather than stealing
// another faction's home. Anchors don't have to lie on the continent
// silhouette — the closest-Voronoi-site search projects to land regardless.
export const SPARE_ANCHORS = [
  [0.50, 0.20], [0.10, 0.30], [0.90, 0.30], [0.10, 0.70], [0.90, 0.70],
  [0.50, 0.85], [0.30, 0.25], [0.70, 0.25], [0.30, 0.78], [0.70, 0.78],
  [0.25, 0.50], [0.75, 0.50],
];

/**
 * Picks the spare anchor furthest from every currently-claimed banner
 * anchor (maximin). Deterministic given the same `claimed` set.
 * Iterates explicit arrays — no Object key order, no locale-sensitive
 * comparisons — to stay byte-identical across browsers.
 *
 * @param {Array<[number, number]>} claimed
 * @returns {[number, number]}
 */
export function chooseSpareAnchor(claimed) {
  let best = SPARE_ANCHORS[0];
  let bestMinD = -1;
  for (const cand of SPARE_ANCHORS) {
    let minD = Infinity;
    for (const c of claimed) {
      const dx = cand[0] - c[0], dy = cand[1] - c[1];
      const d = dx * dx + dy * dy;
      if (d < minD) minD = d;
    }
    if (minD > bestMinD) { bestMinD = minD; best = cand; }
  }
  return best;
}
