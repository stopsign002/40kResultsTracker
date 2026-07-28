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
  -- Optional picture of the terrain layout, uploaded once and then shown on
  -- every game that used it. File lives at UPLOAD_DIR/maps/<image_name>,
  -- served by Caddy at /uploads/maps/<image_name> like game photos.
  image_name       TEXT,
  image_thumb_name TEXT,
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
  play_medium         TEXT NOT NULL DEFAULT 'physical' CHECK (play_medium IN ('physical','digital')),
  edition             TEXT NOT NULL DEFAULT '11' CHECK (edition IN ('10','11')),
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
  primary_mission_id   INTEGER REFERENCES primary_missions(id),
  primary_mission_name TEXT,
  force_disposition    TEXT CHECK (force_disposition IN
    ('Take and Hold','Purge the Foe','Disruption','Reconnaissance','Priority Assets')),
  -- Chess-clock time for this player. DERIVED (the sum) whenever any round
  -- carries a time; otherwise it's whatever total was typed directly.
  time_seconds         INTEGER CHECK (time_seconds >= 0),
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
  time_seconds     INTEGER CHECK (time_seconds >= 0),
  UNIQUE (game_player_id, round_number)
);

-- 11e lets a player field more than one detachment, so detachments are a child
-- table rather than a single column. game_players.detachment_name is kept as a
-- DERIVED display string (the names joined with ', ') so the game list, detail
-- view and any older query keep working — this table is the source of truth,
-- and analytics/autocomplete read it, not the joined string.
CREATE TABLE IF NOT EXISTS player_detachments (
  id              SERIAL PRIMARY KEY,
  game_player_id  INTEGER NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  detachment_id   INTEGER REFERENCES detachments(id),
  detachment_name TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_player_detachments_gp ON player_detachments(game_player_id);
CREATE INDEX IF NOT EXISTS idx_player_detachments_name ON player_detachments(detachment_name);

-- Tactical secondaries drawn per round, OR fixed secondaries (round_number = NULL means fixed-pick total)
CREATE TABLE IF NOT EXISTS player_secondaries (
  id              SERIAL PRIMARY KEY,
  game_player_id  INTEGER NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  round_number    INTEGER CHECK (round_number BETWEEN 1 AND 5),
  drawn_round     INTEGER CHECK (drawn_round BETWEEN 1 AND 5),
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

-- Seasons: each game belongs to a season, the war map can render any
-- archived season's state, and admins can start a new season at any time.
-- Initial migration creates "Season 1" and assigns every existing game to it.
CREATE TABLE IF NOT EXISTS seasons (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  map_seed    BIGINT NOT NULL,                  -- drives war map geometry per season
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,                      -- NULL = currently active
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Only one active season at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_only_one_active
  ON seasons (is_active) WHERE is_active = TRUE;

-- Migration: add season_id to games if upgrading from earlier schema.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='games' AND column_name='season_id'
  ) THEN
    ALTER TABLE games ADD COLUMN season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season_id);

-- Migration: add play_medium to games (physical = in-person tabletop, digital =
-- Tabletop Simulator). Existing rows default to 'physical'.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='games' AND column_name='play_medium'
  ) THEN
    ALTER TABLE games ADD COLUMN play_medium TEXT NOT NULL DEFAULT 'physical'
      CHECK (play_medium IN ('physical','digital'));
  END IF;
END $$;

-- Migration: add edition to games. Every game recorded before this column
-- existed was a 10th-edition game, so the column is added with DEFAULT '10' (so
-- the backfill of existing rows lands on '10'), then the default is flipped to
-- '11' for everything created from here on.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='games' AND column_name='edition'
  ) THEN
    ALTER TABLE games ADD COLUMN edition TEXT NOT NULL DEFAULT '10'
      CHECK (edition IN ('10','11'));
    ALTER TABLE games ALTER COLUMN edition SET DEFAULT '11';
  END IF;
END $$;

