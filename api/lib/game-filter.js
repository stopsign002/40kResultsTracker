// @ts-check
// Single source of truth for "which games count toward competitive surfaces"
// (war map, rankings, stats). Digital (Tabletop Simulator) games are INCLUDED by
// default; set INCLUDE_DIGITAL_IN_STATS=false in the environment to exclude them
// from all of those at once (browse/list is unaffected — you can still see them).
//
// COUNTED_GAMES is meant to be dropped into a WHERE/JOIN where the `games` table
// is aliased `g` (which every competitive query already does). When digital is
// included (the default) it is byte-identical to the legacy filter, so the
// emitted SQL — and behaviour — is unchanged until the flag is flipped.

export const INCLUDE_DIGITAL_IN_STATS = process.env.INCLUDE_DIGITAL_IN_STATS !== 'false';

export const COUNTED_GAMES =
  `g.hidden_from_stats = FALSE${INCLUDE_DIGITAL_IN_STATS ? '' : " AND g.play_medium = 'physical'"}`;
