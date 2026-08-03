#!/usr/bin/env python3
"""
Apply the density table to every ingredient: metric everywhere, grams wherever
a scale can actually resolve the amount.

Priority for a gram figure:
  1. the publisher's own "(312 g)" - authoritative, already in the book
  2. a mass unit converted (oz/lb -> g)
  3. density lookup: exact key, else longest matching substring
Below MIN_WEIGHABLE the volume stays primary - no one can weigh 1/4 tsp.
"""
import json, re, sys, collections
from pathlib import Path
from build_density import canon, CUPS, MASS_G, VOL_ML, parse_metric

ROOT = Path(__file__).resolve().parent

ML_PER_CUP = 236.588
MIN_WEIGHABLE = 5.0          # grams; a 1 g kitchen scale can't resolve less

F_TEMP = re.compile(r'(\d{2,3})\s*°?\s*F\b(?!\s*\()', re.I)
INCH = re.compile(r'(\d+(?:\.\d+)?|\d+/\d+|\d+ \d+/\d+)[- ]?(?:inch|in\.)\b(?!\s*\[)', re.I)


class Densities:
    def __init__(self, path=ROOT / 'density_table.json'):
        self.t = {k: v for k, v in json.load(open(path, encoding='utf-8')).items() if not k.startswith('_')}
        cur = json.load(open(ROOT / 'density_curated.json', encoding='utf-8'))
        self.each = cur.get('_each_grams_approx', {})
        self.each_keys = sorted(self.each, key=len, reverse=True)
        # longest keys first so "extra-virgin olive oil" beats "olive oil"
        self.keys = sorted((k for k in self.t if self.t[k].get('g_per_cup')),
                           key=len, reverse=True)

    def lookup(self, item):
        k = canon(item)
        if k in self.t and self.t[k].get('g_per_cup'):
            return k, self.t[k], 'exact'
        for cand in self.keys:
            if len(cand) >= 4 and re.search(rf'\b{re.escape(cand)}\b', k):
                return cand, self.t[cand], 'substring'
        return None, None, None

    def resolve_liquids(self):
        """Give ml-identity entries a real density via substring match."""
        cur = json.load(open(ROOT / 'density_curated.json', encoding='utf-8'))['_liquid_g_per_ml']
        lk = sorted(cur, key=len, reverse=True)
        fixed = 0
        for k, v in self.t.items():
            solid_ok = v.get('g_per_cup') and not v.get('liquid') and \
                v.get('confidence') in ('high', 'medium') and (v.get('n') or 0) >= 3
            if solid_ok or v.get('g_per_ml'):
                continue
            for cand in lk:
                if re.search(rf'\b{re.escape(cand)}\b', k):
                    v.update({'g_per_cup': round(cur[cand] * ML_PER_CUP, 1),
                              'g_per_ml': cur[cand], 'liquid': True,
                              'source': f'curated-density ({cand})', 'confidence': 'high'})
                    fixed += 1
                    break
        self.keys = sorted((k for k in self.t if self.t[k].get('g_per_cup')),
                           key=len, reverse=True)
        return fixed


