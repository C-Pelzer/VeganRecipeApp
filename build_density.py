#!/usr/bin/env python3
"""
Build a volume->mass density table by mining the cookbooks themselves.

53% of ingredients ship with a publisher gram/ml figure beside the volume
("1/2 cup (114 g) vegan butter"). Each such line is one density observation.
Aggregate across the library -> g per cup per ingredient, with sample counts
and spread so we can tell a solid figure from a guess.
"""
import json, re, statistics, collections, unicodedata

CUPS = {'cup': 1, 'cups': 1, 'c.': 1, 'tbsp': 1/16, 'tablespoon': 1/16, 'tablespoons': 1/16,
        'tsp': 1/48, 'teaspoon': 1/48, 'teaspoons': 1/48, 'quart': 4, 'quarts': 4, 'qt': 4,
        'pint': 2, 'pints': 2, 'gallon': 16, 'l': 4.2268, 'liter': 4.2268, 'liters': 4.2268,
        'litre': 4.2268, 'litres': 4.2268, 'ml': 0.0042268}

MASS_G = {'g': 1, 'gram': 1, 'grams': 1, 'kg': 1000, 'mg': .001,
          'oz': 28.3495, 'ounce': 28.3495, 'ounces': 28.3495, 'lb': 453.592, 'lbs': 453.592}
VOL_ML = {'ml': 1, 'l': 1000, 'liter': 1000, 'liters': 1000, 'litre': 1000, 'litres': 1000,
          'fl oz': 29.5735}

NUM = r'(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)'
METRIC_VAL = re.compile(rf'^\s*(?P<n>{NUM})\s*(?:to|-|–)?\s*(?:{NUM})?\s*(?P<u>[a-z ]+?)\.?\s*$', re.I)

# prep words that don't change what the ingredient IS
STRIP = re.compile(r'\b(?:divided|plus more|\+ more(?: as needed)?|as needed|to taste|optional|'
                   r'for (?:frying|serving|garnish|dusting|greasing|brushing)|'
                   r'at room temperature|room temperature|packed|lightly packed|'
                   r'firmly packed|well[- ]shaken|full[- ]fat|store[- ]bought|homemade|'
                   r'see (?:page|here|recipe notes?)[^,]*)\b', re.I)
PARENS = re.compile(r'\([^)]*\)')


def to_float(s):
    s = s.strip()
    m = re.match(r'^(\d+)\s+(\d+)/(\d+)$', s)
    if m:
        a, b, c = map(float, m.groups()); return a + b / c
    m = re.match(r'^(\d+)/(\d+)$', s)
    if m:
        return float(m.group(1)) / float(m.group(2))
    try:
        return float(s)
    except ValueError:
        return None


