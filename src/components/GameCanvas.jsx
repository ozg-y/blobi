import { useEffect, useRef, useState } from 'react'
import BlobiGame from '../game/blobiGame.js'

// Fonts (self-hosted, see index.css): the two typefaces from the design mockup.
const PIX = "'Press Start 2P', ui-monospace, monospace"
const UI = "'Nunito', -apple-system, BlinkMacSystemFont, sans-serif"

// --- Local scoreboard storage ------------------------------------------------
const NICK_KEY = 'blobi.nick'
const SCORES_KEY = 'blobi.scores'
const MAX_SCORES = 20

const loadNick = () => {
  try {
    return localStorage.getItem(NICK_KEY) || ''
  } catch {
    return ''
  }
}
const saveNick = (n) => {
  try {
    localStorage.setItem(NICK_KEY, n)
  } catch {
    /* ignore (private mode etc.) */
  }
}
const loadScores = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SCORES_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const saveScores = (list) => {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}
// Insert a run and keep the sorted top N.
const withScore = (list, name, score) =>
  [...list, { name, score }].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES)

/**
 * React shell around the framework-agnostic BlobiGame engine.
 *
 * The engine runs its own requestAnimationFrame loop and paints the animated
 * playfield (background, blob, monsters, shards) to the <canvas>. React owns the
 * crisp text overlay (HUD, title, game-over) in the real pixel font, plus the
 * nickname prompt and the local scoreboard. The engine pushes its discrete UI
 * state up through `game.onState`; gameplay stays 100% in the engine.
 */
export default function GameCanvas() {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const [ui, setUi] = useState({ state: 'TITLE', score: 0, best: 0, cloaked: false, canRetry: false })
  const [nick, setNick] = useState(loadNick())
  const [scores, setScores] = useState(loadScores())
  const [editingName, setEditingName] = useState(false)
  const prevState = useRef('TITLE')

  useEffect(() => {
    const canvas = canvasRef.current
    const game = new BlobiGame(canvas)
    gameRef.current = game
    game.onState = setUi
    setUi({ state: game.state, score: 0, best: game.best, cloaked: false, canRetry: false })
    if (import.meta.env.DEV) window.__game = game
    game.start()

    const down = (e) => {
      e.preventDefault()
      game.onPointerDown()
    }
    const up = (e) => {
      e.preventDefault()
      game.onPointerUp()
    }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)

    const onResize = () => game.resize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize)

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

  // Record a run on the play -> game-over transition (once per death).
  useEffect(() => {
    if (prevState.current !== 'GAMEOVER' && ui.state === 'GAMEOVER' && ui.score > 0) {
      setScores((prev) => {
        const next = withScore(prev, nick || 'YOU', ui.score)
        saveScores(next)
        return next
      })
    }
    prevState.current = ui.state
  }, [ui.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const needName = !nick
  const showNameEntry = needName || editingName

  const submitName = (n) => {
    setNick(n)
    saveNick(n)
    setEditingName(false)
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100vw', height: '100vh', touchAction: 'none' }}
      />
      <Overlay ui={ui} nick={nick} scores={scores} onChangeName={() => setEditingName(true)} />
      {showNameEntry && (
        <NameEntry
          initial={nick}
          onSubmit={submitName}
          onCancel={nick ? () => setEditingName(false) : null}
        />
      )}
    </>
  )
}

// --- Crisp DOM text overlay (pointer-transparent, except opt-in controls) ----

function Overlay({ ui, nick, scores, onChangeName }) {
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
      }}
    >
      {state === 'PLAY' && <Hud score={score} best={best} cloaked={cloaked} />}
      {state === 'TITLE' && (
        <Title best={best} nick={nick} scores={scores} onChangeName={onChangeName} />
      )}
      {state === 'GAMEOVER' && (
        <GameOver score={score} best={best} canRetry={canRetry} newBest={score > 0 && score >= best} />
      )}
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
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Title({ best, nick, scores, onChangeName }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '28%',
        textAlign: 'center',
        padding: '0 18px',
      }}
    >
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(38px, 14vw, 70px)',
          color: '#6d2c52',
          textShadow: '4px 4px 0 #9fd0ff',
          marginBottom: 'clamp(14px, 4vw, 22px)',
        }}
      >
        BLOBI
      </div>
      <div
        style={{
          fontFamily: UI,
          fontWeight: 800,
          fontSize: 'clamp(14px, 4.2vw, 19px)',
          lineHeight: 1.45,
          color: '#8a4a75',
          maxWidth: '420px',
          margin: '0 auto clamp(18px, 5vw, 28px)',
        }}
      >
        Hold to turn invisible and slip past the beasts. Survive as long as you can.
      </div>
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(13px, 4.2vw, 17px)',
          color: '#d63a7e',
          textShadow: '2px 2px 0 #6d2c52',
          animation: 'blobi-blink 1.4s steps(1) infinite',
          marginBottom: 'clamp(20px, 6vw, 30px)',
        }}
      >
        TAP TO START
      </div>
      <Scoreboard scores={scores} nick={nick} />
      <div style={{ fontFamily: PIX, fontSize: 'clamp(8px, 2.7vw, 11px)', color: '#a2497f', marginTop: '16px' }}>
        YOU: <span style={{ color: '#6d2c52' }}>{nick || 'YOU'}</span>{' '}
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onChangeName()
          }}
          style={{
            pointerEvents: 'auto',
            font: 'inherit',
            fontSize: 'clamp(8px, 2.7vw, 11px)',
            color: '#c05a92',
            background: 'transparent',
            border: '0',
            borderBottom: '2px solid #ffb8dd',
            padding: '2px 2px 1px',
            cursor: 'pointer',
          }}
        >
          CHANGE
        </button>
      </div>
    </div>
  )
}

