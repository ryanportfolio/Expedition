# Gameplay specification

Expedition follows the mechanics of one earlier god game, called "the reference game" in this repository, and of its expansion. This document says how that game plays, system by system, with the numbers the sources give, so that build sessions add features to one shared spec instead of guessing. It then compares Expedition as it stands on `main` (commit `c8882b0`) with the reference, lists the gaps, records the user's design decisions, and proposes an order to close the gaps.

It describes mechanics only. Expedition keeps its own names, art, interface layout and text, and its own art direction (grounded, muted, weathered). Nothing here is copied from a manual, wiki or guide; every line is a summary in our words.

## How to read this

Each mechanic carries a priority for a pixel-art browser version:

- **Core**: without it Expedition does not play like the reference. Build first.
- **Important**: a large part of the feel; build once the core stands.
- **Optional**: depth, content or polish; build if time allows, or skip.

Sources are cited in square brackets with these keys:

| Key | Source | Weight |
|---|---|---|
| MAN | The reference game's official manual, read in full as archive.org OCR text. The OCR skips its pages 11 to 13 (flags, influence, alignment, objectives, tribute). | First-hand |
| GUIDE | The official strategy guide, read in full as archive.org OCR text. Some numbers are garbled by the OCR. | First-hand |
| GSG | A games site's commercial strategy guide, archive copy, first ~780 lines read. | First-hand |
| WIKI | The two community wikis. Their pages are uneven, and several describe the first game in the series under the second game's heading. | Secondary |
| FAN | Player guides: one player's measured impressiveness formulas and strategy notes, two full walkthroughs, a cheat and data-file listing. | Secondary, often measured |
| VID | 14 gameplay videos with captions: a silent tutorial run, a 21-part good-path series, land-by-land runs, an evil-leaning series. Timestamps are kept in the research notes. | First-hand, play as observed |
| REV | Reviews (about 10 outlets) and the encyclopedia entries for the game and expansion. Several review pages were blocked and are known only from search summaries. | Secondary |

The research notes, the full URL list (about 150 pages and 14 videos) and the video transcripts live outside the repository, because nearly every URL contains the reference game's name and `npm run check:ip` bans it from committed files. [Decision 6](#decisions) says where they are kept.

