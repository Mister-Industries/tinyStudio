import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import circuitDiagram from '../assets/circuitdiagram.png'

export function CircuitEditor(): React.JSX.Element {
  return (
    <div className="size-full flex items-center justify-center bg-background overflow-hidden">
      <TransformWrapper
        centerOnInit
        centerZoomedOut
        initialScale={2}
        wheel={{ step: 0.8 }}
        pinch={{ step: 10 }}
      >
        <TransformComponent>
          <img src={circuitDiagram} alt="Circuit placeholder" className="size-fit object-contain" />
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
