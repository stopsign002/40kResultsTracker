-- Seed reference data for 10e Warhammer 40k

-- ── Factions (parent codexes) and notable sub-factions ─────────
INSERT INTO factions (name) VALUES
  ('Adepta Sororitas'),
  ('Adeptus Custodes'),
  ('Adeptus Mechanicus'),
  ('Aeldari'),
  ('Astra Militarum'),
  ('Black Templars'),
  ('Blood Angels'),
  ('Chaos Daemons'),
  ('Chaos Knights'),
  ('Chaos Space Marines'),
  ('Dark Angels'),
  ('Death Guard'),
  ('Deathwatch'),
  ('Drukhari'),
  ('Emperor''s Children'),
  ('Genestealer Cults'),
  ('Grey Knights'),
  ('Imperial Agents'),
  ('Imperial Knights'),
  ('Leagues of Votann'),
  ('Necrons'),
  ('Orks'),
  ('Salamanders'),
  ('Space Marines'),
  ('Space Wolves'),
  ('T''au Empire'),
  ('Thousand Sons'),
  ('Tyranids'),
  ('World Eaters')
ON CONFLICT (name) DO NOTHING;

-- ── Detachments (current 10e — sourced from BSData wh40k-10e) ──
-- Append-only: ON CONFLICT DO NOTHING means re-running is safe and any
-- legacy rows from earlier seeds linger harmlessly. If you need to prune
-- a stale detachment, delete it via psql once games no longer reference it.

-- Adepta Sororitas
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Hallowed Martyrs'),
  ('Penitent Host'),
  ('Bringers of Flame'),
  ('Army of Faith'),
  ('Champions of Faith')
) AS d(n) WHERE factions.name = 'Adepta Sororitas' ON CONFLICT DO NOTHING;

-- Adeptus Custodes
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Shield Host'),
  ('Talons of the Emperor'),
  ('Null Maiden Vigil'),
  ('Auric Champions'),
  ('Solar Spearhead'),
  ('Lions of the Emperor')
) AS d(n) WHERE factions.name = 'Adeptus Custodes' ON CONFLICT DO NOTHING;

-- Adeptus Mechanicus
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Rad-zone Corps'),
  ('Skitarii Hunter Cohort'),
  ('Explorator Maniple'),
  ('Data-psalm Conclave'),
  ('Cohort Cybernetica'),
  ('Haloscreed Battleclade'),
  ('Eradication Cohort')
) AS d(n) WHERE factions.name = 'Adeptus Mechanicus' ON CONFLICT DO NOTHING;

-- Aeldari (Craftworlds + Ynnari folded together)
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Battle Host'),
  ('Windrider Host'),
  ('Spirit Conclave'),
  ('Guardian Battlehost'),
  ('Aspect Host'),
  ('Seer Council'),
  ('Armoured Wraith Host'),
  ('Devoted of Ynnead')
) AS d(n) WHERE factions.name = 'Aeldari' ON CONFLICT DO NOTHING;

-- Astra Militarum
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Combined Regiment'),
  ('Bridgehead Strike'),
  ('Siege Regiment'),
  ('Mechanised Assault'),
  ('Hammer of the Emperor'),
  ('Recon Element'),
  ('Tempestus Drop Force')
) AS d(n) WHERE factions.name = 'Astra Militarum' ON CONFLICT DO NOTHING;

-- Black Templars
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Righteous Crusaders')
) AS d(n) WHERE factions.name = 'Black Templars' ON CONFLICT DO NOTHING;

-- Blood Angels
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Sons of Sanguinius'),
  ('Liberator Assault Group'),
  ('The Lost Brotherhood'),
  ('Angelic Inheritors')
) AS d(n) WHERE factions.name = 'Blood Angels' ON CONFLICT DO NOTHING;

-- Chaos Daemons
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Daemonic Incursion'),
  ('Legion of Excess'),
  ('Scintillating Legion'),
  ('Blood Legion'),
  ('Plague Legion'),
  ('Shadow Legion')
) AS d(n) WHERE factions.name = 'Chaos Daemons' ON CONFLICT DO NOTHING;

