const { Plugin, MarkdownRenderChild, Notice, requestUrl, setIcon } = require("obsidian");

// ```chords syntax:
//   [Verse]                -> section title
//   | F# | B Bmaj7 | D#m |  -> one row of bars (outer pipes optional)
//   %                      -> repeat previous bar
//   x2 at end of row       -> play the row twice
//   // text                -> note
//   time: 3/4              -> beats per bar (default 4/4)
// Frontmatter: key, bpm

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const CHORD_RE = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/;

// Chord templates for the piano, most common first.
const DETECT = [
  ["", [0, 4, 7]], ["m", [0, 3, 7]], ["7", [0, 4, 7, 10]], ["maj7", [0, 4, 7, 11]], ["m7", [0, 3, 7, 10]],
  ["sus4", [0, 5, 7]], ["sus2", [0, 2, 7]], ["5", [0, 7]], ["add9", [0, 2, 4, 7]], ["madd9", [0, 2, 3, 7]],
  ["6", [0, 4, 7, 9]], ["m6", [0, 3, 7, 9]], ["dim", [0, 3, 6]], ["aug", [0, 4, 8]], ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]], ["7sus4", [0, 5, 7, 10]], ["9", [0, 2, 4, 7, 10]], ["maj9", [0, 2, 4, 7, 11]],
  ["m9", [0, 2, 3, 7, 10]], ["69", [0, 2, 4, 7, 9]], ["mMaj7", [0, 3, 7, 11]], ["7#5", [0, 4, 8, 10]],
  ["7", [0, 4, 10]], ["maj7", [0, 4, 11]], ["m7", [0, 3, 10]], ["9", [0, 2, 4, 10]], ["maj9", [0, 2, 4, 11]],
  ["m9", [0, 2, 3, 10]],
  // altered / extended
  ["7(b9)", [0, 1, 4, 7, 10]], ["7(#9)", [0, 3, 4, 7, 10]], ["7(b9)", [0, 1, 4, 10]], ["7(#9)", [0, 3, 4, 10]],
  ["maj7(#11)", [0, 4, 6, 7, 11]], ["7(#11)", [0, 4, 6, 7, 10]], ["7(b13)", [0, 4, 8, 10]], ["7(b5)", [0, 4, 6, 10]],
  ["13", [0, 4, 7, 9, 10]], ["13", [0, 2, 4, 9, 10]], ["m11", [0, 3, 5, 7, 10]], ["m11", [0, 2, 3, 5, 10]],
  ["maj7(b9)", [0, 1, 4, 7, 11]], ["maj9(#11)", [0, 2, 4, 6, 7, 11]], ["7(b9,#11)", [0, 1, 4, 6, 10]],
  ["maj11", [0, 2, 4, 5, 7, 11]], ["maj11", [0, 2, 5, 7, 11]], ["maj13", [0, 2, 4, 7, 9, 11]], ["maj13", [0, 4, 7, 9, 11]],
  ["maj13(#11)", [0, 2, 4, 6, 7, 9, 11]], ["13", [0, 2, 4, 7, 9, 10]], ["m13", [0, 2, 3, 7, 9, 10]], ["m13", [0, 2, 3, 5, 7, 9, 10]],
  ["11", [0, 2, 4, 5, 7, 10]], ["9sus4", [0, 2, 5, 7, 10]], ["13(#11)", [0, 2, 4, 6, 7, 9, 10]],
  ["7(b9,b13)", [0, 1, 4, 8, 10]], ["7(#9,b13)", [0, 3, 4, 8, 10]], ["add11", [0, 4, 5, 7]], ["m(add11)", [0, 3, 5, 7]],
];

// Computer keys → semitones above the lowest C shown (physical positions, any layout).
const KEY_CODES = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ",
  "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon", "Quote"];

function splitRow(line) {
  let body = line.trim(), suffix = "";
  const rep = body.match(/\s*[x×]\d+\s*$/i);
  if (rep) { suffix = " " + rep[0].trim(); body = body.slice(0, rep.index); }
  body = body.replace(/^\|/, "").replace(/\|$/, "");
  return { bars: body.split("|").map((b) => b.trim()), suffix };
}

function joinRow(row) {
  return "| " + row.bars.join(" | ") + " |" + row.suffix;
}

function accPc(letter, acc) {
  return (NOTE_PC[letter] + (acc === "#" || acc === "♯" ? 1 : acc === "b" || acc === "♭" ? -1 : 0) + 12) % 12;
}

// Chord quality → semitones above the root. Understands extensions and alterations in
// the usual spellings: 7(b9), 7b9, 7(9-), 7-9, maj7(#11), 7(11+), m7b5, ø, 6/9, add9, sus4, no3…
const DEGREE = { 5: 7, 9: 14, 11: 17, 13: 21 };

