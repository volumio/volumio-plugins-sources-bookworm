# Submitting to Volumio plugin store

It is important to install Node modules manually instead of letting the plugin submission script do it. We need to skip installation of the optional `puppeteer` dependency as that would download the Chrome browser executable, which is not available for `armhf`. The plugin's `install.sh` script will take care of installing `puppeteer` along with `chromium-headless-shell`.

```bash
$ npm i --omit=dev --omit=optional
$ volumio plugin submit
```