-- Chaos Knights
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Traitoris Lance'),
  ('Iconoclast Lance'),
  ('Court of Traitors')
) AS d(n) WHERE factions.name = 'Chaos Knights' ON CONFLICT DO NOTHING;

-- Chaos Space Marines
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Pactbound Zealots'),
  ('Veterans of the Long War'),
  ('Renegade Raiders'),
  ('Dread Talons'),
  ('Fellhammer Siege-host'),
  ('Soulforged Warpack'),
  ('Creations of Bile'),
  ('Chaos Cult'),
  ('Cult of the Arkifane')
) AS d(n) WHERE factions.name = 'Chaos Space Marines' ON CONFLICT DO NOTHING;

-- Dark Angels
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Unforgiven Task Force'),
  ('Inner Circle Task Force'),
  ('Company of Hunters'),
  ('Lion''s Blade Task Force'),
  ('Stormlance Task Force')
) AS d(n) WHERE factions.name = 'Dark Angels' ON CONFLICT DO NOTHING;

-- Death Guard
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Plague Company'),
  ('Flyblown Host'),
  ('Lords of Virulence'),
  ('Mortarion''s Anvil'),
  ('Bringers of Decay')
) AS d(n) WHERE factions.name = 'Death Guard' ON CONFLICT DO NOTHING;

-- Deathwatch
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Black Spear Task Force')
) AS d(n) WHERE factions.name = 'Deathwatch' ON CONFLICT DO NOTHING;

-- Drukhari
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Realspace Raid'),
  ('Skysplinter Assault'),
  ('Kabal of the Black Heart'),
  ('Cult of Strife'),
  ('Coven of the Twenty'),
  ('Cult of the Red Grief'),
  ('Reaper Skyfall')
) AS d(n) WHERE factions.name = 'Drukhari' ON CONFLICT DO NOTHING;

-- Emperor's Children
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Peerless Bladehost'),
  ('Flawless Host'),
  ('Mortal Vessels of Slaanesh'),
  ('Carnival of Excess'),
  ('Court of the Phoenician')
) AS d(n) WHERE factions.name = 'Emperor''s Children' ON CONFLICT DO NOTHING;

-- Genestealer Cults
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Brood Brothers'),
  ('Ascension Day'),
  ('Final Day'),
  ('Biosanctic Broodsurge'),
  ('Outlander Claw'),
  ('Host of Ascension'),
  ('Xenocreed Congregation')
) AS d(n) WHERE factions.name = 'Genestealer Cults' ON CONFLICT DO NOTHING;

-- Grey Knights
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Teleport Strike Force'),
  ('Hallowed Conclave'),
  ('Warpbane Task Force'),
  ('Sanctic Spearhead')
) AS d(n) WHERE factions.name = 'Grey Knights' ON CONFLICT DO NOTHING;

-- Imperial Agents
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Joint Operations Detachment'),
  ('Alien Hunters'),
  ('Daemon Hunters'),
  ('Purgation Force')
) AS d(n) WHERE factions.name = 'Imperial Agents' ON CONFLICT DO NOTHING;

-- Imperial Knights
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Noble Lance'),
  ('Skyreaper Lance'),
  ('Honoured Knights'),
  ('Royal Court'),
  ('Questor Forgepact')
) AS d(n) WHERE factions.name = 'Imperial Knights' ON CONFLICT DO NOTHING;

-- Leagues of Votann
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Oathband'),
  ('Hearthkyn Yeomanry'),
  ('Hearthfyre Arsenal')
) AS d(n) WHERE factions.name = 'Leagues of Votann' ON CONFLICT DO NOTHING;

-- Necrons
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Awakened Dynasty'),
  ('Annihilation Legion'),
  ('Canoptek Court'),
  ('Obeisance Phalanx'),
  ('Hypercrypt Legion'),
  ('Starshatter Arsenal'),
  ('Cryptek Conclave'),
  ('Cursed Legion')
) AS d(n) WHERE factions.name = 'Necrons' ON CONFLICT DO NOTHING;

