# FM/DAB Radio Plugin for Volumio

Receive FM and DAB/DAB+ radio in Volumio 4 with an RTL-SDR USB dongle. Stations appear in the music library and play through Volumio's own audio output.

## What you need

- Volumio 4 (Bookworm) on a Raspberry Pi, another ARM board or an x86-64 computer
- An RTL-SDR USB dongle (RTL2832U with an R820T, R820T2, R828D or E4000 tuner)
- An antenna for FM and/or DAB Band III

## Installing

1. Plug in the dongle and connect the antenna.
2. Install **FM/DAB Radio** from Volumio's plugin store (Music Services) and enable it.
3. Scan for stations in the plugin's settings, then play them from **Music Library > FM/DAB Radio**.

The Station Manager, for naming and organising stations, logos, backups and updates, is at `http://<player address>:3456`.

## Documentation

Everything is described in the wiki: https://github.com/foonerd/rtlsdr-radio/wiki

| | |
| --- | --- |
| First steps | [Installation](https://github.com/foonerd/rtlsdr-radio/wiki/Installation), [Getting Started](https://github.com/foonerd/rtlsdr-radio/wiki/Getting-Started) |
| Hardware | [Dongles](https://github.com/foonerd/rtlsdr-radio/wiki/Dongles), [Dongle Report](https://github.com/foonerd/rtlsdr-radio/wiki/Dongle-Report), [Antennas](https://github.com/foonerd/rtlsdr-radio/wiki/Antennas), [Antenna Design Guide](https://github.com/foonerd/rtlsdr-radio/wiki/Antenna-Design-Guide) |
| Using it | [Scanning](https://github.com/foonerd/rtlsdr-radio/wiki/Scanning), [Station Manager](https://github.com/foonerd/rtlsdr-radio/wiki/Station-Manager), [Settings Reference](https://github.com/foonerd/rtlsdr-radio/wiki/Settings-Reference) |
| When something does not work | [Troubleshooting](https://github.com/foonerd/rtlsdr-radio/wiki/Troubleshooting), [FAQ](https://github.com/foonerd/rtlsdr-radio/wiki/FAQ) |
| Reference | [Station Manager API](https://github.com/foonerd/rtlsdr-radio/wiki/Station-Manager-API), [Test Setup](https://github.com/foonerd/rtlsdr-radio/wiki/Test-Setup), [Changelog](https://github.com/foonerd/rtlsdr-radio/wiki/Changelog) |

## Support

Questions and reports: the [community thread](https://community.volumio.com/t/plugin-fm-dab-radio-rtl-sdr/74311).

## License

GPL-3.0

## Author

Just a Nerd

## Credits

- Wheaten - SNR measurement algorithm (snrd-api_V2.sh), adapted for the gain measurement
- [rtl-sdr](https://github.com/osmocom/rtl-sdr), [dab-cmdline](https://github.com/JvanKatwijk/dab-cmdline), [redsea](https://github.com/windytan/redsea)
