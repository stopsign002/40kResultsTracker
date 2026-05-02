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
  ('Space Marines'),
  ('Space Wolves'),
  ('T''au Empire'),
  ('Thousand Sons'),
  ('Tyranids'),
  ('World Eaters')
ON CONFLICT (name) DO NOTHING;

-- ── Detachments (current 10e indexes / codexes) ────────────────
-- Space Marines
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES
  ('Gladius Task Force'),
  ('Anvil Siege Force'),
  ('Stormlance Task Force'),
  ('1st Company Task Force'),
  ('Firestorm Assault Force'),
  ('Ironstorm Spearhead'),
  ('Vanguard Spearhead')
) AS d(n) WHERE factions.name = 'Space Marines'
ON CONFLICT DO NOTHING;

-- Black Templars
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Righteous Crusaders')) AS d(n)
WHERE factions.name = 'Black Templars' ON CONFLICT DO NOTHING;

-- Blood Angels
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Sons of Sanguinius'), ('Liberator Assault Group'), ('Lost Brotherhood')) AS d(n)
WHERE factions.name = 'Blood Angels' ON CONFLICT DO NOTHING;

-- Dark Angels
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Unforgiven Task Force'), ('Inner Circle Task Force'), ('Company of Hunters'), ('Lion''s Blade Task Force'), ('Stormlance Task Force')) AS d(n)
WHERE factions.name = 'Dark Angels' ON CONFLICT DO NOTHING;

-- Space Wolves
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Champions of Russ')) AS d(n)
WHERE factions.name = 'Space Wolves' ON CONFLICT DO NOTHING;

-- Deathwatch
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Black Spear Task Force')) AS d(n)
WHERE factions.name = 'Deathwatch' ON CONFLICT DO NOTHING;

-- Grey Knights
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Teleport Strike Force')) AS d(n)
WHERE factions.name = 'Grey Knights' ON CONFLICT DO NOTHING;

-- Adepta Sororitas
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Hallowed Martyrs'), ('Bringers of Flame'), ('Penitent Host'), ('Champions of the Faith'), ('Army of Faith')) AS d(n)
WHERE factions.name = 'Adepta Sororitas' ON CONFLICT DO NOTHING;

-- Adeptus Custodes
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Shield Host'), ('Lions of the Emperor'), ('Auric Champions'), ('Solar Spearhead'), ('Talons of the Emperor')) AS d(n)
WHERE factions.name = 'Adeptus Custodes' ON CONFLICT DO NOTHING;

-- Adeptus Mechanicus
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Skitarii Hunter Cohort'), ('Explorator Maniple'), ('Rad-zone Corps'), ('Data-psalm Conclave'), ('Cohort Cybernetica')) AS d(n)
WHERE factions.name = 'Adeptus Mechanicus' ON CONFLICT DO NOTHING;

-- Astra Militarum
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Combined Regiment'), ('Bridgehead Strike'), ('Mechanised Assault'), ('Recon Element'), ('Hammer of the Emperor'), ('Siege Regiment')) AS d(n)
WHERE factions.name = 'Astra Militarum' ON CONFLICT DO NOTHING;

-- Imperial Knights
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Noble Lance'), ('Skyreaper Lance'), ('Honoured Knights'), ('Royal Court')) AS d(n)
WHERE factions.name = 'Imperial Knights' ON CONFLICT DO NOTHING;

-- Imperial Agents
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Joint Operations Detachment')) AS d(n)
WHERE factions.name = 'Imperial Agents' ON CONFLICT DO NOTHING;

-- Aeldari
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Battle Host'), ('Windrider Host'), ('Armoured Wraith Host'), ('Seer Council'), ('Devoted of Ynnead'), ('Aspect Host'), ('Guardian Battlehost')) AS d(n)
WHERE factions.name = 'Aeldari' ON CONFLICT DO NOTHING;

-- Drukhari
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Realspace Raid'), ('Skysplinter Assault'), ('Kabal of the Black Heart'), ('Cult of Strife'), ('Coven of the Twenty'), ('Cult of the Red Grief'), ('Reaper Skyfall')) AS d(n)
WHERE factions.name = 'Drukhari' ON CONFLICT DO NOTHING;

-- Genestealer Cults
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Brood Brothers'), ('Ascension Day'), ('Final Day'), ('Biosanctic Broodsurge'), ('Outlander Claw'), ('Host of Ascension'), ('Xenocreed Congregation')) AS d(n)
WHERE factions.name = 'Genestealer Cults' ON CONFLICT DO NOTHING;

-- Leagues of Votann
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Oathband'), ('Hearthkyn Yeomanry')) AS d(n)
WHERE factions.name = 'Leagues of Votann' ON CONFLICT DO NOTHING;

