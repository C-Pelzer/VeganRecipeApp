"""Repairs ingredient sectioning damage left by extract.py, in place of a re-extract.

WHY THIS EXISTS
---------------
extract.py mis-read the ingredient sections in several Page Street books, three
ways at once. Reading the actual EPUB markup (which is available -- see CLAUDE.md)
showed what the output alone could not:

  - Its GROUP_HDR pattern only knew wordings like "for the ...", "topping" and
    "filling", so a bare header ("SUGAR COOKIE LAYER") matched nothing and was
    discarded -- collapsing every section into one unnamed group.
  - The *method* headings further down the same recipe ("FOR THE SUGAR COOKIE
    LAYER") did match, and GROUP_HDR had no guard against firing once steps had
    begun. Those were the empty sections that rendered as blank cards.
  - Where a book styles its headers with the same class as its steps (Delicious
    AF Vegan's p.nonindent1), the header was appended to `steps`. That made
    cur['steps'] non-empty, so every ingredient after it failed the
    `looks_ing and not cur['steps']` guard and fell into `notes` -- which is how
    ~1,000 real ingredient lines stopped reaching the ingredient list, the
    shopping list and the tagger. "My Famous Vegan Cinnamon Rolls" shipped with
    no cinnamon, no sugar and no frosting.

extract.py now fixes all three at the source by identifying a header from what
*follows* it rather than from its wording or class. This pass is what remains
afterwards: a residual cleanup for recipes the extractor still can't segment,
mostly ones packing two variants into a single document ("...-2 Ways", where the
shared filling and frosting attach to whichever variant the splitter ended on).

It reuses extract.parse_ingredient and apply_metric.run rather than
reimplementing them, so a recovered ingredient gets exactly the fields -- grams
included -- it would have had if the extractor had seen it in the right place.

    recipes_metric.json  ->  repair_sections.py  ->  recipes_repaired.json
                                                     section-repair-report.txt

build-bundle.mjs prefers recipes_repaired.json when it exists. recipes_metric.json
is never written to.

    python repair_sections.py --dry-run     # report only, writes no JSON
    python repair_sections.py

WHAT IT STILL FIXES (counts as of the 2026-08-19 extractor fix; 130 recipes)
---------------------------------------------------------------------------
1. Ingredient lines, and the section headers between them, stranded in `notes`:
   54 sections' worth. Parsed back and attached to the section they belong to.
2. Section headers that landed as ingredient *rows* ("Chocolate Layer", with no
   quantity) -- 48 of them. The boundary is exact, so the group splits there.
3. Empty sections whose "name" was never a header: 9 yield lines ("YIELDS ABOUT
   1 PINT"), which the extractor's mid-recipe heading branch still creates
   because its SERVES check wants a digit right after the verb.
4. Whatever is left with no ingredients gets dropped, named or not -- 37 groups.
   A flat list is honest; a blank card is not.

infer_boundaries() also survives, for recipes where the ingredients merged into
one unnamed group so only the boundaries were lost. It now fires on almost
nothing, because the extractor recovers the real headers instead of guessing --
and where the two disagreed, the book proved the extractor right (it splits
ENCHILADA Roja 4/13 and LOBSTER MUSHROOM Bisque 3/12; inference wanted 15/2 and
10/5, and its confidence gate rejected both). Kept for the residue, not relied on.
"""

import json
import re
import sys
from pathlib import Path

# extract.py imports bs4/lxml at module scope for the HTML side we don't use
# here; requirements.txt already pins both.
import extract
import apply_metric

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'recipes_metric.json'
OUT = ROOT / 'recipes_repaired.json'
REPORT = ROOT / 'section-repair-report.txt'

# Section vocabulary, deliberately wider than extract.GROUP_HDR: that only ever
# had to fire on lines the extractor met in ingredient position, whereas here a
# header can reach us as a note or as a quantity-less ingredient row, so
# "Chocolate Layer" and "VEGAN CREAM CHEESE FROSTING" have to match too.
#
# Split by how much a word proves on its own. A STRONG noun
# names a recipe component and nothing else, so "Chocolate Layer" or "FILLING"
# is a header wherever it turns up. A SOFT noun doubles as a real ingredient --
# "Vegan whipped cream", "Drizzle of olive oil", "1 cup marinara sauce" -- so it
# only reads as a header with corroboration (ALL CAPS, or a "for the" prefix).
# Getting this wrong in the loose direction cost 3,576 false splits on a first
# pass: every "Lime wedges" and "Sesame seeds" garnish row became a section.
#
# "dough" and "shells" are deliberately absent: "Pizza dough", "Taco shells" and
# "Tart shells" are things you buy, and every real dough *section* in the corpus
# announces itself in caps or with a "for the" prefix, which are checked anyway.
STRONG = (r'layers?|crusts?|bases?|batter|filling|toppings?|frosting|icing|'
          r'ganache|streusel|crumble|assembly|roux|marinade|meringue')
