# Metric & weight conversion — review

9,586 ingredients across 865 recipes. **7,429 now carry a gram figure (77%)**, of which 5,520 are weighable on a 1 g scale.

## Where each gram figure came from

| Source | Count | Share |
|---|---|---|
| book | 3,277 | 34.2% |
| density lookup | 3,137 | 32.7% |
| count-based | 1,953 | 20.4% |
| approx (count item) | 588 | 6.1% |
| book-package | 250 | 2.6% |
| no-density-known | 204 | 2.1% |
| assumed-water-density | 169 | 1.8% |
| unit-conversion | 8 | 0.1% |

Confidence of converted figures: **5,350 high**, 588 medium, 1,491 low.

## How it decides

1. **Publisher figure wins.** `1¼ cups (150 g) flour` → 150 g, exactly as the author tested it.
2. **Package weights** parsed from square brackets: `2 (14-oz [414-g]) cans` → 828 g.
3. **Density lookup** for volumes with no gram figure, using the table mined from the library.
4. **Below 5 g the volume stays primary** — a 1 g kitchen scale cannot resolve ¼ tsp of baking soda (1.2 g), so those still read as spoons. The gram value is stored but not displayed.
5. **Count items stay counts** — `2 limes`, `4 cloves garlic`. Approximate weights are attached for bulk produce so shopping lists can total, flagged `approx`.

## Highest-confidence densities

| Ingredient | g per cup | Observations | Spread | Source |
|---|---|---|---|---|
| all-purpose flour | 125 | 78 | 43% | curated-reference |
| melted coconut oil | 218.6 | 50 | 0% | curated-density (coconut oil) |
| nutritional yeast | 80.0 | 48 | 8% | cookbook-derived |
| baking powder | 192 | 46 | 38% | curated-reference |
| unsweetened almond milk | 239.0 | 33 | 0% | curated-density (almond milk) |
| rolled oats | 80.0 | 32 | 13% | cookbook-derived |
| cacao powder | 85 | 30 | 44% | curated-reference |
| fresh lemon juice | 243.7 | 27 | 0% | curated-density (lemon juice) |
| ground flaxseed | 112 | 27 | 48% | curated-reference |
| pitted dates | 170.0 | 25 | 6% | cookbook-derived |
| sugar | 192.0 | 22 | 8% | cookbook-derived |
| toasted sesame oil | 217.9 | 22 | 0% | curated-density (sesame oil) |
| brown sugar | 213 | 20 | 44% | curated-reference |
| whole wheat flour | 129.0 | 18 | 9% | cookbook-derived |
| almond | 170.0 | 17 | 6% | cookbook-derived |
| chia seeds | 160.0 | 17 | 1% | cookbook-derived |
| walnut | 120.0 | 14 | 8% | cookbook-derived |
| warm water | 236.6 | 14 | 0% | curated-density (water) |

## Sample recipes, converted

### CAULIFLOWER RICE AND BLACK BEANS with Kale
*The Ultimate Vegan Cookbook* · serves 4.0 · 1,069 g total

| As written | Weighed | Source | Confidence |
|---|---|---|---|
| 1 tbsp (15 ml) olive oil (or sauté with broth for oil-free) | **14 g** | density:olive oil | high |
| 1/2 cup (75 g) minced onion | **75 g** | book | high |
| 2 cloves garlic, minced (about 14 g) | — | count-based |  |
| 1 tsp ground cumin | 2.5 g (spoon it) | density:ground cumin | low |
| 1/2 tsp chili powder | 1.2 g (spoon it) | density:chili powder | medium |
| 1/2 tsp smoked paprika | 1.2 g (spoon it) | density:smoked paprika | medium |
| 1/8–1/2 tsp cayenne pepper (optional) | 2.5 g (spoon it) | density:cayenne pepper | medium |
| 1/4 cup (60 ml) water | **60 g** | density:water | high |
| 1 (15 1/2-oz [439-g]) can black beans, drained and rinsed (or 1  | **439 g** | book-package | high |
| 1 (12-oz [340-g]) bag riced cauliflower and sweet potato (I use  | **340 g** | book-package | high |
| 2 cups (134 g) chopped kale | **134 g** | book | high |
| Salt and pepper, to taste | — | count-based |  |

### Cherry BERRY QUINOA BREAKFAST BOWL
*The Ultimate Vegan Cookbook* · serves 4.0 · 1,485 g total

| As written | Weighed | Source | Confidence |
|---|---|---|---|
| 1 1/2 cups (360 ml) water | **360 g** | density:water | high |
| 1 cup (180 g) uncooked quinoa, rinsed | **180 g** | book | high |
| 1 cup (240 ml) almond milk | **242 g** | density:almond milk | high |
| 1 tbsp (15 ml) pure maple syrup | **20 g** | density:pure maple syrup | high |
| 1 tsp ground cinnamon | 2.7 g (spoon it) | density:ground cinnamon | low |
| Pinch of salt | — | count-based |  |
| 1 cup (170 g) almonds, soaked in water to cover, drained | **170 g** | book | high |
| 2 tbsp (20 g) hulled hemp seeds | **20 g** | book | high |
| 1 1/2 cups (300 g) fresh pitted and diced cherries | **300 g** | book | high |
| 1 cup (150 g) blueberries | **150 g** | book | high |
| 1/2 cup (40 g) unsweetened coconut flakes | **40 g** | book | high |

### MINESTRONE SOUP with Arugula
*The Ultimate Vegan Cookbook* · serves 4.0 · 2,248 g total

| As written | Weighed | Source | Confidence |
|---|---|---|---|
| 1 tsp olive oil | 4.5 g (spoon it) | density:olive oil | high |
| 1 yellow onion, chopped | ~150 g | approx-each:yellow onion | low |
| 2 cloves garlic, minced | — | count-based |  |
| 6 large tomatoes, quartered | — | count-based |  |
| 3/4 cup (83 g) green beans, sliced into bite-size pieces | **83 g** | book | high |
| 1 (15-oz [425-g]) can cannellini beans, rinsed and drained | **425 g** | book-package | high |
| 1/4 cup (10 g) chopped flat-leaf parsley | **10 g** | book | high |
| 6 cups (1420 ml) vegetable stock | **1420 g** | density:vegetable stock | high |
| 3/4 cup (75 g) orzo pasta (use gluten-free) | **75 g** | book | high |
| Salt and pepper, to taste | — | count-based |  |
| 2 cups (80 g) arugula, plus more for garnish | **80 g** | book | high |
| Vegan Parmesan, for garnish | — | count-based |  |

## Known limits

- **169 ingredients** fell back to water density (1.0 g/ml) — jams, purées and cream-style products that are actually denser. Add them to the curated file to fix.
- **204 volume measures** had no density match at all; mostly one-off branded or unusual items.
- **Flour is inherently imprecise.** The library's own figures range 120–150 g/cup depending on scoop method. Publisher figures are used where given, so each recipe stays self-consistent — but two books may weigh 'a cup of flour' differently.
- **Source typos survive.** One New Vegan Baking line reads `1/4 sea salt` with no unit; the book itself is missing the word. Flagged as unconverted rather than guessed.