"Unknown" means no readable source gives it; nothing here fills such a gap with a guess. Where sources disagree, the text says so, and the [disagreements](#where-sources-disagree) section collects them.

---

## 1. Shape of play

### Core loop

- **Core.** The player is a god with no avatar. Everything is done through a hand in the world: pick up, drop, throw, pour. Villagers worship and the worship pays for miracles. The player grows a town, trains a creature, and takes over the rival towns on each land. [MAN, GUIDE, REV]
- **Core.** City building is most of the playing time. Reviewers describe it as one part city sim, one part real-time strategy and one part pet sim. [REV]
- **Core.** A land runs like this: arrive at a prebuilt town centre with a few buildings, do tutorial and challenge scrolls for tribute, get food and wood (later ore) flowing, build homes and impressive buildings, then either pull rival villagers over by impressing them or raise platoons and capture town centres. Defend against the rival's armies and epic miracles while doing it. [FAN, VID]

### Lands

- **Important.** The campaign is a chain of separate islands ("lands"). The base game has 9: a tutorial island, a scripted escape from a burning homeland, then seven town lands against three rival peoples. The expansion adds 4 lands and an unlockable survival land with endless raider waves. [WIKI, REV]
- **Important.** Each land sets its rival towns with their own population, impressiveness and the impressiveness needed to win them. Examples: the first town land starts the player with 34 villagers next to four neutral towns of 15 to 20 people, which take 4,466 to 8,433 impressiveness to win; the next land has a capital of 125 people (40 of them soldiers) that takes 19,839; a later capital has 470 people and takes 34,741. [WIKI]
- **Optional.** Lands differ in scarcity: one has a bottomless ore mine, later ones are short of wood, one desert land is fertile only near water. [WIKI]
- **Optional.** No sandbox or skirmish mode exists in the base game; the expansion has no skirmish either. [WIKI, REV]

### Winning a land

- **Core.** Two routes, mixed freely. Impress: when the player's town is more impressive than a rival town's capture threshold, its villagers leave and walk to the player's town. Conquer: a platoon carried to the rival's town centre captures it over time. [GUIDE, WIKI, REV]
- **Core.** The two routes end differently. A town won by impressing is left empty and neutral; a town taken by force stays a separate town with its people and stock, which the player then runs or moves to the capital by hand. Capitals can be won either way, but impressing one takes a much higher score: one capital needed 19,839 against 4,466 to 8,433 for villages, and the guide calls the last land's capital very hard to impress and easy to take by force. The manual adds that taking all of a town's people as migrants never captures its town centre itself; only force does. [GUIDE, MAN, WIKI]
- **Important.** When every town on the land is held, the influence limit disappears and the hand works anywhere. A gold scroll then appears and moves the player to the next land on a click and a confirm. Land wins pay 100,000 to 120,000 tribute. [GUIDE, WIKI, VID]
- **Important.** The rival also attacks: small waves of about 20 soldiers early, catapults later, and epic miracles cast at the player's town from the sixth land on. [GSG, WIKI, VID]

### What carries between lands

- **Important.** Tribute, everything bought with it (building types, miracles, hand and creature upgrades) and the creature carry over. The town does not. Tribute carrying over is a strong inference from the guides, not a quoted rule. [GUIDE, WIKI]
- **Optional.** Tribute can buy imports for the next land: one extra man or woman (5,000, each further purchase about 10% dearer), or the best 100 soldiers, 100 archers or one siege engine (180,000, 200,000, 110,000, once per game). [GUIDE]

---

## 2. The hand

The hand is the cursor, the camera grip and the only tool. It is the thing reviewers praise most and complain about most.

### Buttons and basics

- **Core.** Two buttons. Left is "act": pick up, drop, throw, pour, press. Right is "move": grab the land and drag the view (see 3). [MAN, GUIDE]
- **Core.** The hand is context sensitive: pressing act on a thing does that thing's action, which is usually picking it up. [GUIDE]
- **Core.** The hand only works inside the player's influence area, drawn as a green border round the town. Outside it the cursor soon shows a red cross and nothing can be touched. Thrown objects and thrown miracles can land outside it. [GUIDE, WIKI]

### What it can pick up

- **Core.** Villagers (including soldiers), animals, trees (pulled up by the root), rocks and boulders, ore rocks, piles of grain, wood and ore, and the crop of a field (sucked up as grain). Also flags (platoon and migrant flags), building blueprints, miracles, and toys or food for the creature. [MAN, GUIDE]
- **Core.** Anything that can be picked up can be thrown. [GUIDE]
- **Core.** Buildings cannot be picked up. Pressing and dragging away from a finished building instead puts a blueprint of that type in the hand, ready to lay another (not for fields, storehouses, altars, armouries, the creature's pen or wonders). [GUIDE]
- **Core.** The creature is never carried. The hand strokes or slaps it, and can hold an item in front of it so the creature takes it. [MAN]

### How much it holds

- **Core.** Resources come in bulk, by holding the button over the source. Holding act over a field, tree or ore rock sucks it up; the amount grows the longer the button is held. Players were seen holding 200 grain (a tutorial target), 1,000 and 4,000 wood, over 3,000 grain, and close to 10,000 ore in one hand. No cap is documented. [MAN, VID, GSG]
- **Core.** Without an upgrade, the hand holds one villager, animal, tree or rock at a time. [MAN, GUIDE, VID]
- **Important.** The "multi pick-up" upgrade (15,000 tribute) lets the hand sweep across many things of one type while holding the button: villagers, animals and trees, never rocks or ore. Held things come out one per click, or pour out while the button is held, following the hand. No source gives a maximum. A guide calls it the most useful hand upgrade, and players buy it early. This is the upgrade behind the user's complaint that Expedition carries one tree at a time. [GUIDE, MAN, FAN]

### Putting things down

- **Core.** A click with something held drops it. Dropping an adult villager on or near a workplace makes it a disciple of that job (see 4). Dropping a villager by the town centre, or shaking it in the hand, clears its job. Children and the old cannot take jobs. [MAN]
- **Core.** Dropping grain, wood or ore on the store adds it to the town's stock. Dropping a tree or wood on a building foundation pays wood into it. [MAN, GUIDE, FAN]
- **Core.** Resources can be taken back out of the store and carried to a foundation, saving the haulers' walk. [GUIDE, GSG]
- **Important.** "God building": holding act with resources over a foundation pours them in and the building rises fast, but uses more material than builders would (a wonder god-built costs at least 1,000 more). A grown tree is enough wood for one family home. [MAN, WIKI, FAN]
- **Optional.** Dropping a villager into the altar's fire sacrifices it for an instant burst of mana. Very evil; children give the most. [GUIDE]

### Throwing

- **Core.** A throw is a flick: move the hand in the throw direction and let go. A faster move throws farther. The manual says releasing early sends the object low and releasing late lofts it; the guide describes rocking the mouse back and forth to wind up. Thrown things fly, bounce and roll until they settle. No speed, range or damage numbers are published. [MAN, GUIDE]
- **Core.** Heavy thrown rocks damage buildings, the player's own included; people hit are hurt and often killed. Larger rocks do more damage. [GUIDE, WIKI]
- **Important.** Throwing was the hardest thing for new players: one took half an hour to pass the throwing tutorial, and reviewers call the hand imprecise for aiming. A forgiving throw is worth more than an accurate one. [VID, REV]

### Other gestures

- **Core.** Shaking the hand hard (or a cancel key) empties it or cancels the current action. [MAN, VID]
- **Important.** Hovering the hand over a building, statue or villager shows a tooltip; a longer hover adds detail. [GUIDE, VID]
- **Important.** The "forcing" upgrade (20,000) turns the empty hand into a physical object: held and rocked, it shoves, knocks people over and breaks things, harder with more momentum. [GUIDE, MAN]
- **Optional.** Rubbing the ground gently spreads the god's alignment (flowers bloom); rubbing fast scorches the grass. [VID]
- **Optional.** Pressing act on the sky opens a sundial; dragging it sets the time of day. Villagers start work about 5 am, look for fun about 8 pm and sleep at midnight. [MAN, GUIDE, VID]
- **Optional.** The "gestures" upgrade (15,000) lets the player cast miracles by drawing a shape; players found it unreliable and kept using the menu and orbs. [GUIDE, REV]

### Look

- **Important.** The hand's look follows alignment: a good hand is lighter and wrapped in strands of light, an evil one red and clawed, with markings that change. Exact thresholds are unknown, and the descriptions come from fan summaries that may mix in the first game. [WIKI, VID]

---

## 3. Camera

- **Core.** Holding the move button on the land and dragging pulls the world along with the hand, as if grabbing the ground. Arrow keys also scroll. [MAN, VID]
- **Core.** The middle button held and moved sideways rotates the view about the point looked at; moved up and down it changes the pitch. The wheel zooms, from one villager's face to the whole island. [MAN, VID, REV]
- **Core.** Double-clicking the move button on a spot flies the camera there. [MAN, GUIDE, VID]
- **Important.** Jumps: a key to the town centre, a key to the creature, clicking a platoon flag flies to that platoon, and nine bookmarks the player can set anywhere, even on a moving villager. [MAN, GUIDE, VID]
- **Optional.** Zoom and pitch limits are not documented.

Expedition's art is fixed isometric pixel art, so free rotation and pitch do not carry over directly. See the gap table for what a pixel version can do instead.

---

## 4. Villagers and jobs

### Needs

- **Core.** Villagers need food, a home, sleep and fun. A hungry villager walks to the store to eat; villagers never starve to death but slow down, work less and get unhappy. More adults than adult housing makes them homeless. [WIKI, FAN]
- **Important.** Villagers age: adult at 18, death of old age between 70 and 90, children follow their parents around. Corpses make others mourn unless a graveyard holds them. Day and year lengths are unknown. [WIKI]
- **Important.** At night villagers call for sleep; overworked towns call for fun (tavern, baths). [FAN, REV]

### Jobs

- **Core.** The player assigns a job by dropping an adult on its place. A villager with a job glows in the job's colour and keeps it until death unless the job disappears. The jobs: builder (on a foundation or damaged building), farmer (field), forester (tree), miner (ore mine), worshipper (altar or wonder), breeder (next to an adult of the other sex, or a nursery), refiner (granary, lumber mill or smelter). The expansion adds a butcher. [MAN, WIKI]
- **Core.** Villagers without a job do some work on their own, but slowly. Reviewers say they rarely work unassigned, which is why so much play is assigning them one at a time. [WIKI, REV]
- **Important.** Practical numbers from players: 10 to 15 builders for a wonder, about a dozen worshippers per altar, 2 or 3 male breeders. The first town land's tutorial asks for 3 farmers, 3 foresters, 3 builders and 3 breeders. [FAN, VID]
- **Important.** Soldiers are not a job. They come from a platoon flag (see 11), and only men can be soldiers. [GUIDE, WIKI]

### Population

- **Core.** Breeders only make children when housing has room; with little spare room, few children come. In practice towns grow mostly through migrants. Birth rates are unknown. [FAN]
- **Important.** Nurseries and fertility statues raise births in nearby homes. Putting many men in the army lowers the birth rate. [WIKI]

---

## 5. Town

### Housing

- **Core.** Homes in rising order: hovel (7 people), house (10), the free starting home (9, one more when spaced from its neighbours), manor (10, up to 12 near other homes), mansion (7, up to 14 near other homes), and a tower home of 8 per floor that can be stacked. Hovels and plain houses make people unhappy and lean the god evil; the better homes lean good. [WIKI, FAN]

### Desires and happiness

- **Core.** The town centre shows what the town most wants: a statue on a pedestal whose figure is the wanted resource (food, wood, ore) and whose height is the urgency, a statue for breeding, and the building type people want most, ready to be dragged off as a blueprint. Once basics are met the wants move on to homes, then decoration. [GUIDE, VID]
- **Important.** Happiness comes from met desires, distance from industry and armouries, decoration and trees, and fun buildings. It changes quickly; impressiveness changes slowly. Happiness does not add to impressiveness directly, but it moves alignment a little every tick. [FAN, GUIDE]

### Impressiveness

- **Core.** Each town has an impressiveness number. It wins rival towns (by migration) and widens the influence area. Hovering the town centre's information scroll shows it with each modifier. [GUIDE, WIKI]
- **Core.** The number is the sum of each building's base value plus a placement bonus, plus modifiers. One player measured the modifiers:
  - placement: about -80 to +200 per building, more on high ground, less in lowlands;
  - alignment: +40 per percent of good, -40 per percent of evil, capped at 4,000 either way;
  - housing: 1.8 times adult housing capacity (capacity, not head count);
  - homelessness: -18 per homeless adult;
  - roads: +45 once per building joined to a road (the official guide says 22);
  - a building rotated before placing: +9;
  - repetition: the third and later copies of a type earn less (decorations exempt);
  - security: walls round the whole town add an unknown amount;
  - trees planted beside buildings: +20 each;
  - wonders: +3,000 each.
  [FAN, GUIDE, WIKI]
- **Important.** Base values run from 2 (hovel) and 40 (starting home) through 120 to 240 (manor, mansion), 800 (creature pen), 1,300 to 1,400 (temple, baths) and about 2,000 (amphitheatre) to 3,000 (wonder). [WIKI, VID]
- **Important.** Rough targets: the first town land is won near 9,000; most later lands need about 30,000; a hard expansion land about 55,000. [WIKI, FAN]

### Migration

- **Core.** When the player's town beats a rival town's capture threshold, that town's villagers walk to the player's nearest town. The threshold depends on the rival town's own impressiveness, population, distance, happiness and whether it is a capital. [WIKI]
- **Core.** Migrants arrive as a group behind a flag at the edge of the influence area. Dropping the flag inside the area accepts them and their goods; dropping it outside refuses them; leaving it does nothing. Accepting is good, refusing mildly evil. [MAN, GUIDE]
- **Important.** Groups are large and bring stock: one video counted "more than 25" in a group; whole towns arrive with thousands of ore or wood. One player's town reached 841 adults for 410 places. Rival soldiers outside the gate, or the rival creature, can kill a group in the open. [VID, FAN]

### Influence area

- **Core.** The influence area grows with population and with buildings. Each building type adds a set amount: storehouse 60, wonder 120, creature pen 48, armouries 40 to 50; roads and walls add nothing; fields add nothing. The unit is not stated. [GUIDE, WIKI]

---

## 6. Economy

- **Core.** Three resources: food (grain), wood and ore. Ore is new to this game, finite on most lands, and pays for walls, armies and the grand buildings. Mana is separate (see 8). [WIKI]
- **Core.** Food: fields, any size the player drags, worked by farmers, who carry grain to the store or a granary. Neighbouring fields help each other; many small fields beat a few big ones; fertile ground matters, with a fertility overlay while placing. Farmers left alone let crops overgrow, so the hand often carries grain itself. Soldiers eat twice as much as civilians. [WIKI, FAN, VID]
- **Core.** Wood: trees, cut and replanted by foresters; seedlings spread at fertile edges; the water miracle speeds growth. A villager carries one log, worth up to 250 wood. Trees left beside buildings for decoration are not cut. [WIKI, FAN]
- **Important.** Ore: surface ore rocks the hand can carry, and mines only villagers and the creature can work. Mines run out (one land's seven hold about 2,000 to 9,700 each), with one bottomless mine on one land. A smelter near the mine speeds it. [WIKI]
- **Core.** The store holds all three resources, up to 20,000 of each per store, so a growing town needs more stores. A store also helps nearby fields and refineries and widens influence cheaply. [WIKI, GUIDE]
- **Important.** Refineries (granary, lumber mill, smelter) multiply output when staffed with refiners; a granary ringed by fields, near a store, with a university near, can raise food output more than tenfold. [FAN]
- **Important.** Scale: a starting home costs about 320 wood, a temple 3,000 wood and 1,500 ore, a wonder several thousand of each; objectives ask for 4,000 to 6,000 of a resource; rival towns start with 1,000 to 6,000 of each. In this game "a lot of wood" means thousands. [WIKI, VID]
- **Important.** Recurring crises, seen in every long playthrough: food runs short (often unnoticed), ore runs out, builders fall behind the blueprints. [VID]

---

## 7. Buildings and construction

### How building works

- **Core.** Three ways to start a building: pick it from the construction menu; drag the most-wanted blueprint off the town centre; drag a copy off an existing building. The blueprint rotates before it is dropped, must sit inside the influence area, and snaps to face roads. The tooltip shows what the placement will do before the drop. [GUIDE, MAN]
- **Core.** A dropped blueprint becomes a foundation. Builders carry wood and ore to it from the store; the player can drop resources or a tree on it, or god-build it. Players found it often better to feed foundations by hand even with many builders. The creature can build too. [GUIDE, WIKI, REV]
- **Important.** There are no upgrades of an existing building; a better home is a different building. [WIKI]
- **Important.** A demolish tool sits at the end of each menu list. [MAN]

### Building list

Costs are tribute / wood / ore where known. "Free" means no tribute.

- **Core.** Basics: town centre (prebuilt, the town's information point), starting home (free, 320 wood), field (free, no materials, instant), store (free, about 1,500 wood), altar (free, 3,000 wood; makes mana, see 8), creature pen (free, 3,000 wood). [WIKI, GUIDE]
- **Important.** Homes: hovel (25,000 / 280), house (20,000 / 300), manor (40,000 / 800 / 200), mansion (80,000 / 1,200 / 400), tower home (100,000; 400 wood and 200 ore per floor). [WIKI]
- **Important.** Civic and fun: temple (40,000 / 3,000 / 1,500; raises happiness and the mana cap), tavern (30,000), baths (100,000 / 2,500 / 1,000), amphitheatre (200,000), university (50,000; raises nearby productivity), nursery (35,000 to 40,000), rest home (40,000), graveyard (30,000; holds 260), prison (35,000; holds 20, raises nearby output, lowers happiness). [GUIDE, WIKI, FAN]
- **Important.** Industry: granary (30,000), lumber mill (40,000), smelter (60,000), and three markets that place pots, statues or plants outside homes (20,000 to 28,000). [GUIDE, FAN]
- **Optional.** Decoration: column (20,000), lamp (10,000), meadow (15,000), well (15,000), fertility statue, a fountain that renames a villager dropped in it, and two evil pieces (punishment spike, torture pit). Decorations escape the repetition penalty. [GUIDE, FAN]
- **Important.** Roads: free, drawn by dragging out from an existing road. Villagers walk them faster and cut across grass without them. Each building joined to a road adds impressiveness once (see 5). Lamps light along them at night. [WIKI, FAN]
- **Important.** Walls and gates: walls cost ore per segment (about 50), are drawn from a tower point, may end outside the influence area, and are the only thing that can. Gates open and close on a click. A town fully enclosed gets a security bonus. A fortified wall and gate (100,000 tribute) are stronger and do not join plain walls. [GUIDE, MAN]
- **Important.** Military: melee armoury and ranged armoury (40,000 / 2,000 / 500 each) and a siege workshop (50,000 or 100,000; sources differ, see below). See 11. [MAN, GUIDE]
- **Optional.** The expansion adds a hospital, a blacksmith (stronger soldiers), a slaughterhouse with animal pens, and a few small decorations. [REV, WIKI]

### Wonders

- **Important.** Four wonder buildings, each holding one epic miracle: a charm that converts (400,000 tribute, 7,000 wood, 4,000 ore), an earthquake, a whirlwind, and a volcano (1,000,000, 10,000 wood, 4,000 ore). Sources disagree on which of earthquake and whirlwind costs 600,000 and which 800,000. Each adds 3,000 impressiveness and 120 influence. [MAN, GUIDE, WIKI]
- **Important.** A wonder charges from worshippers placed by it: more worshippers charge faster, with no cap, and a charge can take several game days. One player charged the conversion wonder with 55 to 67 worshippers over most of an episode. [GUIDE, VID]

---

## 8. Miracles

### Mana

- **Core.** Miracles cost mana. Worshippers at the altar make it, dance without stopping and are fed from the store automatically. The flame on the altar shows the stock. The base cap is 50,000; each temple raises it, by less each time. Mana per worshipper per second is not published. [GUIDE, MAN]
- **Optional.** Sacrifice at the altar gives an instant burst (very evil). [GUIDE]

### Getting and casting

- **Core.** A miracle is bought once with tribute, then appears as an orb on the altar. Picking up an orb (or choosing it from the miracles menu) puts the miracle in the hand if there is mana for it. [MAN, GUIDE]
- **Core.** Two ways to cast, with different results. Pouring (holding the button and moving slowly, or clicking on the spot) works only inside the influence area and makes a steady effect under the hand. Throwing (a flick) reaches outside it and makes a burst where it lands. [MAN, GUIDE]
- **Core.** Shaking the hand drops an uncast miracle; a key repeats the last one. [MAN]

### The six regular miracles

| Miracle | Tribute | Mana | Thrown | Poured |
|---|---|---|---|---|
| Water | free (from the fourth land) | 750 | splash that grows trees and crops, douses fire, sprouts saplings | same, smaller area |
| Heal | 20,000 | 1,000 | blast that restores people and the creature to full health | same, smaller area |
| Shield | 30,000 | 1,250 | burst of wind that pushes things away | a dome of chosen size that stops miracles and missiles |
| Fire | 60,000 | 2,000 | bouncing fireball that explodes | wall of flame |
| Lightning | 90,000 | 5,000 | bolts that kill troops along the path | wall of lightning |
| Meteor | 150,000 | 7,500 | meteors fall in a ring after a glowing warning circle | same, smaller ring |

[MAN, GUIDE, WIKI]

- **Core.** In play, water and heal are the workhorses: water regrows forests and crops cheaply, heal saves the creature mid-fight and undoes a misthrown fireball. Fire is the cheapest attack and good against buildings, troops and catapults. Heal always moves alignment good. [VID, GUIDE]
- **Optional.** The expansion adds four more: lava (120,000 / 3,000), a forest-and-animal miracle (150,000 / 7,000), death, which raises short-lived skeleton soldiers (180,000 / 10,000), and life, which raises the dead and refills a store (200,000 / 9,000). [WIKI, REV]
- **Optional.** Gesture casting: draw a spiral, then the miracle's shape (needs the 15,000 upgrade). [GUIDE]
- **Optional.** Whether a miracle can be strengthened (by grabbing more, or holding) is uncertain; one walkthrough says so, the manual does not.

### Epic miracles

- **Important.** A charged wonder works as a button: press it to take the epic, press the target. Epics land anywhere except inside a rival's influence or over water. [MAN]
- **Important.** Effects: the charm floats enemy villagers and soldiers into the air, makes them glow and turns them into the player's civilians, who walk home (it can more than double a town, and it empties a town far faster than migration); the earthquake opens a long fissure that swallows buildings and walls; the whirlwind lifts people and buildings and drops them, but does nothing to walls; the volcano raises a mountain, rains fire and pours lava that kills everything but creatures. Water hardens lava, the shield blocks the falling fire. Players found the charm the most memorable moment of the campaign. [GUIDE, WIKI, VID]
- **Important.** The rival casts epics at the player, with an audible countdown. [VID, WIKI]

---

## 9. Tribute and unlocks

- **Core.** Tribute is a fixed reward, never produced by the town. It comes from scrolls and objectives only, so the total is limited and choices matter. [GUIDE]
- **Core.** Scrolls float in the world. Bronze ones teach (about 1,000 each on the tutorial island), silver ones are optional challenges (1,000 to 50,000), gold ones advance the story or the land. Used scrolls turn to face the camera; unused ones spin. [GUIDE, VID]
- **Important.** Land objectives pay set amounts: 2,000 for each tutorial job group, 3,000 for a field or 12 homes, 5,000 for 20 worshippers, 8,000 for a captured village, 10,000 for 150 people, 20,000 for 300 people, 100,000 for a wonder, 100,000 to 120,000 for winning the land. [WIKI, VID, FAN]
- **Optional.** Silver challenges include mini-games: tossing an indestructible man as far as possible for rising pay, sliding pucks, tile puzzles, carrying lost nomads home, moving a rock off a garden. The advisors argue over each (see 13). [VID, WIKI]
- **Core.** What tribute buys, with costs, is listed beside each building, miracle and upgrade in this document. The cheapest useful items are under 20,000; the top ones are the four wonders (400,000 to 1,000,000). A good-path player is advised to spend on buildings and wonders and to buy the multi pick-up early. [GUIDE, FAN]
- **Important.** Evil completions may pay less: one review says evil routes earn no tribute for some objectives, while the official guide lists objectives that reward evil deeds. [REV, GUIDE]

---

## 10. The creature

### Choosing

- **Important.** The player picks one creature on the tutorial island and keeps it all game. The base game offers four animal species; a fifth came with a special edition, and the expansion adds a sixth and allows importing a trained creature. No numeric species stats exist for this game; fan descriptions say one is smartest, one strongest, one fastest, one gentlest and slowest. (Expedition already has its own creature, a gaunt slate giant the user approved, and keeps it.) [WIKI, REV]

### Learning

- **Core.** Every action the creature can take has its own value on a scale from never to always. Stroking (a slow up-and-down pass over its body) raises the value of what it just did; slapping (a fast side-to-side pass, or a slap) lowers it. About 5 to 10 seconds of stroking pushes an action to always; a few slaps push it to never. [REV, VID, MAN]
- **Core.** A thought bubble over its head shows what it is about to do, so the player can reward or punish the intention before the act. The game pings the player when the creature meets something new. [REV, VID]
- **Important.** A learning menu lists every learned action with its current value, and the player can raise or lower any of them there at any time, for example "sleeps in its pen: yes", "takes from the store: no". [REV, VID]
- **Important.** Whether the creature generalises a lesson across kinds of target (as the first game did, separately for adults, children, own and enemy villagers) is not stated for this game. [WIKI, FAN]
- **Important.** Miracles are not learned by watching. The creature can buy four: water (50,000), heal (75,000), lightning (75,000), fire (90,000). It then casts them on its own: water on crops and trees, heal on villagers, platoons and itself, fire and lightning on enemies. [GUIDE, WIKI, VID]
- **Optional.** Toys (10,000 each): a ball keeps it from getting bored, a soft toy nudges it good, a voodoo doll nudges it evil. It may throw a toy and hurt someone, or try to eat it. [WIKI, VID]

### Roles and the leash

- **Core.** The leash is a role with a work area. The player picks one of four roles (gatherer, builder, entertainer, soldier) or free will, then ties the creature to a building or spot; a border appears round that point and the creature does only that role's work inside it. Each role has its own leash colour (soldier is red). [WIKI, VID, GUIDE]
  - gatherer: harvests and waters crops, pulls up and carries trees, breaks ore, can reach resources outside the influence area, and at the top level throws resources into the store;
  - builder: carries material to foundations and builds and repairs, slower than villagers at first;
  - entertainer: plays with villagers, raising happiness and soldiers' morale, and tends to keep it good;
  - soldier: attacks anything in the area; it cannot leave the area, so archers outside it go unanswered; this duty drifts it evil.
- **Core.** Free will: the creature follows what it has learned and what it likes. Long service in roles lowers a visible free-will bar, so it acts "more like a machine than a pet". [WIKI, VID]
- **Important.** Each role has two upgrades bought with tribute: advanced (50,000) and master (100,000 to 250,000), giving double then triple speed or carrying, a sweep attack, and a species-specific special move. Roles themselves cost about 1,000 each (known only from a search summary of the guide). Guides disagree on whether upgrades are worth buying. [GUIDE, FAN]
- **Important.** Leash controls: select the creature (click it or a key), click the ground to send it, click a field to feed it, double-click an object to tie it there; a key cycles roles. [VID, GUIDE]

### Needs and body

- **Important.** It eats (villagers, fish, grain, even ore, which it vomits up), sleeps, plays, gets bored and leaves dung, which can crush villagers and fertilises fields. Sleeping in its pen heals, rests and grows it faster, more so at night. [REV, WIKI]
- **Important.** Its body shows how it lives: overeating makes it fat (soaks damage, hits less often), lifting trees and round rocks and fighting make it strong. A mid-sized, exercised creature fights best. [GUIDE, REV, VID]
- **Important.** Its look follows its own alignment, which is separate from the god's: a good one stands tall with a warm glow and lighter colouring; an evil one hunches, darkens, grows its claws and fangs. One species' fur turns white when good and dark when evil. [GUIDE, WIKI, VID]
- **Optional.** It grows through childhood, adolescence and adulthood and can become huge. Growth numbers for this game are unknown. [REV]

### Combat

- **Important.** Creature fights are mostly automatic: it throws things, charges, body-slams, and pins a weaker opponent until it faints or is freed. Size, fitness and muscle seem to decide them. Throwing it a rock or tree gives it a club. [WIKI, GUIDE]
- **Important.** It is the main answer to catapults and walls ("one hit" kicks a catapult over) and crushes swordsmen; massed archers and rival creatures are its threats. Its stomps hit the player's own soldiers too. [VID, GSG, REV]
- **Important.** Beaten, it faints and comes back after about two minutes at its pen or the town centre at half health. Healing it during a fight keeps it up. [GUIDE, VID]
- **Important.** Pathfinding is the top player complaint: it gets stuck on stores and cannot route round walls. [VID]

---

## 11. Armies and combat

- **Important.** Platoons are raised by picking up the flag on an armoury and dropping it on the ground inside the influence area. A recruiting tent appears and jobless men walk to it. Holding the button while dropping and dragging away sets the size, shown as a ghost platoon. Minimum 5; the official guide states no maximum, while another guide works with 40 as a soft cap. [MAN, GUIDE, GSG]
- **Important.** Three unit kinds: swordsmen, archers, and catapults (exactly 10 men each, slow, fragile, strong against walls, unable to defend or merge). [MAN, GUIDE]
- **Important.** Orders are given by carrying the platoon's flag. Held over a target, the tooltip names the order: attack (an enemy platoon, villager or building, or a wall for catapults), defend (a friendly building, platoon or the creature; on a wall, patrol it), capture (a rival town centre), climb onto a wall (archers), link (act together, stay separate) and merge (same kind only). Shaking the flag drops it with no order. Dropping it on a military building disbands the platoon. [MAN, GUIDE]
- **Important.** Flags are listed in the bottom-right corner; keys 1 to 9 select the first nine; double-tapping flies the camera to one. Each flag shows its number, kind, rank and health. [MAN, VID]
- **Important.** Soldiers rank up from 1 to 10 by winning fights and taking towns, gaining speed, attack and damage. At the fifth rank archers and catapults switch to fire. Merging spreads experience. Soldiers do not age. [GUIDE, VID]
- **Important.** Combat is real time and per soldier. No formations and no morale stat appear in any source. Soldiers eat double, and double again while moving. [GSG, GUIDE]
- **Important.** Capture: drop the flag on the rival town centre; soldiers stand round it until it falls. Bigger platoons capture faster. The capturing platoon cannot defend itself. [GUIDE, VID]
- **Important.** Defence that works: a wall across the approach, archers on it, a gate opened as bait, swordsmen or the soldier-role creature inside. [GSG, VID]
- **Optional.** Scale: early waves of about 20; a late objective of 20 platoons (5 swordsmen, 5 archers, 10 catapults); final pushes of about 200 men; armies of hundreds strain old hardware. [GSG, GUIDE, VID, REV]
- **Optional.** Reviewers call the war side thin: few unit kinds, few tactics, a passive enemy that trickles platoons and walks into archer fire. [REV]

---

## 12. Alignment

- **Core.** Every act nudges the god's alignment a little; none swings it much. The further toward an extreme, the less each act moves it, so early acts count most and turning back is hard. The game says "good" or "evil" after an act but not how much. [GUIDE]
- **Core.** Acts from good to evil, in the official guide's order (weights unpublished):
  - good: accepting migrants; converting enemy troops with the charm epic; healing; placing buildings on good ground; making people happy; planting trees; adding to the store or a foundation;
  - neutral: killing enemy soldiers (by army, miracle or hand); rewarding or punishing the creature;
  - mildly evil: taking from the store (cancelled when it reaches a foundation); pulling up a tree; refusing migrants; hurting the creature;
  - evil: starving people; sacrificing; killing villagers by miracle, hand or drowning; killing own soldiers;
  - most evil: damaging buildings; starting a creature fight; capturing a town by force; killing your own creature.
  [GUIDE]
- **Core.** Alignment changes impressiveness by up to 4,000 either way (see 5), so a good god wins by impressing and an evil god by force. [GUIDE]
- **Important.** It shows on the town centre (a plinth that grows a fountain for good or a flame for evil, its height showing how far), on buildings (a soft gleam for good; a dark look and smoky braziers for evil), on the hand, and on the creature (which has its own alignment). Fan summaries also describe the land itself turning lush or scorched, but those may describe the first game. [MAN, GUIDE, WIKI]
- **Important.** Nothing is locked by alignment except the punishment spike, which only evil or neutral gods can build. [GUIDE]
- **Optional.** No source documents music that changes with alignment.
- **Important.** Reviewers found the good path slow and, once all buildings were unlocked, dull; the evil path quicker. [REV]

---

## 13. Interface

- **Core.** Almost no fixed interface. Information lives in the world: the town centre's statues and scroll, flags, glowing job colours, scrolls, tooltips on hover. The four screen corners hold small panels: the opponent (people, troop count), the creature (health, hunger, dung, happiness), the player's towns with their most urgent want, and the platoon flags. [GUIDE, VID]
- **Core.** A toolbar opens from the town's flag icon or a key and closes with escape. Seven tabs: construction, creature learning, creature roles, tribute, miracles, objectives, statistics. The construction tab lists what people want most first, then building types, with the town's resources along the bottom. [MAN, GUIDE]
- **Important.** Two advisors, the god's conscience, one good and one evil, appear as small figures, argue every choice and never lie. They teach the whole tutorial, talk a lot in the first lands and much less from the fourth land on. The evil one tempts (throw that man into the sea); the good one warns. [MAN, GUIDE, VID]
- **Important.** The town centre is the town's dashboard: hover its scroll for impressiveness and each modifier, happiness, the odds of taking each neighbour, and job counts. Town statistics include child and adult counts, sex ratio, birth rate, productivity and a happiness face. [GUIDE, VID]
- **Important.** Signposts round the map give hints; finding them all is an objective. [GUIDE, VID]
- **Important.** Escape pauses with save, load and quit. [MAN]
- **Optional.** No world map: the gold scroll moves the player on. [GUIDE]

---

## 14. Pace and scale

- **Important.** Tutorial island: about 14 minutes. First town land: about 33 minutes played silently, 85 with commentary. Later lands: one fast good-path player never took over 2 hours; a force-route land took over 3.5 hours; reviewers say impressing "takes hours". One reader finished the whole campaign in about 9 hours; a commented good-path video series runs about 12 hours. [VID, FAN, REV]
- **Important.** Population: 34 at the first town land's start, 75 its target; 50 at the next start, 150 its target; 300 targets later; capitals of 125 and 470; the largest towns players report hold 800 to 1,200. Rival villages hold 8 to 45. [WIKI, FAN, VID]
- **Important.** Rival tempo: the first land's rogue platoons move about 5 to 6 minutes in; expansion assaults about 10 minutes in; one expansion land casts a whirlwind at the player within minutes. [WIKI, FAN]
- **Important.** Tribute: tutorials 1,000 to 5,000; challenges 5,000 to 50,000; land wins 100,000 to 120,000; wonders 400,000 to 1,000,000. [WIKI, GUIDE]

Expedition aims at this scale ([decision 4](#decisions)): towns of hundreds of villagers with no fixed cap, homes of about 7 to 10, a field per several farmers, wood in the hundreds per building and thousands per grand building, tribute costs where the cheapest useful unlock takes one or two objectives and a wonder takes most of a land. The current 64 x 64 island cannot hold that, so the build order enlarges the world early (step 2).

---

## Where sources disagree

1. **Throwing.** The manual: press act while moving, release timing sets the angle. The guide: hold act and rock the mouse, release to throw. Play videos show a hold, pull back and flick.
2. **Pouring a miracle.** The manual: hold act and move slowly. The guide: click act on the spot.
3. **Pitch control.** The manual: middle button moved up and down. The guide: move button plus the wheel.
4. **Wonder costs.** Manual: conversion 400,000, earthquake 600,000, whirlwind 800,000. The guide and one wiki swap earthquake and whirlwind. The guide's OCR gives the conversion wonder 200,000, likely an OCR error.
5. **Siege workshop.** Guide 100,000 tribute and 2,000 wood; manual and wiki 50,000 and 2,500 wood.
6. **Road bonus.** Guide +22 per joined building; a measured player guide, a second guide and the wiki +45.
7. **Starting home.** Base impressiveness 40 (wiki) or 22 (measured); capacity 9 (wiki) or 8 adults (measured). Likely a data value against a measured one.
8. **Platoon size.** Guide: no maximum. Another guide: 40 with overflow. Wiki: 5 platoons per armoury at the start.
9. **Fighting and evil.** Guide: killing enemy soldiers is neutral. Another guide: fighting outside your influence costs a little evil. One review: war and armouries are evil.
10. **Tavern.** Guide: slightly good through happiness. Manual: drink pushes evil.
11. **Creature combat between creatures.** One review says there is none; four other sources and the videos show it.
12. **Species count.** Four (most reviews), five with a special edition, six with the expansion.
13. **Tribute on the evil path.** One review: none for some evil completions. Guide: some objectives reward evil.
14. **Land count.** Nine lands (wikis, a walkthrough) or eight (one review, probably counting differently).
15. **Desire symbols.** Wiki pages on desire flags describe the first game; the second game shows wants as statues at the town centre.
16. **Capitals and migration.** The manual: emptying a town by migration never captures its town centre, only force does. The guide: a very impressive town makes even a rival capital join peacefully. Read together, impressing a capital wins it for the land, but the building is not taken.

---

## Expedition today against the reference

Read from `main` at `c8882b0`: `src/systems/`, `src/village/`, `src/creature/`, `src/miracles/`, `src/hand/`, `src/engine/camera.js`, `src/alignment/`, `src/ui/` and `README.md`. Gap size: **none**, **small** (tuning or an extra rule in existing code), **medium** (a new mechanic inside an existing system), **large** (a new system or a rework).

### Hand

| Reference | Expedition today | Gap |
|---|---|---|
| Hand holds many villagers, trees or animals with an upgrade, swept up by holding the button | One entity at a time (`hand.heldId`) | Large |
| Resources sucked up in bulk from fields, trees, ore and the store; amount grows while the button is held | Picks up one `wood` or `grain` item of whatever amount it has; cannot take from a field or the store | Large |
| Drop grain, wood or a tree on the store to deposit; on a foundation to pay wood | A dropped item lies on the ground; villagers within 6 tiles may pick it up later; dropping a tree on a woodpile or blueprint does nothing at once | Medium |
| Pour resources onto a foundation to god-build at extra cost | Absent | Medium |
| Drop a villager on a job site to make it a disciple; shake or town centre to clear | Present: drop within 2 tiles of temple, blueprint, field or tree sets worshipper, builder, farmer or woodcutter for 90 s, after which auto-assignment may move it | Small (make it permanent, add clear) |
| Flick throw, faster is farther; bounce and roll | Present: release speed decides drop or throw (1.5 to 16 tiles/s), bounces, rocks damage buildings, falls and water kill villagers | None |
| Hand limited to the influence area | Hand works anywhere; only blueprint placement checks influence | Medium |
| Shake to cancel or empty | Absent | Small |
| Drag a copy of a building off an existing one | Absent | Small |
| Hover tooltips on buildings, villagers, statues | Absent | Medium |
| Hand forcing, gestures, sundial, rubbing the ground | Absent | Optional |
| Hand look follows alignment | The hand is recoloured by the world palette as alignment moves; no shape change | Small |

### Camera

| Reference | Expedition today | Gap |
|---|---|---|
| Grab the land with the move button and drag | Middle-drag pans; right button is used for slap and tether | Medium (button map) |
| Rotate and pitch | Fixed isometric view, no rotation | Large; planned near the end (decision 2, step 16): four 90-degree turns, every sprite drawn from four sides |
| Wheel zoom from close-up to whole island | Four zoom steps (2, 3, 4, 6 device px per game px) | Small |
| Double-click travel | Absent | Small |
| Keys to town centre and creature, bookmarks, click a flag to fly to a platoon | Absent | Small |

### Villagers and town

| Reference | Expedition today | Gap |
|---|---|---|
| Seven disciple jobs plus soldiers | Four jobs (farmer, woodcutter, builder, worshipper) plus idle, dealt out automatically by shares | Medium |
| Jobs mostly by hand; unassigned villagers work slowly | Jobs mostly automatic; the hand only overrides for 90 s | Small (decision 1 keeps automatic; a hand-set job must stay) |
| Food need, slowdown and unhappiness, never death by hunger | Hunger rises over 120 s; a hungry villager eats 1 grain or walks at 60% speed | Small |
| Housing need, homelessness | Houses only cap births (3 per house); no homes, no homelessness | Medium |
| Age, children, old age, mourning | Absent | Medium |
| Day and night, sleep, fun | Absent | Medium |
| Breeding by breeders when housing has room | Births every 25 s when a house has room and the store holds 25 grain (costs 5) | Small |
| Town centre showing wants as statues, the wanted building as a blueprint | Absent | Large |
| Happiness | Absent | Medium |
| Impressiveness number with modifiers | Absent | Large |
| Migration of rival villagers to the more impressive town, with a flag to accept or refuse | Absent; the rival converts all at once when a belief meter fills | Large |
| Influence area growing with population and buildings, shown as a border | Fixed placement radius: 10 tiles from the temple or 5 from a finished building; not drawn | Medium |
| Villages start at 34 to 50 people and grow to hundreds | 9 player and 8 rival villagers on a 64 x 64 island; a full village in the perf scene holds 12 | Large (decision 4: reference scale needs a bigger map and crowd performance) |

### Economy

| Reference | Expedition today | Gap |
|---|---|---|
| Food, wood, ore | Grain and wood; no ore | Medium |
| One store for all resources, 20,000 each | Grain in a storehouse, wood in a separate woodpile; no cap | Small |
| Fields of any size, fertility, overgrowing crops | Fixed 3 x 3 fields, growth in 45 s (faster when tended or rained on), 5 grain a harvest | Small |
| Foresters replant; seedlings spread; water grows trees | 247 trees placed at start; felled trees never come back (rain grows only entities that already have `growth`) | Medium |
| Refineries | Absent | Optional |
| Wood in hundreds per building | Costs of 2 to 8 logs; a tree gives 2 | Tuning (scale up when bulk carrying lands) |

### Buildings

| Reference | Expedition today | Gap |
|---|---|---|
| Construction menu with tabs and a demolish tool | A 4-slot build bar (house, field, storehouse, woodpile), keys 1 to 4 | Medium |
| Over 30 building types | 5 (temple prebuilt, plus the four above) | Large |
| Rotation before placing | Absent | Small (each rotation needs its own sprite) |
| Builders haul from the store; the player can feed foundations | Builders haul 3 logs at a time from the woodpile; the creature can haul too; the player cannot feed a blueprint directly | Small |
| Roads | Absent | Medium |
| Walls and gates | Absent | Large |
| Wonders and epics | Absent | Large |
| Altar and temple as separate buildings, mana cap raised by temples | One temple: worship site and orb pedestals together; power cap fixed at 100 | Small |
| Creature pen | Absent | Small |

### Miracles

| Reference | Expedition today | Gap |
|---|---|---|
| Mana from worshippers, stock shown on the altar | Present: 0.08 power per praying worshipper per second, cap 100, shown in a HUD bar | Small |
| Orbs at the altar, taken into the hand | Present: four orbs on temple pedestals, back 4 s after being taken | None |
| Throw or pour, with different effects | Present as drop or throw at the landing point; both give the same effect | Medium |
| Water, heal, shield, fire, lightning, meteor | Rain, heal, fire, lightning | Small (add shield and meteor) |
| Bought once with tribute | All four available from the start | Medium (needs tribute) |
| Shake to cancel, key to repeat | Absent | Small |
| Four epics | Absent | Large |

### Creature

| Reference | Expedition today | Gap |
|---|---|---|
| Per-action never-to-always values, raised by strokes and lowered by slaps | Present: a learned score per verb and target, credit to the last 5 actions within 10 s, one slap forbids | None |
| Thought bubble before acting; ping on new things | Bubble present; no ping | Small |
| Learning menu to change any lesson directly | Debug panel only (backquote), read-only | Medium |
| Roles with a tied work area: gatherer, builder, entertainer, soldier, free will | One point tether: 3-tile radius, 20 s, no roles | Large |
| Free-will bar lowered by role service | Absent | Small (with roles) |
| Needs: hunger, sleep, boredom, dung that fertilises | Present: hunger, fatigue, boredom, sleep, dung that boosts a field | None |
| Pen for sleep, healing, growth | Absent | Small |
| Fat and strength from food and exercise | Weakness after starving only | Medium |
| Look follows its own alignment | Present: sprite and palette change at a lean of plus or minus 0.33 | None |
| Growth over time | Absent | Medium |
| Creature miracles bought with tribute | Absent | Medium |
| Fights rival creatures and armies; faints and comes back | Smashes buildings and throws villagers; no health, no fighting, no rival creature | Large |
| Toys | Absent | Optional |

### Armies

| Reference | Expedition today | Gap |
|---|---|---|
| Platoons from armoury flags, three unit kinds, flag orders, capture by force | Absent | Large |
| Rival attacks | Absent; the rival only grows | Large |
| Ranks, linking and merging | Absent | Optional |

### Alignment and winning

| Reference | Expedition today | Gap |
|---|---|---|
| Many small acts, inertia near the ends | Each act adds `weight x 0.15`, clamped to plus or minus 1; drifts back to 0 with a 4-minute half-life | Small (drift is our own addition; reference has none documented) |
| Act list: migrants, healing, planting, store deposits good; killing, sacrifice, damage evil | Acts present: heal, rain good; fire, lightning, villager deaths, uprooting evil; dropping and throwing neutral | Small (extend the list) |
| Alignment adds to impressiveness | No impressiveness | With impressiveness |
| Win by migration (impress) or capture (force), per town | Belief meter in a 10-tile ring round the rival: good acts add awe, evil acts add fear; full meter converts the whole rival village | Large |
| World look follows alignment | Present: the whole palette shifts in 8 steps | None (reference is more local: town centre, buildings, hand) |
| A rival that can lose ground to you and win against you | No lose condition | Large |

### Interface

| Reference | Expedition today | Gap |
|---|---|---|
| Almost no fixed interface; information in the world | Fixed HUD panels: power bar, alignment scale, rival belief, creature needs, build bar | Medium (move information into the world as systems arrive) |
| Toolbar with seven tabs | Build bar only | Large |
| Two advisors who teach and argue | Absent | Large |
| Scrolls (tutorial, challenge, story) and objectives with tribute | Absent | Large |
| Town centre dashboard and hover tooltips | Absent | Large |
| Platoon flags in a corner | Absent | With armies |
| Pause menu, save and load | Title screen and win banner; no pause, no save | Medium |
| Music | Synthesised sound effects only, no music | Optional |

### Shape of play

| Reference | Expedition today | Gap |
|---|---|---|
| Several lands, each a fresh island with its own rivals, carrying tribute and the creature | One island, one rival village | Medium (decision 5: one larger island with several rival towns; a chain is optional) |
| Rival towns of 8 to 470 people, several per land | One rival village of 8 that grows by one blueprint every 2 minutes | Large |

---

## Decisions

The user settled these on 2026-11-02. Later steps follow them.

1. **Jobs.** Villagers keep Expedition's automatic job assignment by default. The player can also assign a job by hand by dropping a villager on its place, and a job set by hand stays until the player clears it; automatic assignment never moves that villager.
2. **Camera rotation.** Planned, built near the end (step 16). Until then the view stays fixed, and new sprites need not be drawn from four sides yet.
3. **The belief meter.** Replaced by migration (step 9). Impressing a rival town pulls its villagers over; the force route takes its town centre; the conversion epic pulls a whole crowd over at once. Expedition's fear side of the meter has no counterpart in the reference and goes with it.
4. **Scale.** Close to the reference with no fixed cap: towns of hundreds of villagers, up to the 800 to 1,200 the largest reference towns reached, and costs and tribute in the reference's ranges. This needs a much larger map than 64 x 64 and a sim and renderer that hold hundreds of villagers inside the frame budget (step 2).
5. **Lands.** One larger island for now. The reference itself is a chain of nine separate islands (see 1), so a chain stays possible later (step 17); for now one island carries several rival towns.
6. **Source list.** The URL list and research notes stay out of the repository, so `check:ip` keeps its rule with no exception. A copy is kept on the author's machine at `D:\CoreWise\_artifacts\Expedition\gameplay-research\` (`sources-index.md` maps the keys above to URLs; `research-*.md` holds the per-claim notes; `transcripts\` the 14 video transcripts).

---

## Proposed build order

Each step leaves a game that plays better than before and gives the next step something to stand on. The order follows the core items above, the user's first complaint and the decisions above.

1. **The hand in bulk.** Hold to suck up grain from fields and the store and wood from trees, in amounts that grow while the button is held; drop on the store to deposit and on a blueprint to pay into it; pour onto a blueprint to god-build at extra cost; shake to empty. Multi pick-up for villagers and trees (sweep while holding). This is the complaint the user raised first, and every later system leans on it. Resource amounts move to the reference's scale (hundreds of wood per building). *Size: large.*
2. **A bigger world and crowds.** A much larger island with room for several rival towns, and an engine that holds hundreds of villagers (later a thousand or more) within the 16.7 ms p95 frame budget: terrain drawn and cached in chunks, the spatial grid and pathfinding sized for crowds, a perf scene with a full-size town. Measure first; the scale decision makes this a precondition for every town system. *Large.*
3. **One store, ore, regrowing forests.** Merge the storehouse and woodpile into one store for food, wood and ore; add ore rocks and a mine; foresters who replant; seedlings and rain that grow trees. *Medium.*
4. **Jobs by hand on top of automatic.** A job dropped by hand is permanent and shows its colour; a shake or a drop at the town centre clears it and hands the villager back to automatic assignment. Add the breeder and forester jobs. *Medium.*
5. **Influence area.** A border round the town that grows with buildings and people; the hand works only inside it; throws can leave it. *Medium.*
6. **Camera controls.** Move the camera to the right button (grab the land), double-click travel, keys to the town centre and creature. Slap moves to a fast side-to-side stroke over the creature, as the reference does it. Rotation waits for step 16. *Medium.*
7. **Town centre and wants.** A prebuilt town centre whose statues show the most urgent want and its urgency, a draggable wanted-building blueprint, an information scroll on hover; hover tooltips for buildings and villagers. *Large.*
8. **Homes, happiness, impressiveness.** Homes with capacity and homelessness; happiness; the impressiveness number with its modifiers (placement, alignment, housing, homelessness, repetition, trees); more building types (two or three homes, a fun building, a temple distinct from the altar, decorations); roads with their bonus. *Large.*
9. **Migration replaces the belief meter.** Several rival towns on the island, each with a capture threshold; migrant groups behind a flag the player accepts or refuses; the impress route wins a town and leaves it empty. *Large.*
10. **Tribute, scrolls, objectives and the toolbar.** Tribute from scrolls and objectives only; a tribute tab that unlocks buildings, miracles and upgrades; construction, objectives and statistics tabs. Lock the miracles and upgrades behind it. *Large.*
11. **Advisors and the tutorial.** Two advisors of Expedition's own design who teach the first part of the island and argue over challenges. *Large.*
12. **Creature roles.** Role leashes tied to a building or spot with a drawn area, a free-will bar, a learning menu, the pen, creature miracles and growth. *Large.*
13. **Miracles complete.** Throw and pour as different effects; shield and meteor; repeat key. *Medium.*
14. **Armies and the force route.** Armoury flags, swordsmen and archers, flag orders, capture; walls and gates; rival platoons that attack; catapults; creature fights. *Large.*
15. **Wonders and epics.** The conversion epic first (it serves the impress route), then the destructive three; the rival casting epics back. *Large.*
16. **Camera rotation.** Four 90-degree turns, with every sprite and the terrain drawn from four sides. *Large.*
17. **Optional depth.** Ages and mourning, day and night with a sundial, refineries, hand forcing and gestures, toys, ranks and merging, music, and a chain of islands if one island ever feels too small.
