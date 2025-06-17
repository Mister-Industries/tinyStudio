import { CheckCircle, Circle } from 'lucide-react'
import { Button } from './ui/Button'

export function StatusBar(): React.JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-1 border-t border-border text-xs bg-muted">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <CheckCircle size={10} />
          Ready
        </div>
        <div className="flex items-center gap-1">
          <Circle size={10} className="text-destructive fill-destructive" />
          Arduino Agent Not Found
        </div>
        <div className="flex items-center gap-3">
          <Button variant="link" className="p-0 h-fit text-xs text-blue-400">
            Retry
          </Button>
          <Button variant="link" className="p-0 h-fit text-xs text-blue-400">
            How to Install
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <p>UTF-8</p>
        <p>Arduino (C++)</p>
      </div>
    </div>
  )
}
