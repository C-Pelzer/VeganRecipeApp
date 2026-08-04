#!/usr/bin/env python3
"""
Format-agnostic vegan cookbook epub -> structured recipe JSON.

Two passes per book:
  1. infer_roles()  - learn which CSS classes mean "ingredient" vs "step"
                      by measuring quantity-density and text length.
  2. parse_doc()    - walk each content doc in reading order and emit recipes.

No per-book class names are hardcoded anywhere.
"""
import json, re, sys, zipfile, posixpath, unicodedata, hashlib, collections
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent

# ---------------------------------------------------------------- vocabulary
UNITS = (r'cups?|c\.|tbsp|tablespoons?|tsp|teaspoons?|ounces?|oz\.?|pounds?|lbs?\.?|'
         r'grams?|g|kg|mg|ml|l|liters?|litres?|quarts?|qts?|pints?|pts?|gallons?|gal|'
         r'cloves?|cans?|jars?|packages?|pkgs?|bunch(?:es)?|heads?|stalks?|sprigs?|'
         r'slices?|pieces?|strips?|sheets?|leaves|leaf|ears?|ribs?|pinch(?:es)?|dash(?:es)?|'
         r'handfuls?|drops?|inch(?:es)?|in\.|scoops?|sticks?|bags?|boxes?|containers?')

VULGAR = {'¼': .25, '½': .5, '¾': .75, '⅐': 1/7, '⅑': 1/9, '⅒': .1, '⅓': 1/3, '⅔': 2/3,
          '⅕': .2, '⅖': .4, '⅗': .6, '⅘': .8, '⅙': 1/6, '⅚': 5/6, '⅛': .125,
          '⅜': .375, '⅝': .625, '⅞': .875}
VUL = ''.join(VULGAR)

QTY_START = re.compile(rf'^\s*(?:\d|[{VUL}])')
QTY_LINE = re.compile(rf'^\s*(?:\d[\d\s,./{VUL}-]*|[{VUL}])\s*(?:{UNITS})?\b', re.I)

# "1½ cups (312 g) all-purpose flour, sifted"
# ORDER MATTERS: mixed numbers and fractions must be tried before bare integers,
# or "1/4" matches the integer branch as 1 and the "/4" is orphaned.
NUM = (rf'(?:\d+\s+\d+\s*/\s*\d+'      # 1 1/2
       rf'|\d+\s*[{VUL}]'                  # 1½
       rf'|\d+\s*/\s*\d+'                # 1/2
       rf'|[{VUL}]'                         # ½
       rf'|\d+[\d,]*(?:\.\d+)?)')         # 12  /  1.5
ING = re.compile(
    rf'^\s*(?P<qty>{NUM}(?:\s*(?:to|or|-|–|—)\s*{NUM})?)?'
    rf'\s*(?P<unit>(?:{UNITS})\b\.?)?'
    rf'\s*(?P<rest>.*)$', re.I)

PKG = re.compile(r'\[\s*(?P<n>[\d.,/]+)\s*-?\s*(?P<u>g|kg|ml|l|oz|lb)\b[^\]]*\]', re.I)
METRIC = re.compile(r'\(\s*([\d.,/\s' + VUL + r']+\s*(?:g|kg|mg|ml|l|oz|lb|cm|inch|in)\.?'
                    r'(?:\s*(?:to|-|–)\s*[\d.,/\s]+\s*\w+)?)\s*\)', re.I)

GROUP_HDR = re.compile(r'^\s*(?:for\s+the\b.*|for\s+serving\b.*|to\s+serve\b.*|topping\b.*|'
                       r'garnish(?:es)?\b.*|filling\b.*|crust\b.*|dough\b.*|sauce\b.*|'
                       r'dressing\b.*|marinade\b.*|glaze\b.*|frosting\b.*|streusel\b.*|'
                       r'ingredients?)\s*:?\s*$', re.I)

