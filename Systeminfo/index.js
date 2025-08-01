//Systeminfo - balbuze 2024
'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var libFsExtra = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
const si = require('systeminformation');
var spawn = require('child_process').spawn;
// Define the Systeminfo class
module.exports = Systeminfo;



function Systeminfo(context) {
   var self = this;

   // Save a reference to the parent commandRouter
   self.context = context;
   self.commandRouter = self.context.coreCommand;
   self.logger = self.commandRouter.logger;


   this.context = context;
   this.commandRouter = this.context.coreCommand;
   this.logger = this.context.logger;
   this.configManager = this.context.configManager;

};

Systeminfo.prototype.onVolumioStart = function () {
   var self = this;
   var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
   this.config = new (require('v-conf'))();
   this.config.loadFile(configFile);

   return libQ.resolve();


};

Systeminfo.prototype.getConfigurationFiles = function () {
   var self = this;
   return ['config.json'];
};




// Plugin methods -----------------------------------------------------------------------------

Systeminfo.prototype.onStop = function () {
   var self = this;
   var defer = libQ.defer();
   defer.resolve();
   return defer.promise;
};

Systeminfo.prototype.onStart = function () {
   var self = this;
   var defer = libQ.defer();


   // Once the Plugin has successfull started resolve the promise
   defer.resolve();

   return defer.promise;
};

// playonconnect stop



Systeminfo.prototype.onRestart = function () {
   var self = this;
   //
};

Systeminfo.prototype.onInstall = function () {
   var self = this;
   //Perform your installation tasks here
};

Systeminfo.prototype.onUninstall = function () {
   var self = this;
};

Systeminfo.prototype.getUIConfig = function () {
   var defer = libQ.defer();
   var self = this;

   var lang_code = this.commandRouter.sharedVars.get('language_code');

   self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
      __dirname + '/i18n/strings_en.json',
      __dirname + '/UIConfig.json')
      .then(function (uiconf) {


         defer.resolve(uiconf);
      })
      .fail(function () {
         defer.reject(new Error());
      });

   return defer.promise;

};

Systeminfo.prototype.setUIConfig = function (data) {
   var self = this;
   //Perform your installation tasks here
};

Systeminfo.prototype.getConf = function (varName) {
   var self = this;
   //Perform your installation tasks here
};

Systeminfo.prototype.setConf = function (varName, varValue) {
   var self = this;
   //Perform your installation tasks here
};


//here we detect hw info
Systeminfo.prototype.hwinfo = function () {
   var self = this;
   var nchannels;
   var hwinfo;
   var samplerates, probesmplerates;
   fs.readFile('/data/configuration/audio_interface/alsa_controller/config.json', 'utf8', function (err, config) {
      if (err) {
         self.logger.info('Error reading config.json', err);
      } else {
         try {
            const hwinfoJSON = JSON.parse(config);
            var cmixt = hwinfoJSON.mixer_type.value;
            var cout = hwinfoJSON.outputdevicename.value
            var output_device = hwinfoJSON.outputdevice.value
            // console.log('AAAAAAAAAAAAAAAAAAAAAAAAAA-> ' + output_device + ' <-AAAAAAAAAAAAA');

            self.config.set('cmixt', cmixt);
            self.config.set('cout', cout);



            exec('/data/plugins/user_interface/Systeminfo/hw_params hw:' + output_device + ' >/data/configuration/user_interface/Systeminfo/config.json ', {
               uid: 1000,
               gid: 1000
            }, function (error, stdout, stderr) {
               if (error) {
                  self.logger.info('failed ' + error);
                  self.commandRouter.pushToastMessage('error', 'Audio Hardware detection seems to fail  !', 'Do not play music or equalizer while probing system and retry');
               } else {

                  fs.readFile('/data/configuration/user_interface/Systeminfo/config.json', 'utf8', function (err, hwinfo) {
                     if (err) {
                        self.logger.info('Error reading config', err);
                     } else {
                        try {
                           const hwinfoJSON = JSON.parse(hwinfo);
                           nchannels = hwinfoJSON.channels.value;
                           samplerates = hwinfoJSON.samplerates.value;
                           console.log('AAAAAAAAAAAAAAAAAAAAAAAAAA-> ' + nchannels + ' <-AAAAAAAAAAAAA');
                           console.log('AAAAAAAAAAAAAAAAAAAAAAAAAA-> ' + samplerates + ' <-AAAAAAAAAAAAA');
                           self.config.set('nchannels', nchannels);
                           self.config.set('smpl_rate', samplerates);
                           //    var output_format = formats.split(" ").pop();
                        } catch (e) {
                           self.logger.info('Error reading Systeminfo/config.json, detection failed', e);

                        }
                     }
                  });
               }
            })
         } catch (e) {
            self.logger.info('Error reading config.json, detection failed', e);
         }
      }
   });

};
Systeminfo.prototype.mpdversion = function () {
   var self = this;

   // Execute the command 'mpd -V'
   exec('mpd -V', (error, stdout, stderr) => {
      if (error) {
         self.logger.error(`Error executing command: ${error.message}`);
         return;
      }
      if (stderr) {
         self.logger.error(`Error: ${stderr}`);
         return;
      }

      // Splitting the stdout into lines
      const lines = stdout.trim().split('\n');

      // Extracting the first line
      const mpdVersion = lines[0];
      self.config.set("mpdversion", mpdVersion)
      // console.log(`MPD Version !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!: ${mpdVersion}`);
   });

};


