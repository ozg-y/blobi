/**
 * BLOBI: core game engine (framework-agnostic).
 *
 * A one-thumb pixel-art arcade game. A pink blob auto-drifts and bounces off the
 * walls. A small monster (GNASH) pops up. Tap & hold to cloak: the blob turns
 * invisible and phases through the monster, but stops bouncing and dies if it
 * drifts into a wall. Release before you hit an edge, and the passed monster
 * vanishes for a point.
 *
 * Rendering: the animated playfield (background gradient, dot texture, blob,
 * monster, shards) is painted straight onto the display canvas at full device
 * resolution with image smoothing OFF, so pixel-art sprites stay crisp and carry
 * a hard plum drop-shadow, the "sticker" look from the design. All text (HUD,
 * title, game-over) is NOT drawn here: the engine publishes its discrete UI state
 * via `onState`, and the React shell renders that text with the real pixel font
 * (Press Start 2P) so it is razor-sharp at any size, exactly like the mockup.
 *
 * The class is intentionally UI-framework-free so it can be mounted from React,
 * plain JS, or anything else. See components/GameCanvas.jsx for the React shell.
 *
 * Sprites: the exact pixel-art PNGs from the original mockup (Blobi alive/dead,
 * GNASH) are drawn with image smoothing OFF so they look identical to the design.
 */

// Real mockup sprites (Vite turns these into bundled asset URLs).
import blobiPng from '../assets/blobi.png'
import blobiDeadPng from '../assets/blobi_dead.png'
import gnashPng from '../assets/gnash.png'

// ---- Palette (from the mockup / spec) ---------------------------------------
const COLORS = {
  bgTop: '#eef8ff', // mockup play gradient: #eef8ff → #e4f1ff → #e6ecff
  bgMid: '#e4f1ff',
  bgBottom: '#e6ecff',
  bgTopCloak: '#dcebff', // cloak gradient: #dcebff → #dfe2ff (deepened, blind state)
  bgBottomCloak: '#dfe2ff',
  overDim: 'rgba(50,25,60,0.5)', // game-over dim (mockup)
  plum: '#6d2c52', // outlines
  pink: '#ff9fc9', // blob body
  pinkShade: '#f27ab0', // blob lower body / shading
  cheek: '#e2569b', // blush
  mouth: '#d63a63',
  eyeWhite: '#ffffff',
  iris: '#2a2c66',
  monBody: '#b06cd6', // GNASH purple
  monShade: '#8a4fb0',
  monHorn: '#e0c2f2',
  fang: '#ffffff',
  hudText: '#d6317f', // magenta HUD, as in the mockup
  hudShadow: '#ffffff',
}

// ---- Tuning knobs (spec section 9): everything balance-able lives here -----
const TUNING = {
  // Speeds/sizes are fractions of the art-space HEIGHT so they scale with the screen.
  blobBaseSpeed: 0.185, // fraction of art-height per second (a touch quicker for arcade feel)
  speedRampPerPoint: 0.03, // +3% per monster cleared — a slow, gradual climb (no big jumps)
  speedRampMax: 2.4, // cap the multiplier so it never gets impossible
  blobDrawR: 0.052, // physics radius (wall bounce / cloak-death boundary)
  blobHitR: 0.03, // forgiving hitbox for monster contact
  monsterHitR: 0.028, // monster contact hitbox
  // Sprite draw sizes, as a fraction of art-height (the PNGs have transparent margins).
  blobSpriteH: 0.15,
  deadSpriteH: 0.16,
  monsterSpriteH: 0.135,
  // Keep monsters well clear of the walls so that after you phase one you still
  // have room to un-cloak and bounce without touching the wall OR re-touching it.
  spawnMargin: 0.28, // >= 28% from every edge
  spawnTelegraph: 0.28, // seconds of pop-in
  monsterLifetime: 3.2, // an ignored monster wanders off after this and re-appears elsewhere
  spawnDelayBase: 0.5, // pause before the next monster appears
  spawnDelayMin: 0.22, // shrinks with score
  relocateDelay: 0.35, // short beat before a fresh monster pops in after one leaves
  shakeTime: 0.5, // seconds of screen shake on death
  shakeMag: 5, // art-pixels of shake amplitude
  gameOverLockout: 0.6, // seconds before a retry tap is accepted
  artHeight: 260, // art-space height in "art pixels"
}