SERVES = re.compile(r'\b(serves?|makes|yields?|serving\s+size)\b\s*:?\s*'
                    r'(?P<val>[\d' + VUL + r'][\d\s' + VUL + r'./to–—-]*'
                    r'(?:\s*\w+)?(?:\s*\([^)]*\))?)', re.I)
TIME = re.compile(r'(\d+(?:\s*(?:to|-|–)\s*\d+)?)\s*(minutes?|mins?|hours?|hrs?)'
                  r'(?:\s+(?:to\s+prepare|prep|cook(?:ing)?|total|active|inactive|rest|chill))?', re.I)
NUTRI = re.compile(r'\b(calories|kcal|protein|carbohydrates?|total fat)\b', re.I)
DIET = re.compile(r'\b(nut[- ]free|soy[- ]free|gluten[- ]free|oil[- ]free|raw|sugar[- ]free|'
                  r'grain[- ]free|no[- ]bake|freezer[- ]friendly|one[- ]pot|quick|30 minutes or less)\b', re.I)
OPTIONAL = re.compile(r'\b(optional|to taste|if desired|as needed|for serving|for garnish)\b', re.I)

YIELD_LABEL = re.compile(r'^\s*(serves?|makes|yields?|serving\s+size)\s*:?\s*$', re.I)
YIELD_NOUN = re.compile(r'^(pizzas?|servings?|portions?|people|cookies|bars?|muffins?|loaves|'
                        r'loaf|cakes?|pies?|quarts?|cups?|dozen|slices?|pancakes?|waffles?|'
                        r'donuts?|rolls?|burgers?|tacos?|bowls?|jars?|batches?|sandwiches)\b', re.I)

SKIP_TITLE = re.compile(r'^\s*(contents?|table of contents|index|acknowledg|about the author|'
                        r'introduction|copyright|dedication|title page|resources?|'
                        r'conversion|equipment|pantry|glossary|references?)\b', re.I)


def _fracslash(m):
    num, den = m.group(1), m.group(2)
    if len(num) > 1:                     # "11/4" is typeset 1-and-1/4
        return f'{num[:-1]} {num[-1]}/{den}'
    return f'{num}/{den}'


def norm(s):
    s = unicodedata.normalize('NFKC', s or '')
    s = re.sub(r'(\d+)\u2044(\d+)', _fracslash, s)
    s = s.replace('\u00a0', ' ').replace('\u2019', "'").replace('\u2018', "'")
    s = s.replace('\u201c', '"').replace('\u201d', '"')
    return re.sub(r'\s+', ' ', s).strip()


def qty_to_float(q):
    if not q:
        return None
    q = norm(q)
    # tolerate leading words: "APPROXIMATELY 4 CUPS" -> 4
    m0 = re.search(r'[\d' + VUL + r']', q)
    if m0 and m0.start() > 0:
        q = q[m0.start():]
    m = re.match(r'^([\d.,]+)?\s*([' + VUL + r'])$', q)
    if m:
        return round((float(m.group(1).replace(',', '')) if m.group(1) else 0) + VULGAR[m.group(2)], 4)
    m = re.match(r'^(\d+)\s+(\d+)/(\d+)$', q)
    if m:
        a, b, c = map(float, m.groups())
        return round(a + b / c, 4)
    m = re.match(r'^(\d+)/(\d+)$', q)
    if m:
        return round(float(m.group(1)) / float(m.group(2)), 4)
    m = re.match(r'^([\d,]+(?:\.\d+)?)', q)
    if m:
        try:
            return float(m.group(1).replace(',', ''))
        except ValueError:
            return None
    return None


# ------------------------------------------------------------------ epub bits
def opf_path(z):
    try:
        m = re.search(r'full-path="([^"]+)"', z.read('META-INF/container.xml').decode('utf-8', 'replace'))
        if m:
            return m.group(1)
    except KeyError:
        pass
    return next((n for n in z.namelist() if n.endswith('.opf')), None)


