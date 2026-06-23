import { CheckCircle, Circle } from 'lucide-react'
import { useArduinoContext } from '../contexts/ArduinoContext'
import { Button } from './ui/Button'

export function StatusBar(): React.JSX.Element {
  const { isAgentConnected, checkAgentStatus } = useArduinoContext()

  const handleRetry = async () => {
    try {
      await checkAgentStatus()
    } catch (error) {
      console.error('Failed to check Arduino service status:', error)
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-1 border-t border-border text-xs bg-muted">
      <div className="flex items-center gap-4">
        {isAgentConnected ? (
          <div className="flex items-center gap-1">
            <CheckCircle size={10} className="text-green-500" />
            Arduino Service Connected
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Circle size={10} className="text-destructive fill-destructive" />
            Arduino Service Disconnected
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button variant="link" className="p-0 h-fit text-xs text-blue-400" onClick={handleRetry}>
            Retry
          </Button>
          {/* <Button variant="link" className="p-0 h-fit text-xs text-blue-400">
            How to Install
          </Button> */}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <p>UTF-8</p>
        <p>Arduino (C++)</p>
      </div>
    </div>
  )
}
