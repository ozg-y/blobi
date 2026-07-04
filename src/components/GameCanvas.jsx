import { useEffect, useRef, useState } from 'react'
import BlobiGame from '../game/blobiGame.js'

// Fonts (self-hosted, see index.css): the two typefaces from the design mockup.
const PIX = "'Press Start 2P', ui-monospace, monospace"
const UI = "'Nunito', -apple-system, BlinkMacSystemFont, sans-serif"

/**
 * React shell around the framework-agnostic BlobiGame engine.
 *
 * The engine runs its own requestAnimationFrame loop and paints the animated
 * playfield (background, blob, monster, shards) to the <canvas>. React owns the
 * crisp text overlay (HUD, title and game-over) rendered with the real pixel
 * font so it stays razor-sharp at any device resolution, exactly like the design
 * mockup (which is DOM/CSS text layered over the art). The engine pushes its
 * discrete UI state up through `game.onState`; gameplay stays 100% in the engine.
 */
export default function GameCanvas() {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const [ui, setUi] = useState({
    state: 'TITLE',
    score: 0,
    best: 0,
    cloaked: false,
    canRetry: false,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const game = new BlobiGame(canvas)
    gameRef.current = game
    game.onState = setUi
    // Seed the overlay with the initial (title) state incl. the stored best.
    setUi({ state: game.state, score: 0, best: game.best, cloaked: false, canRetry: false })
    if (import.meta.env.DEV) window.__game = game
    game.start()

    // Pointer (covers touch + mouse for desktop testing).
    const down = (e) => {
      e.preventDefault()
      game.onPointerDown()
    }
    const up = (e) => {
      e.preventDefault()
      game.onPointerUp()
    }

    canvas.addEventListener('pointerdown', down)
    // Listen on window for up/cancel so releasing off-canvas still un-cloaks.
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)

    // Keep the canvas sized to the viewport.
    const onResize = () => game.resize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    // visualViewport catches the iOS URL-bar / safe-area settling.
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize)

    // Pause the loop when the app is backgrounded (saves battery, avoids dt spikes).
    const onVisibility = () => {
      if (document.hidden) game.stop()
      else game.start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      game.destroy()
    }
  }, [])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100vw',
          height: '100vh',
          touchAction: 'none',
        }}
      />
      <Overlay ui={ui} />
    </>
  )
}

// --- Crisp DOM text overlay (pointer-transparent) ---------------------------

function Overlay({ ui }) {
  const { state, score, best, cloaked, canRetry } = ui
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        fontFamily: PIX,
        // Nudge everything below the notch on iOS.
        // (individual blocks add their own offsets.)
      }}
    >
      {(state === 'PLAY') && <Hud score={score} best={best} cloaked={cloaked} />}
      {state === 'TITLE' && <Title best={best} />}
      {state === 'GAMEOVER' && <GameOver score={score} best={best} canRetry={canRetry} />}
    </div>
  )
}

function Hud({ score, best, cloaked }) {
  const pad = 'clamp(16px, 5.5vw, 26px)'
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        left: pad,
        right: pad,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}
    >
      <Stat label="SCORE" value={score} labelColor="#6d2c52" valueColor="#d63a7e" />
      {cloaked ? (
        <div
          style={{
            fontFamily: PIX,
            fontSize: 'clamp(9px, 3vw, 13px)',
            color: '#7a4bb0',
            letterSpacing: '0.05em',
            textAlign: 'right',
            paddingTop: '3px',
          }}
        >
          CLOAKED
        </div>
      ) : (
        <Stat label="BEST" value={best} labelColor="#a2497f" valueColor="#a2497f" align="right" />
      )}
    </div>
  )
}

function Stat({ label, value, labelColor, valueColor, align = 'left' }) {
  return (
    <div style={{ textAlign: align, lineHeight: 1 }}>
      <div style={{ fontFamily: PIX, fontSize: 'clamp(9px, 3vw, 13px)', color: labelColor }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(16px, 5.4vw, 24px)',
          color: valueColor,
          marginTop: '9px',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Title({ best }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '52%',
        textAlign: 'center',
        padding: '0 18px',
      }}
    >
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(40px, 15vw, 76px)',
          color: '#6d2c52',
          textShadow: '4px 4px 0 #9fd0ff',
          marginBottom: 'clamp(20px, 6vw, 34px)',
        }}
      >
        BLOBI
      </div>
      <div
        style={{
          fontFamily: UI,
          fontWeight: 800,
          fontSize: 'clamp(15px, 4.6vw, 21px)',
          lineHeight: 1.5,
          color: '#8a4a75',
          maxWidth: '440px',
          margin: '0 auto clamp(30px, 9vw, 48px)',
        }}
      >
        Tap &amp; hold to turn invisible and phase past the beasts. You go
        blind and can&apos;t bounce off walls.
      </div>
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(13px, 4.4vw, 18px)',
          color: '#d63a7e',
          textShadow: '2px 2px 0 #6d2c52',
          animation: 'blobi-blink 1.4s steps(1) infinite',
          marginBottom: 'clamp(26px, 8vw, 40px)',
        }}
      >
        TAP TO START
      </div>
      <div style={{ fontFamily: PIX, fontSize: 'clamp(9px, 3vw, 12px)', color: '#a2497f' }}>
        BEST {best}
      </div>
    </div>
  )
}

function GameOver({ score, best, canRetry }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        textAlign: 'center',
        padding: '0 18px',
      }}
    >
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(34px, 12vw, 60px)',
          lineHeight: 1.15,
          color: '#ff5b9e',
          textShadow: '3px 3px 0 #6d2c52',
          marginBottom: 'clamp(26px, 8vw, 40px)',
        }}
      >
        GAME
        <br />
        OVER
      </div>
      <div
        style={{
          display: 'inline-flex',
          gap: 'clamp(26px, 9vw, 44px)',
          marginBottom: 'clamp(28px, 9vw, 44px)',
        }}
      >
        <div style={{ fontFamily: PIX, fontSize: 'clamp(9px, 3vw, 12px)', color: '#ffd3e8' }}>
          SCORE
          <div style={{ fontSize: 'clamp(18px, 6vw, 26px)', color: '#fff', marginTop: '9px' }}>
            {score}
          </div>
        </div>
        <div style={{ fontFamily: PIX, fontSize: 'clamp(9px, 3vw, 12px)', color: '#ffb8dd' }}>
          BEST
          <div style={{ fontSize: 'clamp(18px, 6vw, 26px)', color: '#ffd3e8', marginTop: '9px' }}>
            {best}
          </div>
        </div>
      </div>
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(12px, 4vw, 16px)',
          color: '#fff',
          visibility: canRetry ? 'visible' : 'hidden',
          animation: 'blobi-blink 1.4s steps(1) infinite',
        }}
      >
        TAP TO RETRY
      </div>
    </div>
  )
}