def book_meta(z):
    op = opf_path(z)
    if not op:
        return {}, []
    s = BeautifulSoup(z.read(op), 'xml')
    base = posixpath.dirname(op)
    meta = {'title': (s.find('title').get_text() if s.find('title') else None),
            'authors': [a.get_text() for a in s.find_all('creator')] or None}
    hrefs = {i.get('id'): i.get('href') for i in s.find_all('item')}
    docs = []
    for ref in s.find_all('itemref'):
        h = hrefs.get(ref.get('idref'))
        if h and h.split('#')[0].endswith(('.xhtml', '.html', '.htm')):
            docs.append(posixpath.normpath(posixpath.join(base, h)) if base else h)
    return meta, docs


def blocks(soup):
    """Flat list of (tagname, classkey, text) in reading order."""
    out = []
    for t in soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'div', 'li', 'td']):
        if t.find(['p', 'h1', 'h2', 'h3', 'h4', 'li', 'td']):
            continue  # container, not a leaf
        txt = norm(t.get_text(' '))
        if not txt:
            continue
        cls = '.'.join(t.get('class') or []) or '-'
        out.append((t.name, f'{t.name}.{cls}', txt))
    return out


# --------------------------------------------------------------- role inference
def infer_roles(z, docs):
    """Learn this book's ingredient/step classes from statistics, not names."""
    stat = collections.defaultdict(lambda: {'n': 0, 'len': 0, 'qty': 0, 'short': 0})
    for d in docs:
        try:
            bl = blocks(BeautifulSoup(z.read(d), 'lxml'))
        except KeyError:
            continue
        for tag, key, txt in bl:
            if tag.startswith('h'):
                continue
            s = stat[key]
            s['n'] += 1
            s['len'] += len(txt)
            if len(txt) <= 110:
                s['short'] += 1
                if QTY_LINE.match(txt) and QTY_START.match(txt):
                    s['qty'] += 1

    ing, step = set(), set()
    for key, s in stat.items():
        if s['n'] < 8:
            continue
        mean = s['len'] / s['n']
        qfrac = s['qty'] / s['n']
        sfrac = s['short'] / s['n']
        if qfrac >= 0.35 and 8 <= mean < 110 and sfrac > 0.7:
            ing.add(key)
        elif mean >= 115 and qfrac < 0.30:
            step.add(key)

    # fallback: no class-level signal (unstyled book) -> decide per line later
    return {'ingredient': ing, 'step': step,
            'stats': {k: {'n': v['n'], 'mean_len': round(v['len'] / v['n'], 1),
                          'qty_frac': round(v['qty'] / v['n'], 3)}
                      for k, v in stat.items() if v['n'] >= 8}}


# ------------------------------------------------------------------- ingredient
def parse_ingredient(raw):
    raw = norm(raw)
    out = {'raw': raw, 'quantity': None, 'quantity_text': None, 'unit': None,
           'metric': None, 'package_metric': None, 'item': raw, 'prep': None,
           'optional': False}
    pk = PKG.search(raw)
    if pk:
        out['package_metric'] = f"{pk.group('n')} {pk.group('u').lower()}"

    met = METRIC.search(raw)
    stripped = raw
    if met:
        out['metric'] = norm(met.group(1))
        stripped = norm(raw[:met.start()] + ' ' + raw[met.end():])

    m = ING.match(stripped)
    if m:
        q, u, rest = m.group('qty'), m.group('unit'), m.group('rest')
        if q:
            out['quantity_text'] = norm(q)
            out['quantity'] = qty_to_float(q)
        if u:
            out['unit'] = norm(u).lower().rstrip('.')
        rest = norm(rest)
        # trailing prep after comma: "all-purpose flour, sifted"
        if ',' in rest:
            head, tail = rest.split(',', 1)
            if len(head) and (len(tail) < 60 or OPTIONAL.search(tail)):
                out['item'], out['prep'] = norm(head), norm(tail)
            else:
                out['item'] = rest
        else:
            out['item'] = rest
    out['optional'] = bool(OPTIONAL.search(raw))
    if not out['item']:
        out['item'] = raw
    return out