SOFT = (r'sauces?|dressing|glaze|garnish(?:es)?|serving|cream|custard|syrup|'
        r'compote|caramel|mixture|seasoning|coating|swirl|drizzle|sprinkles?|'
        r'dip|spread|salsa|pesto|puree|purée|paste|crumbs?|broth|jam|curd')

# "For the ...", "To serve", "To assemble" -- an explicit component preamble.
SECTION_PREFIX = re.compile(r'^\s*(?:for|to)\s+(?:the\b|a\b|serve\b|assemble\b|finish\b)', re.I)
ENDS_STRONG = re.compile(r'\b(' + STRONG + r')\s*:?\s*$', re.I)
ENDS_SOFT = re.compile(r'\b(?:' + SOFT + r')\s*:?\s*$', re.I)

# "Sea salt, for topping", "Cornmeal, for crust", "Fresh berries for topping" --
# an ingredient named with the job it does, not a heading for the rows below it.
# A bare "For topping" has nothing before the "for" and is a heading.
PURPOSE_SUFFIX = re.compile(r'\w[\s,]+for\s+\w', re.I)

# An imperative cooking verb in something sentence-length makes it an
# instruction, not a header -- "Garnish with pecans and coconut sugar before
# serving." would otherwise read as a "garnish" section.
VERB_RE = re.compile(
    r'\b(?:combine|mix|stir|add|place|whisk|bake|pour|heat|cook|blend|scatter|'
    r'preheat|transfer|spread|remove|drizzle|sprinkle|process|beat|fold|chill|'
    r'freeze|refrigerate|line|grease|spoon|serve|enjoy|garnish|repeat|replace|'
    r'divide|arrange|dollop|brush|toss|reserve|discard|cover|simmer|boil|'
    r'roast|sauté|saute|drain|rinse|slice|dice|chop|blitz|pulse)\b', re.I)

# Ingredient lines mostly open with a quantity, but a real minority don't and
# they are exactly the ones a quantity-only test would strand a second time
# ("Pinch of cloves", "Salt and pepper, to taste", "Nonstick spray, for the pan",
# "Zest and juice of 1 lemon", "Freshly ground black pepper").
QTY_START_RE = re.compile(
    r'^\s*(?:[\d' + extract.VUL + r']|a\s+(?:pinch|dash|handful|few)\b|'
    r'(?:tiny\s+)?pinch\b|dash\b|handful\b|salt\b|sea\s+salt\b|pepper\b|'
    r'freshly\s+ground\b|nonstick\b|non-stick\b|cooking\s+spray\b|'
    r'zest\b|juice\b|water\b|ice\b|oil\b)', re.I)

YIELD_RE = re.compile(r'^\s*(?:yields?|makes|serves)\b', re.I)

# Words too generic to tie an ingredient or a step to one particular section --
# every layer is a "layer", so "layer" identifies none of them.
GENERIC_RAW = set(re.findall(r"[a-z']{3,}", STRONG + '|' + SOFT)) | {
    'for', 'the', 'and', 'with', 'optional', 'from', 'your', 'into', 'onto',
    'plus', 'more', 'about', 'each', 'other', 'some', 'this', 'that', 'them',
    'taste', 'needed', 'fresh', 'chopped', 'ground', 'vegan', 'large', 'small',
}


def words(text):
    """Word set with naive singular stems folded in.

    "FOR THE BREADCRUMB TOPPING" has to find "the breadcrumbs" in a step, and an
    exact-token match doesn't: missing that one anchor put the entire method
    after step 0 inside the topping and left the cheese sauce with 2 of 20
    ingredients.
    """
    out = set()
    for word in re.findall(r"[a-z][a-z']{2,}", (text or '').lower()):
        out.add(word)
        if word.endswith('ies'):
            out.add(word[:-3] + 'y')
        elif word.endswith('es'):
            out.add(word[:-2])
        if word.endswith('s'):
            out.add(word[:-1])
    return out


