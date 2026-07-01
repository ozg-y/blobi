import { useEffect, useRef } from 'react'
import BlobiGame from '../game/blobiGame.js'

/**
 * Thin React shell around the framework-agnostic BlobiGame engine.
 * The game runs its own requestAnimationFrame loop on a canvas — React only
 * mounts/unmounts it and wires up pointer + resize events. Keeping the game loop
 * out of React's render cycle is the standard pattern for canvas games.
 */
export default function GameCanvas() {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const game = new BlobiGame(canvas)
    gameRef.current = game
    // Dev-only handle so the game can be driven/inspected from the console.
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

    // Keep the buffer/display sized to the viewport.
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
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100vw',
        height: '100vh',
        // Fill the whole screen including the notch/home-indicator zone.
        touchAction: 'none',
      }}
    />
  )
}
