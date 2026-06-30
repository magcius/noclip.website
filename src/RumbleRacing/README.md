## TS Port

The Rumble Racing TypeScript parsing code was ported by Claude Sonnet 4.6 in a single prompt from my original Go codebase at https://github.com/mattbruv/rumble-racing-re.

Any additional reverse engineering work will happen upstream in that repository before finding its way to noclip.

## Actor Transformation Note

Because there was too much logic to reverse engineer to place actors correctly, I have pre-processed the transformations for the individual actors in the scenes.
I took a save state using PCSX2 at the exact moment after loading the level and scraped out the final actor Y levels and transformations using [this script](https://github.com/mattbruv/rumble-racing-re/blob/main/scripts/searchY.py).
This pre-processed JSON data should be served alongside the game's data in the DATA folder for actors to be placed properly.

## Future Improvements / Cool Ideas

- Render Skybox
- Fix alternating normals
- Render lighting correctly, place instanced lights
- Render Powerups
- Handle alpha transparency/blending correctly (currently treats pure black pixels as full transparency)
- Add a render toggle for showing driveable polygons and/or collision geometry
- Would be cool to animate networked actor and move them along their spline paths (Cropduster/Helicopters/Planes/Tornado)
