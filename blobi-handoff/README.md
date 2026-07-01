# BLOBI — Game Spec

A one-thumb mobile arcade game. A little pink pixel-art blob drifts around the
screen and bounces off the walls. Small toothy monsters pop up. **Tap & hold to turn the
blob invisible so it can phase through a monster** — but while cloaked the blob is blind:
it stops bouncing and dies if it drifts into a wall. Time your cloak, slip past the
monster, then release before you hit an edge.

This repo currently contains a **static visual mockup** (`Peek-a-Blob Mockups.dc.html`) and
this spec. Build the playable game from the rules below.

---

## 1. Format & feel
- **Portrait** mobile (single vertical playfield). No scrolling — the whole arena is one screen.
- **Pixel art**, `image-rendering: pixelated`, integer scaling. Everything is drawn on a pixel grid.
- **Soft pastel palette on a very light BABY-BLUE background** (`#eef8ff`→`#e6ecff`), deep
  plum outlines (`#6d2c52`). The pink blob and the purple monster pop against the blue.
  The cloaked state deepens the blue slightly; game-over dims it.
- Cute but readable at small sizes.

## 2. Blobi (player)
- **Round & squishy — like a piece of bubblegum, NOT a perfect ball, but not wildly lumpy
  either.** Pink pixel body with stubby arms + feet, two big shiny eyes, blush cheeks, a
  tiny mouth. (Original design — deliberately un-Kirby.)
- **Death pose = a SPLAT.** When Blobi dies it flattens into a wide, melty puddle shape with
  `x x` cross-eyes (see the mockup's dead sprite). Same pink palette — just the squashed
  silhouette + x x eyes.
- The blob has a fixed radius/hitbox smaller than its drawn bounds (forgiving).

### Movement
- The blob **auto-moves** with a constant velocity vector (`vx, vy`). It does not stop.
- While **visible**, hitting any of the 4 walls **reflects** the velocity (classic bounce),
  optionally with a tiny squash animation. Speed is preserved.
- Suggested start speed ≈ 3–4% of screen height per second; ramp up slowly with score.

## 3. The monster (obstacle)
- **GNASH** — one monster type: a small horned purple biter with four white fangs and angry
  brows. **Smaller than Blobi.** See the mockup for the exact look.
- It sits still (gentle idle bob only). It does not chase.

### Spawn rules — IMPORTANT
- **One monster at a time** (or a small max; tune later).
- A monster spawns at a random point **but never near a corner or edge**. Keep it inside a
  safe margin (e.g. ≥ 20% of screen width/height from every edge). This guarantees the player
  always has room to *un-cloak and bounce* right after passing it.
- Give a short telegraph (pop-in / scale-up) so the player can react.

### Despawn rule — IMPORTANT
- A monster disappears **only after the blob has fully passed through/over it AND the blob is
  visible again.** 
- Concretely: mark the monster `cleared = true` the moment the (invisible) blob overlaps it.
  Do **NOT** remove it yet. Remove it (and award score) only once `cleared === true` **and**
  the blob is no longer cloaked. If the player keeps holding after passing, the monster stays
  on screen until they release.

## 4. Cloak mechanic (the core input)
- **Input:** touch-and-hold anywhere on the screen. Press = cloak on, release = cloak off.
- **While cloaked:**
  - The blob is **fully invisible** — no sprite, no trail, no ghost. (Hard mode: the player
    tracks it from memory.) *(The mockup shows a dashed outline only to explain the idea —
    do NOT render that in the real game.)*
  - The blob **phases through monsters** — no death on monster contact.
  - The blob **does NOT bounce off walls.** It keeps its velocity and, if it reaches a wall,
    it **dies** (it would "leave" the arena). So you can't stay cloaked forever.
- **On release:** blob becomes visible again and resumes normal wall-bouncing.
- The skill loop: watch a monster appear → judge the blob's path → cloak just before contact →
  hold across the monster → release before the blob drifts into a wall → the passed monster
  vanishes and you score.

## 5. Death & collisions
The blob dies when:
1. It touches a monster **while visible** (not cloaked), OR
2. It reaches a wall **while cloaked** (invisible, so it can't bounce).

On death:
- Eyes switch to `x x`, freeze the blob at the impact point.
- **Short screen shake** + a little burst of pixel shards.
- Show the **Game Over** overlay: `GAME OVER`, final `SCORE`, `BEST`, and a blinking
  `TAP TO RETRY`. Tap restarts.

## 6. Scoring / UI
- **Score = number of monsters successfully cleared.** HUD shows `SCORE` (top-left) and
  `BEST` (top-right), pixel font.
- Persist the high score locally (e.g. `localStorage`).
- Optional difficulty ramp: increase blob speed and/or shrink the monster-spawn interval as
  score climbs.

## 7. Screens / states
1. **PLAY** — HUD + blob bouncing + monsters spawning. (Add a lightweight title/start state.)
2. **CLOAKED** — same as play but blob hidden while the finger is down.
3. **GAME OVER** — dim overlay, dead blob (`x x`), score/best, blinking retry.

## 8. Suggested tech
- Single `<canvas>` game loop (`requestAnimationFrame`), fixed-timestep update.
- State machine: `TITLE → PLAY → GAMEOVER`. A boolean `cloaked` toggled by
  `touchstart/touchend` (and `mousedown/mouseup` for desktop testing).
- Draw pixel sprites from small matrices or spritesheets; scale by an integer factor.
- Keep a `tuning` object for everything below so it's easy to balance.

## 9. Tuning knobs (start values, then playtest)
| Knob | Suggested start |
|---|---|
| Blob base speed | ~4% screen-height / sec |
| Speed ramp | +5% every 5 points |
| Blob hitbox radius | ~40% of drawn size |
| Monster hitbox | ~50% of drawn size |
| Monster spawn margin from edges | ≥ 20% width & height |
| Monsters on screen at once | 1 (raise later) |
| Spawn telegraph | 0.25 s pop-in |
| Screen shake on death | ~0.5 s |

## 10. Asset reference
Open `Peek-a-Blob Mockups.dc.html` in a browser for the visual target: the 3 gameplay
screens (play / cloak / game-over), Blobi (alive + splat-dead), and the GNASH monster. The
sprites there are generated procedurally in the file's logic — reuse the shapes/palette or
redraw as a spritesheet.
