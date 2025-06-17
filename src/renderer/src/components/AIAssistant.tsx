import { Button } from './ui/Button'
import { Input } from './ui/Input'

export function AIAssistant(): React.JSX.Element {
  return (
    <div className="size-full flex flex-col relative">
      <div>Chat Area</div>
      <div className="absolute bottom-0 border-t border-border w-full h-fit p-4 flex gap-2">
        <Input placeholder="Ask about Arduino code..." />
        <Button>Send</Button>
      </div>
    </div>
  )
}
