/**
 * agentGuides — the reference guides behind Studio AI's read_guide tool.
 *
 * Markdown and screenshots are bundled with the app (Vite `?raw` / `?inline`),
 * so they work the same on desktop and web and never depend on what's in the
 * user's workspace. agentCore imports this module lazily: the screenshots are a
 * few hundred KB of base64 and only load the first time the model asks.
 *
 * Refresh the screenshots with scripts/capture-agent-screens.mjs after UI changes.
 */

import { tinyCorePinTable } from '../tinycorePins'
import type { GuideId } from './catalog'
import circuitJson from './circuit-json.md?raw'
import serial from './serial.md?raw'
import tinycore from './tinycore.md?raw'
import tinystudio from './tinystudio.md?raw'
import visualJs from './visual-js.md?raw'
import appCircuit from './screens/app-circuit.jpg?inline'
import appCode from './screens/app-code.jpg?inline'
import appVisual from './screens/app-visual.jpg?inline'
import tinycorePinout from './screens/tinycore-pinout.png?inline'
import visualReference from './screens/visual-reference.jpg?inline'

export interface GuideImage {
  caption: string
  mediaType: 'image/jpeg' | 'image/png'
  /** base64, no data: prefix */
  data: string
}

export interface Guide {
  id: GuideId
  markdown: string
  images: GuideImage[]
}

const GUIDES: Record<GuideId, { markdown: string; images: [dataUrl: string, caption: string][] }> =
  {
    tinystudio: {
      markdown: tinystudio,
      images: [
        [
          appCode,
          'The Code view with the blink-basic example open in the web build (not yet saved to a folder): Files on the left, the .ino in the editor with the Serial Monitor / Output dock below, the right panel on its Docs tab rendering README.md (Examples and Studio AI are the other tabs), and the Code | Circuit | Visual switch at the top right.'
        ]
      ]
    },
    tinycore: {
      markdown: tinycore.replace('{{PIN_TABLE}}', tinyCorePinTable()),
      images: [[tinycorePinout, 'Official tinyCore V2 pinout (MR.INDUSTRIES).']]
    },
    'visual-js': {
      markdown: visualJs,
      images: [
        [
          appVisual,
          "The Visual view running a new project's default visual.js (the themed serial plotter), fed with test data: sketch picker and Pause / Restart on the bar, the square sketch frame below."
        ],
        [
          visualReference,
          'The reference sketch from this guide with live data — light theme on the left, dark theme on the right. This is the target look.'
        ]
      ]
    },
    serial: { markdown: serial, images: [] },
    'circuit-json': {
      markdown: circuitJson,
      images: [
        [
          appCircuit,
          'The Circuit view (Breadboard) for the blink-basic example: a tinyCore with D13 → resistor → LED → GND, and an AA battery pack wired to pins 8 and 9. Breadboard | Schematic, Simulate and Export sit on the canvas toolbar; Files shows the circuit.json converted from the old diagram.json (kept as diagram.json.bak).'
        ]
      ]
    }
  }

function image(dataUrl: string, caption: string): GuideImage {
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/s.exec(dataUrl)
  if (!m) throw new Error(`Guide screenshot "${caption}" is not an inlined base64 image.`)
  return { caption, mediaType: m[1] as GuideImage['mediaType'], data: m[2] }
}

export function loadGuide(id: GuideId): Guide {
  const g = GUIDES[id]
  return { id, markdown: g.markdown, images: g.images.map(([url, caption]) => image(url, caption)) }
}
