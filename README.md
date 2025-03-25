# volumio-plugins-sources-bookworm

The repo for Volumio Bookworm plugins.

Bookworm version of Volumio required some adjustement for plugins due to new node and kernel version.
To learn more how to write a plugin for Volumio, [see](https://developers.volumio.com/plugins/submission-checklist)

## Volumio Bookworm 

We are working on OTA delivery system. Until this is completed, the link updated here:

| HW | Version | Link |
| --- | --- | --- |
| Pi | 0.050 | [Download](https://dev-updates.volumio.org/pi/volumio/0.050/Volumio-0.050-2025-03-25-pi.zip) |
| x64 | 0.050 | [Download](https://dev-updates.volumio.org/x86_amd64/volumio/0.050/Volumio-0.050-2025-03-25-x86_amd64.zip) |

Steps to create/modify a plugin
## 1. Fork the Repository
  - Click the Fork button (top-right corner) to create a copy of the repository under your own GitHub account.
## 2. Clone your forked repository
  - From a running Volumio Bookworm system, clone the Bookworm dedicated plugin repo:
```
git clone https://github.com/YOUR-USERNAME/REPOSITORY-NAME.git --depth=1
```
## 3. Create a new branch
```
git checkout -b your-branch-name
```
## 4. Create or copy your plugin folder and cd to it.

In package.json make changes as shown in the example below:

```
                                                                               
{
        "name": "Systeminfo",
        "version": "3.0.7", <------------------------------------PLUGIN VERSION
        "description": "Information about your system",
        "main": "index.js",
        "scripts": {
                "test": "echo \"Error: no test specified\" && exit 1"
        },
        "author": "Balbuze",
        "license": "",
        "repository": "https://github.com/balbuze/volumio-plugins-sources",
        "volumio_info": {
                "prettyName": "System information",
                "plugin_type": "user_interface",
                "icon": "fa-info-circle",
                "architectures": [
                        "amd64",
                        "armhf"
                ],
                "os": [
                        "bookworm" <--------------------------------OS VERSION
                ],
                "details": "Gives information about your system",
                "changelog": "bookworm version"
        },
        "engines": {
                "node": ">=20", <-------------------------------NODE VERSION >=20
                "volumio": ">=0" <---------------------VOLUMIO VERSION >=0 DURING ALPHA TEST
        },
        "dependencies": { 
                "fs-extra": "*",
                "kew": "*",                  <---------ADJUST DEPENDENCIES VERSION IF NEEDED
                "systeminformation": "*",
                "v-conf": "*"
        }
}
```

## 5. To install the plugin on your system, use :
```
volumio plugin install
```
Test carefully your plugin!
If ok, uninstall the plugin (important to check it works!)
Remove node_modules
```
rm -Rf node_modules
```
## 6. Send a PR to Github and submit from a BOOKWORM DEVICE!

For Github
```
git add *
git commit -m 'pluginname - change description'
git push origin your-branch-name
```

To submit
```
volumio plugin submit
```

Your plugin is now in beta state, available in the store when "plugin test mode" is enabled.

It will be released as stable once checked by volumio team.