function Scoreboard({ scores, nick }) {
  const top = scores.slice(0, 5)
  return (
    <div style={{ maxWidth: '300px', margin: '0 auto', textAlign: 'left' }}>
      <div
        style={{
          fontFamily: PIX,
          fontSize: 'clamp(10px, 3.2vw, 13px)',
          color: '#6d2c52',
          textAlign: 'center',
          marginBottom: '12px',
          letterSpacing: '0.04em',
        }}
      >
        SCOREBOARD
      </div>
      {top.length === 0 ? (
        <div
          style={{
            fontFamily: UI,
            fontWeight: 700,
            fontSize: 'clamp(12px, 3.6vw, 15px)',
            color: '#a2497f',
            textAlign: 'center',
          }}
        >
          No scores yet. Be the first!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {top.map((s, i) => {
            const me = s.name === (nick || 'YOU')
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontFamily: PIX,
                  fontSize: 'clamp(9px, 2.9vw, 12px)',
                  color: me ? '#d63a7e' : '#8a4a75',
                }}
              >
                <span style={{ color: '#c79ad0', width: '1.4em', flexShrink: 0 }}>{i + 1}</span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: me ? '#d63a7e' : '#6d2c52' }}>
                  {s.score}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GameOver({ score, best, canRetry, newBest }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '40%',
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
          marginBottom: 'clamp(16px, 5vw, 26px)',
        }}
      >
        GAME
        <br />
        OVER
      </div>
      {newBest && (
        <div
          style={{
            fontFamily: PIX,
            fontSize: 'clamp(11px, 3.6vw, 15px)',
            color: '#ffe27a',
            textShadow: '2px 2px 0 #6d2c52',
            marginBottom: 'clamp(14px, 4vw, 22px)',
            animation: 'blobi-blink 1s steps(1) infinite',
          }}
        >
          NEW BEST!
        </div>
      )}
      <div
        style={{
          display: 'inline-flex',
          gap: 'clamp(26px, 9vw, 44px)',
          marginBottom: 'clamp(24px, 8vw, 40px)',
        }}
      >
        <div style={{ fontFamily: PIX, fontSize: 'clamp(9px, 3vw, 12px)', color: '#ffd3e8' }}>
          SCORE
          <div
            style={{
              fontSize: 'clamp(18px, 6vw, 26px)',
              color: '#fff',
              marginTop: '9px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {score}
          </div>
        </div>
        <div style={{ fontFamily: PIX, fontSize: 'clamp(9px, 3vw, 12px)', color: '#ffb8dd' }}>
          BEST
          <div
            style={{
              fontSize: 'clamp(18px, 6vw, 26px)',
              color: '#ffd3e8',
              marginTop: '9px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
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

// --- Nickname prompt (interactive; blocks the game underneath) ----------------

function NameEntry({ initial, onSubmit, onCancel }) {
  const [val, setVal] = useState(initial || '')
  const inputRef = useRef(null)
  const clean = val.trim().toUpperCase().slice(0, 8)

  useEffect(() => {
    const id = setTimeout(() => inputRef.current && inputRef.current.focus(), 60)
    return () => clearTimeout(id)
  }, [])

  const submit = () => {
    if (clean) onSubmit(clean)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background:
          'linear-gradient(180deg, rgba(238,248,255,0.94) 0%, rgba(230,236,255,0.96) 100%)',
        backdropFilter: 'blur(2px)',
        zIndex: 20,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '340px',
          background: '#fff',
          border: '4px solid #6d2c52',
          borderRadius: '20px',
          boxShadow: '8px 10px 0 #ffb8dd',
          padding: 'clamp(22px, 6vw, 30px)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: PIX,
            fontSize: 'clamp(13px, 4vw, 16px)',
            color: '#6d2c52',
            lineHeight: 1.5,
            marginBottom: '6px',
          }}
        >
          WHO'S
          <br />
          PLAYING?
        </div>
        <div
          style={{
            fontFamily: UI,
            fontWeight: 700,
            fontSize: 'clamp(12px, 3.6vw, 15px)',
            color: '#8a4a75',
            marginBottom: '20px',
          }}
        >
          Enter a name for the scoreboard.
        </div>
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value.toUpperCase().slice(0, 8))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          maxLength={8}
          placeholder="NAME"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: '100%',
            fontFamily: PIX,
            fontSize: 'clamp(16px, 5vw, 22px)',
            textAlign: 'center',
            letterSpacing: '0.08em',
            color: '#d63a7e',
            padding: '12px 10px',
            border: '3px solid #6d2c52',
            borderRadius: '12px',
            outline: 'none',
            background: '#fff6fb',
            WebkitUserSelect: 'text',
            userSelect: 'text',
            touchAction: 'auto',
            marginBottom: '20px',
            textTransform: 'uppercase',
          }}
        />
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          {onCancel && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onCancel()
              }}
              style={btnStyle('#fff', '#8a4a75', '#c79ad0')}
            >
              CANCEL
            </button>
          )}
          <button
            type="button"
            disabled={!clean}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              submit()
            }}
            style={btnStyle(clean ? '#ff5b9e' : '#f0c4d9', '#fff', '#6d2c52')}
          >
            START
          </button>
        </div>
      </div>
    </div>
  )
}

const btnStyle = (bg, fg, border) => ({
  pointerEvents: 'auto',
  fontFamily: PIX,
  fontSize: 'clamp(11px, 3.4vw, 14px)',
  color: fg,
  background: bg,
  border: `3px solid ${border}`,
  borderRadius: '12px',
  padding: '12px 18px',
  cursor: 'pointer',
  boxShadow: `3px 3px 0 ${border}`,
})
