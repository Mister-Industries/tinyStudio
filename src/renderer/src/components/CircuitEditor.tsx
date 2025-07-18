import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

export function CircuitEditor(): React.JSX.Element {
  return (
    <div className="size-full flex items-center justify-center bg-background overflow-hidden">
      <TransformWrapper>
        <TransformComponent>
          <div className="size-400 flex justify-center items-center bg-accent text-accent-foreground">
            TODO Replace with an image
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
