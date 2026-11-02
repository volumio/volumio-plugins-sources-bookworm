'use strict';
// CMA for the KMS overlay, per board. The kernel overlays carry their own defaults
// (vc4-kms-v3d 256 MB, -pi4 508 MB, -pi5 64 MB, from the .dts files on rpi-6.12.y);
// the README marks cma-192 and above "(needs 1GB)". Volumio's pi.sh leaves the default
// alone except for the 3A+ (512 MB), which it means to give cma-128.

const KERNEL_DEFAULT = { 'vc4-kms-v3d': 256, 'vc4-kms-v3d-pi4': 508, 'vc4-kms-v3d-pi5': 64 };

// The sizes the overlays accept as cma-N (README); 'auto' writes no parameter.
const SIZES = [32, 64, 96, 128, 192, 256, 320, 384, 448, 512];

function policy(board) {
    const overlay = board && board.kmsOverlay;
    const ramMb = board && board.memoryMb;
    if (!overlay) return { kernelDefault: null, recommended: null, max: null, sizes: [], auto: false };
    const kernelDefault = KERNEL_DEFAULT[overlay] || null;
    const small = ramMb !== null && ramMb !== undefined && ramMb <= 512;
    const max = small ? 128 : (ramMb ? Math.min(512, ramMb / 2) : 512);
    const sizes = SIZES.filter((s) => s <= max);
    // 512 MB boards: the kernel default would take half the memory; Volumio chose 128.
    const recommended = small ? 128 : kernelDefault;
    return { kernelDefault, recommended, max, sizes, auto: !small };
}

// The ",cma-N" suffix for a choice: 'auto' → kernel default (no parameter), a number →
// clamped to the policy, 'custom' with mb → 4 MB aligned and clamped.
function parameter(choice, mb, board) {
    const p = policy(board);
    if (choice === 'auto' || choice === undefined || choice === null) return p.auto ? '' : ',cma-' + p.recommended;
    let n = choice === 'custom' ? Number(mb) : Number(choice);
    if (!Number.isFinite(n) || n <= 0) return p.auto ? '' : ',cma-' + p.recommended;
    n = Math.round(n / 4) * 4;
    if (p.max && n > p.max) n = p.max;
    if (n < 32) n = 32;
    return ',cma-' + n;
}

// The CMA the running kernel actually has, from /proc/meminfo.
function appliedMb(meminfo) {
    const m = meminfo && String(meminfo).match(/CmaTotal:\s+(\d+)\s+kB/);
    return m ? Math.round(parseInt(m[1], 10) / 1024) : null;
}

// The legacy option names the plugin stored (kms.cma_option) → a choice for parameter().
const LEGACY = { default: 64, low: 32, medium: 128, high: 256, max: 512 };
function fromLegacyOption(option, customMb) {
    if (option === 'custom') return { choice: 'custom', mb: customMb };
    if (option in LEGACY) return { choice: LEGACY[option] };
    if (/^\d+$/.test(String(option))) return { choice: Number(option) };
    return { choice: 'auto' };
}

module.exports = { KERNEL_DEFAULT, SIZES, policy, parameter, appliedMb, fromLegacyOption };
