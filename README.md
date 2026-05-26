<img align="right" src="src/assets/logo.png">

# <a href="https://noclip.website">noclip</a>

The reverse engineering of model formats was done by many people. See the application for full credits.

## Contributing

Contributions are very welcome! New games, new features, and bug fixes are all very appreciated. Even small contributions like proper map names, grouping maps and new default savestates are extremely helpful.

## AI Contributions Policy

* If AI was used in any capacity for your contribution (coding, reverse engineering, authoring commit messages or PR descriptions), this must be disclosed in your pull request.
* Please only submit contributions that you have tested, reviewed, and feel you understand.
* All comments or documentation *must* be fully human-authored. Any AI-written or even AI-assisted comments are not allowed.
* Project maintainers reserve the right to reject contributions at any time, for any reason, including if they suspect this policy has not been correctly followed.

## Development Guide

To develop for noclip.website, you'll need these requisites:

* Your code editor of choice (for example, [Visual Studio Code](https://code.visualstudio.com/), [WebStorm](https://www.jetbrains.com/webstorm/)),
* [Node.js](https://nodejs.org/en/download). Choose the latest LTS version and choose the `pnpm` package manager,
* [rustup](https://rust-lang.org/learn/get-started/).

Then, use the following commands to set up your environment (only needed every so often):
* Install dependencies from npm: `pnpm install`,
* Set up the required rust binaries:
  ```shell
  rustup target add wasm32-unknown-unknown
  cd rust
  cargo install cargo-run-bin
  cargo bin --install
  ```

Finally, to build and run the project, use `pnpm start`. This will start a live-reloading environment and uses filesystem watchers to auto-build the project.

For any questions related to development, see the [Official noclip.website Discord Server](https://discord.gg/bkJmKKv)'s #development channel. A number of developers from the community are present there and can help answer questions if you run into any additional issues getting set up.

## Controls

Key | Description
-|-
`Z` | Show/hide all UI
`T` | Open "Games" list
`W`/`A`/`S`/`D` or Arrow Keys | Move camera
Hold `Shift` | Make camera move faster
Hold `\` | Make camera move slower
`E` or `Page Up` or `Space` | Move camera up
`Q` or `Page Down` or `Ctrl+Space` | Move camera down
`Scroll Wheel` | Adjust camera movement speed (in WASD camera mode; instead changes the zoom level in Orbit or Ortho camera modes)
`I`/`J`/`K`/`L` | Tilt camera
`O` | Rotate camera clockwise
`U` | Rotate camera counterclockwise
`1`/`2`/`3`/`4`/`5`/`6`/`7`/`8`/`9` | Load savestate
`Shift`+`1`/`2`/`3`/`4`/`5`/`6`/`7`/`8`/`9` | Save savestate
`Numpad 3` | Export save states
`.` | Freeze/unfreeze time
`,` | Hold to slowly move through time
`F9` | Reload current scene
`B` | Reset camera position back to origin
`R` | Start/stop automatic orbiting (requries Orbit or Ortho camera modes)
`Numpad 5` | Immediately stop all orbiting (requries Orbit or Ortho camera modes)
`Numpad 2`/`Numpad 4`/`Numpad 6`/`Numpad 8` | Snap view to front/left/right/top view (requires Orbit camera mode)
`F` | Not sure what this key does, let me know if you figure it out

## Third-Party Credits

All icons you see are from [The Noun Project](https://thenounproject.com/), used under Creative Commons CC-BY:
* Truncated Pyramid by Bohdan Burmich
* Images by Creative Stall
* Help by Gregor Cresnar
* Open by Landan Lloyd
* Nightshift by mikicon
* Layer by Chameleon Design
* Sand Clock by James
* Line Chart by Shastry
* Search by Alain W.
* Save by Prime Icons
* Overlap by Zach Bogart
* VR by Fauzan Adaiima
* Play Clapboard by Yoyon Pujiyono
* Undo by Numero Uno
* Redo by Numero Uno
* Zoom In by Tanvir Islam
* Zoom Out by Tanvir Islam
