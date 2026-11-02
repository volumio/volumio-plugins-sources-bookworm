'use strict';
// Virtual guests: recognise the hypervisor and render the Xorg piece of a fixed
// resolution. Three layers pin one resolution on a guest with no usable EDID: Xorg
// (a Screen section with the one mode), GRUB (gfxpayload), and the kernel line
// (video=). The last two ride rotation.cfg (grub.js); this module renders the
// Xorg piece and classifies the host.

// Written by the root helper (xorg-conf write resolution). The file carries the
// plugin's name so uninstall can find it.
const XORG_PATH = '/etc/X11/xorg.conf.d/90-display-configuration-resolution.conf';

// systemd-detect-virt words and the DMI strings that name the same hypervisors.
function classify({ detectVirt, sysVendor, productName, boardVendor } = {}) {
    const dv = String(detectVirt || '').trim();
    if (dv && dv !== 'none') return { virtual: true, hypervisor: dv, source: 'systemd-detect-virt' };
    const s = [sysVendor, productName, boardVendor].map((x) => String(x || '')).join(' ');
    const dmi = [
        [/innotek|VirtualBox/i, 'oracle'], [/VMware/i, 'vmware'], [/QEMU|KVM|Bochs/i, 'kvm'],
        [/Microsoft Corporation.*Virtual Machine|Hyper-V/i, 'microsoft'], [/Xen/i, 'xen'], [/Parallels/i, 'parallels'],
    ];
    for (const [re, name] of dmi) if (re.test(s)) return { virtual: true, hypervisor: name, source: 'dmi' };
    return { virtual: false, hypervisor: null, source: dv === 'none' ? 'systemd-detect-virt' : 'dmi' };
}

function xorgConf(resolution) {
    if (!/^\d{3,5}x\d{3,5}$/.test(resolution)) throw new RangeError('resolution must look like 1280x720, got ' + resolution);
    return [
        'Section "Monitor"',
        '    Identifier "Monitor0"',
        '    HorizSync 30-80',
        '    VertRefresh 50-75',
        'EndSection',
        '',
        'Section "Screen"',
        '    Identifier "Screen0"',
        '    Monitor "Monitor0"',
        '    DefaultDepth 24',
        '    SubSection "Display"',
        '        Depth 24',
        '        Modes "' + resolution + '"',
        '    EndSubSection',
        'EndSection',
        '',
    ].join('\n');
}

// The guest's connector for video=: VirtualBox's vboxvideo and QEMU's bochs/virtio
// name it Virtual-1; VMware's vmwgfx also Virtual-1; the legacy non-KMS case has none.
function connectorFor(probeOutputs) {
    const kms = (probeOutputs || []).filter((o) => o.connected && o.name !== 'default');
    return kms.length ? kms[0].name : null;
}

const RESOLUTIONS = ['800x600', '1024x600', '1024x768', '1280x720', '1280x800', '1366x768', '1600x900', '1920x1080', '1920x1200', '2560x1440'];

module.exports = { XORG_PATH, RESOLUTIONS, classify, xorgConf, connectorFor };