def canon(item):
    """Canonical ingredient key: lowercase, no parentheticals, no prep noise."""
    s = unicodedata.normalize('NFKC', item or '').lower()
    s = PARENS.sub(' ', s)
    s = STRIP.sub(' ', s)
    s = re.sub(r'[^a-z0-9%\s/&-]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' -/&')
    s = re.sub(r'\b(\w+)s\b', lambda m: m.group(1) if m.group(1).endswith(('e', 'o', 'a')) is False
               and len(m.group(1)) > 4 and not m.group(1).endswith('s') else m.group(0), s)
    return s.strip()


def parse_metric(txt):
    """'312 g' -> (312,'g') ; '60 ml' -> (60,'ml')"""
    m = METRIC_VAL.match(txt or '')
    if not m:
        return None, None
    n = to_float(m.group('n'))
    u = m.group('u').strip().lower()
    return n, u


def build(recipes):
    obs = collections.defaultdict(list)     # key -> [g per cup]
    liq = collections.defaultdict(list)     # key -> [ml per cup] (density ~1 liquids)
    for r in recipes:
        for g in r['ingredient_groups']:
            for i in g['ingredients']:
                if not i['metric'] or not i['unit'] or i['quantity'] is None:
                    continue
                cups = CUPS.get(i['unit'].lower())
                if not cups:
                    continue
                vol_cups = i['quantity'] * cups
                if vol_cups <= 0:
                    continue
                # a 1 g rounding on 1 tsp is a ~30% error; only large-enough
                # volumes give a usable density reading
                coarse = vol_cups < 0.125
                val, unit = parse_metric(i['metric'])
                if val is None:
                    continue
                key = canon(i['item'])
                # reject keys that are fragments, not ingredient names
                if not key or len(key) < 3 or re.match(r'^(and|plus|or|of|more)\b', key) \
                        or re.match(r'^\d', key) or len(key) > 42:
                    continue
                if unit in MASS_G:
                    obs[key].append((val * MASS_G[unit] / vol_cups, coarse))
                elif unit in VOL_ML:
                    liq[key].append(val * VOL_ML[unit] / vol_cups)

    table = {}
    for key, allv in obs.items():
        fine = [v for v, c in allv if not c]
        vals = fine if len(fine) >= 2 else [v for v, c in allv]
        vals = [v for v in vals if 5 < v < 800]      # drop absurd outliers
        if not vals:
            continue
        med = statistics.median(vals)
        # keep only observations within 35% of the median, then re-median
        tight = [v for v in vals if abs(v - med) / med <= 0.35] or vals
        spread = (max(tight) - min(tight)) / statistics.median(tight) if len(tight) > 1 else 0
        table[key] = {'g_per_cup': round(statistics.median(tight), 1),
                      'n': len(vals), 'n_agree': len(tight),
                      'spread': round(spread, 3),
                      'source': 'cookbook-derived',
                      'confidence': ('high' if len(tight) >= 4 and spread <= .15 else
                                     'medium' if len(tight) >= 2 and spread <= .35 else 'low')}
    for key, vals in liq.items():
        if key in table:
            continue
        vals = [v for v in vals if 100 < v < 400]
        if not vals:
            continue
        table[key] = {'ml_per_cup': round(statistics.median(vals), 1), 'n': len(vals),
                      'n_agree': len(vals), 'spread': 0.0, 'source': 'cookbook-derived-liquid',
                      'confidence': 'high' if len(vals) >= 3 else 'medium', 'liquid': True}
    return table


def merge_curated(t, path='/home/claude/density_curated.json'):
    cur = json.load(open(path))
    for k, gml in cur['_liquid_g_per_ml'].items():
        e = t.get(k, {})
        # a book's "(240 ml)" is a volume identity, not a weight -> overwrite it
        if 'g_per_cup' not in e:
            t[k] = {'g_per_cup': round(gml * 236.588, 1), 'g_per_ml': gml,
                    'liquid': True, 'n': None, 'spread': 0.0,
                    'source': 'curated-density', 'confidence': 'high'}
        else:
            e['g_per_ml'] = gml
    for k, gpc in cur['_solid_g_per_cup'].items():
        if k not in t or t[k].get('confidence') == 'low' or t[k].get('liquid'):
            keep = t.get(k, {})
            t[k] = {'g_per_cup': gpc, 'n': keep.get('n'), 'spread': keep.get('spread', 0.0),
                    'source': 'curated-reference', 'confidence': 'high',
                    'cookbook_value': keep.get('g_per_cup')}
    return t


if __name__ == '__main__':
    R = json.load(open('/home/claude/recipes.json'))
    t = merge_curated(build(R))
    json.dump(t, open('/home/claude/density_table.json', 'w'), indent=1, sort_keys=True)
    byc = collections.Counter(v['confidence'] for v in t.values())
    print(f'{len(t)} ingredient densities derived  {dict(byc)}')
    print('\nmost-observed:')
    for k, v in sorted(t.items(), key=lambda x: -(x[1]['n'] or 0))[:22]:
        unit = f"{v.get('g_per_cup')} g/cup" if 'g_per_cup' in v else f"{v.get('ml_per_cup')} ml/cup"
        print(f"  {k[:44]:46s} {unit:16s} n={v['n']:4d} spread={v['spread']:.2f} {v['confidence']}")
