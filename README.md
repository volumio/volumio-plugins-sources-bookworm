# volumio-plugins-sources-bookworm

The repo for Volumio Bookworm plugins.

Bookworm version of Volumio required some adjustement for plugins due to new node and kernel version.

Clone the Bookworm dedicated plugin repo
```
git clone https://github.com/volumio/volumio-plugins-sources-bookworm --depth=1
```

Create or copy your plugin folder and cd to it.

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
                "node": ">=20", <-------------------------------NODE VERSION
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

To install on your system, use :
```
volumio plugin install
```
Test carefully your plugin before sending a PR and submit from a BOOKWORM DEVICE!
To submit
```
volumio plugin submit
```
Your plugin is now in beta state, available in the store when "plugin test mode" is enabled.
It will be released as stable once checked by volumio team.
