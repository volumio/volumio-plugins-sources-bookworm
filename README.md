# volumio-plugins-sources-bookworm

The repo for Volumio Bookworm plugins.

Bookworm version of Volumio required some adjustement for plugins due to new node and kernel version.

First in package.json

See:
```
                                                                               
{
        "name": "Systeminfo",
        "version": "3.0.7", <-----------------------------------------------------------PLUGIN VERSION
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
                        "bookworm" <-------------------------------------------OS VERSION
                ],
                "details": "Gives information about your system",
                "changelog": "bookworm version"
        },
        "engines": {
                "node": ">=20", <-------------------------------------------NODE VERSION
                "volumio": ">=0" <-------------------------------------------VOLUMIO VERSION >=0 DURING ALPHA TEST
        },
        "dependencies": { 
                "fs-extra": "*",
                "kew": "*",                            <--------------------ADJUST DEPENDENNCIES VERSION IF NEEDED
                "systeminformation": "*",
                "v-conf": "*"
        }
}
```


