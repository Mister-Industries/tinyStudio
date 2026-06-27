import { useSelector } from 'react-redux'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import circuitDiagram from '../assets/circuitdiagram.png'
import { RootState } from '../redux/store'

interface CircuitEditorProps {
  svgContent?: string
}

export function CircuitEditor({ svgContent }: CircuitEditorProps): React.JSX.Element {
  const diagramSvgContent = useSelector((state: RootState) => state.file.diagramSvgContent)
  const activeSvgContent = svgContent || diagramSvgContent

  const diagramElement = activeSvgContent ? (
    <div
      className="size-1/2 z-30 flex items-center justify-center [&>svg]:w-auto [&>svg]:h-auto [&>svg]:max-w-full [&>svg]:max-h-full"
      dangerouslySetInnerHTML={{ __html: activeSvgContent }}
    />
  ) : (
    <img src={circuitDiagram} alt="Circuit diagram" className="size-fit object-contain" />
  )

  return (
    <div className="size-full flex items-center justify-center bg-bg-sunken overflow-hidden">
      <TransformWrapper
        centerOnInit
        centerZoomedOut
        initialScale={1.8}
        maxScale={5}
        minScale={1.8}
        wheel={{
          smoothStep: 0.01,
          touchPadDisabled: false
        }}
        pinch={{ step: 10 }}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            className="absolute -inset-20"
            style={{
              backgroundImage: 'radial-gradient(var(--dot-color) 1.1px, transparent 1.1px)',
              backgroundSize: '10px 10px',
              backgroundColor: 'var(--bg-sunken)'
            }}
          ></div>
          {diagramElement}
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