-- Orks
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('War Horde'),
  ('Bully Boyz'),
  ('Dread Mob'),
  ('Green Tide'),
  ('Kult of Speed'),
  ('Taktikal Brigade'),
  ('Kommando Skirmish'),
  ('Da Big Hunt'),
  ('More Dakka!')
) AS d(n) WHERE factions.name = 'Orks' ON CONFLICT DO NOTHING;

-- Space Marines
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Gladius Task Force'),
  ('Anvil Siege Force'),
  ('Stormlance Task Force'),
  ('1st Company Task Force'),
  ('Firestorm Assault Force'),
  ('Ironstorm Spearhead'),
  ('Vanguard Spearhead'),
  ('Librarius Conclave')
) AS d(n) WHERE factions.name = 'Space Marines' ON CONFLICT DO NOTHING;

-- Salamanders (Space Marines chapter — shares the SM detachment roster)
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Gladius Task Force'),
  ('Anvil Siege Force'),
  ('Stormlance Task Force'),
  ('1st Company Task Force'),
  ('Firestorm Assault Force'),
  ('Ironstorm Spearhead'),
  ('Vanguard Spearhead'),
  ('Librarius Conclave')
) AS d(n) WHERE factions.name = 'Salamanders' ON CONFLICT DO NOTHING;

-- Space Wolves
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Champions of Russ'),
  ('Champions of Fenris')
) AS d(n) WHERE factions.name = 'Space Wolves' ON CONFLICT DO NOTHING;

-- T'au Empire
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Mont''ka'),
  ('Kauyon'),
  ('Retaliation Cadre'),
  ('Kroot Hunting Pack'),
  ('Auxiliary Cadre'),
  ('Ranged Support Cadre'),
  ('Experimental Cadre')
) AS d(n) WHERE factions.name = 'T''au Empire' ON CONFLICT DO NOTHING;

-- Thousand Sons
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Hexwarp Thrallband'),
  ('Cult of Magic'),
  ('Tzaangor Coven'),
  ('Cult of Mutation'),
  ('Cult of Time'),
  ('Warpmeld Pact')
) AS d(n) WHERE factions.name = 'Thousand Sons' ON CONFLICT DO NOTHING;

-- Tyranids
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Invasion Fleet'),
  ('Vanguard Onslaught'),
  ('Crusher Stampede'),
  ('Assimilation Swarm'),
  ('Endless Multitude'),
  ('Synaptic Nexus'),
  ('Unending Swarm'),
  ('Warrior Bioform Onslaught')
) AS d(n) WHERE factions.name = 'Tyranids' ON CONFLICT DO NOTHING;

-- World Eaters
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Berzerker Warband'),
  ('Vessels of Wrath'),
  ('Slaughterbound')
) AS d(n) WHERE factions.name = 'World Eaters' ON CONFLICT DO NOTHING;

-- ── Mission Packs ──────────────────────────────────────────────
INSERT INTO mission_packs (name) VALUES
  ('Pariah Nexus'),
  ('Leviathan'),
  ('Chapter Approved 2025-26'),
  ('2026 - 2027 Chapter Approved'),
  ('Tempest of War'),
  ('Crusade'),
  ('Open Play'),
  ('Other')
ON CONFLICT (name) DO NOTHING;

