# RPi Wireless Off

Powers off the Wi-Fi and Bluetooth chips of a Raspberry Pi 4, Pi 400 or Compute Module 4. With a chip off, the Pi boots as if it had no such chip. The Flight Mode plugin works differently: it keeps the chips powered and only stops them from transmitting.

The settings page has one switch per chip, a status line and a health line. The status line says what each chip does now and what changes at the next boot. The health line counts restarts of `volumio.service` and `volumiobt.service` since boot and lists failed units, so a restart loop is easy to spot.

Chips change state only at boot, so Save offers a reboot. On any other board the page hides the switches and says it isn't supported. The plugin still installs the generator described below, and the status section still shows.

Volumio 4 on Debian Bookworm, 32-bit (`armhf`).

## What it changes

The plugin changes two things on the Pi.

### A block in `/boot/userconfig.txt`

While a chip is off, the plugin keeps this block at the end of the file:

```
# >>> rpi_wireless_off plugin. Managed from the plugin's settings page.
[all]
dtoverlay=disable-wifi
dtoverlay=disable-bt
# <<< rpi_wireless_off plugin
```

It lists only the chips that are off, and it's gone when both are on. Save rewrites the block and leaves the rest of the file as it is.

A `dtoverlay=disable-wifi` or `dtoverlay=disable-bt` line that you added by hand is left alone too. The firmware still accepts the old names `dtoverlay=pi3-disable-wifi` and `dtoverlay=pi3-disable-bt`, so the plugin treats those lines the same way. The page shows that chip as off and says why. Delete the line to manage the chip from the page.

### A file in `/lib/systemd/system-generators/`

`rpi-wireless-off-generator` is a systemd generator, a small program that systemd runs at every boot, before any unit starts. When a chip is off, it makes systemd skip `volumiobt.service` or `wireless.service`. Without that, Volumio's Bluetooth service restarts in a loop and the Wi-Fi service fails at every boot. When both chips are on it does nothing. If a Volumio update removes the file, the plugin puts it back at its next start.

The plugin leaves `bluetooth.service`, `bluealsa` and `hciuart` alone, and it needs no new sudoers rule.

## Switching Wi-Fi off needs a cable

With the Wi-Fi chip off, Volumio can't start its rescue hotspot. A dead cable would then leave the SD card as the only way back in. So Save refuses to switch Wi-Fi off unless a wired interface has a link and an IPv4 address. A link-local address (169.254.x.x) doesn't count, because it means DHCP failed.

## First install

1. Run `tools/deploy.sh install [host]` from the [plugin's repo](https://github.com/squadgazzz/volumio-rpi-wireless-off). It builds the zip and uploads it to Volumio.
2. A new plugin starts disabled. Enable it under Plugins > Installed Plugins.
3. Open the plugin's settings, switch the chips off and Save.
4. Reboot from the dialog that Save opens. The music stops for a minute or two.

## Updates

Run `tools/deploy.sh update [host]`, or run `volumio plugin update` inside the plugin's source folder on the Pi. Both leave the block alone, so the chips stay as they are. After an update, reboot or restart Volumio, because the plugin stays stopped until then.

Never update by uninstalling and installing again. Uninstall deletes the block, so both chips turn back on at the next reboot. A toast at the next start warns about it, and switching the chips off again undoes it.

## Recovery with no network

If the Pi can't be reached, take out the SD card. On any computer, open `userconfig.txt` on the boot partition and delete the block, from the line `# >>> rpi_wireless_off plugin` to the line `# <<< rpi_wireless_off plugin`. Delete any `dtoverlay=disable-wifi` or `dtoverlay=disable-bt` line you set by hand too, if you want that chip back. Put the card back in. Both chips come on at the next boot.

## Uninstall

Uninstall the plugin, then reboot. Uninstall deletes the block and the generator, but the chips only come back at the reboot. After the reboot the Pi is stock again. Lines you set by hand aren't touched.

If the block is damaged (a start marker with no end, an end with no start, or two blocks), Save refuses and uninstall leaves it alone. Fix or delete it by hand.
