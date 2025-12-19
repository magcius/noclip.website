# Descent level renderer

This level renderer is capable of rendering levels from the PC version
of Descent (1995), Descent II (1996) and Descent II: Vertigo (1996).

## Source files

The required source files are (all file names must be in lowercase):

- `.rdl` and `.256` files from `descent.hog` extracted out (Descent)
- `descent.pig` (Descent), sound and player physics data can be stripped out
- `.rl2` and `.256` files from `descent2.hog` extracted out (Descent II)
- `descent2.ham` (Descent II), player physics data can be stripped out
- 6 `.pig` files (Descent II)
    - `alien1.pig`, `alien2.pig`, `fire.pig`, `groupa.pig`, `ice.pig`, `water.pig`
- All Descent II files also needed for Descent II: Vertigo
- `.rl2` and `.ham` files from `d2x.hog` extracted out (Descent II: Vertigo)

Descent `.hog` files are archives with a relatively simple format (see below).

All files should be from the most recent retail version.

## Licensing

Much of the parsing code is derived from LibDescent
<https://github.com/InsanityBringer/LibDescent/>, which is
licensed as follows:

    Copyright (c) 2020-2021 The LibDescent team

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## Supported features

- [x] Render mine mesh
    - [x] Support Descent
    - [x] Support Descent II
    - [x] Support Descent II: Vertigo
- [x] Render mine mesh with textures
    - [x] Base layer testure
    - [x] Overlay textures
        - [x] Supertransparency ('see-through') for overlay textures
    - [x] Animate animated textures
    - [x] Animate sliding textures (Descent II)
- [x] Render mesh with static lighting
    - [ ] Dynamic lighting (Descent II)
- [x] Render powerups
    - [x] Animate powerups
- [x] Render hostages
- [x] Render robots
- [x] Render player spawns
- [x] Render reactor
    - [x] Animate reactor
- [x] Render red mines (Descent II)
    - [x] Animate red mines

## Stretch goodies

- [ ] Use proper quad lighting interpolation when the two tris for a side are roughly planar
- [ ] Animate doors when camera gets close (open when close, close when far away)?
- [ ] Animate robots when camera gets close?
- [ ] Implement triggers for opening/closing doors, etc.?
- [ ] Render terrain at the end of the exit tunnel (Descent 1). Would need `.txb` files with matching `.rdl`s.

## Descent .hog format

`.hog` files begin with a three-char header `DHF`.

It is then followed by a file header and file contents. The file header
contains 13 characters for the file name (must include a null terminator,
string ends at null terminator, but always padded to 13 chars), and the file
size as an unsigned little-endian 32-bit integer. After this 17 byte header,
the file contents follow. The next file (header and contents) follows right
after, and so on, until the end of the HOG file. No padding is used.
