'use strict';
// The device side: run the commands, read the files, and turn a plan into actions.
// Every process is started with execFile and an argv (never a shell string); the
// executor is injected so the whole module runs against recorded output on the rig.

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const X = require('./xrandr');
const I = require('./xinput');
const G = require('./grub');
const V = require('./virt');
const O = require('./orientation');

const ROOT_HELPER = '/usr/local/bin/display-configuration-root';
const XAUTHORITY = '/home/volumio/.Xauthority';
const INPUT_CONF_NAME = 'touch';
const RESOLUTION_CONF_NAME = 'resolution';

function defaultRun(cmd, args, opts = {}) {
    const env = Object.assign({}, process.env, opts.env || {});
    if (opts.detached) {
        // A daemon the plugin leaves running (unclutter, xscreensaver): started and let go.
        return new Promise((resolve) => {
            try {
                const child = spawn(cmd, args, { env, detached: true, stdio: 'ignore' });
                child.on('error', (e) => resolve({ code: 1, stdout: '', stderr: '', error: e.message }));
                child.unref();
                setTimeout(() => resolve({ code: 0, stdout: '', stderr: '', error: null }), 50);
            } catch (e) { resolve({ code: 1, stdout: '', stderr: '', error: e.message }); }
        });
    }
    return new Promise((resolve) => {
        const child = execFile(cmd, args, {
            env,
            timeout: opts.timeout || 15000,
            maxBuffer: 4 * 1024 * 1024,
        }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? err.message : null });
        });
        if (opts.input !== undefined && child.stdin) { child.stdin.end(opts.input); }
    });
}

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } }

function writeAtomic(file, text, mode) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.tmp');
    fs.writeFileSync(tmp, text, { mode: mode || 0o644 });
    fs.renameSync(tmp, file);
}

