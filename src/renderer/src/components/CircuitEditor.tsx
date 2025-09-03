import { useSelector } from 'react-redux'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import circuitDiagram from '../assets/circuitdiagram.png'
import { RootState } from '../redux/store'

export function CircuitEditor(): React.JSX.Element {
  const diagramSvgContent = useSelector((state: RootState) => state.file.diagramSvgContent)

  const diagramElement = diagramSvgContent ? (
    <div
      className="size-full p-60 flex items-center justify-center [&>svg]:w-auto [&>svg]:h-auto [&>svg]:max-w-full [&>svg]:max-h-full"
      dangerouslySetInnerHTML={{ __html: diagramSvgContent }}
    />
  ) : (
    <img src={circuitDiagram} alt="Circuit diagram" className="size-fit object-contain" />
  )

  return (
    <div className="size-full flex items-center justify-center bg-background overflow-hidden">
      <TransformWrapper
        centerOnInit
        initialScale={1}
        wheel={{
          smoothStep: 0.01, // Changes the zoom speed
          touchPadDisabled: false // Enable pinch zoom on touchpads
        }}
        pinch={{ step: 10 }}
        // disablePadding
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          {diagramElement}
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
