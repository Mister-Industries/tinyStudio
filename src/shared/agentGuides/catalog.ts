/**
 * The guides Studio AI can pull with read_guide — ids and one-line summaries
 * only. Kept apart from the guide content (./index.ts) so the system prompt and
 * tool schema can list the topics without bundling the screenshots eagerly.
 */

export const GUIDE_CATALOG = [
  {
    id: 'tinystudio',
    summary:
      'Tour of the app (screenshot): panels, the Code / Circuit / Visual views, opening projects, and the write → upload → serial → visual loop.'
  },
  {
    id: 'tinycore',
    summary:
      'tinyCore pinout diagram and full pin table (GPIO, ADC, buses), onboard LEDs / IMU / SD / Qwiic, ESP32-S3 pitfalls, and tested code patterns.'
  },
  {
    id: 'visual-js',
    summary:
      'How visual.js runs, the serial helpers, the `theme` object and tinyStudio visual style, and a reference sketch (screenshots in light and dark).'
  },
  {
    id: 'serial',
    summary:
      'How serial lines reach visual.js, exactly how numbers are parsed, and line formats that work for one value, many values, and events.'
  },
  {
    id: 'circuit-json',
    summary:
      'The circuit.json v2 format (Circuit view screenshot), pin refs, breadboard seating, and safe rules for editing a circuit by hand.'
  }
] as const

export type GuideId = (typeof GUIDE_CATALOG)[number]['id']

export const GUIDE_IDS = GUIDE_CATALOG.map((g) => g.id) as GuideId[]
