-- 40k Results Tracker schema

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  army_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Migration: add army_name if upgrading from earlier schema
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='army_name'
  ) THEN
    ALTER TABLE users ADD COLUMN army_name TEXT;
  END IF;
END $$;

-- Session store (connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Faction taxonomy: parent factions (e.g. Space Marines) with sub-factions (e.g. Ultramarines)
CREATE TABLE IF NOT EXISTS factions (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES factions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS detachments (
  id         SERIAL PRIMARY KEY,
  faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  UNIQUE (faction_id, name)
);

CREATE TABLE IF NOT EXISTS mission_packs (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS primary_missions (
  id              SERIAL PRIMARY KEY,
  mission_pack_id INTEGER NOT NULL REFERENCES mission_packs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  UNIQUE (mission_pack_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_maps (
  id              SERIAL PRIMARY KEY,
  mission_pack_id INTEGER NOT NULL REFERENCES mission_packs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  UNIQUE (mission_pack_id, name)
);

CREATE TABLE IF NOT EXISTS mission_rules (
  id              SERIAL PRIMARY KEY,
  mission_pack_id INTEGER NOT NULL REFERENCES mission_packs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  UNIQUE (mission_pack_id, name)
);

CREATE TABLE IF NOT EXISTS secondary_cards (
  id              SERIAL PRIMARY KEY,
  mission_pack_id INTEGER NOT NULL REFERENCES mission_packs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  card_type       TEXT NOT NULL DEFAULT 'tactical' CHECK (card_type IN ('tactical', 'fixed')),
  UNIQUE (mission_pack_id, name)
);

CREATE TABLE IF NOT EXISTS challenger_cards (
  id              SERIAL PRIMARY KEY,
  mission_pack_id INTEGER NOT NULL REFERENCES mission_packs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  UNIQUE (mission_pack_id, name)
);

-- Games
CREATE TABLE IF NOT EXISTS games (
  id                  SERIAL PRIMARY KEY,
  created_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  played_at           DATE NOT NULL,
  game_format         TEXT NOT NULL DEFAULT 'matched' CHECK (game_format IN ('matched','crusade','narrative','open','tournament')),
  points_limit        INTEGER NOT NULL,
  mission_pack_id     INTEGER REFERENCES mission_packs(id),
  primary_mission_id  INTEGER REFERENCES primary_missions(id),
  deployment_map_id   INTEGER REFERENCES deployment_maps(id),
  mission_rule_id     INTEGER REFERENCES mission_rules(id),
  turn_count          INTEGER,
  end_condition       TEXT NOT NULL DEFAULT 'normal' CHECK (end_condition IN ('normal','concession','tabled')),
  tournament_name     TEXT,
  tournament_round    INTEGER,
  tournament_table    INTEGER,
  location            TEXT,
  notes               TEXT,
  hidden_from_stats   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Two rows per game (one per player)
CREATE TABLE IF NOT EXISTS game_players (
  id              SERIAL PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat            INTEGER NOT NULL CHECK (seat IN (1, 2)),
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_name      TEXT,
  faction_id      INTEGER REFERENCES factions(id),
  detachment_id   INTEGER REFERENCES detachments(id),
  detachment_name TEXT,
  army_list_code  TEXT,
  went_first      BOOLEAN NOT NULL DEFAULT FALSE,
  is_attacker     BOOLEAN,
  final_score     INTEGER NOT NULL DEFAULT 0,
  result          TEXT CHECK (result IN ('win','loss','draw')),
  UNIQUE (game_id, seat),
  CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
);
-- Migration: add detachment_name (free-text) for existing installs that
-- were created before the detachment input switched from a dropdown.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='game_players' AND column_name='detachment_name'
  ) THEN
    ALTER TABLE game_players ADD COLUMN detachment_name TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_players_game ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);
CREATE INDEX IF NOT EXISTS idx_game_players_faction ON game_players(faction_id);

-- Per-round score breakdown
CREATE TABLE IF NOT EXISTS game_rounds (
  id               SERIAL PRIMARY KEY,
  game_player_id   INTEGER NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  round_number     INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 5),
  primary_score    INTEGER NOT NULL DEFAULT 0,
  secondary_score  INTEGER NOT NULL DEFAULT 0,
  cp_remaining     INTEGER,
  UNIQUE (game_player_id, round_number)
);

-- Tactical secondaries drawn per round, OR fixed secondaries (round_number = NULL means fixed-pick total)
CREATE TABLE IF NOT EXISTS player_secondaries (
  id              SERIAL PRIMARY KEY,
  game_player_id  INTEGER NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  round_number    INTEGER CHECK (round_number BETWEEN 1 AND 5),
  card_id         INTEGER REFERENCES secondary_cards(id),
  card_name       TEXT NOT NULL,
  score           INTEGER NOT NULL DEFAULT 0,
  was_discarded   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_player_secondaries_gp ON player_secondaries(game_player_id);
CREATE INDEX IF NOT EXISTS idx_player_secondaries_card ON player_secondaries(card_id);

CREATE TABLE IF NOT EXISTS player_challengers (
  id              SERIAL PRIMARY KEY,
  game_player_id  INTEGER NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  card_id         INTEGER REFERENCES challenger_cards(id),
  card_name       TEXT NOT NULL,
  round_number    INTEGER CHECK (round_number BETWEEN 1 AND 5),
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  score           INTEGER NOT NULL DEFAULT 0
);
-- Migration: add round_number if upgrading from initial schema
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='player_challengers' AND column_name='round_number'
  ) THEN
    ALTER TABLE player_challengers ADD COLUMN round_number INTEGER CHECK (round_number BETWEEN 1 AND 5);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_player_challengers_gp ON player_challengers(game_player_id);

-- Audit trail of admin / write actions. Append-only; no UPDATE on rows.
CREATE TABLE IF NOT EXISTS audit_log (
  id              SERIAL PRIMARY KEY,
  actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_username  TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       INTEGER,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created  ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor    ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target   ON audit_log(target_type, target_id);

-- Persistent first-seen timestamp per (player, faction) banner. Used by
-- the war map to assign and PRESERVE home fortresses: once a banner has
-- a row here, its claimed_at never changes — adding/hiding games can't
-- move existing fortresses. New banners get NOW() on first save.
CREATE TABLE IF NOT EXISTS banner_first_seen (
  player_key    TEXT NOT NULL,
  faction_id    INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_key, faction_id)
);

-- Helper view for stats: one row per (game_player) with derived fields
CREATE OR REPLACE VIEW v_game_player_stats AS
SELECT
  gp.id              AS game_player_id,
  gp.game_id,
  g.played_at,
  g.game_format,
  g.points_limit,
  g.mission_pack_id,
  g.primary_mission_id,
  g.deployment_map_id,
  g.hidden_from_stats,
  gp.seat,
  gp.user_id,
  gp.guest_name,
  gp.faction_id,
  gp.detachment_id,
  gp.went_first,
  gp.final_score,
  gp.result,
  opp.user_id        AS opponent_user_id,
  opp.guest_name     AS opponent_guest_name,
  opp.faction_id     AS opponent_faction_id,
  opp.final_score    AS opponent_score
FROM game_players gp
JOIN games g ON g.id = gp.game_id
JOIN game_players opp ON opp.game_id = gp.game_id AND opp.seat <> gp.seat;