# ------------------------------------------------------------------- recipe cut
def parse_doc(book_title, doc, bl, roles):
    """Split one content doc into recipe records."""
    ing_cls, step_cls = roles['ingredient'], roles['step']
    recipes, cur, pending_yield = [], None, False

    def rescue_yield(r):
        gs = r['ingredient_groups']
        if not gs or not gs[0]['ingredients']:
            return
        first = gs[0]['ingredients'][0]
        if r['servings'] is None and not first['unit'] and first['quantity'] is not None \
                and YIELD_NOUN.match(first['item'] or ''):
            r['servings_text'] = first['raw']
            r['servings'] = first['quantity']
            gs[0]['ingredients'].pop(0)

    def flush():
        nonlocal cur
        if cur:
            rescue_yield(cur)
        if cur and cur['ingredient_groups'] and sum(
                len(g['ingredients']) for g in cur['ingredient_groups']) >= 2:
            recipes.append(cur)
        cur = None

    for tag, key, txt in bl:
        is_head = tag in ('h1', 'h2', 'h3')

        if is_head and len(txt) < 160:
            # A heading only means a new dish when the current recipe is either
            # not started yet, or already complete-shaped (ingredients AND steps
            # both present). The ambiguous window -- ingredients captured, steps
            # not yet started -- is where some books put a heading for something
            # that isn't a new recipe (a "SERVES 2" metadata line, a sub-component
            # name, an alternate-method label). Flushing there ends the real
            # recipe before its steps are seen, and stripped the steps that
            # followed since they'd land on a phantom title with no ingredients,
            # which flush() discards for failing the >=2-ingredients check.
            mid_recipe = cur and cur['ingredient_groups'] and not cur['steps']
            if mid_recipe:
                sv = SERVES.search(txt)
                if sv and len(txt) < 90:
                    cur['servings_text'] = cur['servings_text'] or norm(sv.group(0))
                    cur['servings'] = cur['servings'] or qty_to_float(sv.group('val'))
                else:
                    cur['ingredient_groups'].append(
                        {'name': norm(txt).rstrip(':'), 'ingredients': []})
                continue
            flush()
            pending_yield = False
            if SKIP_TITLE.match(txt):
                cur = None
                continue
            cur = {'title': txt, 'source_book': book_title, 'source_file': doc,
                   'servings_text': None, 'servings': None, 'time_text': None,
                   'diet_tags': [], 'headnote': None,
                   'ingredient_groups': [], 'steps': [], 'notes': [],
                   'nutrition': None, 'warnings': []}
            continue
        if cur is None:
            continue

        if YIELD_LABEL.match(txt):
            pending_yield = True
            continue

        # metadata lines
        sv = SERVES.search(txt)
        if sv and len(txt) < 90:
            cur['servings_text'] = cur['servings_text'] or norm(sv.group(0))
            cur['servings'] = cur['servings'] or qty_to_float(sv.group('val'))
        if len(txt) < 90 and TIME.search(txt) and not cur['steps']:
            cur['time_text'] = cur['time_text'] or norm(TIME.search(txt).group(0))
        for d in DIET.findall(txt if len(txt) < 120 else ''):
            t = d.lower().replace(' ', '-')
            if t not in cur['diet_tags']:
                cur['diet_tags'].append(t)
        if NUTRI.search(txt) and len(txt) < 400:
            cur['nutrition'] = txt
            continue

        # bare number right after a SERVES label ("SERVES" / "2")
        if cur['servings'] is None and re.fullmatch(r'[\d' + VUL + r'][\d\s' + VUL + r'./-]*', txt) \
                and not cur['ingredient_groups']:
            cur['servings'] = qty_to_float(txt)
            cur['servings_text'] = txt
            continue

        if pending_yield and len(txt) < 40:
            cur['servings_text'], cur['servings'] = txt, qty_to_float(txt)
            pending_yield = False
            continue

        looks_ing = (key in ing_cls) or (
            not ing_cls and len(txt) <= 110 and QTY_START.match(txt) and QTY_LINE.match(txt))
        looks_step = (key in step_cls) or (not step_cls and len(txt) > 115)

        if GROUP_HDR.match(txt) and len(txt) < 70:
            cur['ingredient_groups'].append({'name': norm(txt).rstrip(':'), 'ingredients': []})
            continue

        if looks_ing and not cur['steps']:
            if not cur['ingredient_groups']:
                cur['ingredient_groups'].append({'name': None, 'ingredients': []})
            cur['ingredient_groups'][-1]['ingredients'].append(parse_ingredient(txt))
            continue

        if looks_step:
            if not cur['ingredient_groups']:
                # nothing but prose so far -> this is headnote, never a step.
                # (getting this wrong locks out every ingredient that follows)
                cur['headnote'] = f"{cur['headnote']} {txt}".strip() if cur['headnote'] else txt
            else:
                cur['steps'].append(txt)
            continue

        if cur['steps'] and len(txt) < 400:
            cur['notes'].append(txt)

    flush()
    return recipes


