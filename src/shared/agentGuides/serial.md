# Serial: from the board to visual.js

## The path

1. The `.ino` calls `Serial.println(...)`. Each **line** (up to the newline) is one message.
2. tinyStudio owns the serial connection for the whole app. Switching between Code, Circuit and Visual doesn't reopen the port or reset the board.
3. Every line goes to the **Serial Monitor** (Code view) and to the running sketch at the same time.
4. In `visual.js`, `serialEvent(line)` is called once per line, in order, just before the next `draw()`. Several lines can arrive between two frames; each gets its own call.

The app keeps the **last 300 lines** (`serialLines()`) and the number parsed from each (`serialValues()`).

## How `serialValue()` parses a line

For each line, tinyStudio takes the **first number** it finds (matching `-?\d+(\.\d+)?`).

- If the line has no digits, the value is `1` when the line contains `HIGH`, the word `ON`, or `true` (any case), and `0` otherwise.
- Only the first number counts: `"12,34,56"` gives `12`.
- **Digits inside labels are numbers too:** `"A0: 512"` gives `0`, and `"temp1 22.5"` gives `1`. Use labels without digits, or parse in `serialEvent`.
- `"state:on"` gives `1`, `"LED OFF"` gives `0`, and `"hello"` gives `0`, so text lines pollute a chart that uses `serialValue()`.

**Rule of thumb:** use `serialValue()` only when the board prints one bare number per line. For everything else, parse the line yourself in `serialEvent(line)`.

## Line formats that work

Pick one format per project, and use it in both the `.ino` and `visual.js`.

**One value**
```cpp
Serial.println(analogRead(A5));
```
```js
let v = 0;
function serialEvent(line) {
  const n = parseFloat(line);
  if (!isNaN(n)) v = n;
}
```

**Several values: comma-separated, fixed order**
```cpp
Serial.printf("%d,%d,%d\n", x, y, pressed);
```
```js
function serialEvent(line) {
  const [x, y, pressed] = line.trim().split(',').map(Number);
  if ([x, y, pressed].some(isNaN)) return;  // ignore partial or garbled lines
  // …use them
}
```

**Several values: labelled** (also readable in the Serial Monitor, and in the Arduino IDE's Serial Plotter)
```cpp
Serial.printf("ax:%.2f ay:%.2f az:%.2f\n", ax, ay, az);
```
```js
let data = {};
function serialEvent(line) {
  for (const [, key, val] of line.matchAll(/([a-zA-Z_]+):(-?\d+(?:\.\d+)?)/g)) {
    data[key] = parseFloat(val);
  }
}
```

**Events and state**
```cpp
Serial.println("event:press");
Serial.println("state:on");
```
```js
function serialEvent(line) {
  const t = line.trim();
  if (t === 'event:press') burst();
  else if (t === 'state:on') on = true;
  else if (t === 'state:off') on = false;
}
```

## Good habits on the board side

- `Serial.begin(115200);` in `setup()`. Tell the user to match the Serial Monitor's baud setting.
- **Print at a sensible rate**: 10–60 lines per second is plenty for a 60 fps sketch. Use `delay()` or a `millis()` timer; don't print every pass through `loop()`.
- **Keep debug text out of the data stream**, or mark it (`# calibrating…`) and skip it in the sketch: `if (line.startsWith('#')) return;`.
- **Repeat state periodically.** A line printed once in `setup()` can be missed while USB reconnects after upload, or before the user switches to Visual.
- Always end a message with `println` (or `\n` in `printf`), so each message is a complete line.

## Debugging the link

Call `read_serial` to see what the board is actually sending, then compare it with what `serialEvent` expects. Common mismatches:
- labels differ in case or spelling;
- a stray space or `\r` (use `line.trim()`);
- values out of the range the sketch maps;
- nothing printed because the `.ino` wasn't re-uploaded after an edit.