//here we detect the board type
Systeminfo.prototype.board = function () {
   var self = this;
   exec("/bin/cat /proc/device-tree/model", function (error, stdout, stderr) {
      if (error) {
         self.logger.error('failed ' + error);
         self.commandRouter.pushToastMessage('error', 'board detection failed');
      } else {
         self.logger.info('board is ' + stdout);
         self.config.set('board', stdout);
      }
   })
};


Systeminfo.prototype.detectModel = function () {
   var self = this;
   try {
      const model = fs.readFileSync('/proc/device-tree/model', 'utf8').toLowerCase();
      if (model.includes('zero 2')) return 'zero2';
      if (model.includes('pi 3')) return 'pi3';
      if (model.includes('pi 4')) return 'pi4';
      if (model.includes('pi 5')) return 'pi5';
   } catch (err) {
   }
   return 'unknown';
};


Systeminfo.prototype.firmwareversion = function () {
   const self = this;
   const model = self.detectModel();
   let cmd;

   // Sur Pi 4 et 5, on utilise bootloader EEPROM
   if (model === 'pi4' || model === 'pi5') {
      cmd = 'vcgencmd bootloader_version';
   } else {
      // Sur Zero 2, Pi 3 et autres modèles, on lit la version du firmware start.elf
      cmd = 'vcgencmd version';
   }

   exec(cmd, { uid: 1000, gid: 1000 }, (error, stdout, stderr) => {
      if (error) {
         self.logger.info('Firmware detection failed: ' + error);
         self.commandRouter.pushToastMessage('error', 'Firmware detection failed');
         return;
      }
      if (stderr) {
         self.logger.info('vcgencmd stderr: ' + stderr);
      }

      const outputLines = stdout.trim().split('\n');
      if (outputLines.length === 0 || !outputLines[0]) {
         self.logger.error(`Unexpected firmware output (model: ${model})`);
         return;
      }

      // On récupère au maximum les 2 premières lignes
      const firmwareInfo = outputLines.slice(0, 2).join(' ');
      self.logger.info('Firmware detected: ' + firmwareInfo);
      self.config.set('firmware', firmwareInfo);
   });
};

//here we detect the temperature for the cpu
Systeminfo.prototype.temperature = function () {
   var self = this;
   var temperature;
   var roundtemp;
   exec("/bin/cat /sys/class/thermal/thermal_zone0/temp", function (error, stdout, stderr) {
      if (error) {
         self.logger.info('failed ' + error);
         self.commandRouter.pushToastMessage('error', 'temperature detection failed');
         roundtemp = 'not applicable';
      } else {
         roundtemp = (stdout / 1000).toFixed(0)
         console.log('BBBBBBBBBBBBBB-CPU Temp ' + roundtemp + ' °C');
         self.config.set('temperature', roundtemp);
      }
   })
};