GENERIC = {stem for word in GENERIC_RAW for stem in words(word)} | GENERIC_RAW


def distinctive(name):
    """The words in a section name that could identify one of its ingredients."""
    return words(name) - GENERIC


def is_step_sentence(text):
    return bool(VERB_RE.search(text)) and (text.endswith(('.', '!')) or len(text.split()) > 9)


def looks_like_header(text, allow_soft=True):
    """Header-shaped in a context where an ingredient is the other possibility.

    ALL CAPS is decisive on its own: none of these books set ingredient lines in
    caps, but every one of them sets section labels that way.
    """
    text = text.strip()
    if not text or len(text) > 70 or len(text.split()) > 8 or text.endswith('.'):
        return False
    if VERB_RE.search(text) and not SECTION_PREFIX.match(text):
        return False
    if ENDS_STRONG.search(text) or SECTION_PREFIX.match(text):
        return True
    caps = text.isupper()
    if caps and not QTY_START_RE.match(text):
        return True
    return bool(allow_soft and caps and ENDS_SOFT.search(text))


def note_kind(text):
    """'ingredient' | 'header' | 'step' | 'yield' | 'prose' for one stranded note line.

    Ties break toward 'ingredient'. A garnish that lands in the ingredient list
    is correct; a garnish mistaken for a header is an ingredient lost twice over.
    """
    text = (text or '').strip()
    if not text:
        return 'prose'
    if YIELD_RE.match(text) and len(text) < 60:
        return 'yield'
    if is_step_sentence(text):
        return 'step'
    # The length cap only exists to keep prose out; it has to clear the longest
    # real ingredient line in the corpus, which is 152 characters of flour plus a
    # parenthetical brand recommendation.
    if len(text) <= 200 and QTY_START_RE.match(text) and not text.endswith('.'):
        return 'ingredient'
    if looks_like_header(text):
        return 'header'
    # Short, verb-less, no quantity: a quantity-less ingredient row, which these
    # books use freely for garnishes and "to taste" items.
    if len(text) <= 90 and not text.endswith('.') and len(text.split()) <= 12:
        return 'ingredient'
    return 'prose'


def is_header_row(ing):
    """True for an ingredient row that is really a section header (defect 3).

    Strictest of the three contexts, and biased hard against firing. A missed
    header leaves the odd quantity-less row the app already renders; a false one
    turns a real ingredient into a heading and loses it. So on top of demanding
    an unambiguous STRONG noun at the end, the noun itself has to be capitalised
    the way a label is -- which is what separates "Soft Meringue Topping" (a
    section) from "Coconut whipped topping" (a tub of Cool Whip).
    """
    if ing['quantity'] is not None or ing['unit'] or ing.get('grams'):
        return False
    raw = (ing['raw'] or '').strip()
    if len(raw.split()) > 4 or raw.endswith('.') or VERB_RE.search(raw):
        return False
    if PURPOSE_SUFFIX.search(raw) and not SECTION_PREFIX.match(raw):
        return False
    if SECTION_PREFIX.match(raw):
        return True
    match = ENDS_STRONG.search(raw)
    return bool(match) and match.group(1)[:1].isupper()


def title_key(text):
    return re.sub(r'[^a-z0-9]', '', (text or '').lower())


def parse_lines(lines):
    return [extract.parse_ingredient(line) for line in lines]


def same_section(a, b):
    """Fuzzy name match, so 'FILLING' fills 'For the Filling'."""
    wa, wb = distinctive(a), distinctive(b)
    if wa and wa == wb:
        return True
    core = lambda s: re.sub(r'[^a-z]', '', re.sub(r'^\s*(?:for|to)\s+(?:the\s+)?', '',
                                                  (s or '').lower()))
    return bool(core(a)) and core(a) == core(b)


# --------------------------------------------------------------------------
# defect 2 -- an empty section whose name was never a header
# --------------------------------------------------------------------------