function createRunners({ run = defaultRun, display = ':0', log = () => { }, readFile = readText, writeFile = writeAtomic, listDir = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } } } = {}) {
    const xenv = { DISPLAY: display, XAUTHORITY };

    const x = (cmd, args, opts) => run(cmd, args, Object.assign({ env: xenv }, opts || {}));
    const root = (verb, args, opts) => run('sudo', ['-n', ROOT_HELPER, verb, ...(args || [])], opts || {});

    // ---------------------------------------------------------------- probe

    async function xServerUp() {
        const r = await x('xset', ['q'], { timeout: 4000 });
        return r.code === 0;
    }

    // The X cookie: the kiosk's server is root's; the helper copies its cookie for us.
    async function ensureXAccess() {
        if (await xServerUp()) return true;
        const r = await root('xauth');
        if (r.code !== 0) log('xauth: ' + (r.stderr || r.error || 'refused'));
        return xServerUp();
    }

    function dmi() {
        const out = {};
        for (const f of ['sys_vendor', 'product_name', 'product_version', 'board_vendor', 'board_name', 'bios_vendor', 'bios_version', 'bios_date', 'chassis_type']) {
            const v = readFile('/sys/class/dmi/id/' + f);
            out[f] = v === null ? null : v.trim();
        }
        return out;
    }

    async function probe() {
        const result = {
            xAvailable: false, outputs: [], providers: [], inputs: [], dmi: dmi(), virt: null,
            cmdline: (readFile('/proc/cmdline') || '').trim(), rotationCfg: G.parse(readFile(G.PATH) || ''),
            backlight: null, fbconRotate: null, tools: {}, errors: [],
        };
        const dv = await run('systemd-detect-virt', [], { timeout: 4000 });
        result.virt = V.classify(Object.assign({ detectVirt: dv.code === 0 ? dv.stdout.trim() : (dv.stdout.trim() || 'none') }, result.dmi));

        for (const t of ['xrandr', 'xinput', 'xset', 'unclutter-xfixes', 'unclutter', 'xscreensaver', 'xscreensaver-command', 'xscreensaver-settings']) {
            const w = await run('which', [t], { timeout: 3000 });
            result.tools[t] = w.code === 0;
        }
        const bl = listDir('/sys/class/backlight');
        if (bl.length) {
            const dev = bl[0];
            const max = parseInt(readFile('/sys/class/backlight/' + dev + '/max_brightness') || '', 10);
            const cur = parseInt(readFile('/sys/class/backlight/' + dev + '/brightness') || '', 10);
            result.backlight = { device: dev, max: Number.isFinite(max) ? max : null, current: Number.isFinite(cur) ? cur : null };
        }
        const fb = readFile('/sys/class/graphics/fbcon/rotate');
        result.fbconRotate = fb === null ? null : parseInt(fb, 10);

        result.xAvailable = await ensureXAccess();
        if (!result.xAvailable) { result.errors.push('X server not reachable on ' + display); return result; }

        const xr = await x('xrandr', ['--verbose']);
        if (xr.code !== 0 && !xr.stdout) { result.errors.push('xrandr: ' + (xr.stderr || xr.error)); return result; }
        const parsed = X.parseVerbose(xr.stdout);
        result.raw = { xrandr: xr.stdout, xinput: '' };
        result.screen = parsed.screen;
        result.outputs = parsed.outputs;
        const pv = await x('xrandr', ['--listproviders']);
        result.providers = pv.code === 0 ? X.parseProviders(pv.stdout) : [];

        const xl = await x('xinput', ['list']);
        if (xl.code === 0) {
            result.raw.xinput = xl.stdout;
            const devices = I.parseList(xl.stdout);
            for (const d of I.pointerSlaves(devices)) {
                const pr = await x('xinput', I.listPropsArgs(d.id));
                const { props } = pr.code === 0 ? I.parseProps(pr.stdout) : { props: {} };
                result.inputs.push({ id: d.id, name: d.name, kind: I.classify(d, props), matrix: I.currentMatrix(props), node: I.nodeOf(props) });
            }
        } else {
            result.errors.push('xinput: ' + (xl.stderr || xl.error));
        }
        return result;
    }

    // ---------------------------------------------------------------- apply

    // One xrandr call per output carries rotate, reflect, mode, position and transform
    // together, so the server sees one change and the kiosk one resize.
    function xrandrArgsFor(output, steps) {
        let args = [];
        const rot = steps.find((s) => s.action === 'rotate');
        const mode = steps.find((s) => s.action === 'mode');
        const pos = steps.find((s) => s.action === 'position');
        const fit = steps.find((s) => s.action === 'fit');
        const reset = steps.find((s) => s.action === 'fit-reset');
        if (steps.some((s) => s.action === 'off')) return X.offArgs(output);
        args.push('--output', output);
        if (mode) args.push('--mode', mode.mode); else args.push('--auto');
        if (rot) args.push('--rotate', rot.rotate, '--reflect', rot.reflect);
        if (pos) args.push('--pos', pos.x + 'x' + pos.y);
        if (fit) args = args.concat(X.fitArgs(output, fit.width, fit.height, fit.fit).slice(2));
        else if (reset) args = args.concat(X.resetTransformArgs(output).slice(2));
        return args;
    }

    // Option "TransformationMatrix" sets XI_PROP_TRANSFORM at device init (xf86Xinput.c,
    // ApplyTransformationMatrix): the same property xinput set-prop writes live, so the
    // two never stack. libinput's CalibrationMatrix would be a second transform on top.
    function inputClassConf(inputSteps, inputs) {
        const lines = ['# Written by the Display Configuration plugin: touch and pointer matrices, applied when X starts.'];
        for (const s of inputSteps.filter((st) => st.action === 'matrix')) {
            const dev = inputs.find((d) => d.id === s.device);
            const name = (dev && dev.name) || s.name;
            if (!name) continue;
            const clean = name.replace(/["\\]/g, '');
            lines.push('', 'Section "InputClass"', '    Identifier "display-configuration ' + clean + '"', '    MatchProduct "' + clean + '"', '    Option "TransformationMatrix" "' + s.matrix + '"', 'EndSection');
        }
        return lines.join('\n') + '\n';
    }

    async function applyX(plan, probeResult, report) {
        const xSteps = plan.steps.filter((s) => s.layer === 'x');
        const byOutput = new Map();
        for (const s of xSteps) { if (!byOutput.has(s.output)) byOutput.set(s.output, []); byOutput.get(s.output).push(s); }
        for (const [output, steps] of byOutput) {
            const out = probeResult.outputs.find((o) => o.name === output);
            if (out && !X.canRotate(out) && steps.some((s) => s.action === 'rotate' && s.rotate !== 'normal')) {
                report.skipped.push('rotate ' + output + ': the driver offers no rotation');
            }
            const r = await x('xrandr', xrandrArgsFor(output, steps));
            report.commands.push(['xrandr', ...xrandrArgsFor(output, steps)]);
            if (r.code !== 0) report.errors.push('xrandr ' + output + ': ' + (r.stderr || r.error).trim());
            const us = steps.find((s) => s.action === 'underscan');
            if (us) {
                for (const [prop, val] of [['underscan', 'on'], ['underscan hborder', us.hborder], ['underscan vborder', us.vborder]]) {
                    const u = await x('xrandr', X.setPropertyArgs(output, prop, val));
                    if (u.code !== 0) report.errors.push('underscan ' + output + ': ' + (u.stderr || u.error).trim());
                }
            }
        }
    }

    async function applyInputs(plan, probeResult, report) {
        const steps = plan.steps.filter((s) => s.layer === 'input');
        for (const s of steps) {
            if (s.action === 'matrix') {
                const r = await x('xinput', I.setMatrixArgs(s.device, s.matrix));
                report.commands.push(['xinput', ...I.setMatrixArgs(s.device, s.matrix)]);
                if (r.code !== 0) report.errors.push('xinput ' + s.name + ': ' + (r.stderr || r.error).trim());
            } else if (s.action === 'map-to-output') {
                const r = await x('xinput', I.mapToOutputArgs(s.device, s.output));
                if (r.code !== 0) report.errors.push('map-to-output ' + s.name + ': ' + (r.stderr || r.error).trim());
            }
        }
        // Persistence: an InputClass so the matrices hold from the next X start, before
        // this plugin runs. Written through the root helper; its absence is reported.
        const matrices = steps.filter((s) => s.action === 'matrix');
        if (matrices.length) {
            const r = await root('xorg-conf', ['write', INPUT_CONF_NAME], { input: inputClassConf(steps, probeResult.inputs) });
            if (r.code !== 0) report.warnings.push('touch settings apply now but will not persist across a display restart: ' + (r.stderr || r.error || 'root helper refused').trim());
        } else {
            await root('xorg-conf', ['remove', INPUT_CONF_NAME]);
        }
    }

    async function applyBoot(plan, probeResult, report) {
        const s = plan.steps.find((st) => st.action === 'rotation.cfg');
        if (!s) return;
        const text = G.render({ plymouth: s.plymouth, fbcon: s.fbcon, video: s.video || {}, gfxpayload: s.gfxpayload });
        const before = readFile(G.PATH);
        if (before !== text) {
            writeFile(G.PATH, text, 0o644);
            report.changed.push('rotation.cfg');
            report.rebootNeeded = true;
        }
        if (probeResult.fbconRotate !== null && probeResult.fbconRotate !== s.fbcon) {
            const r = await root('fbcon', [String(s.fbcon)]);
            if (r.code !== 0) report.warnings.push('console turn applies at the next boot: ' + (r.stderr || r.error || '').trim());
        }
    }

    async function applySession(plan, probeResult, report, state) {
        const ss = plan.steps.find((s) => s.action === 'screensaver');
        if (ss) await applyScreensaver(ss, probeResult, report, state);
        const br = plan.steps.find((s) => s.action === 'brightness');
        if (br) await applyBrightness(br.percent, probeResult, report);
        const fixed = plan.steps.find((s) => s.action === 'fixed-resolution');
        if (fixed) {
            const r = await root('xorg-conf', ['write', RESOLUTION_CONF_NAME], { input: V.xorgConf(fixed.resolution) });
            if (r.code !== 0) report.warnings.push('fixed resolution: ' + (r.stderr || r.error || 'root helper refused').trim());
            else report.changed.push('xorg resolution');
        } else if (plan.steps.some((s) => s.action === 'fixed-resolution-remove')) {
            await root('xorg-conf', ['remove', RESOLUTION_CONF_NAME]);
        }
    }

    // pkill -x compares the 15-character comm, which "unclutter-xfixes" exceeds;
    // the full command line is matched instead.
    async function stopCursorHiders() {
        await run('pkill', ['-f', '^unclutter-xfixes( |$)'], { timeout: 3000 });
        await run('pkill', ['-f', '^unclutter( |$)'], { timeout: 3000 });
    }

    // DPMS and the X screen saver are set together; "not while playing" is honoured by
    // the caller passing state.playing, which turns blanking off until playback stops.
    async function applyScreensaver(ss, probeResult, report, state = {}) {
        const blankingOff = ss.type === 'off' || ss.timeout === 0 || (ss.notWhilePlaying && state.playing);
        if (blankingOff) {
            await x('xset', ['s', 'off', '-dpms']);
            if (probeResult.tools['xscreensaver-command']) await x('xscreensaver-command', ['-deactivate'], { timeout: 3000 });
        } else if (ss.type === 'dpms') {
            await x('xset', ['s', 'off', '+dpms', 'dpms', '0', '0', String(ss.timeout)]);
            if (probeResult.tools['xscreensaver-command']) await x('xscreensaver-command', ['-exit'], { timeout: 3000 });
        } else if (ss.type === 'xscreensaver') {
            await x('xset', ['s', 'off', '-dpms']);
            if (!probeResult.tools.xscreensaver) { report.warnings.push('xscreensaver is not installed; the screen stays on'); }
            else {
                const home = process.env.HOME || '/home/volumio';
                const mm = String(Math.floor(ss.timeout / 60)).padStart(2, '0'), sec = String(ss.timeout % 60).padStart(2, '0');
                const rc = readFile(path.join(home, '.xscreensaver')) || '';
                const kept = rc.split('\n').filter((l) => !/^(timeout|lock|splash):/.test(l) && l !== '').join('\n');
                writeFile(path.join(home, '.xscreensaver'), kept + (kept ? '\n' : '') + 'timeout:\t0:' + mm + ':' + sec + '\nlock:\tFalse\nsplash:\tFalse\n', 0o644);
                const running = await x('xscreensaver-command', ['-time'], { timeout: 3000 });
                if (running.code !== 0) { run('xscreensaver', ['-no-splash'], { env: xenv, detached: true, timeout: 1000 }); }
                else await x('xscreensaver-command', ['-restart'], { timeout: 3000 });
            }
        }
        if (ss.hideCursor) {
            await stopCursorHiders();
            if (probeResult.tools['unclutter-xfixes']) run('unclutter-xfixes', ['--timeout', '3', '--start-hidden'], { env: xenv, detached: true, timeout: 1000 });
            else if (probeResult.tools.unclutter) run('unclutter', ['-idle', '3', '-root'], { env: xenv, detached: true, timeout: 1000 });
            else report.warnings.push('no unclutter on this player; the cursor stays visible');
        } else {
            await stopCursorHiders();
        }
    }

    async function applyBrightness(percent, probeResult, report) {
        const pct = Math.max(1, Math.min(100, percent));
        if (probeResult.backlight && probeResult.backlight.max) {
            const value = Math.max(1, Math.round(probeResult.backlight.max * pct / 100));
            const r = await root('backlight', [probeResult.backlight.device, String(value)]);
            if (r.code !== 0) report.warnings.push('backlight: ' + (r.stderr || r.error || 'root helper refused').trim());
            return;
        }
        for (const o of probeResult.outputs.filter((out) => out.connected)) {
            await x('xrandr', ['--output', o.name, '--brightness', (pct / 100).toFixed(2)]);
        }
    }

    async function apply(plan, probeResult, state) {
        const report = { commands: [], changed: [], skipped: [], warnings: [].concat(plan.notes || []), errors: [], rebootNeeded: false, geometryChanged: false };
        if (!probeResult.xAvailable) { report.warnings.push('The display is not running; screen settings apply when it starts.'); }
        else {
            const geom = (outs) => outs.filter((o) => o.connected).map((o) => o.name + ':' + (o.rotation || '') + ':' + (o.geometry ? o.geometry.width + 'x' + o.geometry.height + '+' + o.geometry.x + '+' + o.geometry.y : '')).join('|');
            const beforeGeom = geom(probeResult.outputs);
            await applyX(plan, probeResult, report);
            await applyInputs(plan, probeResult, report);
            const after = await x('xrandr', ['--query']);
            // xrandr reports the transformed size, so a fit or its removal shows here too.
            if (after.code === 0) report.geometryChanged = geom(X.parseVerbose(after.stdout).outputs) !== beforeGeom;
            await applySession(plan, probeResult, report, state);
        }
        await applyBoot(plan, probeResult, report);
        return report;
    }

    async function kiosk(verb) { return root('kiosk', [verb]); }

    async function screenOff() { return x('xset', ['dpms', 'force', 'off']); }

    async function screenOn() { return x('xset', ['dpms', 'force', 'on']); }

    // The X server's identity for the restart watcher: its PID, without opening a display.
    async function xServerPid() {
        const r = await run('pidof', ['Xorg', 'X'], { timeout: 3000 });
        return r.code === 0 ? r.stdout.trim() || null : null;
    }

    async function openScreensaverSettings() { return run('xscreensaver-settings', [], { env: xenv, detached: true, timeout: 1000 }); }

    return { probe, apply, kiosk, screenOff, screenOn, xServerPid, openScreensaverSettings, ensureXAccess, xrandrArgsFor, inputClassConf, applyScreensaver, applyBrightness, run, ROOT_HELPER, XAUTHORITY };
}

module.exports = { createRunners, defaultRun, writeAtomic, readText, ROOT_HELPER, XAUTHORITY };