-- ── Pariah Nexus primary missions ──────────────────────────────
INSERT INTO primary_missions (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Take and Hold'),
  ('Purge the Foe'),
  ('The Scouring'),
  ('Sites of Power'),
  ('Linchpin'),
  ('Supply Drop'),
  ('Priority Targets'),
  ('Burden of Trust'),
  ('Terraform'),
  ('Tipping Point'),
  ('Unexploded Ordnance')
) AS m(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- Pariah Nexus deployment maps
INSERT INTO deployment_maps (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Hammer and Anvil'),
  ('Dawn of War'),
  ('Search and Destroy'),
  ('Sweeping Engagement'),
  ('Crucible of Battle'),
  ('Tipping Point Deployment'),
  ('Sites of Power Deployment')
) AS d(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- Pariah Nexus mission rules
INSERT INTO mission_rules (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Chilling Rain'),
  ('Nowhere to Hide'),
  ('Smoke and Mirrors'),
  ('Scrambler Fields'),
  ('Hidden Supplies'),
  ('Layered Defences'),
  ('Stalwarts'),
  ('Swift Action'),
  ('Auspex Scan'),
  ('Supply Cache')
) AS r(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- Pariah Nexus tactical secondaries
INSERT INTO secondary_cards (mission_pack_id, name, card_type)
SELECT id, n, 'tactical' FROM mission_packs, (VALUES
  ('Bring it Down'),
  ('Assassination'),
  ('No Prisoners'),
  ('Cleanse'),
  ('Engage on All Fronts'),
  ('Behind Enemy Lines'),
  ('Investigate Signals'),
  ('Establish Locus'),
  ('Defend Stronghold'),
  ('Storm Hostile Objective'),
  ('Cull the Horde'),
  ('Marked for Death'),
  ('Overwhelming Force'),
  ('A Tempting Target'),
  ('Display of Might'),
  ('Recover Assets'),
  ('Extend Battle Lines'),
  ('Secure No Man''s Land'),
  ('Sabotage')
) AS s(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- Pariah Nexus fixed secondaries (subset)
INSERT INTO secondary_cards (mission_pack_id, name, card_type)
SELECT id, n, 'fixed' FROM mission_packs, (VALUES
  ('Bring it Down (Fixed)'),
  ('Assassination (Fixed)'),
  ('No Prisoners (Fixed)'),
  ('Cull the Horde (Fixed)')
) AS s(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- Pariah Nexus Secret Missions (Tournament Companion 2024)
-- These replaced the old Leviathan-style "Gambits". Four cards exist; each
-- player draws all four and picks one as their Secret Mission for the game.
-- First, prune any obsolete placeholder names if no game references them.
DELETE FROM challenger_cards
WHERE name IN (
  'No Mercy, No Respite',
  'Recover the Relics',
  'Storm Hostile Objective',
  'Defend Stronghold',
  'Behind Enemy Lines'
)
  AND mission_pack_id = (SELECT id FROM mission_packs WHERE name = 'Pariah Nexus')
  AND NOT EXISTS (SELECT 1 FROM player_challengers pc WHERE pc.card_id = challenger_cards.id);

INSERT INTO challenger_cards (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Command Insertion'),
  ('War of Attrition'),
  ('Unbroken Wall'),
  ('Shatter Cohesion')
) AS c(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- ── Leviathan (predecessor; for historical games) ──────────────
INSERT INTO primary_missions (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Take and Hold'),
  ('Purge the Enemy'),
  ('The Scouring'),
  ('Deploy Teleport Homers'),
  ('Vital Ground'),
  ('Burden of Trust'),
  ('Supply Drop'),
  ('Scorched Earth'),
  ('Priority Targets')
) AS m(n) WHERE mission_packs.name = 'Leviathan' ON CONFLICT DO NOTHING;

INSERT INTO deployment_maps (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Hammer and Anvil'),
  ('Dawn of War'),
  ('Search and Destroy'),
  ('Sweeping Engagement'),
  ('Crucible of Battle'),
  ('Tipping Point'),
  ('Sites of Power')
) AS d(n) WHERE mission_packs.name = 'Leviathan' ON CONFLICT DO NOTHING;

INSERT INTO secondary_cards (mission_pack_id, name, card_type)
SELECT id, n, 'tactical' FROM mission_packs, (VALUES
  ('Bring it Down'),
  ('Assassination'),
  ('No Prisoners'),
  ('Cleanse'),
  ('Engage on All Fronts'),
  ('Behind Enemy Lines'),
  ('Containment'),
  ('Investigate Signals'),
  ('Area Denial'),
  ('Storm Hostile Objective'),
  ('Defend Stronghold'),
  ('Overwhelming Force'),
  ('Cull the Horde'),
  ('A Tempting Target'),
  ('Marked for Death'),
  ('Display of Might'),
  ('Recover Assets'),
  ('Extend Battle Lines'),
  ('Secure No Man''s Land'),
  ('Sabotage')
) AS s(n) WHERE mission_packs.name = 'Leviathan' ON CONFLICT DO NOTHING;

-- ── Chapter Approved 2025-26 ───────────────────────────────────
INSERT INTO primary_missions (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Linchpin'),
  ('Purge the Foe'),
  ('Burden of Trust'),
  ('The Ritual'),
  ('Hidden Supplies'),
  ('Unexploded Ordnance'),
  ('Terraform'),
  ('Supply Drop'),
  ('Scorched Earth')
) AS m(n) WHERE mission_packs.name = 'Chapter Approved 2025-26' ON CONFLICT DO NOTHING;

INSERT INTO deployment_maps (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Hammer and Anvil'),
  ('Sweeping Engagement'),
  ('Dawn of War'),
  ('Crucible of Battle'),
  ('Search and Destroy'),
  ('Tipping Point')
) AS d(n) WHERE mission_packs.name = 'Chapter Approved 2025-26' ON CONFLICT DO NOTHING;

INSERT INTO secondary_cards (mission_pack_id, name, card_type)
SELECT id, n, 'tactical' FROM mission_packs, (VALUES
  ('Cleanse'),
  ('Behind Enemy Lines'),
  ('Cull the Horde'),
  ('Area Denial'),
  ('Defend Stronghold'),
  ('A Tempting Target'),
  ('No Prisoners'),
  ('Sabotage'),
  ('Display of Might'),
  ('Bring it Down'),
  ('Engage on All Fronts'),
  ('Recover Assets'),
  ('Marked for Death'),
  ('Establish Locus'),
  ('Storm Hostile Objective'),
  ('Assassination'),
  ('Secure No Man''s Land'),
  ('Extend Battle Lines'),
  ('Overwhelming Force')
) AS s(n) WHERE mission_packs.name = 'Chapter Approved 2025-26' ON CONFLICT DO NOTHING;

INSERT INTO challenger_cards (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Secure Extraction Zone'),
  ('Zone Defense'),
  ('Sow Chaos'),
  ('Attrition'),
  ('Over the Line'),
  ('Establish Comms'),
  ('Dug In'),
  ('Self Preservation'),
  ('Focused Effort')
) AS c(n) WHERE mission_packs.name = 'Chapter Approved 2025-26' ON CONFLICT DO NOTHING;

-- ── Seasons: ensure a default "Season 1" exists and backfill ─────
-- One-shot: every install gets a Season 1 with the canonical MAP_SEED
-- (0xDEAD40 = 14589504). After this seed runs, any game that lacks a
-- season_id is attached to the currently-active season.
-- ── 2026 - 2027 Chapter Approved (11th edition) ────────────────
-- 11e drops challenger cards entirely, so none are seeded for this pack.
--
-- Casing fix, and it must run BEFORE the deck insert below. The first 10 cards
-- were transcribed from a screenshot of an app that title-cases every word, so
-- two landed as 'Bring It Down' / 'Burden Of Trust'. Renaming in place (rather
-- than letting the insert add a second, correctly-cased row) keeps the card_id
-- that already-recorded games point at, and drags the denormalised
-- player_secondaries.card_name along with it. Idempotent: finds nothing once
-- applied, and the NOT EXISTS guard means it can never collide with the insert.
DO $$
DECLARE
  pack_id INTEGER;
  fix     RECORD;
BEGIN
  SELECT id INTO pack_id FROM mission_packs WHERE name = '2026 - 2027 Chapter Approved';
  IF pack_id IS NULL THEN RETURN; END IF;
  FOR fix IN SELECT * FROM (VALUES
      ('Bring It Down',   'Bring it Down'),
      ('Burden Of Trust', 'Burden of Trust')
    ) AS t(old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM secondary_cards
                WHERE mission_pack_id = pack_id AND name = fix.old_name)
       AND NOT EXISTS (SELECT 1 FROM secondary_cards
                        WHERE mission_pack_id = pack_id AND name = fix.new_name)
    THEN
      UPDATE secondary_cards SET name = fix.new_name
       WHERE mission_pack_id = pack_id AND name = fix.old_name;
    END IF;
    UPDATE player_secondaries ps SET card_name = fix.new_name
      FROM secondary_cards sc
     WHERE sc.id = ps.card_id
       AND sc.mission_pack_id = pack_id
       AND sc.name = fix.new_name
       AND ps.card_name = fix.old_name;
  END LOOP;
END $$;

-- The full 18-card 11e secondary deck. All 18 are drawable as Tactical, so all
-- are seeded 'tactical' — card_type only drives sort order in reference.js, it
-- gates nothing. Four of them (A Grievous Blow, Assassination, Bring it Down,
-- Engage on All Fronts) are additionally the Fixed-mission options; that isn't
-- representable here without a second row per card, and nothing consumes it.
INSERT INTO secondary_cards (mission_pack_id, name, card_type)
SELECT id, n, 'tactical' FROM mission_packs, (VALUES
  ('A Grievous Blow'),
  ('A Tempting Target'),
  ('Assassination'),
  ('Beacon'),
  ('Behind Enemy Lines'),
  ('Bring it Down'),
  ('Burden of Trust'),
  ('Centre Ground'),
  ('Cleanse'),
  ('Defend Stronghold'),
  ('Display of Might'),
  ('Engage on All Fronts'),
  ('Forward Position'),
  ('No Prisoners'),
  ('Outflank'),
  ('Overwhelming Force'),
  ('Plunder'),
  ('Secure No Man''s Land')
) AS s(n) WHERE mission_packs.name = '2026 - 2027 Chapter Approved' ON CONFLICT DO NOTHING;

-- GW publishes three recommended terrain layouts per 11e matched-play mission.
-- Anything else a group plays on is entered as a custom layout and files itself
-- under this pack the same way free-text missions do.
INSERT INTO deployment_maps (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('Layout A'),
  ('Layout B'),
  ('Layout C')
) AS d(n) WHERE mission_packs.name = '2026 - 2027 Chapter Approved' ON CONFLICT DO NOTHING;

-- 11e primary missions. There are five Force Dispositions (Take and Hold,
-- Purge the Foe, Disruption, Reconnaissance, Priority Assets); the pairing of
-- yours against your opponent's decides the named mission EACH of you plays,
-- which is why the primary is per-player here and not per-game. 5 dispositions
-- x 5 opponents = the 25 named missions below, grouped by the disposition that
-- generates them. The disposition itself is not currently recorded — only the
-- resulting mission name.
INSERT INTO primary_missions (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  -- Take and Hold: vs T&H / Disruption / Purge the Foe / Priority Assets / Recon
  ('Battlefield Dominance'),
  ('Determined Acquisition'),
  ('Immovable Object'),
  ('Inescapable Dominion'),
  ('Purge and Secure'),
  -- Purge the Foe: vs Take and Hold / PtF / Disruption / Recon / Priority Assets
  ('Unstoppable Force'),
  ('Meatgrinder'),
  ('Punishment'),
  ('Consecrate'),
  ('Destroyer''s Wrath'),
  -- Disruption: vs Take and Hold / Purge the Foe / Disruption / Recon / Priority Assets
  ('Death Trap'),
  ('Delaying Action'),
  ('Outmanoeuvre'),
  ('Smoke and Mirrors'),
  ('Locate and Deny'),
  -- Reconnaissance: vs Take and Hold / Purge the Foe / Disruption / Recon / Priority Assets
  ('Reconnaissance Sweep'),
  ('Triangulation'),
  ('Surveil the Foe'),
  ('Gather Intel'),
  ('Search and Scour'),
  -- Priority Assets: vs Take and Hold / Purge the Foe / Disruption / Recon / PA
  ('Secure Asset'),
  ('Vital Link'),
  ('Extract Relic'),
  ('Vanguard Operation'),
  ('Sabotage')
) AS m(n) WHERE mission_packs.name = '2026 - 2027 Chapter Approved' ON CONFLICT DO NOTHING;

-- ── Backfill: game_players.detachment_name -> player_detachments ───
-- Detachments moved to a child table when 11e allowed more than one per
-- player. Every historical row holds exactly one name, so it becomes one child
-- row. Idempotent: the NOT EXISTS guard means re-runs find nothing.
INSERT INTO player_detachments (game_player_id, detachment_id, detachment_name, sort_order)
SELECT gp.id, gp.detachment_id, TRIM(gp.detachment_name), 0
  FROM game_players gp
 WHERE gp.detachment_name IS NOT NULL
   AND TRIM(gp.detachment_name) <> ''
   AND NOT EXISTS (SELECT 1 FROM player_detachments pd WHERE pd.game_player_id = gp.id);

INSERT INTO seasons (name, map_seed, is_active)
SELECT 'Season 1', 14589504::bigint, TRUE
WHERE NOT EXISTS (SELECT 1 FROM seasons);

UPDATE games
SET season_id = (SELECT id FROM seasons WHERE is_active = TRUE LIMIT 1)
WHERE season_id IS NULL;

-- ── Backfill: copy detachment.name into game_players.detachment_name
-- The detachment input is now a free-text box. Old games saved with a
-- detachment_id need their name copied over so the display logic stops
-- depending on a JOIN. Idempotent: rows with detachment_name already set
-- are skipped.
UPDATE game_players gp
SET detachment_name = d.name
FROM detachments d
WHERE gp.detachment_name IS NULL
  AND gp.detachment_id IS NOT NULL
  AND d.id = gp.detachment_id;

-- ── One-shot backfill: link guest-name game_players to users ─────
-- The form takes a free-text player-name input, so when a friend types
-- their own name (matching their display_name), the player row stored
-- guest_name=Joe instead of user_id=5. This breaks army_name lookup on
-- the war map and stops player_winrates / head-to-head from grouping
-- correctly. Find every game_player with a guest_name that matches a
-- registered user's display_name (case-insensitive) and re-link it.
-- Idempotent: re-runs find no rows once already linked.
UPDATE game_players gp
SET user_id = u.id, guest_name = NULL
FROM users u
WHERE gp.user_id IS NULL
  AND gp.guest_name IS NOT NULL
  AND u.is_active = TRUE
  AND LOWER(u.display_name) = LOWER(gp.guest_name);

-- ── Backfill: banner_first_seen from existing game data ─────────
-- One-shot: any (player, faction) banner that already plays in the
-- system gets its first_seen_at = MIN(played_at). After this single
-- backfill, NEW banners get NOW() via the games.js save path / the
-- warmap endpoint's lazy upsert. Existing banners retain their
-- assigned timestamp forever.
INSERT INTO banner_first_seen (player_key, faction_id, first_seen_at)
SELECT
  CASE WHEN gp.user_id IS NOT NULL
       THEN 'user:' || gp.user_id::text
       ELSE 'guest:' || gp.guest_name
  END                          AS player_key,
  gp.faction_id,
  MIN(g.played_at)::timestamptz AS first_seen_at
FROM game_players gp
JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
WHERE gp.faction_id IS NOT NULL
GROUP BY player_key, gp.faction_id
ON CONFLICT (player_key, faction_id) DO NOTHING;

-- ── Backfill last_login_at from the audit log ──────────────────
-- audit_log has recorded 'auth.login' with an actor since day one, so the
-- column ships with real history instead of starting empty. Idempotent by
-- construction: it only fills NULLs, so a genuine login always outranks the
-- backfill and the second run matches zero rows.
UPDATE users u
SET last_login_at = a.last_login
FROM (
  SELECT actor_user_id, MAX(created_at) AS last_login
    FROM audit_log
   WHERE action = 'auth.login' AND actor_user_id IS NOT NULL
   GROUP BY actor_user_id
) a
WHERE a.actor_user_id = u.id
  AND u.last_login_at IS NULL;

-- ── Backfill game_drafts.submitted_at ──────────────────────────
-- Two sources, because the obvious one is lossy: a draft whose game was later
-- hard-deleted has had submitted_game_id nulled by the FK, and the only
-- surviving evidence that it was ever submitted is the audit row. Idempotent:
-- both only fill NULLs, so they match zero rows on the second run.
UPDATE game_drafts d
SET submitted_at = a.first_submit
FROM (
  SELECT (payload->>'draftId')::int AS draft_id, MIN(created_at) AS first_submit
    FROM audit_log
   WHERE action = 'draft.submit' AND payload ? 'draftId'
   GROUP BY 1
) a
WHERE a.draft_id = d.id
  AND d.submitted_at IS NULL;

UPDATE game_drafts
SET submitted_at = updated_at
WHERE submitted_game_id IS NOT NULL
  AND submitted_at IS NULL;
