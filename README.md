# Chord Bars

Write chord progressions bar by bar in Obsidian and hear them back.

Chord Bars turns a ```` ```chords ```` code block into an interactive chord chart: bars laid out four per line, sections, repeats, and a toolbar to play, loop, transpose and change the tempo. A built-in piano finds the name of the chord you play and adds it to the progression.

## Writing chords

````markdown
```chords
[Intro]
| F# | B Bmaj7 | D#m | C# |

[Verse] x2
| F | Am/E | Adim/D# | Dm7 |
| A#m | F | Gm G | C7(b9) |
// second time: hold the C

[Chorus]
| B | C# | D#m | % |
```
````

| Syntax | Meaning |
|---|---|
| `[Verse]` | Section title |
| `\| F# \| B Bmaj7 \|` | One row of bars. Several chords in a bar split it evenly. Outer pipes are optional. |
| `%` | Repeat the previous bar |
| `x2` at the end of a row | Play that row twice |
| `[Verse] x2` or `[Verse x2]` | Play the whole section twice (no blank lines inside the section) |
| `// text` | A note |
| `time: 3/4` | Beats per bar (default 4/4) |

Rows longer than four bars wrap onto the next line (two per line on narrow screens).

### Chord symbols

Any root with `#` or `b`, an optional slash bass, and the usual qualities, extensions and alterations, in the common spellings:

`C` `Cm` `C7` `Cmaj7` `CΔ7` `Cm7b5` `Cø` `Cdim7` `C°7` `Caug` `C+` `C5` `Csus2` `C7sus4` `Cadd9` `C6` `C6/9` `C9` `Cmaj9` `Cm11` `Cmaj11` `C13` `Cmaj13` `Cm(maj7)` `C7(b9)` `C7b9` `C7(9-)` `C7(#9)` `Cmaj7(#11)` `C7(11+)` `C7(b13)` `C7alt` `C7(b9,#11)` `C/E` `C7(b9)/E`

## Note properties

| Property | Use |
|---|---|
| `key` | Shown in the toolbar and transposed with the chart |
| `bpm` | Starting tempo. Changing the tempo in the toolbar saves it here. |

## Toolbar

- **Play / Stop**, **Loop** and **Metronome**. Tempo, transposition, metronome and sound can all be changed while playing.
- **Play from anywhere**: the ▶ in a bar's corner, a double-click on a bar, or the ▶ next to a section title. Play keeps starting from that point until you press ⏮.
- **BPM** with − / + and **Tap** tempo (tap the beat a few times).
- **Transpose** up or down in semitones, and switch between ♯ and ♭ spelling. This only changes the view, not your note.
- **Sound**: Soft Piano and Acoustic Guitar (recorded samples), plus synthesized Piano, Guitar, E-Piano, Pad, Organ and Synth.

## Piano chord finder

Open it with the 🎹 button. Click the keys, or use your computer keyboard (`A W S E D F T G Y H U J K…`, `Z`/`X` to change octave). The chord name appears as you play, with alternatives when there is more than one (Am7 = C6/A). The lowest note is the bass, so slash chords are detected too.

- **New bar** (`Enter`) adds the chord as a new bar after the selected one.
- **In bar** (`Shift+Enter`) adds it inside the selected bar.
- Click a bar to choose where chords go. `Space` plays the chord, `Esc` clears it.

## Drag and drop

Drag a chord to another bar to move it, hold `Ctrl` (or `Alt`) to copy it, drop it on the dashed `+` at the end of a row to make a new bar, or on **Delete** to remove it. Every change is written back to the note, so `Ctrl+Z` undoes it. Drag and drop needs a mouse, so it isn't available on phones.

## Network use

The Soft Piano and Acoustic Guitar sounds use recorded samples that are not bundled with the plugin. The first time you choose one of these sounds, Chord Bars downloads its samples (about 1.8 MB for the piano and 6.8 MB for the guitar) from the sources below and saves them in the plugin folder. After that they work offline. Nothing else is sent or received, and the other sounds never use the network.

## Credits

- Soft Piano: [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, CC BY 3.0, served by [Tone.js](https://tonejs.github.io/audio/salamander/).
- Acoustic Guitar: [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) by Nicholaus Brosowsky, CC BY 3.0.

## Installing manually

Copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<your vault>/.obsidian/plugins/chord-bars/`, then turn on **Chord Bars** in **Settings → Community plugins**.

## License

[MIT](LICENSE)
