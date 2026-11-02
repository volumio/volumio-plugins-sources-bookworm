'use strict';
// The vendor overlay files the plugin ships (plugin/overlays, built by
// scripts/vendor-overlays.js from the vendor's downloads): what each pss- file is,
// a dtoverlay line rewritten to the shipped name and back, and what a generated
// videoconfig.txt needs present in /boot/overlays.
//
// The firmware finds an overlay by file name, case-insensitively on the FAT boot
// partition; a dtoverlay line names the file, and its parameters live inside the
// blob. So a vendor file installed under a pss- name is the same overlay with the
// same parameters, and the pss- prefix is what the root helper allows the plugin to
// write to and remove from /boot/overlays — never a file that came with the OS.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = /^pss-[a-z0-9-]+$/;
const FDT_MAGIC = 0xd00dfeed;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function split(line) {
    const i = String(line).indexOf(',');
    return i === -1 ? [String(line), ''] : [line.slice(0, i), line.slice(i)];
}

// Reads manifest.json and every file it names. A file that is missing, whose bytes are
// not the manifest's, or that is not a device tree blob is left out and reported in
// `problems`; it is never installed. `dir` absent: nothing shipped, no problem.
function load(dir) {
    const byVendor = new Map();
    const byFile = new Map();
    const problems = [];
    let manifest = null;
    const manifestFile = path.join(dir, 'manifest.json');
    if (fs.existsSync(manifestFile)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (e) { problems.push('manifest.json does not parse: ' + e.message); }
    }
    for (const [vendor, entry] of Object.entries((manifest && manifest.overlays) || {})) {
        if (!entry || typeof entry !== 'object' || !FILE_NAME.test(entry.file || '')) { problems.push(vendor + ': manifest names no pss- file'); continue; }
        let bytes;
        try { bytes = fs.readFileSync(path.join(dir, entry.file + '.dtbo')); } catch (e) { problems.push(vendor + ': ' + entry.file + '.dtbo is missing'); continue; }
        if (sha256(bytes) !== entry.sha256) { problems.push(vendor + ': ' + entry.file + '.dtbo is not the file the manifest describes'); continue; }
        if (bytes.length < 8 || bytes.readUInt32BE(0) !== FDT_MAGIC) { problems.push(vendor + ': ' + entry.file + '.dtbo is not a device tree blob'); continue; }
        if (byFile.has(entry.file)) { problems.push(vendor + ': ' + entry.file + ' is named twice'); continue; }
        const rec = { vendor, file: entry.file, bytes, sha256: entry.sha256, source: entry.source || null, page: entry.page || null };
        byVendor.set(vendor.toLowerCase(), rec);
        byFile.set(entry.file, rec);
    }
    return {
        dir,
        problems,
        fetched: manifest && manifest.fetched || null,
        count: byFile.size,
        // Lower-case vendor names, for presets.applicable
        names() { return new Set(byVendor.keys()); },
        fileFor(vendor) { const r = byVendor.get(String(vendor || '').toLowerCase()); return r ? r.file : null; },
        vendorFor(file) { const r = byFile.get(file); return r ? r.vendor : null; },
        bytes(file) { const r = byFile.get(file); return r ? r.bytes : null; },
        record(file) { return byFile.get(file) || null; },
        // dtoverlay value with the base name rewritten to the shipped file, parameters kept
        toShipped(line) { const [base, params] = split(line); const f = this.fileFor(base); return f ? f + params : String(line); },
        // and back to the vendor's name, for reading the plugin's own file
        toVendor(line) { const [base, params] = split(line); const v = this.vendorFor(base); return v ? v + params : String(line); },
        // the shipped files a videoconfig.txt refers to, in order, each once
        needed(text) {
            const out = [];
            String(text || '').split(/\r?\n/).forEach((raw) => {
                const m = raw.trim().match(/^dtoverlay=([^,\s]+)/);
                if (m && byFile.has(m[1]) && out.indexOf(m[1]) === -1) out.push(m[1]);
            });
            return out;
        },
    };
}

// The pss- files present in a /boot/overlays directory (ours by prefix), or [] when it
// cannot be read.
function installed(overlaysDir) {
    try {
        return fs.readdirSync(overlaysDir).map((f) => f.match(/^(pss-[a-z0-9-]+)\.dtbo$/)).filter(Boolean).map((m) => m[1]).sort();
    } catch (e) { return []; }
}

module.exports = { FILE_NAME, FDT_MAGIC, load, installed, sha256 };
