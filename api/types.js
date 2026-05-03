// @ts-check
// Shared JSDoc typedefs imported via /** @import */ in other files.
// Lives in api/lib so both server code and tests can pick it up.

/**
 * @typedef {Object} RoundPayload
 * @property {1|2|3|4|5} roundNumber
 * @property {number} primaryScore
 * @property {number} [secondaryScore]   Computed by computeFinalScores; usually omit on input
 * @property {number|null} [cpRemaining]
 */

/**
 * @typedef {Object} SecondaryPayload
 * @property {number|null} cardId
 * @property {string} cardName
 * @property {1|2|3|4|5|null} [roundNumber]
 * @property {number} score
 * @property {boolean} [wasDiscarded]
 */

/**
 * @typedef {Object} ChallengerPayload
 * @property {number|null} cardId
 * @property {string} cardName
 * @property {1|2|3|4|5|null} [roundNumber]
 * @property {boolean} [completed]
 * @property {number} score
 */

/**
 * Player as it appears in a request payload to POST /games or PUT /games/:id.
 * Snake_case is for the DB; the API speaks camelCase. Convert at the boundary.
 *
 * @typedef {Object} PlayerPayload
 * @property {number|null} userId
 * @property {string|null} guestName
 * @property {number|null} factionId
 * @property {number|null} [detachmentId]
 * @property {string|null} [detachmentName]
 * @property {string|null} [armyListCode]
 * @property {boolean} [wentFirst]
 * @property {boolean|null} [isAttacker]
 * @property {boolean} [manualWinner]
 * @property {number} [finalScore]
 * @property {'win'|'loss'|'draw'|null} [result]
 * @property {RoundPayload[]} rounds
 * @property {SecondaryPayload[]} secondaries
 * @property {ChallengerPayload[]} challengers
 */

/**
 * @typedef {Object} GamePayload
 * @property {string} playedAt           YYYY-MM-DD
 * @property {'matched'|'crusade'|'narrative'|'open'|'tournament'} [gameFormat]
 * @property {number} pointsLimit
 * @property {number|null} [missionPackId]
 * @property {number|null} [primaryMissionId]
 * @property {number|null} [deploymentMapId]
 * @property {number|null} [missionRuleId]
 * @property {number|null} [turnCount]
 * @property {'normal'|'concession'|'tabled'} [endCondition]
 * @property {string|null} [tournamentName]
 * @property {number|null} [tournamentRound]
 * @property {number|null} [tournamentTable]
 * @property {string|null} [location]
 * @property {string|null} [notes]
 * @property {[PlayerPayload, PlayerPayload]} players  Exactly two
 */

/**
 * /stats/warmap returns one row per (player_key, faction_id) banner.
 *
 * @typedef {Object} BannerUnit
 * @property {string} player_key         'user:<id>' or 'guest:<name>'
 * @property {string} player_name        display_name (or guest_name fallback)
 * @property {string|null} army_name
 * @property {number} faction_id
 * @property {string} faction
 * @property {number} games
 * @property {number} wins
 * @property {number} losses
 * @property {number} draws
 * @property {number} avg_score
 * @property {string} first_seen_at      ISO timestamp from banner_first_seen
 * @property {number} territory_score    [0..1]
 * @property {number} win_rate           Percent, 1 decimal place
 */

export {};