def reclassify_empty_sections(r, log):
    kept = []
    for group in r['ingredient_groups']:
        if group['ingredients'] or not group['name']:
            kept.append(group)
            continue
        name = group['name'].strip()
        kind = note_kind(name)
        if kind == 'yield':
            # A yield line ("YIELDS ABOUT 1 PINT [480 ML]") only ever reads as a
            # section because GROUP_HDR ran before the SERVES check.
            if not r['servings_text']:
                r['servings_text'] = name
                sv = extract.SERVES.search(name)
                if sv and r['servings'] is None:
                    r['servings'] = extract.qty_to_float(sv.group('val'))
            log('yield line recovered from section name', name)
            continue
        if kind == 'step':
            # Serving/garnish closers, which is why the end of the method is the
            # right place for them. The one exception in the corpus ("For the
            # dressing, in a bowl, combine all of the dressing ingredients.")
            # reads fine last too -- no position survived extraction to restore.
            if name not in r['steps']:
                r['steps'].append(name)
            log('step sentence recovered from section name', name)
            continue
        if ':' in name and note_kind(name.split(':', 1)[1]) != 'header':
            # "Garnishes: Fresh herbs, Aleppo pepper flakes, lemon wedges" -- one
            # header plus its ingredients, comma-separated on a single line.
            label, rest = name.split(':', 1)
            items = [p.strip() for p in rest.split(',') if p.strip()]
            if items:
                kept.append({'name': label.strip(), 'ingredients': parse_lines(items)})
                log('inline ingredient list split out of section name', name)
                continue
        kept.append(group)
    r['ingredient_groups'] = kept


# --------------------------------------------------------------------------
# defect 1 -- ingredients stranded in notes
# --------------------------------------------------------------------------

def strip_stranded_notes(r):
    """Pull the stranded ingredient block(s) out of `notes`.

    Returns [(section_name_or_None, [raw ingredient lines]), ...] in document
    order, and leaves `notes` holding only genuine prose.
    """
    kinds = [note_kind(n) for n in r["notes"]]
    runs, start = [], None
    for i, kind in enumerate(kinds + ['prose']):
        if kind in ('ingredient', 'header'):
            if start is None:
                start = i
        else:
            # A run only counts as a stranded ingredient block if at least two of
            # its lines carry a real measurement. Ingredient-*shaped* is far too
            # weak a test on its own, because two other things in these books
            # look identical to it: a sidebar list of suggested vegetables
            # ("Carrots / Parsnips / Celeriac ..." -- 32 unquantified nouns that
            # would land unpriced on the shopping list) and a list of method
            # headings ("COCINANDO / Make the Chopped Cheese / Assemble the
            # Sandwich"). A genuine stranded section always brings quantities.
            # Unquantified lines *inside* a qualifying run are still kept, since
            # "Lemon zest, to taste" belongs with the section it sits in.
            if start is not None and sum(
                    1 for n in r['notes'][start:i] if QTY_START_RE.match(n.strip())) >= 2:
                runs.append((start, i))
            start = None

    if not runs:
        return []
    consumed = {i for a, b in runs for i in range(a, b)}
    blocks = []
    for a, b in runs:
        current = None
        for i in range(a, b):
            if kinds[i] == 'header':
                current = (r['notes'][i].strip().rstrip(':'), [])
                blocks.append(current)
            else:
                if current is None:
                    current = (None, [])
                    blocks.append(current)
                current[1].append(r['notes'][i])
    r['notes'] = [n for i, n in enumerate(r['notes']) if i not in consumed]
    return [(name, lines) for name, lines in blocks if lines]


def attach_recovered(r, blocks, log):
    groups = r['ingredient_groups']
    empties = [g for g in groups if g['name'] and not g['ingredients']]
    for name, lines in blocks:
        ingredients = parse_lines(lines)
        target = None
        if name:
            target = next((g for g in empties if same_section(g['name'], name)), None)
        if target is None:
            # An unnamed block is the tail of the section already captured as
            # empty, so it fills the first one still waiting.
            target = next((g for g in empties if not g['ingredients']), None)
            if target is not None and name and not same_section(target['name'], name):
                target = None
        if target is not None:
            target['ingredients'] = ingredients
            log('ingredients recovered into an empty section',
                f"{len(ingredients)} -> {target['name'] or '(unnamed)'}")
        elif not name and groups and not groups[-1]['name']:
            # Nothing named either side of the join, so this is the same list
            # continued. Appending a second unnamed group instead would render as
            # two headerless cards split at an invisible boundary.
            groups[-1]['ingredients'].extend(ingredients)
            log('ingredients recovered into the main ingredient list',
                str(len(ingredients)))
        else:
            groups.append({'name': name, 'ingredients': ingredients})
            log('ingredients recovered as a section extract.py never created',
                f"{len(ingredients)} -> {name or '(unnamed)'}")


