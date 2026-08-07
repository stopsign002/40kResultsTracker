#!/usr/bin/env python3
"""Rebuild app/data/mission-cards-11e.json from the Game Datacards mission dump.

Source is game-datacards/datasources, the same repo (and the same GW-app APK
extraction) the sister yaab site already trusts for faction datasheets — just a
different file under 11th/gdc/missions/.

The upstream file is ~500KB because every string carries eight translations.
We keep English only, drop the app-runtime plumbing (uuids, input widget types,
scorable-period lists, recommended layout presets) and land at a fraction of
that, which is what the client fetches.

Card names are matched to the DB's seeded rows by name, case-insensitively —
GDC title-cases every word ("Bring It Down") where seed.sql follows GW's own
casing ("Bring it Down"). Don't "fix" either side; match loosely instead.

    python3 scripts/build-mission-cards.py [--check]

--check rebuilds into memory and exits non-zero if the committed file differs,
without writing (for a cron or a pre-deploy sanity run).
"""

import argparse
import json
import pathlib
import sys
import urllib.request

SOURCE_URL = (
    'https://raw.githubusercontent.com/game-datacards/datasources/main/'
    '11th/gdc/missions/chapter_approved_2026_2027.json'
)
OUT = pathlib.Path(__file__).resolve().parent.parent / 'app' / 'data' / 'mission-cards-11e.json'

EXPECT_PRIMARIES = 25
EXPECT_SECONDARIES = 18


def en(value):
    """Collapse a {en, de, es, …} bag to its English string; pass anything else through."""
    if isinstance(value, dict) and 'en' in value:
        return value['en']
    return value


def clean(text):
    if text is None:
        return None
    text = str(text).strip()
    return text or None


def scoring_row(row):
    out = {
        'victoryPoints': row.get('victoryPoints'),
        'criteria': clean(en(row.get('scoringCriteria'))),
    }
    if row.get('victoryPointsCap') is not None:
        out['cap'] = row['victoryPointsCap']
    # scoringType splits the fixed-vs-tactical halves of a secondary card; a
    # primary has none, so only carry it when it means something.
    if row.get('scoringType'):
        out['mode'] = row['scoringType']
    if row.get('isCumulative'):
        out['cumulative'] = True
    if row.get('isMutuallyExclusive'):
        out['exclusive'] = True
    return out


def objective(obj):
    return {
        'name': clean(en(obj.get('name'))),
        'when': clean(en(obj.get('whenText'))),
        'scoring': [scoring_row(s) for s in obj.get('scoring') or []],
    }


def action(act):
    return {
        'name': clean(en(act.get('name'))),
        'starts': clean(en(act.get('startsText'))),
        'completes': clean(en(act.get('completesText'))),
        'units': clean(en(act.get('unitsText'))),
        'effect': clean(en(act.get('effectText'))),
        'useLimit': clean(en(act.get('useLimitText'))),
    }


def card(src, *, extra_keys=()):
    out = {
        'name': clean(en(src.get('name'))),
        'lore': clean(en(src.get('lore'))),
        'objectives': [objective(o) for o in src.get('objectives') or []],
    }
    for key in extra_keys:
        value = clean(en(src.get(key)))
        if value:
            out[key] = value
    actions = [action(a) for a in src.get('actions') or []]
    if actions:
        out['actions'] = actions
    return out


def build(raw):
    primaries = []
    for src in raw.get('primaryMissions') or []:
        entry = card(src, extra_keys=('detachment',))
        entry['dispositions'] = [
            {'yours': fd.get('friendly'), 'theirs': fd.get('opposition')}
            for fd in src.get('forceDispositions') or []
        ]
        primaries.append(entry)

    secondaries = [
        card(src, extra_keys=('description',))
        for src in raw.get('secondaryMissions') or []
    ]

    primaries.sort(key=lambda c: c['name'])
    secondaries.sort(key=lambda c: c['name'])

    return {
        'pack': clean(en(raw.get('name'))),
        'source': raw.get('source'),
        'sourceUrl': SOURCE_URL,
        'compatibleDataVersion': raw.get('compatibleDataVersion'),
        'updated': raw.get('updated'),
        'limits': {
            'primaryGame': raw.get('primaryMissionScoreGameLimit'),
            'primaryRound': raw.get('primaryMissionScoreBattleRoundLimit'),
            'secondaryGame': raw.get('secondaryMissionScoreGameLimit'),
            'secondaryRound': raw.get('secondaryMissionScoreBattleRoundLimit'),
            'fixedSecondaryCap': raw.get('fixedSecondaryMissionCapLimit'),
        },
        'forceDispositions': [clean(en(fd.get('name'))) for fd in raw.get('forceDispositions') or []],
        'primaryMissions': primaries,
        'secondaryMissions': secondaries,
    }


def verify(built):
    problems = []
    if len(built['primaryMissions']) != EXPECT_PRIMARIES:
        problems.append(f"expected {EXPECT_PRIMARIES} primary missions, got {len(built['primaryMissions'])}")
    if len(built['secondaryMissions']) != EXPECT_SECONDARIES:
        problems.append(f"expected {EXPECT_SECONDARIES} secondaries, got {len(built['secondaryMissions'])}")
    for kind in ('primaryMissions', 'secondaryMissions'):
        for entry in built[kind]:
            if not entry['name']:
                problems.append(f'{kind}: a card has no name')
            elif not entry['objectives']:
                problems.append(f"{kind}: {entry['name']} has no scoring objectives")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='compare against the committed file instead of writing')
    ap.add_argument('--from-file', help='use a local copy of the upstream JSON instead of fetching')
    args = ap.parse_args()

    if args.from_file:
        raw = json.loads(pathlib.Path(args.from_file).read_text(encoding='utf-8'))
    else:
        with urllib.request.urlopen(SOURCE_URL, timeout=60) as resp:
            raw = json.loads(resp.read().decode('utf-8'))

    built = build(raw)
    problems = verify(built)
    if problems:
        for p in problems:
            print(f'FAIL: {p}', file=sys.stderr)
        return 2

    text = json.dumps(built, indent=1, ensure_ascii=False) + '\n'

    if args.check:
        if not OUT.exists():
            print(f'FAIL: {OUT} does not exist', file=sys.stderr)
            return 1
        if OUT.read_text(encoding='utf-8') != text:
            print(f'STALE: {OUT} differs from a fresh build of {SOURCE_URL}', file=sys.stderr)
            return 1
        print(f'OK: {OUT.name} matches upstream (data version {built["compatibleDataVersion"]})')
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding='utf-8')
    print(f'wrote {OUT} — {len(built["primaryMissions"])} primaries, '
          f'{len(built["secondaryMissions"])} secondaries, {len(text)/1024:.0f}KB, '
          f'data version {built["compatibleDataVersion"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