def score(r):
    """Confidence + human-readable warnings."""
    w = []
    ings = [i for g in r['ingredient_groups'] for i in g['ingredients']]
    n = len(ings)
    if n < 3:
        w.append('very few ingredients')
    if not r['steps']:
        w.append('no method steps found')
    unparsed = sum(1 for i in ings if i['quantity'] is None and not i['optional'])
    if n and unparsed / n > 0.4:
        w.append(f'{unparsed}/{n} ingredients have no parsed quantity')
    if r['servings'] is None:
        w.append('no servings found')
    if sum(len(s) for s in r['steps']) < 120 and r['steps']:
        w.append('method looks truncated')
    conf = 1.0 - 0.22 * len(w)
    return round(max(conf, 0.0), 2), w


def run(paths):
    all_recipes, report = [], []
    for p in paths:
        z = zipfile.ZipFile(p)
        meta, docs = book_meta(z)
        btitle = norm(meta.get('title') or p.split('/')[-1])
        roles = infer_roles(z, docs)
        got = []
        for d in docs:
            try:
                bl = blocks(BeautifulSoup(z.read(d), 'lxml'))
            except KeyError:
                continue
            got += parse_doc(btitle, d, bl, roles)
        for r in got:
            r['authors'] = meta.get('authors')
            # book + source_file + title: title alone collides when a book misreads
            # a diet-tag badge as the title (many different dishes all titled
            # "Gluten-Free"); source_file alone collides when a book legitimately
            # packs multiple recipes into one content file, or splits one recipe
            # into fragments. Combined, a collision needs the same book to repeat
            # both the exact file and the exact title, which doesn't happen.
            r['id'] = hashlib.sha1(
                f"{btitle}|{r['source_file']}|{r['title']}".encode()).hexdigest()[:12]
            r['confidence'], r['warnings'] = score(r)
        all_recipes += got
        report.append({'file': p.split('/')[-1], 'book': btitle, 'docs': len(docs),
                       'recipes': len(got),
                       'ingredient_classes': sorted(roles['ingredient']),
                       'step_classes': sorted(roles['step']),
                       'mean_conf': round(sum(x['confidence'] for x in got) / max(len(got), 1), 3),
                       'clean': sum(1 for x in got if not x['warnings'])})
    return all_recipes, report


if __name__ == '__main__':
    recipes, rep = run(sys.argv[1:])
    json.dump(recipes, open(ROOT / 'recipes.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    json.dump(rep, open(ROOT / 'report.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    for r in rep:
        print(f"{r['book'][:44]:46s} recipes={r['recipes']:4d}  clean={r['clean']:4d}  "
              f"conf={r['mean_conf']:.2f}  ing={r['ingredient_classes']}")
    print(f'\nTOTAL {len(recipes)} recipes -> recipes.json')