const STATE = { TITLE: 'TITLE', PLAY: 'PLAY', GAMEOVER: 'GAMEOVER' }

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export default class BlobiGame {
  constructor(displayCanvas) {
    this.display = displayCanvas
    this.dctx = displayCanvas.getContext('2d')

    // React (or any UI) subscribes here to render the crisp DOM overlay (HUD,
    // title, game-over) with the real pixel font. The canvas only paints the
    // animated playfield (background, sprites, shards); all text lives in the
    // overlay so it stays razor-sharp at any device resolution, exactly like
    // the design mockup, which is DOM/CSS text over the art.
    this.onState = null
    this._lastSnap = ''

    // Load the mockup sprites.
    const load = (src) => {
      const img = new Image()
      img.src = src
      return img
    }
    this.sprites = {
      blob: load(blobiPng),
      dead: load(blobiDeadPng),
      gnash: load(gnashPng),
    }

    this.state = STATE.TITLE
    this.best = this._loadBest()
    this.score = 0

    // Blob
    this.blob = { x: 0, y: 0, vx: 0, vy: 0, cloaked: false, squashX: 1, squashY: 1, dead: false }
    // One monster at a time (spec).
    this.monster = null
    this.spawnTimer = TUNING.spawnDelayBase

    // Input
    this.pointerDown = false
    this.ignoreHoldUntilRelease = false // prevents the "start"/"retry" tap from also cloaking
    this.gameOverAt = 0

    // FX
    this.shards = []
    this.shakeT = 0
    this.time = 0

    // Loop
    this.acc = 0
    this.last = 0
    this.STEP = 1 / 120 // fixed-timestep update
    this.running = false
    this._frame = this._frame.bind(this)

    this.resize()
  }

  // --- lifecycle ------------------------------------------------------------
  start() {
    if (this.running) return
    this.running = true
    this.last = 0
    requestAnimationFrame((t) => {
      this.last = t
      requestAnimationFrame(this._frame)
    })
  }

  stop() {
    this.running = false
  }

  destroy() {
    this.stop()
  }

  resize() {
    const w = Math.max(1, this.display.clientWidth || window.innerWidth)
    const h = Math.max(1, this.display.clientHeight || window.innerHeight)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    this.display.width = Math.floor(w * dpr)
    this.display.height = Math.floor(h * dpr)

    // Physics runs in a fixed-height "art space" so tuning stays screen-independent;
    // width follows the device aspect ratio.
    this.AH = TUNING.artHeight
    this.AW = Math.max(120, Math.round(this.AH * (w / h)))

    // We draw straight to the display at full device resolution (no low-res blit),
    // scaling art-space → device pixels. Sprites use nearest-neighbor so pixels
    // stay crisp; text is handled by the DOM overlay. `scale` maps art px → device px.
    this.dpr = dpr
    this.scale = this.display.height / this.AH

    this.dctx.imageSmoothingEnabled = false

    // Keep entities inside the (possibly) new bounds.
    if (this.state !== STATE.TITLE) this._clampBlob()
    if (this.monster) {
      this.monster.x = clamp(this.monster.x, this.AW * 0.1, this.AW * 0.9)
      this.monster.y = clamp(this.monster.y, this.AH * 0.1, this.AH * 0.9)
    }
  }

  // --- input ----------------------------------------------------------------
  onPointerDown() {
    this.pointerDown = true
    if (this.state === STATE.TITLE) {
      this._startPlay()
      return
    }
    if (this.state === STATE.GAMEOVER) {
      if (this.time - this.gameOverAt >= TUNING.gameOverLockout) this._startPlay()
      return
    }
    if (this.state === STATE.PLAY && !this.ignoreHoldUntilRelease) {
      this.blob.cloaked = true
    }
  }

  onPointerUp() {
    this.pointerDown = false
    this.ignoreHoldUntilRelease = false
    if (this.state === STATE.PLAY) this.blob.cloaked = false
  }

  // --- state transitions ----------------------------------------------------
  _startPlay() {
    this.state = STATE.PLAY
    this.score = 0
    this.shards = []
    this.shakeT = 0
    this.monster = null
    this.spawnTimer = TUNING.spawnDelayBase

    const b = this.blob
    b.x = this.AW * 0.5
    b.y = this.AH * 0.5
    b.dead = false
    b.cloaked = false
    b.squashX = 1
    b.squashY = 1

    // Launch in a random diagonal direction.
    const angle = (Math.PI / 4) + (Math.floor(Math.random() * 4) * (Math.PI / 2)) + (Math.random() - 0.5) * 0.5
    const sp = this._speed()
    b.vx = Math.cos(angle) * sp
    b.vy = Math.sin(angle) * sp

    // The tap that started the game must not also trigger a cloak.
    this.ignoreHoldUntilRelease = this.pointerDown
  }

  _die() {
    if (this.blob.dead) return
    this.blob.dead = true
    this.blob.cloaked = false
    this.monster = null // clear the arena for a clean game-over screen
    this.state = STATE.GAMEOVER
    this.gameOverAt = this.time
    this.shakeT = TUNING.shakeTime
    this.ignoreHoldUntilRelease = this.pointerDown

    if (this.score > this.best) {
      this.best = this.score
      this._saveBest(this.best)
    }
    // Burst from the composed dead-pose position (top-center) so the shards and
    // the dead sprite read as one on the game-over screen.
    this._spawnShards(this.AW * 0.5, this.AH * 0.3)
  }

  // --- helpers --------------------------------------------------------------
  _speed() {
    // Smooth, gradual ramp: the blob speeds up a little with every monster
    // cleared, so the game tightens the more you pass (capped so it stays fair).
    const mult = Math.min(TUNING.speedRampMax, 1 + TUNING.speedRampPerPoint * this.score)
    return TUNING.blobBaseSpeed * this.AH * mult
  }

  _rescaleVelocity() {
    // Keep direction, refresh magnitude to the current (score-ramped) speed.
    const b = this.blob
    const mag = Math.hypot(b.vx, b.vy) || 1
    const sp = this._speed()
    b.vx = (b.vx / mag) * sp
    b.vy = (b.vy / mag) * sp
  }

  _clampBlob() {
    const r = TUNING.blobDrawR * this.AH
    this.blob.x = clamp(this.blob.x, r, this.AW - r)
    this.blob.y = clamp(this.blob.y, r, this.AH - r)
  }

  _spawnMonster() {
    const mx = TUNING.spawnMargin
    const x = this.AW * (mx + Math.random() * (1 - 2 * mx))
    const y = this.AH * (mx + Math.random() * (1 - 2 * mx))
    this.monster = { x, y, cleared: false, tele: 0, age: 0, bob: Math.random() * Math.PI * 2 }
  }

  _spawnShards(x, y) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const s = (0.15 + Math.random() * 0.5) * this.AH
      this.shards.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - this.AH * 0.15,
        life: 0.5 + Math.random() * 0.4,
        max: 0.9,
        color: Math.random() < 0.7 ? COLORS.pink : COLORS.cheek,
        size: 1 + Math.floor(Math.random() * 2),
      })
    }
  }

  _loadBest() {
    try {
      return parseInt(localStorage.getItem('blobi.best') || '0', 10) || 0
    } catch {
      return 0
    }
  }

  _saveBest(v) {
    try {
      localStorage.setItem('blobi.best', String(v))
    } catch {
      /* ignore (private mode etc.) */
    }
  }

  // --- main loop ------------------------------------------------------------
  _frame(t) {
    if (!this.running) return
    let dt = (t - this.last) / 1000
    this.last = t
    if (dt > 0.1) dt = 0.1 // avoid huge catch-up steps after a pause
    this.acc += dt
    while (this.acc >= this.STEP) {
      this._update(this.STEP)
      this.acc -= this.STEP
    }
    this._syncState()
    this._render()
    requestAnimationFrame(this._frame)
  }

  // Push the discrete UI state (screen, score, best, cloak, retry-ready) to the
  // subscriber only when it actually changes, so the React overlay re-renders a
  // handful of times per game, not every frame.
  _syncState() {
    if (!this.onState) return
    const canRetry =
      this.state === STATE.GAMEOVER && this.time - this.gameOverAt >= TUNING.gameOverLockout
    const cloaked = this.state === STATE.PLAY && this.blob.cloaked
    const snap = `${this.state}|${this.score}|${this.best}|${cloaked ? 1 : 0}|${canRetry ? 1 : 0}`
    if (snap === this._lastSnap) return
    this._lastSnap = snap
    this.onState({ state: this.state, score: this.score, best: this.best, cloaked, canRetry })
  }

  _update(dt) {
    this.time += dt

    // Shards & shake always animate (also during game over).
    for (const s of this.shards) {
      s.life -= dt
      s.vy += this.AH * 1.6 * dt // gravity
      s.x += s.vx * dt
      s.y += s.vy * dt
    }
    this.shards = this.shards.filter((s) => s.life > 0)
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt)

    if (this.state !== STATE.PLAY) return

    const b = this.blob

    // Ease squash back toward round.
    b.squashX += (1 - b.squashX) * Math.min(1, dt * 14)
    b.squashY += (1 - b.squashY) * Math.min(1, dt * 14)

    // Keep speed in sync with the score ramp.
    this._rescaleVelocity()

    // Integrate.
    b.x += b.vx * dt
    b.y += b.vy * dt

    const r = TUNING.blobDrawR * this.AH

    if (b.cloaked) {
      // Invisible: no bouncing. Touching a wall = death (it "leaves" the arena).
      if (b.x - r <= 0 || b.x + r >= this.AW || b.y - r <= 0 || b.y + r >= this.AH) {
        b.x = clamp(b.x, r, this.AW - r)
        b.y = clamp(b.y, r, this.AH - r)
        this._die()
        return
      }
    } else {
      // Visible: classic wall bounce, preserving speed, with a squash pulse.
      let bounced = false
      if (b.x - r < 0) {
        b.x = r
        b.vx = Math.abs(b.vx)
        b.squashX = 0.7
        b.squashY = 1.3
        bounced = true
      } else if (b.x + r > this.AW) {
        b.x = this.AW - r
        b.vx = -Math.abs(b.vx)
        b.squashX = 0.7
        b.squashY = 1.3
        bounced = true
      }
      if (b.y - r < 0) {
        b.y = r
        b.vy = Math.abs(b.vy)
        b.squashX = 1.3
        b.squashY = 0.7
        bounced = true
      } else if (b.y + r > this.AH) {
        b.y = this.AH - r
        b.vy = -Math.abs(b.vy)
        b.squashX = 1.3
        b.squashY = 0.7
        bounced = true
      }
      void bounced
    }

    // Monster lifecycle.
    if (this.monster) {
      const m = this.monster
      if (m.tele < TUNING.spawnTelegraph) m.tele += dt
      m.bob += dt * 3
      const fullyPresent = m.tele >= TUNING.spawnTelegraph

      const dist = Math.hypot(b.x - m.x, b.y - m.y)
      const hitR = TUNING.blobHitR * this.AH + TUNING.monsterHitR * this.AH
      const overlapping = dist < hitR

      // An ignored monster does not sit forever: once it is fully present and the
      // blob is visible (not mid-phase), it ages, then wanders off so a new one
      // can pop up somewhere else. This keeps the beasts constantly moving around.
      if (fullyPresent && !m.cleared && !b.cloaked) {
        m.age += dt
        if (m.age >= TUNING.monsterLifetime) {
          this.monster = null
          this.spawnTimer = TUNING.relocateDelay
        }
      }

      if (this.monster) {
        if (b.cloaked) {
          // Phasing through while invisible: mark cleared, but do NOT remove yet.
          if (overlapping) m.cleared = true
        } else if (m.cleared) {
          // Passed through AND now visible again → score and despawn, then queue
          // the next monster (a little sooner as the score climbs).
          this.monster = null
          this.score += 1
          this.spawnTimer = Math.max(
            TUNING.spawnDelayMin,
            TUNING.spawnDelayBase - this.score * 0.02,
          )
        } else if (overlapping && fullyPresent) {
          // Touched a fully-present monster while visible → death.
          this._die()
          return
        }
      }
    } else {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) this._spawnMonster()
    }
  }

  // --- rendering ------------------------------------------------------------
  // Everything is painted straight onto the display canvas at full device
  // resolution. Sprites are drawn nearest-neighbor (crisp chunky pixels) and
  // carry a hard plum drop-shadow so they read as stickers, just like the
  // mockup. All text (HUD / title / game-over) is rendered by the DOM overlay.
  _render() {
    const g = this.dctx
    const S = this.scale
    const DW = this.display.width
    const DH = this.display.height
    const cloaked = this.state === STATE.PLAY && this.blob.cloaked

    g.save()
    g.imageSmoothingEnabled = false

    // Screen shake offset (art px → device px).
    if (this.shakeT > 0) {
      const k = this.shakeT / TUNING.shakeTime
      const ox = (Math.random() * 2 - 1) * TUNING.shakeMag * S * k
      const oy = (Math.random() * 2 - 1) * TUNING.shakeMag * S * k
      g.translate(Math.round(ox), Math.round(oy))
    }

    // Background gradient (deepens slightly while cloaked).
    const grad = g.createLinearGradient(0, 0, 0, DH)
    grad.addColorStop(0, cloaked ? COLORS.bgTopCloak : COLORS.bgTop)
    grad.addColorStop(0.6, cloaked ? COLORS.bgBottomCloak : COLORS.bgMid)
    grad.addColorStop(1, cloaked ? COLORS.bgBottomCloak : COLORS.bgBottom)
    g.fillStyle = grad
    g.fillRect(-DW, -DH, DW * 3, DH * 3)

    // Soft white dot texture, matching the mockup's 18px pixel grid.
    this._drawBackdropDots(g, DW, DH)

    // Monster (under the blob).
    if (this.monster) this._drawMonster(g, this.monster)

    // Blob (hidden entirely while cloaked; spec: no sprite, no trail, no ghost).
    if (this.state === STATE.TITLE) {
      this._drawBlob(g, this.AW * 0.5 * S, this.AH * 0.42 * S, false, 1, 1)
    } else if (this.state === STATE.GAMEOVER) {
      // Compose the dead blob top-center above the GAME OVER text (mockup layout),
      // rather than wherever it happened to hit, keeps the screen clean.
      this._drawBlob(g, this.AW * 0.5 * S, this.AH * 0.3 * S, true, 1, 1)
    } else if (!cloaked) {
      const b = this.blob
      this._drawBlob(g, b.x * S, b.y * S, b.dead, b.squashX, b.squashY)
    }

    // Shards on top.
    for (const s of this.shards) {
      g.globalAlpha = clamp(s.life / s.max, 0, 1)
      g.fillStyle = s.color
      const sz = Math.max(1, Math.round(s.size * S))
      g.fillRect(Math.round(s.x * S), Math.round(s.y * S), sz, sz)
    }
    g.globalAlpha = 1

    g.restore()

    // Game-over dim (unaffected by shake, drawn last; text sits above via DOM).
    if (this.state === STATE.GAMEOVER) {
      g.fillStyle = COLORS.overDim
      g.fillRect(0, 0, DW, DH)
    }
  }

  _drawBackdropDots(g, DW, DH) {
    const step = Math.max(8, Math.round(18 * this.dpr))
    const r = Math.max(1, Math.round(1.6 * this.dpr))
    g.fillStyle = 'rgba(255,255,255,0.45)'
    for (let y = step; y < DH; y += step) {
      for (let x = step; x < DW; x += step) {
        g.fillRect(x, y, r, r)
      }
    }
  }

  // Draw a sprite PNG centered at device px (cx,cy), scaled to a target height in
  // device px, crisp nearest-neighbor, with a hard offset drop-shadow (plum) so
  // it looks like the mockup's stickers.
  _drawSprite(g, img, cx, cy, targetH, sx = 1, sy = 1, shadow = true) {
    if (!img || !img.complete || !img.naturalWidth) return
    const scale = targetH / img.naturalHeight
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    g.save()
    g.imageSmoothingEnabled = false
    if (shadow) {
      g.shadowColor = 'rgba(109,44,82,0.22)'
      g.shadowBlur = 0
      g.shadowOffsetX = 3 * this.dpr
      g.shadowOffsetY = 4 * this.dpr
    }
    g.translate(cx, cy)
    g.scale(sx, sy)
    g.drawImage(img, -w / 2, -h / 2, w, h)
    g.restore()
  }

  // Blobi: the real mockup sprite (alive, or the dead pose).
  _drawBlob(g, cx, cy, dead, sx = 1, sy = 1) {
    if (dead) {
      this._drawSprite(g, this.sprites.dead, cx, cy, TUNING.deadSpriteH * this.AH * this.scale, 1, 1)
    } else {
      this._drawSprite(g, this.sprites.blob, cx, cy, TUNING.blobSpriteH * this.AH * this.scale, sx, sy)
    }
  }

  // GNASH: the real mockup sprite, with a pop-in scale and gentle idle bob.
  _drawMonster(g, m) {
    const pop = clamp(m.tele / TUNING.spawnTelegraph, 0, 1)
    // Ease-out-back pop-in.
    const s = pop < 1 ? 1.7 * pop - 0.7 * pop * pop : 1
    const targetH = TUNING.monsterSpriteH * this.AH * this.scale
    const bob = Math.sin(m.bob) * targetH * 0.05
    this._drawSprite(g, this.sprites.gnash, m.x * this.scale, m.y * this.scale + bob, targetH, s, s)
  }
}