function intervalsFor(quality) {
  let q = quality.replace(/♭/g, "b").replace(/♯/g, "#").replace(/[()\s,]/g, "")
    .replace(/^ø7?/, "m7b5").replace(/^°7/, "dim7").replace(/^°/, "dim").replace(/Δ/g, "maj");
  if (q === "5") return [0, 7];

  let third = 4, fifth = 7, seventh = null;
  const ext = new Set(), alt = new Map(); // alt: degree → new interval
  let no3 = false, no5 = false;

  let m;
  if ((m = q.match(/^(min|mi|m|-)(?![aA]j)/))) { third = 3; q = q.slice(m[0].length); }
  else if ((m = q.match(/^dim/))) { third = 3; fifth = 6; q = q.slice(3); if (q.startsWith("7")) { seventh = 9; q = q.slice(1); } }
  else if ((m = q.match(/^(aug|\+)(?![59])/))) { fifth = 8; q = q.slice(m[0].length); }

  // 13 implies 9 (and 11 only on minor chords: a natural 11 clashes with a major 3rd)
  const upTo = (n) => { for (const d of [9, 11, 13]) if (d <= n && !(d === 11 && n === 13 && third === 4)) ext.add(DEGREE[d]); };
  while (q.length) {
    if ((m = q.match(/^(?:(b|-)(5|9|13)|(13|11|9|5)(b|-))/))) {          // flattened: b9, -9, 9-
      const d = m[2] || m[3];
      alt.set(+d, DEGREE[d] - 1);
    } else if ((m = q.match(/^(?:(#|\+)(5|9|11)|(11|9|5)(#|\+))/))) {   // sharpened: #11, +11, 11+
      const d = m[2] || m[3];
      alt.set(+d, DEGREE[d] + 1);
    } else if ((m = q.match(/^(maj|Maj|MAJ|ma|M)(13|11|9|7)?/))) {
      seventh = 11;
      if (m[2]) upTo(+m[2]);
    } else if ((m = q.match(/^(13|11|9|7)/))) {
      if (seventh === null) seventh = 10;
      upTo(+m[1]);
    } else if ((m = q.match(/^6\/?9|^69/))) { ext.add(9); ext.add(14); }
    else if ((m = q.match(/^6/))) ext.add(9);
    else if ((m = q.match(/^sus2/))) third = 2;
    else if ((m = q.match(/^sus4?/))) third = 5;
    else if ((m = q.match(/^add(b|#)?(13|11|9|4|2)/))) {
      const base = { 2: 2, 4: 5, 9: 14, 11: 17, 13: 21 }[m[2]];
      ext.add(base + (m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0));
    } else if ((m = q.match(/^(no|omit)(3|5)/))) { if (m[2] === "3") no3 = true; else no5 = true; }
    else if ((m = q.match(/^alt/))) { seventh ??= 10; alt.set(9, 13); alt.set(5, 8); }
    else m = [q[0]]; // unknown character: skip it
    q = q.slice(m[0].length);
  }

  if (alt.has(5)) fifth = alt.get(5);
  for (const d of [9, 11, 13]) if (alt.has(d)) { ext.delete(DEGREE[d]); ext.add(alt.get(d)); }
  const out = [0];
  if (!no3) out.push(third);
  if (!no5) out.push(fifth);
  if (seventh !== null) out.push(seventh);
  return [...new Set(out.concat([...ext]))].sort((a, b) => a - b);
}

function parseChord(token) {
  const m = token.match(CHORD_RE);
  if (!m) return { other: token };
  return {
    pc: accPc(m[1], m[2]),
    quality: m[3],
    bassPc: m[4] ? accPc(m[4], m[5]) : null,
    flat: m[2] === "b" || m[2] === "♭" || m[5] === "b" || m[5] === "♭",
  };
}

function parseSource(source) {
  const song = { sections: [], beats: 4, usesFlats: false };
  let section = null;
  const newSection = (title, repeat = 1) => { section = { title, repeat, items: [] }; song.sections.push(section); };

  source.split("\n").forEach((raw, lineNo) => {
    const line = raw.trim();
    if (!line) { section = null; return; }
    const time = line.match(/^time:\s*(\d+)\s*\/\s*\d+$/i);
    if (time) { song.beats = parseInt(time[1]); return; }
    // [Verse] x2  or  [Verse x2]  repeats the whole section
    const header = line.match(/^\[(.+?)(?:\s+[x×](\d+))?\](?:\s*[x×](\d+))?$/i);
    if (header) { newSection(header[1], parseInt(header[2] || header[3]) || 1); return; }
    if (!section) newSection(null);
    if (line.startsWith("//")) { section.items.push({ note: line.slice(2).trim() }); return; }

    let body = line, repeat = 1;
    const rep = body.match(/\s*[x×](\d+)\s*$/i);
    if (rep) { repeat = parseInt(rep[1]); body = body.slice(0, rep.index); }
    body = body.replace(/^\|/, "").replace(/\|$/, "");

    const bars = [];
    body.split("|").forEach((barText, idx) => {
      const tokens = barText.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 1 && tokens[0] === "%") {
        bars.push({ simile: true, chords: bars.length ? bars[bars.length - 1].chords : [], line: lineNo, idx });
        return;
      }
      const chords = tokens.map(parseChord);
      if (chords.some((c) => c.flat)) song.usesFlats = true;
      bars.push({ chords, line: lineNo, idx });
    });
    section.items.push({ bars, repeat });
  });
  return song;
}

class ChordBlock extends MarkdownRenderChild {
  constructor(plugin, el, source, sourcePath, lineStart) {
    super(el);
    this.plugin = plugin;
    this.source = source;
    this.song = parseSource(source);
    this.sourcePath = sourcePath;
    this.lineStart = lineStart;
    const fm = plugin.app.metadataCache.getCache(sourcePath)?.frontmatter || {};
    this.bpm = parseInt(fm.bpm || fm.tempo) || 90;
    this.key = fm.key || fm.tonalidad || null;
    this.transpose = 0;
    this.flats = this.song.usesFlats;
    this.metronome = false;
    this.loop = false;
    this.playing = null;
    this.pianoOpen = false;
    this.notes = [];
    this.octave = 3;
    this.target = null;
    this.startAt = null; // { line, bar } where Play begins
    // Survive re-renders caused by editing the block.
    Object.assign(this, plugin.ui.get(this.uiKey()) || {});
  }

  uiKey() { return this.sourcePath + ":" + (this.lineStart ?? ""); }

  saveUi() {
    const { transpose, flats, metronome, loop, pianoOpen, octave, target, focusPiano, startAt } = this;
    this.plugin.ui.set(this.uiKey(), { transpose, flats, metronome, loop, pianoOpen, octave, target, focusPiano, startAt });
  }

  onload() { this.render(); }
  onunload() { window.clearTimeout(this.saveTimer); this.stop(); }

  name(pc) { return (this.flats ? FLATS : SHARPS)[(pc + this.transpose + 120) % 12]; }

  render() {
    const el = this.containerEl;
    el.empty();
    const root = el.createDiv({ cls: "cb-sheet" });
    this.sheetEl = root;
    // keep the editor from reacting to clicks and drags inside the block
    for (const evt of ["mousedown", "click", "dragstart", "dragover", "dragenter", "drop"]) root.addEventListener(evt, (e) => e.stopPropagation());

    this.renderToolbar(root.createDiv({ cls: "cb-toolbar" }));
    if (this.pianoOpen) this.renderPiano(root);
    this.saveUi();

    this.barEls = [];
    for (const section of this.song.sections) {
      const sEl = root.createDiv({ cls: "cb-section" });
      if (section.repeat > 1) sEl.addClass("has-repeat");
      if (section.title || section.repeat > 1) {
        const t = sEl.createDiv({ cls: "cb-title", text: section.title || "" });
        if (section.repeat > 1) t.createSpan({ cls: "cb-section-times", text: "×" + section.repeat });
        const first = section.items.find((i) => i.bars?.length)?.bars[0];
        if (first) {
          const pb = t.createSpan({ cls: "cb-section-play", attr: { "aria-label": "Play from " + (section.title || "here") } });
          setIcon(pb, "play");
          pb.addEventListener("click", () => this.playFrom(first));
        }
      }
      for (const item of section.items) {
        if (item.note) { sEl.createDiv({ cls: "cb-note", text: item.note }); continue; }
        const row = sEl.createDiv({ cls: "cb-row" + (item.repeat > 1 ? " has-repeat" : "") });
        const grid = row.createDiv({ cls: "cb-grid" });
        item.bars.forEach((bar) => {
          const bEl = grid.createDiv({ cls: "cb-bar" });
          bar.el = bEl;
          bar.chordEls = [];
          if (this.isStart(bar)) bEl.addClass("is-start");
          const pb = bEl.createDiv({ cls: "cb-bar-play", attr: { "aria-label": "Play from here" } });
          setIcon(pb, "play");
          pb.addEventListener("click", (e) => { e.stopPropagation(); this.playFrom(bar); });
          bEl.addEventListener("dblclick", (e) => { if (!e.target.closest(".cb-chord")) this.playFrom(bar); });
          if (this.pianoOpen) {
            bEl.addClass("cb-selectable");
            if (this.target && this.target.line === bar.line && this.target.bar === bar.idx) bEl.addClass("is-target");
            bEl.addEventListener("click", () => { this.target = { line: bar.line, bar: bar.idx }; this.focusPiano = true; this.render(); });
          }
          if (bar.simile) {
            bEl.addClass("cb-simile-bar");
            bEl.createSpan({ cls: "cb-simile", text: "%" });
            bEl.addEventListener("click", () => this.playChord(bar.chords[0]));
          } else if (!bar.chords.length) {
            bEl.addClass("cb-empty");
          }
          if (!bar.simile) bar.chords.forEach((c, j) => {
            const cEl = this.renderChord(bEl, c);
            this.makeDraggable(cEl, bar, j);
            bar.chordEls.push(cEl);
          });
          this.dropZone(bEl, { line: bar.line, bar: bar.idx });
          this.barEls.push(bEl);
        });
        if (item.bars.length) {
          item.bars[item.bars.length - 1].el?.addClass("is-last");
          const nb = grid.createDiv({ cls: "cb-newbar", text: "+", attr: { "aria-label": "Drop here for a new bar" } });
          this.dropZone(nb, { line: item.bars[0].line, newBar: true });
        }
        if (item.repeat > 1) row.createDiv({ cls: "cb-times", text: "×" + item.repeat });
      }
    }
    this.highlight();
  }

  renderChord(parent, c) {
    const el = parent.createSpan({ cls: "cb-chord" });
    if (c.other !== undefined) { el.addClass("cb-other"); el.setText(c.other); return el; }
    el.createSpan({ cls: "cb-root", text: this.name(c.pc) });
    if (c.quality) el.createSpan({ cls: "cb-quality", text: c.quality });
    if (c.bassPc !== null) el.createSpan({ cls: "cb-bass", text: "/" + this.name(c.bassPc) });
    el.setAttr("title", "Click to hear");
    el.onclick = () => this.playChord(c);
    return el;
  }

  button(parent, icon, label, onClick, active) {
    const b = parent.createEl("button", { cls: "cb-btn" + (active ? " is-active" : ""), attr: { "aria-label": label } });
    if (icon) setIcon(b, icon);
    if (!b.querySelector("svg")) b.setText(icon === "keyboard-music" ? "🎹" : label);
    b.onclick = onClick;
    return b;
  }

  renderToolbar(bar) {
    const trash = bar.createDiv({ cls: "cb-trash", attr: { "aria-label": "Drop here to delete" } });
    setIcon(trash, "trash-2");
    trash.appendText(" Delete");
    this.dropZone(trash, { trash: true });
    const g1 = bar.createDiv({ cls: "cb-group" });
    this.playBtn = this.button(g1, this.playing ? "square" : "play", this.playing ? "Stop" : "Play", () => (this.playing ? this.stop() : this.play()), !!this.playing);
    this.playBtn.addClass("cb-play");
    if (this.startAt) this.button(g1, "skip-back", "Play from the beginning", () => this.playFrom(null)).addClass("cb-rewind");
    this.button(g1, "repeat", "Loop", () => { this.loop = !this.loop; this.render(); }, this.loop);
    this.button(g1, "timer", "Metronome", () => { this.metronome = !this.metronome; this.render(); }, this.metronome);
    this.button(g1, "keyboard-music", "Piano: find chords", () => { this.pianoOpen = !this.pianoOpen; this.focusPiano = this.pianoOpen; this.render(); }, this.pianoOpen).addClass("cb-piano-btn");
    const sel = g1.createEl("select", { cls: "dropdown cb-instrument", attr: { "aria-label": "Sound" } });
    for (const [id, label] of Object.entries(INSTRUMENTS)) sel.createEl("option", { value: id, text: label });
    sel.value = this.plugin.settings.instrument;
    sel.onchange = async () => {
      await this.plugin.setInstrument(sel.value);
      if (!this.playing) this.playChord(this.song.sections.flatMap((s) => s.items).find((i) => i.bars)?.bars[0]?.chords[0]);
    };

    const g2 = bar.createDiv({ cls: "cb-group" });
    g2.createSpan({ cls: "cb-label", text: "BPM" });
    this.button(g2, "minus", "Slower", () => this.setBpm(this.bpm - 1));
    const bpm = g2.createEl("input", { cls: "cb-bpm", attr: { type: "number", min: "30", max: "300", value: String(this.bpm) } });
    this.bpmInput = bpm;
    bpm.oninput = () => { const v = parseInt(bpm.value); if (v >= 30 && v <= 300) this.setBpm(v, false); };
    bpm.onchange = () => this.setBpm(parseInt(bpm.value) || this.bpm);
    this.button(g2, "plus", "Faster", () => this.setBpm(this.bpm + 1));
    this.tapBtn = this.button(g2, null, "Tap", () => this.tap());
    this.tapBtn.addClass("cb-tap");
    this.tapBtn.setAttr("aria-label", "Tap the beat to set the tempo");

    const g3 = bar.createDiv({ cls: "cb-group" });
    g3.createSpan({ cls: "cb-label", text: "Transpose" });
    this.button(g3, "minus", "Down a semitone", () => { this.transpose--; this.render(); });
    g3.createSpan({ cls: "cb-value", text: (this.transpose > 0 ? "+" : "") + this.transpose });
    this.button(g3, "plus", "Up a semitone", () => { this.transpose++; this.render(); });
    this.button(g3, null, this.flats ? "♭" : "♯", () => { this.flats = !this.flats; this.render(); }).addClass("cb-acc");
    if (this.transpose !== 0) this.button(g3, "rotate-ccw", "Reset", () => { this.transpose = 0; this.render(); });

    if (this.key) {
      const m = String(this.key).trim().match(/^([A-G])([#b♯♭]?)(.*)$/);
      const label = m ? this.name(accPc(m[1], m[2])) + m[3] : this.key;
      bar.createDiv({ cls: "cb-key", text: "Key: " + label });
    }
  }

  // Changes apply to playback immediately: the scheduler reads this.bpm for every new event.
  setBpm(v, updateInput = true) {
    this.bpm = Math.min(300, Math.max(30, Math.round(v)));
    if (updateInput && this.bpmInput) this.bpmInput.value = String(this.bpm);
    this.dirty = true;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveBpm(), 1500);
  }

  // Tap tempo: average of the last taps; a pause of 2 s starts over.
  tap() {
    const now = performance.now();
    if (!this.taps || now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();
    this.tapBtn.addClass("is-active");
    window.setTimeout(() => this.tapBtn?.removeClass("is-active"), 90);
    if (this.taps.length < 2) { this.tapBtn.setText("Tap…"); return; }
    const avg = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    this.setBpm(60000 / avg);
    this.tapBtn.setText("Tap " + this.taps.length);
    window.clearTimeout(this.tapReset);
    this.tapReset = window.setTimeout(() => { this.taps = []; this.tapBtn?.setText("Tap"); }, 2000);
  }

  async saveBpm() {
    // Writing the file can re-render the block, so wait until playback stops.
    if (this.playing || !this.dirty) return;
    this.dirty = false;
    window.clearTimeout(this.saveTimer);
    const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
    if (file) await this.plugin.app.fileManager.processFrontMatter(file, (fm) => { fm.bpm = this.bpm; });
  }

  // ---- drag & drop ----

  makeDraggable(el, bar, j) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      this.drag = { line: bar.line, bar: bar.idx, tok: j };
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("application/x-chord-bars", "1");
      window.setTimeout(() => { el.addClass("is-dragging"); this.sheetEl?.addClass("is-dragging"); });
    });
    el.addEventListener("dragend", () => {
      this.drag = null;
      el.removeClass("is-dragging");
      this.sheetEl?.removeClass("is-dragging");
      this.clearDropMarks();
    });
  }

  clearDropMarks() {
    this.containerEl.querySelectorAll(".is-drop, .drop-before, .drop-after").forEach((x) => x.removeClass("is-drop", "drop-before", "drop-after"));
  }

  // where: { line, bar, pos } | { line, newBar: true } | { trash: true }
  dropZone(el, where) {
    el.addEventListener("dragover", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? "copy" : "move";
      this.clearDropMarks();
      el.addClass("is-drop");
      if (where.bar !== undefined) {
        const pos = this.dropPos(el, e.clientX);
        const chords = el.querySelectorAll(".cb-chord");
        if (chords.length) pos < chords.length ? chords[pos].addClass("drop-before") : chords[chords.length - 1].addClass("drop-after");
      }
    });
    el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.removeClass("is-drop"); });
    el.addEventListener("drop", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      const target = where.bar !== undefined ? { ...where, pos: this.dropPos(el, e.clientX) } : where;
      this.moveChord(this.drag, target, e.ctrlKey || e.altKey);
      this.drag = null;
    });
  }

  dropPos(barEl, x) {
    const chords = [...barEl.querySelectorAll(".cb-chord")];
    const i = chords.findIndex((c) => { const r = c.getBoundingClientRect(); return x < r.left + r.width / 2; });
    return i < 0 ? chords.length : i;
  }

  async moveChord(from, to, copy) {
    const lines = this.source.split("\n");
    const rows = new Map();
    const row = (l) => {
      if (!rows.has(l)) {
        const r = splitRow(lines[l]);
        r.bars = r.bars.map((b) => b.split(/\s+/).filter(Boolean));
        rows.set(l, r);
      }
      return rows.get(l);
    };
    const src = row(from.line).bars[from.bar];
    const chord = src[from.tok];
    if (!chord) return;

    if (!copy) {
      src.splice(from.tok, 1);
      if (to.line === from.line && to.bar === from.bar && to.pos > from.tok) to.pos--;
    }
    if (to.trash) {
      if (copy) return;
    } else if (to.newBar) {
      row(to.line).bars.push([chord]);
    } else {
      const dst = row(to.line).bars[to.bar];
      if (dst.length === 1 && dst[0] === "%") dst.splice(0, 1, chord);
      else dst.splice(to.pos, 0, chord);
    }

    // a bar emptied by the move disappears, and so does an emptied row
    if (!copy && !src.length && !(to.line === from.line && to.bar === from.bar)) {
      const r = row(from.line);
      r.bars.splice(r.bars.indexOf(src), 1);
      if (this.target?.line === from.line && this.target.bar >= from.bar) this.target = null;
    }
    const drop = [];
    for (const [l, r] of rows) {
      if (!r.bars.length) drop.push(l);
      else lines[l] = joinRow({ bars: r.bars.map((b) => b.join(" ")), suffix: r.suffix });
    }
    drop.sort((a, b) => b - a).forEach((l) => lines.splice(l, 1));
    if (drop.length) this.target = null;
    this.saveUi();
    await this.writeSource(lines.join("\n"));
  }

  // ---- piano / chord finder ----

  renderPiano(root) {
    const panel = root.createDiv({ cls: "cb-piano", attr: { tabindex: "0" } });
    this.pianoEl = panel;
    panel.addEventListener("mousedown", () => window.setTimeout(() => panel.focus({ preventScroll: true })));
    panel.addEventListener("keydown", (e) => this.onPianoKey(e));
    panel.addEventListener("keyup", (e) => e.stopPropagation());

    const head = panel.createDiv({ cls: "cb-piano-head" });
    const info = head.createDiv({ cls: "cb-piano-info" });
    const found = this.detect();
    const chosen = found.find((f) => f.text === this.chosen) || found[0];
    this.found = chosen;
    info.createDiv({ cls: "cb-found", text: chosen ? this.display(chosen) : this.notes.length ? "?" : "Play some notes" });
    const sub = info.createDiv({ cls: "cb-found-sub" });
    sub.setText(this.notes.length ? this.notes.map((n) => this.name(n % 12 - this.transpose)).join(" · ") : "Click the keys or use your keyboard");
    if (found.length > 1) {
      const alts = info.createDiv({ cls: "cb-alts" });
      for (const f of found) {
        const chip = alts.createEl("button", { cls: "cb-chip" + (f === chosen ? " is-active" : ""), text: this.display(f) });
        chip.onclick = () => { this.chosen = f.text; this.render(); };
      }
    }

    const actions = head.createDiv({ cls: "cb-piano-actions" });
    this.button(actions, "volume-2", "Hear chord (Space)", () => this.hearNotes());
    this.button(actions, "eraser", "Clear (Esc)", () => { this.notes = []; this.chosen = null; this.render(); });
    const addBar = this.button(actions, "plus", "Add as new bar (Enter)", () => this.addChord(false));
    addBar.appendText(" New bar");
    const addIn = this.button(actions, "corner-down-left", "Add to selected bar (Shift+Enter)", () => this.addChord(true));
    addIn.appendText(" In bar");
    if (!chosen || chosen.single) { addBar.disabled = true; addIn.disabled = true; }
    actions.createDiv({ cls: "cb-target", text: this.targetLabel() });

    const kbWrap = panel.createDiv({ cls: "cb-kb-wrap" });
    this.button(kbWrap, "chevron-left", "Octave down (Z)", () => { this.octave = Math.max(1, this.octave - 1); this.render(); });
    const kb = kbWrap.createDiv({ cls: "cb-kb" });
    this.button(kbWrap, "chevron-right", "Octave up (X)", () => { this.octave = Math.min(6, this.octave + 1); this.render(); });

    const base = 12 * (this.octave + 1);
    const whites = [0, 2, 4, 5, 7, 9, 11];
    const total = 25;
    const whiteCount = Array.from({ length: total }, (_, i) => i).filter((i) => whites.includes(i % 12)).length;
    let w = 0;
    for (let i = 0; i < total; i++) {
      const midi = base + i;
      const white = whites.includes(i % 12);
      const key = kb.createDiv({ cls: "cb-key-" + (white ? "white" : "black") });
      if (this.notes.includes(midi)) key.addClass("is-on");
      if (white) {
        key.style.left = (w * 100) / whiteCount + "%";
        key.style.width = 100 / whiteCount + "%";
        w++;
      } else {
        key.style.left = (w * 100) / whiteCount - 30 / whiteCount + "%";
        key.style.width = 60 / whiteCount + "%";
      }
      const label = this.keyLabel(i);
      if (label) key.createDiv({ cls: "cb-key-label", text: label });
      if (i % 12 === 0) key.createDiv({ cls: "cb-key-c", text: "C" + (this.octave + Math.floor(i / 12)) });
      key.addEventListener("mousedown", (e) => { e.preventDefault(); this.toggleNote(midi); });
    }

    panel.createDiv({
      cls: "cb-piano-hint",
      text: "Keyboard: A W S E D F T G Y H U J K… = notes · Z/X octave · Space hear · Enter new bar · Shift+Enter add to bar · Esc clear · click a bar to select it",
    });
    if (this.focusPiano) { this.focusPiano = false; this.saveUi(); window.setTimeout(() => panel.focus({ preventScroll: true })); }
  }

  keyLabel(i) {
    const code = KEY_CODES[i];
    if (!code) return null;
    return (this.plugin.layout?.get(code) || code.replace("Key", "").replace("Semicolon", ";").replace("Quote", "'")).toUpperCase();
  }

  onPianoKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopPropagation();
    if (e.repeat) { e.preventDefault(); return; }
    const i = KEY_CODES.indexOf(e.code);
    let handled = true;
    if (i >= 0) this.toggleNote(12 * (this.octave + 1) + i);
    else if (e.code === "KeyZ") { this.octave = Math.max(1, this.octave - 1); this.focusPiano = true; this.render(); }
    else if (e.code === "KeyX") { this.octave = Math.min(6, this.octave + 1); this.focusPiano = true; this.render(); }
    else if (e.code === "Space") this.hearNotes();
    else if (e.code === "Enter" || e.code === "NumpadEnter") this.addChord(e.shiftKey);
    else if (e.code === "Escape") { this.notes = []; this.chosen = null; this.focusPiano = true; this.render(); }
    else if (e.code === "Backspace") { this.notes.pop(); this.chosen = null; this.focusPiano = true; this.render(); }
    else handled = false;
    if (handled) e.preventDefault();
  }

  toggleNote(midi) {
    const at = this.notes.indexOf(midi);
    if (at >= 0) this.notes.splice(at, 1);
    else {
      this.notes.push(midi);
      const ctx = this.plugin.audio();
      this.plugin.tone(midi, ctx.currentTime, 1.2, 0.16, this.plugin.master, 0);
    }
    this.chosen = null;
    this.focusPiano = true;
    this.render();
  }

  hearNotes() {
    const ctx = this.plugin.audio();
    [...this.notes].sort((a, b) => a - b).forEach((n, i) => this.plugin.tone(n, ctx.currentTime, 1.6, i === 0 ? 0.2 : 0.12, this.plugin.master, i));
  }

  // Chord names that match the selected notes, best first. Pitches are as heard (already transposed).
  detect() {
    if (!this.notes.length) return [];
    const sorted = [...this.notes].sort((a, b) => a - b);
    const bass = sorted[0] % 12;
    const pcs = [...new Set(sorted.map((n) => n % 12))];
    const out = [];
    for (const root of pcs) {
      const set = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b).join(",");
      DETECT.forEach(([quality, ivs], rank) => {
        if (ivs.join(",") !== set) return;
        const bassPc = bass === root ? null : bass;
        out.push({ root, quality, bassPc, score: rank + (bass === root ? 0 : 50) });
      });
    }
    if (!out.length && pcs.length === 1) out.push({ root: bass, quality: "", bassPc: null, single: true, score: 0 });
    out.sort((a, b) => a.score - b.score);
    // canonical text as it will be written in the note (in the original key)
    for (const f of out) f.text = this.chordText(f);
    return out;
  }

  writtenName(pc) {
    const n = (this.flats ? FLATS : SHARPS)[((pc - this.transpose) % 12 + 12) % 12];
    return n.replace("♯", "#").replace("♭", "b");
  }

  chordText(f) {
    return this.writtenName(f.root) + f.quality + (f.bassPc !== null ? "/" + this.writtenName(f.bassPc) : "");
  }

  display(f) {
    const n = (pc) => this.name(pc - this.transpose);
    return n(f.root) + f.quality + (f.bassPc !== null ? "/" + n(f.bassPc) : "") + (f.single ? " (note)" : "");
  }

  targetLabel() {
    const t = this.target;
    if (!t) return "→ end of song";
    const bar = this.allBars().find((b) => b.line === t.line && b.idx === t.bar);
    return bar ? "→ selected bar" : "→ end of song";
  }

  allBars() {
    return this.song.sections.flatMap((s) => s.items).filter((i) => i.bars).flatMap((i) => i.bars);
  }

  // Edit the block's source and write it back to the note.
  async addChord(inBar) {
    const f = this.found;
    if (!f || f.single) return;
    const chord = f.text;
    const lines = this.source.split("\n");
    const rowLines = this.allBars().map((b) => b.line);
    let t = this.target && this.allBars().find((b) => b.line === this.target.line && b.idx === this.target.bar) ? this.target : null;
    if (!t && rowLines.length) {
      const last = this.allBars().pop();
      t = { line: last.line, bar: last.idx };
    }

    if (!t) {
      // no bars yet
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push(`| ${chord} |`);
      this.target = { line: lines.length - 1, bar: 0 };
    } else {
      const row = splitRow(lines[t.line]);
      if (inBar) {
        const cur = row.bars[t.bar].trim();
        row.bars[t.bar] = !cur || cur === "%" ? chord : cur + " " + chord;
        lines[t.line] = joinRow(row);
        this.target = t;
      } else if (t.bar === row.bars.length - 1 && row.bars.length >= 4) {
        lines.splice(t.line + 1, 0, `| ${chord} |`);
        this.target = { line: t.line + 1, bar: 0 };
      } else {
        row.bars.splice(t.bar + 1, 0, chord);
        lines[t.line] = joinRow(row);
        this.target = { line: t.line, bar: t.bar + 1 };
      }
    }
    this.notes = [];
    this.chosen = null;
    this.focusPiano = true;
    this.saveUi();
    await this.writeSource(lines.join("\n"));
  }

  async writeSource(next) {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!file) return;
    const prev = this.source;
    const hint = this.lineStart;
    await this.plugin.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      let best = null;
      for (let i = 0; i < lines.length; i++) {
        if (!/^\s*(`{3,}|~{3,})\s*(chords|acordes)\s*$/.test(lines[i])) continue;
        const fence = lines[i].trim().match(/^(`+|~+)/)[1];
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith(fence)) j++;
        if (lines.slice(i + 1, j).join("\n") !== prev) continue;
        if (!best || (hint != null && Math.abs(i - hint) < Math.abs(best.start - hint))) best = { start: i, end: j };
      }
      if (!best) return data;
      lines.splice(best.start + 1, best.end - best.start - 1, ...next.split("\n"));
      return lines.join("\n");
    });
  }

  // ---- audio ----
  playChord(c, when, dur, out) {
    if (!c || c.other !== undefined) return;
    const ctx = this.plugin.audio();
    const t = when ?? ctx.currentTime;
    const d = dur ?? 1.4;
    const dest = out ?? this.plugin.master;
    const root = c.pc + this.transpose;
    const bass = (c.bassPc ?? c.pc) + this.transpose;
    const midi = [36 + ((bass % 12) + 12) % 12];
    for (const iv of intervalsFor(c.quality)) {
      let n = 48 + ((root % 12) + 12) % 12 + iv;
      if (n < 52) n += 12;
      midi.push(n);
    }
    midi.forEach((n, i) => this.plugin.tone(n, t, d, i === 0 ? 0.22 : 0.11, dest, i));
  }

  sequence() {
    const seq = [];
    for (const s of this.song.sections)
      for (let sr = 0; sr < s.repeat; sr++)
        for (const item of s.items) {
          if (!item.bars) continue;
          for (let r = 0; r < item.repeat; r++)
            for (const bar of item.bars) seq.push(bar);
        }
    return seq;
  }

  // Events of one bar, in beats: chord onsets and metronome clicks.
  barEvents(bar) {
    const beats = this.song.beats;
    const n = bar.chords.length;
    const ev = [];
    bar.chords.forEach((c, j) => ev.push({ at: (j * beats) / n, chord: j, len: beats / n }));
    for (let b = 0; b < beats; b++) ev.push({ at: b, click: true, accent: b === 0 });
    ev.sort((a, b) => a.at - b.at);
    ev.push({ at: beats, end: true });
    return ev;
  }

  isStart(bar) {
    return !!this.startAt && this.startAt.line === bar.line && this.startAt.bar === bar.idx;
  }

  // Set the start point (null = beginning) and play from it; also jumps there while playing.
  playFrom(bar) {
    this.startAt = bar ? { line: bar.line, bar: bar.idx } : null;
    if (this.playing) this.stop();
    this.play();
  }

  play() {
    const seq = this.sequence();
    if (!seq.length) return;
    const from = Math.max(0, seq.findIndex((b) => this.isStart(b)));
    const ctx = this.plugin.audio();
    const out = ctx.createGain();
    out.connect(this.plugin.master);
    const p = { out, seq, from, barIdx: from, evIdx: 0, events: this.barEvents(seq[from]), time: ctx.currentTime + 0.1, timers: new Set() };
    this.playing = p;
    p.interval = window.setInterval(() => this.schedule(p), 25);
    this.schedule(p);
    this.render();
  }

  at(p, time, fn) {
    const id = window.setTimeout(() => { p.timers.delete(id); fn(); }, Math.max(0, (time - this.plugin.audio().currentTime) * 1000));
    p.timers.add(id);
  }

  schedule(p) {
    if (this.playing !== p) return;
    const ctx = this.plugin.audio();
    while (p.time < ctx.currentTime + 0.12) {
      const beat = 60 / this.bpm;
      const ev = p.events[p.evIdx];
      const barIdx = p.barIdx;
      const bar = p.seq[barIdx];

      if (ev.end) {
        p.barIdx++;
        if (p.barIdx >= p.seq.length) {
          if (!this.loop) { this.at(p, p.time, () => this.stop()); window.clearInterval(p.interval); return; }
          p.barIdx = p.from; // loop back to the start point
        }
        p.events = this.barEvents(p.seq[p.barIdx]);
        p.evIdx = 0;
        continue;
      }

      if (ev.click && this.metronome) this.plugin.click(p.time, ev.accent, p.out);
      if (ev.chord !== undefined) {
        this.playChord(bar.chords[ev.chord], p.time, ev.len * beat * 0.95, p.out);
        const j = ev.chord;
        this.at(p, p.time, () => { this.current = { bar, j }; this.highlight(); });
      }
      const next = p.events[p.evIdx + 1];
      p.time += (next.at - ev.at) * beat;
      p.evIdx++;
    }
  }

  highlight() {
    this.containerEl.querySelectorAll(".is-playing:not(.cb-btn)").forEach((x) => x.removeClass("is-playing"));
    if (!this.playing || !this.current) return;
    const { bar, j } = this.current;
    bar.el?.addClass("is-playing");
    bar.chordEls?.[j]?.addClass("is-playing");
  }

  stop() {
    const p = this.playing;
    if (!p) return;
    window.clearInterval(p.interval);
    p.timers.forEach((t) => window.clearTimeout(t));
    const ctx = this.plugin.audio();
    p.out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    window.setTimeout(() => p.out.disconnect(), 300);
    this.playing = null;
    this.current = null;
    if (this.containerEl.isConnected) this.render();
    this.saveBpm();
  }
}