# --------------------------------------------------------------------------
# defect 3 -- a header that landed as an ingredient row
# --------------------------------------------------------------------------

def split_header_rows(r, log, book_titles):
    out = []
    for group in r['ingredient_groups']:
        rows = group['ingredients']
        # Two ways a header-shaped row turns out to be a cross-reference to
        # another recipe rather than a heading, in which case promoting it
        # deletes an ingredient instead of restoring a boundary:
        #   - nothing follows it in the group, so it heads nothing ("Flaky Pie
        #     Crust" as the last row of a quiche);
        #   - it is verbatim another recipe's title in the same book, which is
        #     how these books cite a component ("Savory Sweet Potato-Peanut
        #     Crumble", listed under "For Serving" beside two other dishes).
        #     build-bundle.mjs reads the same signal to flag sub-recipes.
        cuts = [i for i, ing in enumerate(rows)
                if is_header_row(ing)
                and title_key(ing['raw']) not in book_titles
                and any(not is_header_row(x) for x in rows[i + 1:])]
        if not cuts:
            out.append(group)
            continue
        name, bucket = group['name'], []
        for i, ing in enumerate(rows):
            if i in cuts:
                if bucket:
                    out.append({'name': name, 'ingredients': bucket})
                name, bucket = ing['raw'].strip().rstrip(':'), []
                log('section header split out of an ingredient row', name)
            else:
                bucket.append(ing)
        out.append({'name': name, 'ingredients': bucket})
    r['ingredient_groups'] = out


# --------------------------------------------------------------------------
# defect 4 -- boundaries lost, ingredients merged into one unnamed group
# --------------------------------------------------------------------------

def step_ranges(steps, names):
    """Which steps belong to which section, by matching section names in the method.

    "For the Topping: In a medium-sized bowl..." and "prepare the frosting: ..."
    both anchor a section to a step. Sections with no anchor inherit the span
    between their anchored neighbours, so a run of unanchored sections still
    divides the method in order.

    Returns (ranges, found), where `found[j]` says whether section j's anchor was
    actually located in the method rather than invented by interpolation. An
    invented anchor still produces a plausible-looking, well-scoring partition
    that happens to be wrong -- the method for LOBSTER MUSHROOM Bisque never
    says "bisque", so its boundary was guessed at the midpoint and the cashew
    cream took 10 of 15 ingredients -- so the caller gates on this.
    """
    anchors = [None] * len(names)
    for j, name in enumerate(names):
        keys = distinctive(name)
        if not keys:
            continue
        for s, step in enumerate(steps):
            if keys & words(step[:120]):
                anchors[j] = s
                break
    # Force monotonicity: a later section cannot start before an earlier one.
    best = 0
    for j, a in enumerate(anchors):
        if a is None or a < best:
            anchors[j] = None
        else:
            best = a
    found = [a is not None for a in anchors]
    anchors[0] = 0
    # Interpolate the gaps evenly between known anchors.
    known = [(j, a) for j, a in enumerate(anchors) if a is not None]
    for (j0, a0), (j1, a1) in zip(known, known[1:]):
        for j in range(j0 + 1, j1):
            anchors[j] = a0 + round((a1 - a0) * (j - j0) / (j1 - j0))
    # Unanchored sections *after* the last anchored one split what's left of the
    # method evenly. Giving them one step each instead would hand every
    # remaining step to the final section and starve the rest.
    j_last, a_last = known[-1]
    trailing = len(names) - 1 - j_last
    if trailing:
        span = max(len(steps) - a_last, trailing + 1)
        for i, j in enumerate(range(j_last + 1, len(names)), start=1):
            anchors[j] = min(len(steps) - 1,
                             max(a_last + i, a_last + round(span * i / (trailing + 1))))
    ranges = [(anchors[j], anchors[j + 1] if j + 1 < len(names) else len(steps))
              for j in range(len(names))]
    return ranges, found


