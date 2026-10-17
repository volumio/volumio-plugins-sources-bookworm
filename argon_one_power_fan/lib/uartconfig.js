"use strict";

/**
 * Boot-config handling for the UART the case's power-off signal needs.
 *
 * Only /boot/userconfig.txt (the user-owned file) is ever written, never
 * config.txt. The plugin recognises its own setting by a marked block:
 *
 *   # BEGIN argon_one_power_fan (managed by plugin, do not edit)
 *   enable_uart=1                (Pi 5: dtparam=uart0=on)
 *   # END argon_one_power_fan
 *
 * Anything outside the block that enables the UART is "foreign": it is reported
 * but never copied, taken over or removed.
 */

const fs = require("fs");
const path = require("path");

const BEGIN = "# BEGIN argon_one_power_fan (managed by plugin, do not edit)";
const END = "# END argon_one_power_fan";
const BEGIN_RE = /^\s*#\s*BEGIN argon_one_power_fan\b/;
const END_RE = /^\s*#\s*END argon_one_power_fan\b/;

const OWN_FILE = "userconfig.txt";
// Scan order. Volumio's config.txt includes the other two files.
const SCAN_FILES = ["config.txt", "volumioconfig.txt", "userconfig.txt"];

function paramLine(pi5) {
  return pi5 ? "dtparam=uart0=on" : "enable_uart=1";
}

// Returns 'on', 'off' or null for one config line.
function lineSetsUart(line, pi5) {
  const s = String(line).replace(/\r$/, "").trim();
  if (!s || s.charAt(0) === "#") return null;
  let m;
  if (pi5) {
    m = s.match(/^dtparam\s*=\s*(.*)$/i);
    if (!m) return null;
    const tokens = m[1].split(",");
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].trim().match(/^uart0(?:\s*=\s*(\w+))?$/i);
      if (t) {
        const v = (t[1] || "on").toLowerCase();
        return v === "off" || v === "false" || v === "0" || v === "no"
          ? "off"
          : "on";
      }
    }
    return null;
  }
  m = s.match(/^enable_uart\s*=\s*(\S+)/i);
  if (!m) return null;
  return m[1] === "1" ? "on" : "off";
}

// "[all]", "[pi4]", "[pi5]", "[cm4]", "[none]", "[gpio4=1]" ... -> section name
function sectionOf(line) {
  const m = String(line)
    .trim()
    .match(/^\[(.*)\]$/);
  return m ? m[1].trim().toLowerCase() : null;
}

function sectionApplies(section, tag) {
  if (section === null || section === "all") return true;
  return section === tag;
}

// 'none' (no block), 'ok' (every BEGIN is closed by an END before the next BEGIN)
// or 'malformed' (a BEGIN with no END, or a second BEGIN inside a block). A stray
// END on its own is harmless: nothing is removed because of it.
function blockStatus(text) {
  const lines = String(text).split("\n");
  let open = false;
  let seen = false;
  for (let i = 0; i < lines.length; i++) {
    if (BEGIN_RE.test(lines[i])) {
      if (open) return "malformed";
      open = true;
      seen = true;
    } else if (END_RE.test(lines[i])) {
      open = false;
    }
  }
  if (open) return "malformed";
  return seen ? "ok" : "none";
}

// Scan one file's text. Returns { own: bool, foreign: [line numbers], off: [line numbers],
// malformed: bool }. Lines inside the plugin's own block count as "own" and are not
// foreign. A malformed block cannot say which lines are the plugin's, so its marker
// lines are ignored and every setting in the file counts as foreign.
function scanText(text, pi5, tag) {
  const out = {
    own: false,
    foreign: [],
    off: [],
    malformed: blockStatus(text) === "malformed",
  };
  const lines = String(text).split("\n");
  let inBlock = false;
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BEGIN_RE.test(line)) {
      inBlock = !out.malformed;
      continue;
    }
    if (END_RE.test(line)) {
      inBlock = false;
      continue;
    }
    const sec = sectionOf(line);
    if (sec !== null) {
      section = sec;
      continue;
    }
    const v = lineSetsUart(line, pi5);
    if (v === null) continue;
    if (inBlock) {
      if (v === "on") out.own = true;
      continue;
    }
    if (!sectionApplies(section, tag)) continue;
    if (v === "on") out.foreign.push(i + 1);
    else out.off.push(i + 1);
  }
  return out;
}