//local storage probe
Systeminfo.prototype.storages = function () {
   var self = this;
   var storages;
   exec("/bin/df -hBM --output=size,used,avail /data | /usr/bin/tail -1", function (error, stdout, stderr) {
      if (error) {
         self.logger.info('failed ' + error);
         self.commandRouter.pushToastMessage('error', 'storage detection failed');
         storages = 'not applicable';
      } else {


         while (stdout.charAt(0) === ' ') {

            stdout = stdout.substr(1).replace(/  /g, ' ');
            console.log('Storage info ' + stdout);
            self.config.set('storages', stdout);
         }

      }
   })
};


Systeminfo.prototype.getEthernetSpeed = function () {
   var self = this;
   var defer = libQ.defer();

   exec("/usr/bin/sudo /sbin/ethtool eth0 | grep -i speed | tr -d 'Speed:' | xargs", { encoding: 'utf8' }, function (error, data) {
      if (error) {
         self.logger.error('Could not parse Etherned Speed: ' + error);
         defer.resolve('');
      } else {
         if (data.replace('\n', '') == '1000Mb/s') {
            data = '1Gb/s';
            self.config.set("speed", data);

         }
         defer.resolve(data);
      }
   });
   return defer.promise;
};


Systeminfo.prototype.getWirelessSpeed = function () {
   var self = this;
   var defer = libQ.defer();

   exec("/usr/bin/sudo /sbin/iwconfig wlan0 | grep 'Bit Rate' | awk '{print $2,$3}' | tr -d 'Rate:' | xargs", { encoding: 'utf8' }, function (error, data) {
      if (error) {
         self.logger.error('Could not parse Wireless Speed: ' + error);
         defer.resolve('');
      } else {
         let result = data.replace(/=/g, '')
         defer.resolve(result);
         console.log("speed :" + result)
         self.config.set("speed", result);

      }
   });
   return defer.promise;
};


