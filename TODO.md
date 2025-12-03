- use SQLlite instead of store, so operations are better. Also do not save all and load all, these are a big bottleneck for large OPs
- revise the get epub chapter to return also the audio ref if present in the content.opf
- in the FE, refactor how chapter are loaded. Add a callback to after a chapter is loaded ( start to track the sync, scroll to the correct position etc instead of using useEffects etc)
- in the FE, if a chapter is loaded and has a href for audio track, load it from BE. Also use a callaback to after the audio track is loaded so i can enable audio track sync to the BE
- when audiobook conversion happens, dont reload from FE, make it all in the BE
- remove all useEffects because they are shittte
- parallelize on chapters -> if chapters are too few ... i dont know
- Revise how chapter names are extracted from the TOC because they are not extracter correctly
  