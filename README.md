# [Muki](http://muki.io/) - Desktop Version
It's a web based player for sequenced music, that contains a carefully curated list of songs from
video games of the 90's, and some even older. The sound you hear does not come from lossy compressed
formats, by the way. Your browser is actually acting as a synthesizer and generating the waveforms
from the original notation scores.


## Who did this?
The guy behind this is [Tom (aka T.O.M.A.S.)](http://twitter.com/tomaspollak) Pollak, a
journalist-slash-developer-slash-aspiring musician who obviously spent too much time playing DOS
games when he was young.

> and [Joon(aka Firejune) Kyoung](http://firejune.com) was created the Desktop Client Version.

> Once i have a certain extent completed, I will ask an opinion on it to distribute this program to
  Tom.

## How did you build this? What technologies did you use?
A whole bunch of them! The key piece of all is probably
[emscripten](http://kripken.github.io/emscripten-site/), a transpiler that provides a way to port
native C code to Javascript. Using emscripten I was able to build JS versions of the following
libraries: [libTiMidity](http://libtimidity.sourceforge.net/) (for MIDI playback, borrowing ideas
from [midijs.net](http://midijs.net/)), [Munt](https://github.com/munt/munt) (for Roland MT-32
emulation/playback), [Game Music Emulator](https://github.com/kode54/Game_Music_Emu)
(VGM/VGZ/NSF/SPC/etc), [AdPlug](http://adplug.github.io/) (for Adlib emulation) and
[Highly Experimental](https://gitlab.kode54.net/kode54/Highly_Experimental/tree/master/Core)
(PSF/PSF2). The only one I didn't actually build was the JS port of libopenmpt, which I borrowed
from the [chiptune2.js](https://github.com/deskjet/chiptune2.js) project. The real challenge was to
glue everything together, ensuring there were no memleaks, and of course, selecting the list of
songs.

## And what about the music?
Well, so the music is a collection of different files of different formats that hail from different
sources. Probably the most important one is the great, the amazing
[World of Game Music](http://mirsoft.info/), a website that contains a huge database of game music
in both MIDI (rips and arranged tracks) and MOD format. Then there's
[VGMusic](http://www.vgmusic.com/), another great site that contains a nice collection of MIDIs that
have been sequenced by its own (and very talented) community.

Another key source is [Zophar's Domain](http://www.zophar.net), that contains ripped
soundtracks from console games (NES, SNES, Sega, PSX, etc). Music from Sierra games comes from the
legendary guys at [QuestStudios](http://queststudios.com/). Finally there's
[VGMRips](http://vgmrips.net/), a recent (and surprisingly good) discovery that holds an
ever-growing database of VGM music. Everything else was ripped and tweaked personally by me either
using an extractor tool or through DOSBox, like the Might and Magic 3 music or the intro song from
HeroQuest. You gotta listen to those!

By the way, if you click over the name of the song that's playing, a window will pop up showing the
source where the file was downloaded from, as well as the name of the company that holds the rights
for the tune. I was able to get that information from [TheGamesDB](http://thegamesdb.net/) (via API)
or [MobyGames](http://www.mobygames.com/) (by hand!).

## And what formats are supported?
All of the following: .mid, .mod, .xm, .it, .s3m, .psm, .amf, .ay, .gbs, .gym, .hes, .kss, .nsf,
.sap, .spc, .vgm and .vgz. Those, and .dro, .imf, .raw, .laa, .cmf and the rest of the Adlib-based
formats supported by [AdPlug](http://adplug.github.io/). You can drop one or a whole list of files
and Muki will play them in order.

## What soundfont do you use for the MIDI patches?
Muki actually uses a combination of different soundfonts, aiming to balance the highest possible
sound quality with the lowest possible file size. Most of the patches come from the great
[Arachno soundfont](http://www.arachnosoft.com/main/soundfont.php), though.

### Install dependencies

```
$ npm install
```

### Run app

```
$ npm start
```

### Package app

Builds app binaries for OS X, Linux, and Windows.

```
$ npm run build
```

To build for one platform:

```
$ npm run build-[platform]
```

Where `[platform]` is `darwin`, `linux`, `win32`, or `all` (default).

The following optional arguments are available:

- `--sign` - Sign the application (OS X, Windows)
- `--package=[type]` - Package single output type.
   - `deb` - Debian package
   - `zip` - Linux zip file
   - `dmg` - OS X disk image
   - `exe` - Windows installer
   - `portable` - Windows portable app
   - `all` - All platforms (default)

Note: Even with the `--package` option, the auto-update files (.nupkg for Windows, *-darwin.zip for OS X) will always be produced.

#### Windows build notes

To package the Windows app from non-Windows platforms, [Wine](https://www.winehq.org/) needs
to be installed.

On OS X, first install [XQuartz](http://www.xquartz.org/), then run:

```
brew install wine
brew install mono
```

(Requires the [Homebrew](http://brew.sh/) package manager.)