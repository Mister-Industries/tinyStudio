import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { ScrollArea } from './ui/ScrollArea'

export function AIAssistant(): React.JSX.Element {
  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="h-5/6">
        <div className="flex flex-col gap-4">
          <AiChatBubble text="Hello! I'm your coding assistant Teeny! How can I help you today?" />
          <UserChatBubble text="What is the pinout for the tinyCore?" />
        </div>
      </ScrollArea>
      <div className="w-full h-fit border-t border-border p-4 flex gap-2">
        <Input placeholder="Ask about tinyCore code..." />
        <Button>Send</Button>
      </div>
    </div>
  )
}

export function AiChatBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="self-start rounded-xl bg-primary text-primary-foreground py-2 px-4 mr-12 w-fit">
      <p>{text}</p>
    </div>
  )
}

export function UserChatBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="self-end rounded-xl border border-border bg-background py-2 px-4 ml-12 w-fit">
      <p>{text}</p>
    </div>
  )
}
