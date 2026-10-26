/**
 * bin-map — Fritzing `.fzb` filename → tinyStudio pack id.
 *
 * Shared by the classifier (`split-parts-packs.mjs`, which uses bin membership
 * as its highest-confidence signal for where a part belongs) and the tab-icon
 * extractor (`bin-icons.mjs`, which needs the same mapping to know whose icon
 * it just read). One list, so the two can't drift.
 *
 * Only bins that map onto a pack are listed. `core.fzb` isn't: it's a curated
 * subset of the Core library rather than a section of it, so core parts are
 * classified by keyword instead. SparkFun's sub-bins aren't listed either —
 * their `.fzb` basename already *is* the pack id (`sparkfun-sensors.fzb` →
 * `sparkfun-sensors`), so they're matched by name.
 */
export const BIN_TO_PACK = {
  'arduino.fzb': 'arduino',
  'lilypad.fzb': 'lilypad',
  'picaxe.fzb': 'picaxe',
  'parallax.fzb': 'parallax',
  'seeed_fritzing_parts.fzb': 'seeed',
  'WeMos.fzb': 'wemos',
  'AnalogDevices.fzb': 'analog-devices',
  'Atlas Scientific.fzb': 'atlas-scientific',
  'infineon.fzb': 'infineon',
  'intel.fzb': 'intel',
  'spresense.fzb': 'spresense',
  'dagu.fzb': 'dagu',
  'frc.fzb': 'frc',
  'adafruit.fzb': 'adafruit',
  'voltage_regulators.fzb': 'voltage-regulators',
  'sim.fzb': 'simulator'
}
