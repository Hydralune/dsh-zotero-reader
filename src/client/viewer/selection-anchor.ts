export interface ViewportRect { left: number; top: number; right: number; bottom: number }
export interface SelectionAnchor { x: number; y: number; bottom: number; viewport?: ViewportRect }

export function isScrollbarInteraction(event: { target: EventTarget | null; clientX: number; clientY: number }, root: HTMLElement) {
  if (event.target !== root) return false
  const rect = root.getBoundingClientRect()
  return event.clientX >= rect.right - Math.max(16, rect.right - rect.left - root.clientWidth) ||
    event.clientY >= rect.bottom - Math.max(16, rect.bottom - rect.top - root.clientHeight)
}

/** Anchor to a visible selected line; offscreen content retains its selection. */
export function visibleSelectionAnchor(rects: ViewportRect[], viewport: ViewportRect): SelectionAnchor | null {
  const visible = rects.find(rect => rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right)
  if (!visible) return null
  const left = Math.max(visible.left, viewport.left), right = Math.min(visible.right, viewport.right)
  return { x: (left + right) / 2, y: Math.max(visible.top, viewport.top), bottom: Math.min(visible.bottom, viewport.bottom), viewport }
}
