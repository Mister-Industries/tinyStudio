# tinyStudio: the app

tinyStudio is MR.INDUSTRIES' IDE for the tinyCore (ESP32-S3). It puts the three things a hardware project needs (code, wiring, and a live visual) in one window. It ships as a desktop app and as a web app (studio.tinycore.cc); both behave the same apart from how folders are opened.

The screenshot below is the Code view with an example project open.

## Layout

- **Header** (top): tinyStudio wordmark, light/dark toggle, GitHub sign-in.
- **Toolbar** (under the header):
  - **Verify** compiles the sketch; **Upload** compiles and flashes the board.
  - The save button, **Select board** (tinyStudio's board is "tinyCore") and the **port** picker.
  - The **Code | Circuit | Visual** switch on the right.
- **Left panel**: **Files** (the project folder tree) and **GitHub** (clone, pull, push).
- **Center**: depends on the view.
  - **Code**: editor tabs for any file, with the **Serial Monitor** docked underneath. Compile output and errors appear there too.
  - **Circuit**: full-window breadboard + schematic editor for `circuit.json`, with a simulator.
  - **Visual**: runs a p5.js sketch (`visual.js` by default) live, with Pause/Restart and a sketch picker. The Serial Monitor dock is hidden here, but serial stays connected and keeps feeding the sketch.
- **Right panel**: **Docs** (renders the project's `README.md`), **Examples** (a searchable, tag-filtered catalogue of ready-made tinyCore projects), and **Studio AI**.
- **Status bar** (bottom): backend connection, encoding, language, version.

With no project open, the center shows a start screen: **Create new**, **Open existing** (a folder or a GitHub repo), or **Try an example**.

## A project

One folder is the whole project, and it opens unchanged in the Arduino IDE too:

```
blink-basic/
  blink-basic.ino   the sketch (must match the folder name)
  visual.js         p5.js sketch for the Visual view (created on first visit)
  circuit.json      the wiring (created on first visit to Circuit)
  README.md         shown in the Docs tab
```

Examples come from the GitHub repo `Mister-Industries/tinyStudio-examples`. On the web they open in memory from a link like `/Mister-Industries/tinyStudio-examples/basics/blink-basic`, until the user saves them to a folder. Older examples still carry a v1 `diagram.json`. The Circuit view converts it to `circuit.json` the first time it opens, and keeps the original as `diagram.json.bak`.

## The loop users go through

1. Write the `.ino` in **Code**.
2. Pick the **tinyCore** board and its port, then press **Upload**. If compilation fails, the error shows under the editor, and Studio AI receives it as "Last build error".
3. Open the **Serial Monitor** to see `Serial.println()` output. Set the baud there to match `Serial.begin()`.
4. Switch to **Visual**: `visual.js` receives the same serial lines and draws them.
5. Wire or document the hardware in **Circuit**. Explain it in `README.md`, which shows in the **Docs** tab.

The Visual view can also export the sketch as a standalone `index.html`. That page connects to the board over Web Serial (Chrome/Edge) and follows the same `theme` and serial helpers, so the sketch runs unchanged.

## What Studio AI can and can't do

- It can read and edit project files (every change asks the user first), read these guides, inspect the circuit, search the parts library, and read recent serial output.
- It can't press buttons: it can't compile, upload, open ports, or switch views. It tells the user which button to press next.
- Compile and upload run through a local backend service. If the status bar says it isn't connected, the app shows a banner explaining how to start it. Upload failures from a missing backend are not code bugs.