def grams_for(ing, D):
    """-> (grams, source, confidence) or (None, reason, None)"""
    val, unit = parse_metric(ing['metric']) if ing['metric'] else (None, None)
    if val is not None and unit in MASS_G:
        return round(val * MASS_G[unit], 1), 'book', 'high'

    # "2 (14-oz [414-g]) cans" -> 2 x 414 g
    if ing.get('package_metric') and ing['quantity'] is not None:
        pv, pu = parse_metric(ing['package_metric'])
        if pv is not None and pu in MASS_G:
            return round(ing['quantity'] * pv * MASS_G[pu], 1), 'book-package', 'high'
        if pv is not None and pu in VOL_ML:
            key, e, _ = D.lookup(ing['item'])
            gml = (e or {}).get('g_per_ml', 1.0)
            return round(ing['quantity'] * pv * VOL_ML[pu] * gml, 1), 'book-package', 'medium'

    u = (ing['unit'] or '').lower()
    q = ing['quantity']
    if u in MASS_G and q is not None:
        return round(q * MASS_G[u], 1), 'unit-conversion', 'high'

    # publisher gave ml -> weigh it with a real density
    if val is not None and unit in VOL_ML:
        key, e, how = D.lookup(ing['item'])
        if e and e.get('g_per_ml'):
            return round(val * VOL_ML[unit] * e['g_per_ml'], 1), f'density:{key}', e['confidence']
        if e and e.get('g_per_cup'):
            gml = e['g_per_cup'] / ML_PER_CUP
            return round(val * VOL_ML[unit] * gml, 1), f'density:{key}', 'low'
        return round(val * VOL_ML[unit], 1), 'assumed-water-density', 'low'

    if u in CUPS and q is not None:
        key, e, how = D.lookup(ing['item'])
        if e:
            g = q * CUPS[u] * e['g_per_cup']
            conf = e['confidence'] if how == 'exact' else \
                ('medium' if e['confidence'] == 'high' else 'low')
            return round(g, 1), f'density:{key}', conf
        return None, 'no-density-known', None

    # bought by count: give an approximate weight so lists can total
    if q is not None and not u:
        k = canon(ing['item'])
        for cand in D.each_keys:
            if re.search(rf'\b{re.escape(cand)}\b', k):
                return round(q * D.each[cand], 1), f'approx-each:{cand}', 'low'
    return None, 'count-based', None


def fmt(g):
    if g is None:
        return None
    if g >= 1000:
        return f'{g/1000:.2f} kg'.replace('.00 kg', ' kg')
    return f'{g:.0f} g' if g >= 10 else f'{g:.1f} g'


def metricise_step(txt):
    txt = F_TEMP.sub(lambda m: f"{m.group(1)}°F ({round((int(m.group(1))-32)*5/9/5)*5}°C)", txt)
    return txt


def run(recipes, D):
    stats = collections.Counter()
    for r in recipes:
        for g in r['ingredient_groups']:
            for i in g['ingredients']:
                grams, src, conf = grams_for(i, D)
                i['grams'] = grams
                i['grams_source'] = src
                i['grams_confidence'] = conf
                approx = bool(src and src.startswith('approx-each'))
                i['approx'] = approx
                i['weighable'] = bool(grams and grams >= MIN_WEIGHABLE and not approx)
                i['display'] = (f"{fmt(grams)} {i['item']}" if i['weighable']
                                else i['raw'])
                stats[src if grams else f'unconverted:{src}'] += 1
        r['steps'] = [metricise_step(s) for s in r['steps']]
        ings = [i for g in r['ingredient_groups'] for i in g['ingredients']]
        r['ingredient_count'] = len(ings)
        r['weighable_count'] = sum(1 for i in ings if i['weighable'])
        r['total_grams'] = round(sum(i['grams'] for i in ings if i['grams']), 1) or None
    return stats


if __name__ == '__main__':
    D = Densities()
    print(f'liquid densities resolved by substring: {D.resolve_liquids()}')
    json.dump(D.t, open(ROOT / 'density_table.json', 'w', encoding='utf-8'), indent=1, sort_keys=True)

    R = json.load(open(ROOT / 'recipes.json', encoding='utf-8'))
    stats = run(R, D)
    json.dump(R, open(ROOT / 'recipes_metric.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

    tot = sum(stats.values())
    print(f'\n{tot:,} ingredients:')
    roll = collections.Counter()
    for k, v in stats.items():
        roll['density lookup' if k.startswith('density:') else k] += v
    for k, v in roll.most_common():
        print(f'   {k:34s} {v:6,}  {v/tot*100:5.1f}%')
    conv = sum(v for k, v in stats.items() if not k.startswith('unconverted'))
    print(f'\ngram figure obtained for {conv:,}/{tot:,} ({conv/tot*100:.1f}%)')
