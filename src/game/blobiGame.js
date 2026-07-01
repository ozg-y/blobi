/**
 * BLOBI — core game engine (framework-agnostic).
 *
 * A one-thumb pixel-art arcade game. A pink blob auto-drifts and bounces off the
 * walls. A small monster (GNASH) pops up. Tap & hold to cloak: the blob turns
 * invisible and phases through the monster, but stops bouncing and dies if it
 * drifts into a wall. Release before you hit an edge, and the passed monster
 * vanishes for a point.
 *
 * Rendering: the whole scene is drawn into a small low-resolution offscreen
 * buffer, then blitted to the display canvas with image smoothing OFF, giving an
 * authentic chunky pixel-art look at any device size.
 *
 * The class is intentionally UI-framework-free so it can be mounted from React,
 * plain JS, or anything else. See components/GameCanvas.jsx for the React shell.
 *
 * Sprites: the exact pixel-art PNGs from the original mockup (Blobi alive/splat,
 * GNASH) are drawn with image smoothing OFF so they look identical to the design.
 */

// Real mockup sprites (Vite turns these into bundled asset URLs).
import blobiPng from '../assets/blobi.png'
import blobiDeadPng from '../assets/blobi_dead.png'
import gnashPng from '../assets/gnash.png'

// ---- Palette (from the mockup / spec) ---------------------------------------
const COLORS = {
  bgTop: '#eef8ff',
  bgBottom: '#e6ecff',
  bgTopCloak: '#dbe8ff',
  bgBottomCloak: '#c9d6f2',
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

// ---- Tuning knobs (spec section 9) — everything balance-able lives here ------
const TUNING = {
  // Speeds/sizes are fractions of the art-buffer HEIGHT so they scale with the screen.
  blobBaseSpeed: 0.17, // fraction of art-height per second (spec suggests ~0.04; bumped for arcade feel)
  speedRampPer5: 0.05, // +5% every 5 points
  speedRampMax: 2.2, // cap the multiplier so it never gets impossible
  blobDrawR: 0.052, // physics radius (wall bounce / cloak-death boundary)
  blobHitR: 0.032, // forgiving hitbox for monster contact
  monsterHitR: 0.03, // monster contact hitbox
  // Sprite draw sizes, as a fraction of art-height (the PNGs have transparent margins).
  blobSpriteH: 0.15,
  deadSpriteH: 0.16,
  monsterSpriteH: 0.135,
  spawnMargin: 0.2, // >= 20% from every edge
  spawnTelegraph: 0.28, // seconds of pop-in
  spawnDelayBase: 0.55, // pause before the next monster appears
  spawnDelayMin: 0.25, // shrinks with score
  shakeTime: 0.5, // seconds of screen shake on death
  shakeMag: 5, // art-pixels of shake amplitude
  gameOverLockout: 0.6, // seconds before a retry tap is accepted
  artHeight: 260, // low-res buffer height in "art pixels"
}

const STATE = { TITLE: 'TITLE', PLAY: 'PLAY', GAMEOVER: 'GAMEOVER' }

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export default class BlobiGame {
  constructor(displayCanvas) {
    this.display = displayCanvas
    this.dctx = displayCanvas.getContext('2d')

    // Offscreen low-res buffer we actually paint into.
    this.buffer = document.createElement('canvas')
    this.bctx = this.buffer.getContext('2d')

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

    // Art buffer keeps a fixed height; width follows the device aspect ratio.
    this.AH = TUNING.artHeight
    this.AW = Math.max(120, Math.round(this.AH * (w / h)))
    this.buffer.width = this.AW
    this.buffer.height = this.AH

    this.dctx.imageSmoothingEnabled = false
    this.bctx.imageSmoothingEnabled = false

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
    this._spawnShards(this.blob.x, this.blob.y)
  }

  // --- helpers --------------------------------------------------------------
  _speed() {
    const mult = Math.min(TUNING.speedRampMax, 1 + TUNING.speedRampPer5 * Math.floor(this.score / 5))
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
    this.monster = { x, y, cleared: false, tele: 0, bob: Math.random() * Math.PI * 2 }
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
    this._render()
    requestAnimationFrame(this._frame)
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

      const dist = Math.hypot(b.x - m.x, b.y - m.y)
      const hitR = TUNING.blobHitR * this.AH + TUNING.monsterHitR * this.AH
      const overlapping = dist < hitR

      if (b.cloaked) {
        // Phasing through: mark cleared, but do NOT remove yet.
        if (overlapping) m.cleared = true
      } else {
        if (m.cleared) {
          // Passed through AND now visible again → score and despawn.
          this.monster = null
          this.score += 1
          this.spawnTimer = Math.max(
            TUNING.spawnDelayMin,
            TUNING.spawnDelayBase - this.score * 0.02,
          )
        } else if (overlapping && m.tele >= TUNING.spawnTelegraph * 0.5) {
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
  _render() {
    const g = this.bctx
    const W = this.AW
    const H = this.AH
    const cloaked = this.state === STATE.PLAY && this.blob.cloaked

    g.save()

    // Screen shake offset.
    if (this.shakeT > 0) {
      const k = this.shakeT / TUNING.shakeTime
      const ox = (Math.random() * 2 - 1) * TUNING.shakeMag * k
      const oy = (Math.random() * 2 - 1) * TUNING.shakeMag * k
      g.translate(Math.round(ox), Math.round(oy))
    }

    // Background gradient (deepens while cloaked).
    const grad = g.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, cloaked ? COLORS.bgTopCloak : COLORS.bgTop)
    grad.addColorStop(1, cloaked ? COLORS.bgBottomCloak : COLORS.bgBottom)
    g.fillStyle = grad
    g.fillRect(-20, -20, W + 40, H + 40)

    // Subtle pixel-grid dots for texture.
    this._drawBackdropDots(g, W, H, cloaked)

    // Monster (under the blob).
    if (this.monster) this._drawMonster(g, this.monster)

    // Blob (hidden entirely while cloaked — spec: no sprite, no trail, no ghost).
    if (this.state === STATE.TITLE) {
      this._drawBlob(g, W * 0.5, H * 0.42, false, 1, 1)
    } else if (!cloaked) {
      const b = this.blob
      this._drawBlob(g, b.x, b.y, b.dead, b.squashX, b.squashY)
    }

    // Shards on top.
    for (const s of this.shards) {
      g.globalAlpha = clamp(s.life / s.max, 0, 1)
      g.fillStyle = s.color
      g.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size)
    }
    g.globalAlpha = 1

    // HUD + screen text.
    this._drawHud(g, W, H)

    g.restore()

    // Blit low-res buffer → display, nearest-neighbor (chunky pixels).
    this.dctx.imageSmoothingEnabled = false
    this.dctx.clearRect(0, 0, this.display.width, this.display.height)
    this.dctx.drawImage(this.buffer, 0, 0, this.display.width, this.display.height)
  }

  _drawBackdropDots(g, W, H, cloaked) {
    g.fillStyle = cloaked ? 'rgba(109,44,82,0.06)' : 'rgba(109,44,82,0.045)'
    const step = 12
    for (let y = step; y < H; y += step) {
      for (let x = step; x < W; x += step) {
        g.fillRect(x, y, 1, 1)
      }
    }
  }

  // Draw a sprite PNG centered at (cx,cy), scaled to a target height in art px,
  // with crisp nearest-neighbor pixels. Returns silently until the image loads.
  _drawSprite(g, img, cx, cy, targetH, sx = 1, sy = 1) {
    if (!img || !img.complete || !img.naturalWidth) return
    const scale = targetH / img.naturalHeight
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    g.save()
    g.translate(cx, cy)
    g.scale(sx, sy)
    g.imageSmoothingEnabled = false
    g.drawImage(img, -w / 2, -h / 2, w, h)
    g.restore()
  }

  // Blobi — the real mockup sprite (alive, or the splat when dead).
  _drawBlob(g, cx, cy, dead, sx = 1, sy = 1) {
    if (dead) {
      this._drawSprite(g, this.sprites.dead, cx, cy, TUNING.deadSpriteH * this.AH, 1, 1)
    } else {
      this._drawSprite(g, this.sprites.blob, cx, cy, TUNING.blobSpriteH * this.AH, sx, sy)
    }
  }

  // GNASH — the real mockup sprite, with a pop-in scale and gentle idle bob.
  _drawMonster(g, m) {
    const pop = clamp(m.tele / TUNING.spawnTelegraph, 0, 1)
    // Ease-out-back pop-in.
    const s = pop < 1 ? 1.7 * pop - 0.7 * pop * pop : 1
    const targetH = TUNING.monsterSpriteH * this.AH
    const bob = Math.sin(m.bob) * targetH * 0.05
    this._drawSprite(g, this.sprites.gnash, m.x, m.y + bob, targetH, s, s)
  }

  // --- HUD & overlays -------------------------------------------------------
  _pixelText(g, text, x, y, size, color, align = 'left', shadow = true) {
    g.font = `bold ${size}px "Courier New", ui-monospace, monospace`
    g.textAlign = align
    g.textBaseline = 'middle'
    g.lineWidth = 0
    if (shadow) {
      g.fillStyle = COLORS.hudShadow
      g.fillText(text, x + 1, y + 1)
    }
    g.fillStyle = color
    g.fillText(text, x, y)
  }

  // Stacked "LABEL / value" HUD block, like the mockup.
  _hudStat(g, label, value, x, y, align) {
    this._pixelText(g, label, x, y, 7, COLORS.hudText, align)
    this._pixelText(g, String(value), x, y + 11, 15, COLORS.hudText, align)
  }

  _drawHud(g, W, H) {
    // Approximate iOS safe-area top inset in art pixels.
    const topPad = 12

    if (this.state === STATE.PLAY || this.state === STATE.GAMEOVER) {
      this._hudStat(g, 'SCORE', this.score, 6, topPad, 'left')
      this._hudStat(g, 'BEST', this.best, W - 6, topPad, 'right')
    }

    if (this.state === STATE.TITLE) {
      this._pixelText(g, 'BLOBI', W * 0.5, H * 0.6, 30, COLORS.plum, 'center')
      this._pixelText(g, 'hold to cloak', W * 0.5, H * 0.69, 9, COLORS.cheek, 'center')
      this._pixelText(g, 'phase past GNASH', W * 0.5, H * 0.725, 9, COLORS.cheek, 'center')
      if (Math.floor(this.time * 1.6) % 2 === 0) {
        this._pixelText(g, 'TAP TO START', W * 0.5, H * 0.84, 12, COLORS.plum, 'center')
      }
      this._pixelText(g, `BEST ${this.best}`, W * 0.5, H * 0.92, 9, COLORS.hudText, 'center')
    }

    if (this.state === STATE.GAMEOVER) {
      // Dim overlay.
      g.fillStyle = 'rgba(40,30,60,0.35)'
      g.fillRect(-20, -20, W + 40, H + 40)

      this._pixelText(g, 'GAME OVER', W * 0.5, H * 0.36, 18, '#ffffff', 'center')
      this._pixelText(g, `SCORE ${this.score}`, W * 0.5, H * 0.45, 13, '#ffe3f1', 'center', false)
      this._pixelText(g, `BEST ${this.best}`, W * 0.5, H * 0.51, 11, '#ffe3f1', 'center', false)

      if (
        this.time - this.gameOverAt >= TUNING.gameOverLockout &&
        Math.floor(this.time * 1.6) % 2 === 0
      ) {
        this._pixelText(g, 'TAP TO RETRY', W * 0.5, H * 0.66, 13, '#ffffff', 'center', false)
      }
    }
  }
}
