# Third-party notices

tinyStudio is licensed under the GNU General Public License v3.0 or later (see
[LICENSE](LICENSE)). It includes, bundles or downloads the work below, each under
its own licence. The full licence text for each npm package ships in its folder
under `node_modules/`; the in-app **About tinyStudio** dialog lists the main ones.

## Art and data

| Work                                                         | Licence      | Where it's used                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Fritzing parts](https://github.com/fritzing/fritzing-parts) | CC-BY-SA 3.0 | Breadboard and schematic art for the Core parts pack. Attribution ships with the pack as `ATTRIBUTION.md` in `src/renderer/src/assets/tinyparts/packs/core/`. Changes to that art (restroked and recoloured symbols, snapped pins) are shared under the same licence in [tinyparts](https://github.com/Mister-Industries/tinyparts). |

## Programs shipped with the desktop app

| Program                                                                       | Licence                        | Notes                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [arduino-cli](https://github.com/arduino/arduino-cli)                         | GPL-3.0                        | Bundled binary; compiles and uploads sketches. Run as a separate program by tinyService.                     |
| [arduino-language-server](https://github.com/arduino/arduino-language-server) | AGPL-3.0                       | Bundled only when fetched with `npm run fetch:language-server`; editor code intelligence.                    |
| [clangd](https://clangd.llvm.org)                                             | Apache-2.0 with LLVM exception | Bundled alongside arduino-language-server.                                                                   |
| [Electron](https://www.electronjs.org)                                        | MIT                            | The app runtime. Chromium and its dependencies are listed in `LICENSES.chromium.html` in the install folder. |

Board toolchains (ESP32, AVR and others) are not bundled. arduino-cli downloads
them on first compile under their own licences.

## Libraries

| Library                                                                                                                                                              | Licence                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [tinyService](https://www.npmjs.com/package/@mister-industries/tinyservice) and [@mister-industries/shared](https://www.npmjs.com/package/@mister-industries/shared) | See the packages                               |
| [ngspice](https://ngspice.sourceforge.io) via [eecircuit-engine](https://github.com/eelab-dev/EEcircuit-engine)                                                      | BSD-3-Clause (ngspice), MIT (eecircuit-engine) |
| [p5.js](https://p5js.org)                                                                                                                                            | LGPL-2.1                                       |
| [Monaco Editor](https://github.com/microsoft/monaco-editor)                                                                                                          | MIT                                            |
| [Mermaid](https://github.com/mermaid-js/mermaid)                                                                                                                     | MIT                                            |
| [uPlot](https://github.com/leeoniya/uPlot)                                                                                                                           | MIT                                            |
| [DOMPurify](https://github.com/cure53/DOMPurify)                                                                                                                     | MPL-2.0 or Apache-2.0                          |
| [React](https://react.dev), [Redux Toolkit](https://redux-toolkit.js.org)                                                                                            | MIT                                            |
| [Radix UI](https://www.radix-ui.com)                                                                                                                                 | MIT                                            |
| [Tailwind CSS](https://tailwindcss.com)                                                                                                                              | MIT                                            |
| [Lucide icons](https://lucide.dev)                                                                                                                                   | ISC                                            |

The complete list of npm dependencies and their licences can be produced with
`npx license-checker --production --summary`.
