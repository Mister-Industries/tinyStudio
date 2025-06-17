import { Zap } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from './ui/Card'
import { ScrollArea } from './ui/ScrollArea'
import { Button } from './ui/Button'

const arduinoExamples = [
  {
    title: 'Blink LED',
    description: 'Basic LED blinking example',
    code: `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}`
  },
  {
    title: 'Button Input',
    description: 'Read button state and control LED',
    code: `const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(ledPin, OUTPUT);
  pinMode(buttonPin, INPUT);
}

void loop() {
  int buttonState = digitalRead(buttonPin);
  if (buttonState == HIGH) {
    digitalWrite(ledPin, HIGH);
  } else {
    digitalWrite(ledPin, LOW);
  }
}`
  },
  {
    title: 'Servo Motor',
    description: 'Control servo motor position',
    code: `#include <Servo.h>

Servo myservo;

void setup() {
  myservo.attach(9);
}

void loop() {
  myservo.write(90);
  delay(1000);
  myservo.write(0);
  delay(1000);
}`
  }
]

export function ExamplesContent(): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-4 text-primary text-sm font-semibold border-b border-border mb-4">
        <Zap size={16} />
        Arduino Examples
      </div>
      <ScrollArea className="h-5/6">
        <div className="flex flex-col gap-4">
          {arduinoExamples.map((example, index) => (
            <Card key={index}>
              <CardHeader>
                <CardTitle>{example.title}</CardTitle>
                <CardDescription>{example.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                  <code>{example.code}</code>
                </pre>
              </CardContent>
              <CardFooter>
                <Button>
                  <Zap />
                  Run Example
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </>
  )
}
