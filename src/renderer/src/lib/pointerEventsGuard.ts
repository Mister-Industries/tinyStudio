/**
 * Safety net for a Radix UI quirk that can freeze the whole UI.
 *
 * Modal Radix layers (Dialog, DropdownMenu, Select, AlertDialog) block clicks
 * outside themselves by setting `document.body.style.pointerEvents = 'none'`,
 * remembering the previous value, and restoring it when they close. If one
 * layer opens while another is still closing (e.g. a menu item that opens a
 * dialog while the menu fades out), the second layer can record `'none'` as
 * the "original" value and put it back when it closes, leaving nothing in the
 * app clickable. It is far more likely when the primitives end up bundled with
 * separate copies of `@radix-ui/react-dismissable-layer`.
 *
 * This guard watches the body and, whenever pointer events are disabled while
 * no modal layer is actually open, clears the stale lock.
 */

const OPEN_MODAL_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[data-slot="select-content"][data-state="open"]'
].join(',')

function releaseIfStale(): void {
  const body = document.body
  if (body.style.pointerEvents !== 'none') return
  if (document.querySelector(OPEN_MODAL_SELECTOR)) return
  body.style.pointerEvents = ''
}

let installed = false

export function installPointerEventsGuard(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  let frame = 0
  const schedule = (): void => {
    cancelAnimationFrame(frame)
    // Wait a frame so a layer that is mounting in the same tick (menu closes,
    // dialog opens) is in the DOM before we decide nothing is open.
    frame = requestAnimationFrame(releaseIfStale)
  }

  // Style changes on <body> (the lock itself) and portal add/remove (a layer
  // finishing its exit animation) are the moments the lock can go stale.
  new MutationObserver(schedule).observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
    childList: true
  })

  // Belt and braces: any click attempt re-checks. With the body locked,
  // events still reach the window in the capture phase.
  window.addEventListener('pointerdown', releaseIfStale, true)
}