-- Migration: 11th edition gives each player their OWN primary mission, so the
-- mission moves from games.primary_mission_id (shared) down to the player row.
-- 10e games leave both NULL and keep reading the game-level column.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='game_players' AND column_name='primary_mission_id'
  ) THEN
    ALTER TABLE game_players ADD COLUMN primary_mission_id INTEGER REFERENCES primary_missions(id);
    ALTER TABLE game_players ADD COLUMN primary_mission_name TEXT;
  END IF;
END $$;

-- Migration: 11e secondaries persist in hand across rounds, so a card has a
-- draw round distinct from the round it scores. round_number keeps its meaning
-- (the round the card SCORED) and is NULL for a card that never scored;
-- drawn_round is NULL on 10e rows, where draw and score are the same round.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='player_secondaries' AND column_name='drawn_round'
  ) THEN
    ALTER TABLE player_secondaries ADD COLUMN drawn_round INTEGER
      CHECK (drawn_round BETWEEN 1 AND 5);
  END IF;
END $$;

-- Migration: chess-clock timings. Per-round is optional detail; the player
-- total is the sum when any round has one, else the typed total.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='game_players' AND column_name='time_seconds'
  ) THEN
    ALTER TABLE game_players ADD COLUMN time_seconds INTEGER CHECK (time_seconds >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='game_rounds' AND column_name='time_seconds'
  ) THEN
    ALTER TABLE game_rounds ADD COLUMN time_seconds INTEGER CHECK (time_seconds >= 0);
  END IF;
END $$;

-- Migration: terrain-layout picture on a deployment map.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='deployment_maps' AND column_name='image_name'
  ) THEN
    ALTER TABLE deployment_maps ADD COLUMN image_name TEXT;
    ALTER TABLE deployment_maps ADD COLUMN image_thumb_name TEXT;
  END IF;
END $$;

-- Migration: 11e Force Disposition (per player). Yours vs your opponent's is
-- what decides the named primary mission each of you plays. NULL on 10e games.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='game_players' AND column_name='force_disposition'
  ) THEN
    ALTER TABLE game_players ADD COLUMN force_disposition TEXT CHECK (force_disposition IN
      ('Take and Hold','Purge the Foe','Disruption','Reconnaissance','Priority Assets'));
  END IF;
END $$;

-- Photos attached to a game. The bytes live on disk (UPLOAD_DIR, served by
-- Caddy at /uploads/<game_id>/<file>), not in Postgres — keeping multi-MB
-- blobs out of the nightly pg_dumpall. Rows cascade with the game; the files
-- are unlinked by the DELETE route.
CREATE TABLE IF NOT EXISTS game_images (
  id                   SERIAL PRIMARY KEY,
  game_id              INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  uploaded_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  file_name            TEXT NOT NULL,
  thumb_name           TEXT NOT NULL,
  caption              TEXT,
  is_thumbnail         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Marks the shot of the terrain layout this game was played on, shown as the
  -- second thumbnail in the games list. Independent of is_thumbnail: one photo
  -- can be both the cover and the map.
  is_map               BOOLEAN NOT NULL DEFAULT FALSE,
  width                INTEGER,
  height               INTEGER,
  bytes                INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_images_game ON game_images(game_id);
-- At most one image per game can be the list thumbnail. Enforced in the DB so
-- a concurrent "set as thumbnail" can't leave two winners.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_images_one_thumb
  ON game_images(game_id) WHERE is_thumbnail;
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_images_one_map
  ON game_images(game_id) WHERE is_map;

-- Migration: per-game map-layout photo flag. MUST sit below the CREATE TABLE
-- above — a guarded ALTER placed earlier in the file still fails on a FRESH
-- database, because the table it references does not exist yet and initSchema
-- aborts before anything is created.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='game_images' AND column_name='is_map'
  ) THEN
    ALTER TABLE game_images ADD COLUMN is_map BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

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
-- Migration: per-banner anchor (overrides FACTION_HOMES for displaced banners
-- — i.e. the 2nd+ player of a faction). NULL means "use the faction default".
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='banner_first_seen' AND column_name='anchor_x'
  ) THEN
    ALTER TABLE banner_first_seen ADD COLUMN anchor_x REAL;
    ALTER TABLE banner_first_seen ADD COLUMN anchor_y REAL;
  END IF;
END $$;

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