const range = (notes, lo, hi, extra = []) => {
  const out = [];
  for (let o = lo; o <= hi; o++) for (const n of notes) out.push(n + o);
  return out.concat(extra);
};
const SAMPLE_SETS = {
  // Salamander Grand Piano, Alexander Holm (CC BY 3.0)
  softpiano: { dir: "samples", url: "https://tonejs.github.io/audio/salamander", names: range(["C", "Ds", "Fs", "A"], 1, 6, ["C7"]) },
  // tonejs-instruments acoustic guitar, Nicholaus Brosowsky (CC BY 3.0)
  acguitar: {
    dir: "samples/guitar",
    url: "https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-acoustic",
    names: ["D2", "Ds2", "E2", "F2", "Fs2", "G2", "Gs2", "A2", "As2", "B2"]
      .concat(range(["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"], 3, 4), ["C5", "Cs5", "D5"]),
  },
};
const INSTRUMENTS = { softpiano: "Soft Piano", acguitar: "Acoustic Guitar", piano: "Piano", guitar: "Guitar (synth)", epiano: "E-Piano", pad: "Pad", organ: "Organ", synth: "Synth" };

module.exports = class ChordBarsPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({ instrument: "piano" }, await this.loadData());
    this.ksCache = new Map();
    this.ui = new Map();
    if (SAMPLE_SETS[this.settings.instrument]) this.app.workspace.onLayoutReady(() => this.loadSamples(this.settings.instrument));
    navigator.keyboard?.getLayoutMap?.().then((m) => (this.layout = m)).catch(() => {});
    const proc = (source, el, ctx) =>
      ctx.addChild(new ChordBlock(this, el, source, ctx.sourcePath, ctx.getSectionInfo(el)?.lineStart));
    this.registerMarkdownCodeBlockProcessor("chords", proc);
    this.registerMarkdownCodeBlockProcessor("acordes", proc);
  }

  onunload() { this.ctx?.close(); }

  async setInstrument(name) {
    this.settings.instrument = name;
    if (SAMPLE_SETS[name]) await this.loadSamples(name);
    await this.saveData(this.settings);
  }

  audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // limiter so stacked notes never clip
      this.master = this.ctx.createDynamicsCompressor();
      this.master.threshold.value = -10;
      this.master.ratio.value = 8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  // One note. `index` is the note's position in the chord (0 = bass), used for strumming.
  tone(midi, t, dur, vol, dest, index = 0) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const fn = {
      softpiano: this.softpiano, acguitar: this.acguitar, piano: this.piano, guitar: this.guitar, epiano: this.epiano,
      pad: this.pad, organ: this.organ, synth: this.synth,
    }[this.settings.instrument] || this.piano;
    fn.call(this, f, t, dur, vol, dest, index, midi);
  }

  env(t, attack, peak, dur, release = 0.08, sustain = null) {
    const g = this.audio().createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (sustain === null) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else {
      g.gain.setValueAtTime(peak * sustain, t + Math.max(attack, dur - release));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    return g;
  }

  osc(type, f, t, end, dest, gain = 1, detune = 0) {
    const ctx = this.audio();
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    const g = ctx.createGain(); g.gain.value = gain;
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(end + 0.05);
  }

  // ---- Soft Piano: real grand piano samples (Salamander) in ./samples ----

  // Sample sets live in the plugin folder as "<Note><octave>.mp3" (e.g. Cs3.mp3). Missing files
  // (fresh install, phone, synced vault) are downloaded once from the original source and kept.
  loadSamples(set) {
    this.sampleSets ??= {};
    if (this.sampleSets[set]) return this.sampleSets[set].ready;
    const s = (this.sampleSets[set] = { buffers: new Map(), loaded: false });
    const { dir, url, names } = SAMPLE_SETS[set];
    const ctx = this.audio();
    const adapter = this.app.vault.adapter;
    const folder = `${this.manifest.dir}/${dir}`;
    let notice = null;
    s.ready = (async () => {
      if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
      await Promise.all(names.map(async (name) => {
        const path = `${folder}/${name}.mp3`;
        let data;
        if (await adapter.exists(path)) data = await adapter.readBinary(path);
        else {
          notice ??= new Notice(`Chord Bars: downloading ${INSTRUMENTS[set]} sounds (first time only)…`, 0);
          data = (await requestUrl({ url: `${url}/${name}.mp3` })).arrayBuffer;
          await adapter.writeBinary(path, data);
        }
        const m = name.match(/^([A-G])(s?)(\d)$/);
        const midi = 12 * (parseInt(m[3]) + 1) + NOTE_PC[m[1]] + (m[2] ? 1 : 0);
        s.buffers.set(midi, await ctx.decodeAudioData(data.slice(0)));
      }));
      s.loaded = true;
    })().catch((e) => {
      console.error(`Chord Bars: could not load ${set} samples`, e);
      new Notice(`Chord Bars: couldn't load ${INSTRUMENTS[set]} sounds. Check your connection and try again.`);
      delete this.sampleSets[set]; // allow a retry
    }).finally(() => notice?.hide());
    return s.ready;
  }

  // Play the nearest sample, pitch-shifted to `midi`. Returns false if the set isn't ready yet.
  sample(set, midi, st, dur, vol, release) {
    const s = this.sampleSets?.[set];
    if (!s?.loaded) { this.loadSamples(set); return false; }
    const ctx = this.audio();
    let best = null;
    for (const m of s.buffers.keys()) if (best === null || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    const src = ctx.createBufferSource();
    src.buffer = s.buffers.get(best);
    src.playbackRate.value = Math.pow(2, (midi - best) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(vol, st + 0.006);
    g.gain.setTargetAtTime(0.0001, st + Math.max(0.15, dur), release);
    src.connect(g);
    src.start(st);
    src.stop(st + Math.max(0.15, dur) + release * 6);
    return g;
  }

  // Long, soft room reverb built from decaying noise.
  reverb() {
    if (this.reverbIn) return this.reverbIn;
    const ctx = this.audio();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.15;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass"; tone.frequency.value = 3000;
    conv.connect(tone); tone.connect(wet); wet.connect(this.master);
    this.reverbIn = conv;
    return conv;
  }

  softpiano(f, t, dur, vol, dest, index, midi) {
    // played gently: a little looser in time and velocity, darker tone, slow damper
    const st = t + index * 0.012 + Math.random() * 0.006;
    const g = this.sample("softpiano", midi, st, dur, vol * 3.2 * (0.88 + Math.random() * 0.12), 0.35);
    if (!g) return this.piano(f, t, dur, vol, dest); // until the samples are decoded
    const lp = this.audio().createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 2600; lp.Q.value = 0.3;
    g.connect(lp); lp.connect(dest); lp.connect(this.reverb());
  }

  // Steel-string acoustic, strummed down with a natural spread.
  acguitar(f, t, dur, vol, dest, index, midi) {
    while (midi < 40) midi += 12; // nothing below low E
    const st = t + index * 0.028 + Math.random() * 0.008;
    const g = this.sample("acguitar", midi, st, dur - index * 0.028, vol * 2.6 * (0.85 + Math.random() * 0.15), 0.12);
    if (!g) return this.guitar(f, t, dur, vol, dest, index); // until the samples are decoded
    g.connect(dest);
    const send = this.audio().createGain();
    send.gain.value = 0.5;
    g.connect(send); send.connect(this.reverb());
  }

  piano(f, t, dur, vol, dest) {
    const ctx = this.audio();
    const len = Math.max(dur, 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 1.3, t + 0.005);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    // damper: cut the note when the chord changes
    g.gain.setTargetAtTime(0.0001, t + dur, 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(9000, f * 10), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(4000, f * 3), t + 0.6);
    lp.connect(g); g.connect(dest);
    const partials = [[1, 1], [2, 0.45], [3, 0.22], [4, 0.12], [5, 0.06]];
    for (const [h, a] of partials) this.osc("sine", f * h * (1 + 0.0004 * h * h), t, t + len, lp, a);
    this.osc("triangle", f, t, t + len, lp, 0.3, 4);
  }

  // Karplus-Strong plucked string, strummed low → high.
  guitar(f, t, dur, vol, dest, index) {
    const ctx = this.audio();
    const key = Math.round(f * 10);
    let buf = this.ksCache.get(key);
    if (!buf) {
      const sr = ctx.sampleRate, n = Math.floor(sr * 3);
      buf = ctx.createBuffer(1, n, sr);
      const out = buf.getChannelData(0);
      const period = Math.round(sr / f);
      const line = new Float32Array(period);
      for (let i = 0; i < period; i++) line[i] = Math.random() * 2 - 1;
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const j = i % period;
        const v = 0.996 * 0.5 * (line[j] + prev);
        prev = line[j];
        line[j] = v;
        out[i] = v;
      }
      this.ksCache.set(key, buf);
    }
    const st = t + index * 0.022;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 1.6, st);
    g.gain.setTargetAtTime(0.0001, st + Math.max(0.1, dur - index * 0.022), 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3500;
    src.connect(lp); lp.connect(g); g.connect(dest);
    src.start(st); src.stop(st + Math.min(3, dur + 0.3));
  }

  epiano(f, t, dur, vol, dest) {
    const ctx = this.audio();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 1.2, t + 0.004);
    g.gain.exponentialRampToValueAtTime(vol * 0.4, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, 0.3));
    g.connect(dest);
    // FM tine: modulator at 14x decays fast for the bell attack
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * 14;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.3);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g);
    const trem = ctx.createOscillator(); trem.frequency.value = 4.5;
    const tg = ctx.createGain(); tg.gain.value = vol * 0.15;
    trem.connect(tg); tg.connect(g.gain);
    for (const o of [car, mod, trem]) { o.start(t); o.stop(t + dur + 0.1); }
  }

  pad(f, t, dur, vol, dest) {
    const ctx = this.audio();
    const g = this.env(t, Math.min(0.35, dur * 0.4), vol * 0.9, dur + 0.25, 0.3, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = Math.min(2500, f * 4); lp.Q.value = 0.7;
    lp.connect(g); g.connect(dest);
    for (const d of [-9, 0, 9]) this.osc("sawtooth", f, t, t + dur + 0.25, lp, 0.3, d);
  }

  organ(f, t, dur, vol, dest) {
    const g = this.env(t, 0.01, vol * 0.7, dur, 0.05, 1);
    g.connect(dest);
    for (const [h, a] of [[0.5, 0.5], [1, 1], [2, 0.6], [3, 0.35], [4, 0.2]]) this.osc("sine", f * h, t, t + dur, g, a);
  }

  synth(f, t, dur, vol, dest) {
    const ctx = this.audio();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g); g.connect(dest);
    this.osc("triangle", f, t, t + dur, lp, 1);
    this.osc("sawtooth", f, t, t + dur, lp, 0.25, 6);
  }

  click(t, accent, dest) {
    const ctx = this.audio();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(accent ? 0.35 : 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.06);
  }
};