Systeminfo.prototype.getsysteminfo = function () {
   var self = this;

   // Function to format uptime
   function formatUptime(uptime) {
      let seconds = parseInt(uptime, 10);
      let days = Math.floor(seconds / (3600 * 24));
      seconds -= days * 3600 * 24;
      let hrs = Math.floor(seconds / 3600);
      seconds -= hrs * 3600;
      let mnts = Math.floor(seconds / 60);
      seconds -= mnts * 60;
      return `${days} days, ${hrs} Hrs, ${mnts} Minutes, ${seconds} Seconds`;
   }

   // Fetch hardware, firmware version, and temperature information
   self.hwinfo();
   self.firmwareversion();
   self.temperature();
   self.storages();
   self.mpdversion();
   self.board();

   // Network
   // si.networkInterfaces('default').then(data => console.log(data));
   // si.wifiNetworks().then(data => console.log(data));
   // si.networkInterfaces().then(data => console.log(data));
   si.networkInterfaces('default')
      .then(data => {
         //  console.log(data, data.iface);

         // Set configuration values
         self.config.set("iface", data.iface); // Assuming data is an array and you want the first element
         self.config.set("ip4", data.ip4);
         self.config.set("type", data.type);
         if (data.iface === "wlan0") {
            self.getWirelessSpeed();
         } else {
            self.getEthernetSpeed();
         }
         self.config.set("mac", data.mac);

      })
      .catch(error => {
         console.error('Error fetching network interfaces:', error);
      });


   // Fetch system information using si.getAllData()
   si.getAllData()
      .then(data => {
         // Board
         const board = self.config.get('board');


         // Memory
         const memtotal = (data.mem.total / 1024).toFixed(0) + ' Ko';
         const memfree = (data.mem.free / 1024).toFixed(0) + ' Ko';
         const memused = (data.mem.used / 1024).toFixed(0) + ' Ko';

         // Local storage
         const storages = self.config.get('storages');
         const size = storages ? storages.split(' ')[0] : 'N/A';
         const used = storages ? storages.split(' ')[1] : 'N/A';
         const avail = storages ? storages.split(' ')[2] : 'N/A';
         const savail = avail ? avail.slice(0, -2) : 'N/A';
         const ssize = size ? size.slice(0, -1) : 'N/A';
         const pcent = ssize && savail ? ((savail / ssize) * 100).toFixed(0) : 'N/A';

         // Uptime
         const uptime = formatUptime(data.time.uptime);

         // Audio
         const nchannels = self.config.get('nchannels');
         const samplerate = self.config.get('smpl_rate');
         const cmixt = self.config.get('cmixt');
         const cout = self.config.get('cout');

         // Network
         var ni = self.config.get("iface")
         var ip = self.config.get("ip4")
         var mac = self.config.get("mac")
         var type = self.config.get("type")
         var speed = self.config.get("speed")

         // Software
         var mpdVersion = self.config.get("mpdversion")


         try {
            // OS version
            const sysversionf = self.commandRouter.executeOnPlugin('system_controller', 'system', 'getSystemVersion', '');
            return sysversionf.then(info => {
               const result = info.systemversion;



               const messages4 = `<br><li>OS info</br></li><ul><li>Version of Volumio: ${result}</li><li>Hostname: ${data.os.hostname}</li><li>Kernel: ${data.os.kernel}</li><li>Governor: ${data.cpu.governor}</li><li>Uptime: ${uptime}</li></ul>`;

               // Board and CPU info
               const messages1 = `<br><li>Board info</br></li><ul><li>Manufacturer: ${data.system.manufacturer}</li><li>Model: ${board} ${data.baseboard.model}</li><li>Version: ${data.system.version}</li><li>Firmware Version: ${self.config.get('firmware') || 'Available only for RPI'}</li></ul>`;

               const messages2 = `<br><li>CPU info</br></li><ul><li>Brand: ${data.cpu.brand}</li><li>Speed: ${data.cpu.speed} GHz</li><li>Family: ${data.cpu.family}</li><li>Model: ${data.cpu.model}</li><li>Number of cores: ${data.cpu.cores}</li><li>Physical cores: ${data.cpu.physicalCores}</li><li>Average load: ${(data.currentLoad.avgLoad * 100).toFixed(0)}%</li><li>Temperature: ${self.config.get('temperature')}°C</li></ul>`;

               // Memory info
               const messages3 = `<br><li>Memory info</br></li><ul><li>Memory: ${memtotal}</li><li>Free: ${memfree}</li><li>Used: ${memused}</li></ul>`;

               // Network info
               const messages8 = `<br><li>Network info</br></li><ul><li>Interface: ${ni}</li><li>IP Address: ${ip}</li><li>MAC Address: ${mac}</li><li>Type: ${type}</li><li>Speed: ${speed}</li></ul>`;

               // Audio info
               const messages6 = `<br><li>Audio info</br></li><ul><li>Hw audio configured: ${cout}</li><li>Mixer type: ${cmixt}</li><li>Number of channels: ${nchannels}</li><li>Supported sample rate: ${samplerate}</li></ul>`;

               // Storage info
               const messages7 = `<br><li>Storage info</br></li><ul><li>INTERNAL storage - Size: ${size}o</li><li>Used: ${used}o</li><li>Available for storage: ${savail}Mo (${pcent}%)</li></ul>`;

               // software info
               const messages9 = `<br><li>Software info</br></li><ul><li>Mpd version: ${mpdVersion}</li></ul>`;

               // Combine all messages
               const combinedMessages = messages4 + messages8 + messages6 + messages1 + messages2 + messages3 + messages9 + messages7;

               // Display in modal
               const modalData = {
                  title: 'System Information',
                  message: combinedMessages,
                  size: 'lg',
                  buttons: [{
                     name: 'Close',
                     class: 'btn btn-warning',
                     emit: 'closeModals',
                     payload: ''
                  }]
               };
               self.commandRouter.broadcastMessage('openModal', modalData);
            });
         } catch (error) {
            console.error('Error getting OS version:', error);
         }
      })
      .catch(error => console.error('Error getting all data:', error));
};

