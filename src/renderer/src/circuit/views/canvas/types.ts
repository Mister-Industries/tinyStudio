/**
 * circuit/views/canvas/types: interaction state shared by the canvas and its layers.
 * Ephemeral: none of this is ever written to the document.
 */

import type React from 'react'
import type { Pt } from '../../core/model'

export type HandleKind = 'vertex' | 'edge' | 'endpoint'

/** A wire being drawn: it always starts on a pin. */
export interface Armed {
  from: string // "part:pin"
  points: Pt[]
  straight: boolean
}

export type HoverPin = { id: string; pin: string } | null
export type HoverHole = { id: string; pin: string; pos: Pt } | null
export type SetState<T> = React.Dispatch<React.SetStateAction<T>>
