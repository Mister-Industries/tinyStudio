/**
 * circuit/views/captureAnimation: the "screenshot" flourish that plays when
 * the circuit view exports an image.
 *
 * Sequence: a shutter flash over the stage, the freshly-composed scene snaps
 * in as a framed print, shrinks a touch, then flies up to the export button in
 * the top-right corner where the download lands. Pure DOM + the Web Animations
 * API, so it owns no React state and cleans itself up when it settles.
 */

const REDUCED = '(prefers-reduced-motion: reduce)'

export interface CaptureAnimationOpts {
  /** The element that was "photographed"; the animation is drawn over it. */
  stage: HTMLElement | null
  /** Where the download lands (the export button). Falls back to the corner. */
  target?: HTMLElement | null
  /** data: URL of the exported scene. Omit for an untextured card. */
  imageUrl?: string
  /** Total run time in ms (default 1000). */
  duration?: number
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED).matches
}

/**
 * Play the capture animation. Always resolves; a failure to animate must
 * never stop the file from being saved.
 */
export async function playCaptureAnimation(opts: CaptureAnimationOpts): Promise<void> {
  const { stage, target, imageUrl, duration = 1000 } = opts
  if (!stage || typeof stage.animate !== 'function') return
  if (prefersReducedMotion()) {
    await flashOnly(stage)
    return
  }

  const stageBox = stage.getBoundingClientRect()
  if (stageBox.width < 80 || stageBox.height < 80) return

  const layer = document.createElement('div')
  layer.setAttribute('data-capture-layer', '')
  layer.style.cssText =
    'position:absolute;inset:0;z-index:60;pointer-events:none;overflow:hidden;border-radius:inherit'

  // ── shutter flash ─────────────────────────────────────────────────────────
  const flash = document.createElement('div')
  flash.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0'
  layer.appendChild(flash)

  // ── the "print": the exported scene, framed ───────────────────────────────
  const inset = 10
  const print = document.createElement('div')
  print.style.cssText = [
    'position:absolute',
    `left:${inset}px`,
    `top:${inset}px`,
    `width:${Math.max(1, stageBox.width - inset * 2)}px`,
    `height:${Math.max(1, stageBox.height - inset * 2)}px`,
    'border-radius:10px',
    'overflow:hidden',
    'opacity:0',
    'transform-origin:center center',
    'background:var(--bg-sunken, #1e1f22)',
    'box-shadow:0 18px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.16) inset',
    'will-change:transform,opacity'
  ].join(';')

  if (imageUrl) {
    const img = document.createElement('img')
    img.src = imageUrl
    img.alt = ''
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block'
    print.appendChild(img)
  }
  layer.appendChild(print)
  stage.appendChild(layer)

  // Where the print is headed: the export button, else the top-right corner.
  const targetBox = target?.getBoundingClientRect()
  const stageCx = stageBox.width / 2
  const stageCy = stageBox.height / 2
  const destCx = targetBox
    ? targetBox.left - stageBox.left + targetBox.width / 2
    : stageBox.width - 26
  const destCy = targetBox ? targetBox.top - stageBox.top + targetBox.height / 2 : 26
  const destW = targetBox?.width || 32
  const destH = targetBox?.height || 32
  const scale = Math.max(
    0.02,
    Math.min(destW / Math.max(1, stageBox.width), destH / Math.max(1, stageBox.height)) * 0.85
  )

  const flashAnim = flash.animate(
    [{ opacity: 0 }, { opacity: 0.72, offset: 0.3 }, { opacity: 0 }],
    { duration: Math.min(280, duration), easing: 'ease-out' }
  )

  const flight = `translate(${destCx - stageCx}px, ${destCy - stageCy}px)`
  const printAnim = print.animate(
    [
      // 1: the shutter is still white: nothing to see yet
      { transform: 'scale(1)', opacity: 0, offset: 0, easing: 'ease-out' },
      // 2: the print snaps in at full size, exactly over what was captured
      { transform: 'scale(1)', opacity: 1, offset: 0.12, easing: 'cubic-bezier(0.3, 1.2, 0.5, 1)' },
      // 3: it shrinks a bit and holds: this is the beat that reads "screenshot"
      { transform: 'scale(0.86)', opacity: 1, offset: 0.34, easing: 'linear' },
      {
        transform: 'scale(0.85)',
        opacity: 1,
        offset: 0.5,
        easing: 'cubic-bezier(0.55, 0, 0.3, 1)'
      },
      // 4: off to the corner the download lands in, landing before it fades
      {
        transform: `${flight} scale(${scale}) rotate(-5deg)`,
        opacity: 0.9,
        offset: 0.92,
        easing: 'ease-out'
      },
      { transform: `${flight} scale(${scale * 0.65}) rotate(-5deg)`, opacity: 0, offset: 1 }
    ],
    { duration, fill: 'forwards' }
  )

  // the corner catches it
  if (target && typeof target.animate === 'function') {
    target.animate(
      [
        { transform: 'scale(1)', offset: 0 },
        { transform: 'scale(1)', offset: 0.88 },
        { transform: 'scale(1.3)', offset: 0.95 },
        { transform: 'scale(1)', offset: 1 }
      ],
      { duration, easing: 'ease-out' }
    )
  }

  try {
    await Promise.all([safeFinish(flashAnim), safeFinish(printAnim)])
  } finally {
    layer.remove()
  }
}

/** Reduced-motion path: a single quiet flash, no flight. */
async function flashOnly(stage: HTMLElement): Promise<void> {
  const flash = document.createElement('div')
  flash.style.cssText =
    'position:absolute;inset:0;z-index:60;pointer-events:none;background:#fff;opacity:0'
  stage.appendChild(flash)
  try {
    await safeFinish(flash.animate([{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0 }], 220))
  } finally {
    flash.remove()
  }
}

async function safeFinish(a: Animation): Promise<void> {
  try {
    await a.finished
  } catch {
    /* cancelled: nothing to do */
  }
}
