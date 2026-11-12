/**
 * circuit/views/canvas/SolderLayer: solder joints on a tinyProto. Every hole a
 * part's lead is seated in, a stacked board's header pin comes through, or a
 * wire ends in gets a joint, on both faces of the board. Breadboards are
 * plug-in, so they get none. Purely visual: the connection itself is the seat
 * or the wire.
 *
 * A joint is a fillet, not a ball: a concave cone of solder that flares out
 * from the lead to the edge of the pad, like a little volcano, with the lead
 * (or header post, or wire end) poking up out of the middle. Lit from the top
 * left like the part art: the wide foot is nearly flat and evenly lit, and the
 * steep wall hugging the lead is where the light and shade are sharpest,
 * which is what reads as concave. A blob shaded as a dome reads as a bead of
 * tin (it looked like an onion).
 */

import React from 'react'
import type { CircuitDoc } from '../../core/model'
import type { Seat } from '../partsAdapter'
import { solderJoints, type JointKind } from '../solder'

/** the foot of the fillet, out to the edge of the tinyProto's ~3.3 px pads */
const FOOT_R = 3.9
/** the steep collar wetted up the lead, where the light and shade are sharpest */
const COLLAR_R = 3.1

const Tip = React.memo(function Tip({ kind }: { kind: JointKind }): React.JSX.Element {
  if (kind === 'header')
    // a 0.64 mm square post, gold, clipped flat
    return (
      <>
        <rect x={-0.55} y={-0.25} width={1.9} height={1.9} rx={0.3} fill="#000" opacity={0.28} />
        <rect
          x={-0.95}
          y={-0.95}
          width={1.9}
          height={1.9}
          rx={0.3}
          fill="url(#sj-post)"
          stroke="#7a5b16"
          strokeWidth={0.3}
        />
        <rect x={-0.6} y={-0.62} width={0.8} height={0.5} rx={0.2} fill="#fff8de" opacity={0.8} />
      </>
    )
  // a round component lead, or a wire's tinned copper end
  return (
    <>
      <circle cx={0.3} cy={0.35} r={1.1} fill="#000" opacity={0.3} />
      <circle
        r={1.05}
        fill={kind === 'wire' ? 'url(#sj-copper)' : 'url(#sj-lead)'}
        stroke={kind === 'wire' ? '#7c4a22' : '#555b62'}
        strokeWidth={0.3}
      />
      <circle cx={-0.35} cy={-0.38} r={0.33} fill="#fff" opacity={0.85} />
    </>
  )
})

export function SolderLayer({
  doc,
  seats,
  zIndex = 5
}: {
  doc: CircuitDoc
  seats: Seat[]
  zIndex?: number
}): React.JSX.Element | null {
  const joints = React.useMemo(() => solderJoints(doc, seats), [doc, seats])
  if (!joints.length) return null
  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'visible',
        zIndex,
        pointerEvents: 'none'
      }}
      aria-hidden
    >
      <defs>
        {/* the foot: nearly flat, so evenly lit, a little darker away from the light */}
        <linearGradient id="sj-foot" x1="0.1" y1="0.1" x2="0.9" y2="0.9">
          <stop offset="0" stopColor="#d9dde1" />
          <stop offset="1" stopColor="#a3aab1" />
        </linearGradient>
        {/* where the solder thins out onto the pad */}
        <radialGradient id="sj-rim">
          <stop offset="0.8" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#2e3439" stopOpacity="0.5" />
        </radialGradient>
        {/* the collar: steep, so lit hard on the near side and dark on the far */}
        <linearGradient id="sj-steep" x1="0.15" y1="0.15" x2="0.85" y2="0.85">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#b9c0c6" />
          <stop offset="1" stopColor="#4a5057" />
        </linearGradient>
        <radialGradient id="sj-fade">
          <stop offset="0.35" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* the collar blends into the foot: no edge between them */}
        <mask id="sj-collar" maskContentUnits="userSpaceOnUse">
          <circle r={COLLAR_R} fill="url(#sj-fade)" />
        </mask>
        <radialGradient id="sj-lead" cx="0.4" cy="0.4" r="0.65">
          <stop offset="0" stopColor="#f2f4f6" />
          <stop offset="1" stopColor="#7f868d" />
        </radialGradient>
        <radialGradient id="sj-copper" cx="0.4" cy="0.4" r="0.65">
          <stop offset="0" stopColor="#f1c08f" />
          <stop offset="1" stopColor="#a8622c" />
        </radialGradient>
        <linearGradient id="sj-post" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6dc8c" />
          <stop offset="1" stopColor="#b58b28" />
        </linearGradient>
      </defs>
      {joints.map(({ key, pos, kind }) => (
        <g key={key} data-solder={key} data-kind={kind} transform={`translate(${pos.x} ${pos.y})`}>
          <circle r={FOOT_R} fill="url(#sj-foot)" />
          <circle r={FOOT_R} fill="url(#sj-rim)" />
          <g mask="url(#sj-collar)">
            <circle r={COLLAR_R} fill="url(#sj-steep)" />
          </g>
          {/* a faint sheen on the lit side of the wide, shallow foot */}
          <path
            d="M -3.2 0.9 A 3.3 3.3 0 0 1 0.9 -3.2"
            fill="none"
            stroke="#fff"
            strokeOpacity={0.35}
            strokeWidth={0.35}
            strokeLinecap="round"
          />
          {/* the steep wall hugging the lead: a bright crescent toward the
              light, a dark one away from it. Hard and close in is what makes
              the fillet read as concave rather than a dome */}
          <path
            d="M -1.75 0.35 A 1.8 1.8 0 0 1 0.35 -1.75"
            fill="none"
            stroke="#fff"
            strokeOpacity={0.95}
            strokeWidth={0.55}
            strokeLinecap="round"
          />
          <path
            d="M 1.85 -0.35 A 1.9 1.9 0 0 1 -0.35 1.85"
            fill="none"
            stroke="#3a4046"
            strokeOpacity={0.5}
            strokeWidth={0.6}
            strokeLinecap="round"
          />
          <Tip kind={kind} />
        </g>
      ))}
    </svg>
  )
}
