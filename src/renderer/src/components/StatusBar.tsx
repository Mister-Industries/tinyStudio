import { Cpu, Usb, Wifi, WifiOff } from 'lucide-react'
import { useArduinoContext } from '../contexts/ArduinoContext'
import { useSerial } from '../contexts/SerialContext'
import { Button } from './ui/Button'

export function StatusBar(): React.JSX.Element {
  const { isAgentConnected, checkAgentStatus, selectedBoard, isCompiling, isUploading } =
    useArduinoContext()
  const { connected, disconnected, port, baud, reconnect } = useSerial()

  const handleRetry = async (): Promise<void> => {
    try {
      await checkAgentStatus()
    } catch (error) {
      console.error('Failed to check Arduino service status:', error)
    }
  }

  const busyLabel = isUploading ? 'Uploading…' : isCompiling ? 'Compiling…' : 'Ready'

  return (
    <div className="flex items-center justify-between shrink-0 px-3 py-1 border-t border-navy-600 text-[11px] font-medium bg-navy-900 text-fg-3">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background:
                isCompiling || isUploading ? 'var(--signal-warning)' : 'var(--signal-success)'
            }}
          />
          {busyLabel}
        </span>
        {selectedBoard && (
          <span className="flex items-center gap-1.5">
            <Cpu size={12} />
            {selectedBoard.config.name}
          </span>
        )}
        <span
          className="flex items-center gap-1.5"
          style={isAgentConnected ? {} : { color: 'var(--signal-error)' }}
        >
          {isAgentConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isAgentConnected ? 'Connected' : 'Disconnected'}
        </span>
        {isAgentConnected && port && (
          <span
            className="flex items-center gap-1.5"
            style={
              connected
                ? { color: 'var(--signal-success)' }
                : disconnected
                  ? { color: 'var(--fg-4)' }
                  : {}
            }
          >
            <Usb size={12} />
            {disconnected
              ? 'Serial released'
              : connected
                ? `${port} @ ${baud}`
                : `Connecting ${port}…`}
            {disconnected && (
              <Button
                variant="link"
                className="p-0 h-fit text-[11px] text-cyan hover:text-cyan-bright"
                onClick={reconnect}
              >
                reconnect
              </Button>
            )}
          </span>
        )}
        {!isAgentConnected && (
          <Button
            variant="link"
            className="p-0 h-fit text-[11px] text-cyan hover:text-cyan-bright"
            onClick={handleRetry}
          >
            Retry
          </Button>
        )}
      </div>
      <div className="flex items-center gap-4 font-mono">
        <p>UTF-8</p>
        <p>Arduino (C++)</p>
        <p>tinyStudio 0.1.0 · alpha</p>
      </div>
    </div>
  )
}