// Combine per-file results into one status.
// state: 'managed' | 'foreign' | 'both' | 'conflict' | 'off'
function combine(perFile) {
  let own = false;
  let malformed = false;
  const foreign = [];
  const off = [];
  Object.keys(perFile).forEach(function (file) {
    const r = perFile[file];
    if (r.own) own = true;
    if (r.malformed) malformed = true;
    r.foreign.forEach(function (n) {
      foreign.push({ file: file, line: n });
    });
    r.off.forEach(function (n) {
      off.push({ file: file, line: n });
    });
  });
  let state;
  if (foreign.length && own) state = "both";
  else if (foreign.length) state = "foreign";
  else if (off.length) state = "conflict";
  else if (own) state = "managed";
  else state = "off";
  return {
    state: state,
    own: own,
    foreign: foreign,
    off: off,
    malformed: malformed,
  };
}

function scan(opts) {
  const dir = opts.bootDir || "/boot";
  const perFile = {};
  SCAN_FILES.forEach(function (name) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      return;
    }
    perFile[name] = scanText(text, opts.pi5, opts.tag);
  });
  return combine(perFile);
}

function eolOf(text) {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

// Text with the plugin's block removed (no other line is touched). A malformed block
// is never removed: without its END line there is no telling where it stops.
function removeBlock(text) {
  if (blockStatus(text) === "malformed") return String(text);
  const lines = String(text).split("\n");
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (BEGIN_RE.test(lines[i])) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (END_RE.test(lines[i])) inBlock = false;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n"); // any \r stays on its line, so CRLF files keep their endings
}

// Text with the plugin's block present (replaced if it already exists).
function addBlock(text, pi5) {
  const eol = eolOf(text);
  let base = removeBlock(text);
  if (base.length && base.charAt(base.length - 1) !== "\n") base += eol;
  return `${base}${BEGIN}${eol}${paramLine(pi5)}${eol}${END}${eol}`;
}

// Block status of userconfig.txt ('none' when the file cannot be read).
function readOwnBlockStatus(opts) {
  try {
    return blockStatus(
      fs.readFileSync(path.join(opts.bootDir || "/boot", OWN_FILE), "utf8"),
    );
  } catch {
    return "none";
  }
}

function writeFileAtomic(file, content) {
  const tmp = `${file}.argon_pf.tmp`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    fs.writeFileSync(file, content); // fallback: in place
  }
}

function backupOnce(file, backupDir) {
  if (!backupDir) return;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const dest = path.join(backupDir, "userconfig.txt.bak");
    if (!fs.existsSync(dest) && fs.existsSync(file))
      fs.copyFileSync(file, dest);
  } catch {
    /* a missing backup must not block the change */
  }
}

// Turn the plugin's setting on. Does nothing when another line already enables
// the UART. Returns { ok, changed, reason }.
//   reason: 'foreign' (already enabled elsewhere), 'conflict' (a line turns it
//   off), 'already' (plugin block present), 'malformed' (the plugin's block in
//   userconfig.txt is incomplete; the file is left untouched), 'io' (write failed)
function enable(opts) {
  if (readOwnBlockStatus(opts) === "malformed")
    return {
      ok: false,
      changed: false,
      reason: "malformed",
      status: scan(opts),
    };
  const s = scan(opts);
  if (s.state === "conflict")
    return { ok: false, changed: false, reason: "conflict", status: s };
  if (s.state === "foreign" || s.state === "both")
    return { ok: true, changed: false, reason: "foreign", status: s };
  if (s.state === "managed")
    return { ok: true, changed: false, reason: "already", status: s };
  const file = path.join(opts.bootDir || "/boot", OWN_FILE);
  try {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      text = "";
    }
    backupOnce(file, opts.backupDir);
    writeFileAtomic(file, addBlock(text, opts.pi5));
  } catch (e) {
    return {
      ok: false,
      changed: false,
      reason: "io",
      error: e.message,
      status: s,
    };
  }
  return { ok: true, changed: true, reason: null, status: scan(opts) };
}

// Remove only the plugin's block. Returns { ok, changed, status }; reason 'malformed'
// when the block is incomplete (nothing is written then).
function disable(opts) {
  const file = path.join(opts.bootDir || "/boot", OWN_FILE);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: true, changed: false, status: scan(opts) };
  }
  const found = blockStatus(text);
  if (found === "malformed")
    return {
      ok: false,
      changed: false,
      reason: "malformed",
      status: scan(opts),
    };
  if (found === "none") return { ok: true, changed: false, status: scan(opts) };
  try {
    backupOnce(file, opts.backupDir);
    writeFileAtomic(file, removeBlock(text));
  } catch (e) {
    return {
      ok: false,
      changed: false,
      reason: "io",
      error: e.message,
      status: scan(opts),
    };
  }
  return { ok: true, changed: true, status: scan(opts) };
}

module.exports = {
  BEGIN: BEGIN,
  END: END,
  paramLine: paramLine,
  blockStatus: blockStatus,
  lineSetsUart: lineSetsUart,
  scanText: scanText,
  combine: combine,
  scan: scan,
  addBlock: addBlock,
  removeBlock: removeBlock,
  enable: enable,
  disable: disable,
};