def infer_boundaries(r, log):
    """Split one merged group across its orphaned section names.

    Only runs on the unambiguous shape -- a single unnamed populated group
    followed by nothing but empty named ones -- because that is the only layout
    where every ingredient provably belongs to one of the orphaned sections.
    Where a named group is populated *and* empty ones follow, the ingredients
    are already claimed and there is nothing to redistribute.
    """
    groups = r['ingredient_groups']
    if len(groups) < 2 or groups[0]['name'] or not groups[0]['ingredients']:
        return False
    if any(g['ingredients'] or not g['name'] for g in groups[1:]):
        return False
    names = [g['name'] for g in groups[1:]]
    ings = groups[0]['ingredients']
    k, n = len(names), len(ings)
    if k < 2 or n < k or not r['steps']:
        return False

    ranges, anchor_found = step_ranges(r['steps'], names)
    # Which step first mentions each ingredient -- the strongest available
    # signal, since a step that reaches for the chocolate is making the
    # chocolate layer.
    first_step = []
    for ing in ings:
        keys = words(ing['item']) - GENERIC
        hit = next((s for s, step in enumerate(r['steps']) if keys & words(step)), None) \
            if keys else None
        first_step.append(hit)

    def score(i, j):
        total = 0.0
        keys = distinctive(names[j])
        if keys & (words(ings[i]['item']) - GENERIC):
            total += 3.0          # the section names this very ingredient
        lo, hi = ranges[j]
        if first_step[i] is not None:
            if lo <= first_step[i] < max(hi, lo + 1):
                total += 2.0      # used by a step belonging to this section
            else:
                total -= 1.0
        return total

    # Best contiguous, in-order partition of n ingredients into k sections.
    # Book order is preserved, so the only unknowns are the k-1 cut points.
    NEG = float('-inf')
    dp = [[NEG] * (n + 1) for _ in range(k + 1)]
    back = [[0] * (n + 1) for _ in range(k + 1)]
    dp[0][0] = 0.0
    for j in range(1, k + 1):
        for i in range(j, n - (k - j) + 1):
            for t in range(j - 1, i):
                if dp[j - 1][t] == NEG:
                    continue
                cand = dp[j - 1][t] + sum(score(x, j - 1) for x in range(t, i))
                if cand > dp[j][i]:
                    dp[j][i], back[j][i] = cand, t
    if dp[k][n] == NEG:
        return False

    cuts, i = [], n
    for j in range(k, 0, -1):
        cuts.append((back[j][i], i))
        i = back[j][i]
    cuts.reverse()

    # Confidence gate. A wrong grouping in a recipe you are cooking from is
    # worse than no grouping, so anything short of a well-supported split falls
    # back to the flat list.
    evidence = sum(1 for x in range(n) if first_step[x] is not None
                   or any(distinctive(nm) & words(ings[x]['item']) for nm in names))
    if evidence < max(3, n * 0.5):
        log('boundaries left flat (too few ingredients traceable to a step)',
            f'{evidence}/{n}')
        return False
    # A starved section is the signature of a section the method never names
    # (Enchilada Roja's filling steps never say "enchiladas", so the salsa
    # absorbed 15 of 17 ingredients). Real sections in these books are not that
    # lopsided, so treat it as a failed inference rather than a 1-item section.
    floor = max(2, n / (4 * k))
    starved = [(names[j], b - a) for j, (a, b) in enumerate(cuts) if b - a < floor]
    if starved:
        log('boundaries left flat (a section came out implausibly small)',
            ' | '.join(f'{nm}: {size}' for nm, size in starved))
        return False
    # Every section has to be tied to the recipe by something real: either the
    # method names it, or one of the ingredients it was given carries its name
    # ("FOR THE CASHEW CREAM" over "1 cup raw cashews"). Sections with neither
    # were placed by interpolation alone, and score density does not catch it --
    # LOBSTER MUSHROOM Bisque's wrong split scored higher than most right ones.
    unsupported = [names[j] for j, (a, b) in enumerate(cuts)
                   if not anchor_found[j]
                   and not any(distinctive(names[j]) & (words(ings[x]['item']) - GENERIC)
                               for x in range(a, b))]
    if unsupported:
        log('boundaries left flat (a section is named nowhere in the recipe)',
            ' | '.join(unsupported))
        return False
    if any(sum(score(x, j) for x in range(a, b)) <= 0 for j, (a, b) in enumerate(cuts)):
        log('boundaries left flat (a section drew no positive evidence)',
            ' | '.join(names))
        return False

    r['ingredient_groups'] = [
        {'name': names[j], 'ingredients': ings[a:b]} for j, (a, b) in enumerate(cuts)
    ]
    log('boundaries inferred from the method',
        ' | '.join(f'{names[j]}: {b - a}' for j, (a, b) in enumerate(cuts)))
    return True