-- Necrons
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Awakened Dynasty'), ('Canoptek Court'), ('Hypercrypt Legion'), ('Annihilation Legion'), ('Obeisance Phalanx'), ('Starshatter Arsenal'), ('Living Metal Cohort')) AS d(n)
WHERE factions.name = 'Necrons' ON CONFLICT DO NOTHING;

-- Orks
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('War Horde'), ('Bully Boyz'), ('Dread Mob'), ('Green Tide'), ('Kult of Speed'), ('Taktikal Brigade'), ('Kommando Skirmish'), ('Da Big Hunt')) AS d(n)
WHERE factions.name = 'Orks' ON CONFLICT DO NOTHING;

-- T'au Empire
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Mont''ka'), ('Kauyon'), ('Retaliation Cadre'), ('Kroot Hunting Pack'), ('Auxiliary Cadre'), ('Ranged Support Cadre'), ('Experimental Cadre')) AS d(n)
WHERE factions.name = 'T''au Empire' ON CONFLICT DO NOTHING;

-- Tyranids
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Invasion Fleet'), ('Vanguard Onslaught'), ('Crusher Stampede'), ('Assimilation Swarm'), ('Endless Multitude'), ('Synaptic Nexus'), ('Unending Swarm'), ('Warrior Bioform Onslaught')) AS d(n)
WHERE factions.name = 'Tyranids' ON CONFLICT DO NOTHING;

-- Chaos Space Marines
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Chaos Lord''s Warband'), ('Pactbound Zealots'), ('Veterans of the Long War'), ('Renegade Raiders'), ('Soulforged Warpack'), ('Dread Talons'), ('Fellhammer Siege-host'), ('Creations of Bile')) AS d(n)
WHERE factions.name = 'Chaos Space Marines' ON CONFLICT DO NOTHING;

-- Chaos Daemons
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Daemonic Incursion'), ('Pandaemonium'), ('Mortal Vessels'), ('Daemonic Champions'), ('Court of Glory')) AS d(n)
WHERE factions.name = 'Chaos Daemons' ON CONFLICT DO NOTHING;

-- Chaos Knights
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Iconoclast Lance'), ('Traitoris Lance'), ('Court of Traitors')) AS d(n)
WHERE factions.name = 'Chaos Knights' ON CONFLICT DO NOTHING;

-- Death Guard
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Plague Company'), ('Flyblown Host'), ('Lords of Virulence'), ('Mortarion''s Anvil'), ('Bringers of Decay')) AS d(n)
WHERE factions.name = 'Death Guard' ON CONFLICT DO NOTHING;

-- Thousand Sons
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Hexwarp Thrallband'), ('Cult of Magic'), ('Tzaangor Coven'), ('Cult of Mutation'), ('Cult of Time')) AS d(n)
WHERE factions.name = 'Thousand Sons' ON CONFLICT DO NOTHING;

-- World Eaters
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Berzerker Warband'), ('Vessels of Wrath'), ('Slaughterbound')) AS d(n)
WHERE factions.name = 'World Eaters' ON CONFLICT DO NOTHING;

-- Emperor's Children
INSERT INTO detachments (faction_id, name)
SELECT id, n FROM factions, (VALUES ('Peerless Bladehost'), ('Flawless Host'), ('Slaaneshi Host'), ('Mortal Vessels of Slaanesh')) AS d(n)
WHERE factions.name = 'Emperor''s Children' ON CONFLICT DO NOTHING;

-- ── Mission Packs ──────────────────────────────────────────────
INSERT INTO mission_packs (name) VALUES
  ('Pariah Nexus'),
  ('Leviathan'),
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
  ('A Tempting Target')
) AS s(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- Pariah Nexus fixed secondaries (subset)
INSERT INTO secondary_cards (mission_pack_id, name, card_type)
SELECT id, n, 'fixed' FROM mission_packs, (VALUES
  ('Bring it Down (Fixed)'),
  ('Assassination (Fixed)'),
  ('No Prisoners (Fixed)'),
  ('Cull the Horde (Fixed)')
) AS s(n) WHERE mission_packs.name = 'Pariah Nexus' ON CONFLICT DO NOTHING;

-- Pariah Nexus challenger / "Gambit" cards
INSERT INTO challenger_cards (mission_pack_id, name)
SELECT id, n FROM mission_packs, (VALUES
  ('No Mercy, No Respite'),
  ('Behind Enemy Lines'),
  ('Recover the Relics'),
  ('Storm Hostile Objective'),
  ('Defend Stronghold')
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
  ('Marked for Death')
) AS s(n) WHERE mission_packs.name = 'Leviathan' ON CONFLICT DO NOTHING;