# --------------------------------------------------------------------------

def repair(recipes, density):
    log_by_recipe, counts = [], {}
    touched = []
    titles_by_book = {}
    for r in recipes:
        titles_by_book.setdefault(r['source_book'], set()).add(title_key(r['title']))
    for r in recipes:
        entries = []

        def log(what, detail=''):
            entries.append((what, detail))
            counts[what] = counts.get(what, 0) + 1

        before = sum(len(g['ingredients']) for g in r['ingredient_groups'])
        reclassify_empty_sections(r, log)
        blocks = strip_stranded_notes(r)
        if blocks:
            attach_recovered(r, blocks, log)
        split_header_rows(r, log, titles_by_book[r['source_book']])
        infer_boundaries(r, log)

        # Unnamed empties count too. extract.py's rescue_yield() pulls a yield
        # line back out of the first group, which empties it outright when that
        # was its only row -- 18 recipes in Great Vegan Meals for the Carnivorous
        # Family arrive that way. An unnamed empty group renders the same blank
        # card a named one does, so the guarantee here is "no empty sections",
        # not "no empty *named* sections".
        dropped = [g['name'] for g in r['ingredient_groups'] if not g['ingredients']]
        if dropped:
            r['ingredient_groups'] = [g for g in r['ingredient_groups'] if g['ingredients']]
            for name in dropped:
                log('empty section dropped (no ingredients to recover)',
                    name or '(unnamed)')
        # A lone unnamed group is the flat list the UI already renders headerless.
        if len(r['ingredient_groups']) == 1 and r['ingredient_groups'][0]['name'] \
                and before != sum(len(g['ingredients']) for g in r['ingredient_groups']):
            pass

        if entries:
            after = sum(len(g['ingredients']) for g in r['ingredient_groups'])
            log_by_recipe.append((r, entries, before, after))
            touched.append(r)

    # Recovered ingredients arrive with only what parse_ingredient() can see;
    # re-running the metric pass gives them the same grams/weighable/display
    # fields every other ingredient in the bundle already has.
    if touched:
        apply_metric.run(touched, density)
    for r in touched:
        ings = [i for g in r['ingredient_groups'] for i in g['ingredients']]
        r['ingredient_count'] = len(ings)
        r['weighable_count'] = sum(1 for i in ings if i['weighable'])
        r['total_grams'] = round(sum(i['grams'] or 0 for i in ings), 1)
        r['confidence'], r['warnings'] = extract.score(r)
    return log_by_recipe, counts


def write_report(log_by_recipe, counts, total):
    lines = [f'Section repair over {total} recipes -- {len(log_by_recipe)} changed', '']
    lines.append('SUMMARY')
    for what, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        lines.append(f'  {count:5d}  {what}')
    lines += ['', 'PER RECIPE', '']
    for r, entries, before, after in log_by_recipe:
        delta = f'  ingredients {before} -> {after}' if before != after else ''
        lines.append(f"{r['title']}  [{r['source_book']}]{delta}")
        for what, detail in entries:
            lines.append(f'    {what}' + (f': {detail}' if detail else ''))
        lines.append('    sections now: ' + ' | '.join(
            (g['name'] or '(unnamed)') + f" ({len(g['ingredients'])})"
            for g in r['ingredient_groups']))
        lines.append('')
    REPORT.write_text('\n'.join(lines), encoding='utf-8')


def main():
    dry_run = '--dry-run' in sys.argv
    recipes = json.load(open(SRC, encoding='utf-8'))
    density = apply_metric.Densities(ROOT / 'density_table.json')
    log_by_recipe, counts = repair(recipes, density)
    write_report(log_by_recipe, counts, len(recipes))

    print(f'{len(log_by_recipe)} of {len(recipes)} recipes changed')
    for what, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f'  {count:5d}  {what}')
    empty_left = sum(1 for r in recipes for g in r['ingredient_groups']
                     if not g['ingredients'])
    print(f'  empty sections remaining: {empty_left}')
    print(f'-> {REPORT.name}')
    if dry_run:
        print('--dry-run: no JSON written')
        return
    json.dump(recipes, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(f'-> {OUT.name}')


if __name__ == '__main__':
    main()
