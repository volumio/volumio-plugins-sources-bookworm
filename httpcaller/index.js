'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var axios = require('axios');


module.exports = httpcaller;
function httpcaller(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}



httpcaller.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

    return libQ.resolve();
}

httpcaller.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();
        self.load18nStrings();

        // Place on browse menu bar
        let browseTitle = this.config.get('browseMenuTitle');
        if (browseTitle == "") { browseTitle = 'HTTP Caller';}
        var data = {
           name: browseTitle,
           uri: 'httpcaller',
           plugin_type:'system_controller',
           plugin_name:'httpcaller',
           albumart: '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png'
         };
         self.commandRouter.volumioAddToBrowseSources(data);

	// Once the Plugin has successfull started resolve the promise
	defer.resolve();

    return defer.promise;
};

httpcaller.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();
    let browseTitle = this.config.get('browseMenuTitle');
    if (browseTitle == "") { browseTitle = 'HTTP Caller';}
    self.commandRouter.volumioRemoveToBrowseSources(browseTitle);

    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();

    return libQ.resolve();
};

// axios functions called from handleBrowseUI --------------------------------------------

httpcaller.prototype.http_call_one = function() {
    var self = this;
    var defer=libQ.defer();
    let call1  = this.config.get('button1Call');
    let action1 = this.config.get('button1Action');
     axios.get(call1)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action1, call1);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_two = function() {
    var self = this;
    var defer=libQ.defer();
    let call2  = this.config.get('button2Call');
    let action2 = this.config.get('button2Action');
    axios.get(call2)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action2, call2);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_three = function() {
    var self = this;
    var defer=libQ.defer();
    let call3  = this.config.get('button3Call');
    let action3 = this.config.get('button3Action');
    axios.get(call3)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action3, call3);

  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_four = function() {
    var self = this;
    var defer=libQ.defer();
    let call4  = this.config.get('button4Call');
    let action4 = this.config.get('button4Action');
    axios.get(call4)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action4, call4);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_five = function() {
    var self = this;
    var defer=libQ.defer();
    let call5  = this.config.get('button5Call');
    let action5 = this.config.get('button5Action');
    axios.get(call5)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action5, call5);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_six = function() {
    var self = this;
    var defer=libQ.defer();
    let call6  = this.config.get('button6Call');
    let action6 = this.config.get('button6Action');
    axios.get(call6)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action6, call6);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_seven = function() {
    var self = this;
    var defer=libQ.defer();
    let  call7 = this.config.get('button7Call');
    let action7 = this.config.get('button7Action');
    axios.get(call7)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
   self.commandRouter.pushToastMessage('info', action7, call7);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_eight = function() {
    var self = this;
    var defer=libQ.defer();
    let  call8 = this.config.get('button8Call');
    let action8 = this.config.get('button8Action');
     axios.get(call8)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action8, call8);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_nine = function() {
    var self = this;
    var defer=libQ.defer();
    let  call9 = this.config.get('button9Call');
    let action9 = this.config.get('button9Action');
     axios.get(call9)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action9, call9);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_ten = function() {
    var self = this;
    var defer=libQ.defer();
    let  call10 = this.config.get('button10Call');
    let action10 = this.config.get('button10Action');
     axios.get(call10)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action10, call10);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_eleven = function() {
    var self = this;
    var defer=libQ.defer();
    let  call11 = this.config.get('button11Call');
    let action11 = this.config.get('button11Action');
     axios.get(call11)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action11, call11);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}

httpcaller.prototype.http_call_twelve = function() {
    var self = this;
    var defer=libQ.defer();
    let  call12 = this.config.get('button12Call');
    let action12 = this.config.get('button12Action');
     axios.get(call12)
     .then(response => {
      console.log(response.data);
    })
    .catch(error => {
     console.error('Error fetching data:', error);
    });
    self.commandRouter.pushToastMessage('info', action12, call12);
  // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}



//httpcaller.prototype.onRestart = function() {
//    var self = this;
    // Optional, use if you need it
//};


// Configuration Methods -----------------------------------------------------------------------------

httpcaller.prototype.load18nStrings = function () {
    var self = this;

    try {
        var language_code = this.commandRouter.sharedVars.get('language_code');
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + ".json");
    } catch (e) {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }

    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
};

httpcaller.prototype.getI18nString = function (key) {
    var self = this;

    if (self.i18nStrings[key] !== undefined)
        return self.i18nStrings[key];
    else
        return self.i18nStringsDefaults[key];
};

httpcaller.prototype.saveSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    let browseTitle = this.config.get('browseMenuTitle');
    self.commandRouter.volumioRemoveToBrowseSources(browseTitle);

    defer.resolve();
       if (data['browseMenuTitle'] != "")
       {
         self.config.set('browseMenuTitle', data['browseMenuTitle']);
       } else {
         self.config.set('browseMenuTitle', 'HTTP Caller');
       }
       self.config.set('button1Enabled', data['button1Enabled']);
       if (data['button1Call'] === "" || data['button1Action'] === "")
       {
         self.config.set('button1Enabled', false);
       }
       self.config.set('button1Call', data['button1Call']);
       self.config.set('button1Action', data['button1Action']);

       self.config.set('button2Enabled', data['button2Enabled']);
       if (data['button2Call'] === "" || data['button2Action'] === "")
       {
         self.config.set('button2Enabled', false);
       }
       self.config.set('button2Call', data['button2Call']);
       self.config.set('button2Action', data['button2Action']);

       self.config.set('button3Enabled', data['button3Enabled']);
       if (data['button3Call'] === "" || data['button3Action'] === "")
       {
         self.config.set('button3Enabled', false);
       }
       self.config.set('button3Call', data['button3Call']);
       self.config.set('button3Action', data['button3Action']);

       self.config.set('button4Enabled', data['button4Enabled']);
       if (data['button4Call'] === "" || data['button4Action'] === "")
       {
         self.config.set('button4Enabled', false);
       }
       self.config.set('button4Call', data['button4Call']);
       self.config.set('button4Action', data['button4Action']);

       self.config.set('button5Enabled', data['button5Enabled']);
       if (data['button5Call'] === "" || data['button5Action'] === "")
       {
         self.config.set('button5Enabled', false);
       }
       self.config.set('button5Call', data['button5Call']);
       self.config.set('button5Action', data['button5Action']);

       self.config.set('button6Enabled', data['button6Enabled']);
       if (data['button6Call'] === "" || data['button6Action'] === "")
       {
         self.config.set('button6Enabled', false);
       }
       self.config.set('button6Call', data['button6Call']);
       self.config.set('button6Action', data['button6Action']);

       self.config.set('button7Enabled', data['button7Enabled']);
       if (data['button7Call'] === "" || data['button7Action'] === "")
       {
         self.config.set('button7Enabled', false);
       }
       self.config.set('button7Call', data['button7Call']);
       self.config.set('button7Action', data['button7Action']);

       self.config.set('button8Enabled', data['button8Enabled']);
       if (data['button8Call'] === "" || data['button8Action'] === "")
       {
         self.config.set('button8Enabled', false);
       }
       self.config.set('button8Call', data['button8Call']);
       self.config.set('button8Action', data['button8Action']);

       self.config.set('button9Enabled', data['button9Enabled']);
       if (data['button9Call'] === "" || data['button9Action'] === "")
       {
         self.config.set('button9Enabled', false);
       }
       self.config.set('button9Call', data['button9Call']);
       self.config.set('button9Action', data['button9Action']);

       self.config.set('button10Enabled', data['button10Enabled']);
       if (data['button10Call'] === "" || data['button10Action'] === "")
       {
         self.config.set('button10Enabled', false);
       }
       self.config.set('button10Call', data['button10Call']);
       self.config.set('button10Action', data['button10Action']);

       self.config.set('button11Enabled', data['button11Enabled']);
       if (data['button11Call'] === "" || data['button11Action'] === "")
       {
         self.config.set('button11Enabled', false);
       }
       self.config.set('button11Call', data['button11Call']);
       self.config.set('button11Action', data['button11Action']);

       self.config.set('button12Enabled', data['button12Enabled']);
       if (data['button12Call'] === "" || data['button12Action'] === "")
       {
         self.config.set('button12Enabled', false);
       }
       self.config.set('button12Call', data['button12Call']);
       self.config.set('button12Action', data['button12Action']);

       self.commandRouter.pushToastMessage('success', self.getI18nString("SUCCESS_TITLE"), self.getI18nString("SUCCESS_MESSAGE"));
       self.getUIConfig();
       self.onStart();

    return defer.promise;
};

httpcaller.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            uiconf.sections[0].content[0].value = self.config.get('browseMenuTitle');
            uiconf.sections[0].content[1].value = self.config.get('button1Enabled');
            uiconf.sections[0].content[2].value = self.config.get('button1Call');
            uiconf.sections[0].content[3].value = self.config.get('button1Action');
            uiconf.sections[0].content[4].value = self.config.get('button2Enabled');
            uiconf.sections[0].content[5].value = self.config.get('button2Call');
            uiconf.sections[0].content[6].value = self.config.get('button2Action');
            uiconf.sections[0].content[7].value = self.config.get('button3Enabled');
            uiconf.sections[0].content[8].value = self.config.get('button3Call');
            uiconf.sections[0].content[9].value = self.config.get('button3Action');
            uiconf.sections[0].content[10].value = self.config.get('button4Enabled');
            uiconf.sections[0].content[11].value = self.config.get('button4Call');
            uiconf.sections[0].content[12].value = self.config.get('button4Action');
            uiconf.sections[0].content[13].value = self.config.get('button5Enabled');
            uiconf.sections[0].content[14].value = self.config.get('button5Call');
            uiconf.sections[0].content[15].value = self.config.get('button5Action');
            uiconf.sections[0].content[16].value = self.config.get('button6Enabled');
            uiconf.sections[0].content[17].value = self.config.get('button6Call');
            uiconf.sections[0].content[18].value = self.config.get('button6Action');
            uiconf.sections[0].content[19].value = self.config.get('button7Enabled');
            uiconf.sections[0].content[20].value = self.config.get('button7Call');
            uiconf.sections[0].content[21].value = self.config.get('button7Action');
            uiconf.sections[0].content[22].value = self.config.get('button8Enabled');
            uiconf.sections[0].content[23].value = self.config.get('button8Call');
            uiconf.sections[0].content[24].value = self.config.get('button8Action');
            uiconf.sections[0].content[25].value = self.config.get('button9Enabled');
            uiconf.sections[0].content[26].value = self.config.get('button9Call');
            uiconf.sections[0].content[27].value = self.config.get('button9Action');
            uiconf.sections[0].content[28].value = self.config.get('button10Enabled');
            uiconf.sections[0].content[29].value = self.config.get('button10Call');
            uiconf.sections[0].content[30].value = self.config.get('button10Action');
            uiconf.sections[0].content[31].value = self.config.get('button11Enabled');
            uiconf.sections[0].content[32].value = self.config.get('button11Call');
            uiconf.sections[0].content[33].value = self.config.get('button11Action');
            uiconf.sections[0].content[34].value = self.config.get('button12Enabled');
            uiconf.sections[0].content[35].value = self.config.get('button12Call');
            uiconf.sections[0].content[36].value = self.config.get('button12Action');
            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });
        let browseTitle = this.config.get('browseMenuTitle');

        if (browseTitle == "") { browseTitle = 'HTTP Caller';}

   return defer.promise;
};

httpcaller.prototype.handleBrowseUri = function(uri) {

  let browseTitle = this.config.get('browseMenuTitle');
  let enable1  = this.config.get('button1Enabled');
  let enable2  = this.config.get('button2Enabled');
  let enable3  = this.config.get('button3Enabled');
  let enable4  = this.config.get('button4Enabled');
  let enable5  = this.config.get('button5Enabled');
  let enable6  = this.config.get('button6Enabled');
  let enable7  = this.config.get('button7Enabled');
  let enable8  = this.config.get('button8Enabled');
  let enable9  = this.config.get('button9Enabled');
  let enable10  = this.config.get('button10Enabled');
  let enable11  = this.config.get('button11Enabled');
  let enable12  = this.config.get('button12Enabled');

  let action1  = this.config.get('button1Action');
  let icn1 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable1 == false ) {
    action1 = 'Not Enabled';
    icn1 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action2  = this.config.get('button2Action');
  let icn2 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable2 == false ) {
    action2 = 'NOT Enabled';
    icn2 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action3  = this.config.get('button3Action');
  let icn3 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable3 == false ) {
    action3 = 'NOT Enabled';
    icn3 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action4  = this.config.get('button4Action');
  let icn4 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable4 == false ) {
    action4 = 'NOT Enabled';
    icn4 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action5  = this.config.get('button5Action');
  let icn5 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable5 == false ) {
    action5 = 'NOT Enabled';
    icn5 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action6  = this.config.get('button6Action');
  let icn6 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable6 == false ) {
    action6 = 'NOT Enabled';
    icn6 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action7  = this.config.get('button7Action');
  let icn7 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable7 == false ) {
    action7 = 'NOT Enabled';
    icn7 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action8  = this.config.get('button8Action');
  let icn8 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable8 == false ) {
    action8 = 'NOT Enabled';
    icn8 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action9  = this.config.get('button9Action');
  let icn9 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable9 == false ) {
    action9 = 'NOT Enabled';
    icn9 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action10  = this.config.get('button10Action');
  let icn10 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable10 == false ) {
    action10 = 'NOT Enabled';
    icn10 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action11  = this.config.get('button11Action');
  let icn11 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable11 == false ) {
    action11 = 'NOT Enabled';
    icn11 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  let action12  = this.config.get('button12Action');
  let icn12 = '/albumart?sourceicon=system_controller/httpcaller/assets/http.png';
  if (enable12 == false ) {
    action12 = 'NOT Enabled';
    icn12 = '/albumart?sourceicon=system_controller/httpcaller/assets/nohttp.png';
  }
  switch (uri) {
    case 'httpcaller':
      break;
    case 'httpcaller/http_call_one':
    if (enable1 == true){
        this.http_call_one();
      }
      break;
    case 'httpcaller/http_call_two':
      if (enable2 == true) {
        this.http_call_two();
      }
      break;
    case 'httpcaller/http_call_three':
      if (enable3 == true) {
        this.http_call_three();
      }
      break;
    case 'httpcaller/http_call_four':
      if (enable4 == true) {
        this.http_call_four();
      }
      break;
    case 'httpcaller/http_call_five':
      if (enable5 == true) {
        this.http_call_five();
      }
      break;
    case 'httpcaller/http_call_six':
      if (enable6 == true) {
        this.http_call_six();
      }
      break;
    case 'httpcaller/http_call_seven':
      if (enable7 == true) {
        this.http_call_seven();
      }
      break;
    case 'httpcaller/http_call_eight':
      if (enable8 == true) {
        this.http_call_eight();
      }
      break;
    case 'httpcaller/http_call_nine':
      if (enable9 == true) {
        this.http_call_nine();
      }
      break;
    case 'httpcaller/http_call_ten':
      if (enable10 == true) {
        this.http_call_ten();
      }
      break;
    case 'httpcaller/http_call_eleven':
      if (enable11 == true) {
        this.http_call_eleven();
      }
      break;
    case 'httpcaller/http_call_twelve':
      if (enable12 == true) {
        this.http_call_twelve();
      }
      break;
    default:
      return libQ.reject(`Unknown httpcaller URI: ${uri}`)
  }

  return libQ.resolve({
    navigation: {
      prev: { uri: '/' },
      lists: [
        {
          title: browseTitle,
          availableListViews: [ 'list', 'grid' ],
          items: [
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action1,
              uri: `httpcaller/http_call_one`,
              albumart: icn1
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action2,
              uri: `httpcaller/http_call_two`,
              albumart: icn2
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action3,
              uri: `httpcaller/http_call_three`,
              albumart: icn3
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action4,
              uri: `httpcaller/http_call_four`,
              albumart: icn4
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action5,
              uri: `httpcaller/http_call_five`,
              albumart: icn5
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action6,
              uri: `httpcaller/http_call_six`,
              albumart: icn6
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action7,
              uri: `httpcaller/http_call_seven`,
              albumart: icn7
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action8,
              uri: `httpcaller/http_call_eight`,
              albumart: icn8
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action9,
              uri: `httpcaller/http_call_nine`,
              albumart: icn9
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action10,
              uri: `httpcaller/http_call_ten`,
              albumart: icn10
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action11,
              uri: `httpcaller/http_call_eleven`,
              albumart: icn11
            },
            {
              service: browseTitle,
              type: 'item-no-menu',
              title: action12,
              uri: `httpcaller/http_call_twelve`,
              albumart: icn12
            }
          ]
        }
      ]
    }
  });
}



//httpcaller.prototype.getUIConfig1 = function() {
//    var defer = libQ.defer();
//    var self = this;

//    var lang_code = this.commandRouter.sharedVars.get('language_code');

//    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
 //       __dirname+'/i18n/strings_en.json',
 //       __dirname + '/UIConfig.json')
 //       .then(function(uiconf)
 //       {


 //           defer.resolve(uiconf);
 //       })
 //       .fail(function()
 //       {
 //           defer.reject(new Error());
 //       });

//    return defer.promise;
//};

//httpcaller.prototype.getConfigurationFiles = function() {
//	return ['config.json'];
//}

//httpcaller.prototype.setUIConfig = function(data) {
//	var self = this;
	//Perform your installation tasks here
//};

//httpcaller.prototype.getConf = function(varName) {
//	var self = this;
//	//Perform your installation tasks here
//};

//httpcaller.prototype.setConf = function(varName, varValue) {
//	var self = this;
	//Perform your installation tasks here
//};



// Playback Controls ---------------------------------------------------------------------------------------
// If your plugin is not a music_sevice don't use this part and delete it


//httpcaller.prototype.addToBrowseSources = function () {

	// Use this function to add your music service plugin to music sources
    //var data = {name: 'Spotify', uri: 'spotify',plugin_type:'music_service',plugin_name:'spop'};
//    this.commandRouter.volumioAddToBrowseSources(data);
//};

//httpcaller.prototype.handleBrowseUri1 = function (curUri) {
//    var self = this;

    //self.commandRouter.logger.info(curUri);
//    var response;


//    return response;
//};



// Define a method to clear, add, and play an array of tracks
//httpcaller.prototype.clearAddPlayTrack = function(track) {
//	var self = this;
//	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'httpcaller::clearAddPlayTrack');

//	self.commandRouter.logger.info(JSON.stringify(track));

//	return self.sendSpopCommand('uplay', [track.uri]);
//};

//httpcaller.prototype.seek = function (timepos) {
//    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'httpcaller::seek to ' + timepos);

//    return this.sendSpopCommand('seek '+timepos, []);
//};

// Stop
//httpcaller.prototype.stop = function() {
//	var self = this;
//	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'httpcaller::stop');


//};

// Spop pause
//httpcaller.prototype.pause = function() {
//	var self = this;
//	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'httpcaller::pause');


//};

// Get state
//httpcaller.prototype.getState = function() {
//	var self = this;
//	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'httpcaller::getState');


//};

//Parse state
//httpcaller.prototype.parseState = function(sState) {
//	var self = this;
//	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'httpcaller::parseState');

	//Use this method to parse the state and eventually send it with the following function
//};

// Announce updated State
//httpcaller.prototype.pushState = function(state) {
//	var self = this;
//	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'httpcaller::pushState');

//	return self.commandRouter.servicePushState(state, self.servicename);
//};


//httpcaller.prototype.explodeUri = function(uri) {
//	var self = this;
//	var defer=libQ.defer();

	// Mandatory: retrieve all info for a given URI

//	return defer.promise;
//};

//httpcaller.prototype.getAlbumArt = function (data, path) {

//	var artist, album;

//	if (data != undefined && data.path != undefined) {
//		path = data.path;
//	}

//	var web;

//	if (data != undefined && data.artist != undefined) {
//		artist = data.artist;
//		if (data.album != undefined)
//			album = data.album;
//		else album = data.artist;

//		web = '?web=' + nodetools.urlEncode(artist) + '/' + nodetools.urlEncode(album) + '/large'
//	}

//	var url = '/albumart';

//	if (web != undefined)
//		url = url + web;

//	if (web != undefined && path != undefined)
//		url = url + '&';
//	else if (path != undefined)
//		url = url + '?';

//	if (path != undefined)
//		url = url + 'path=' + nodetools.urlEncode(path);
//
//	return url;
//};





//httpcaller.prototype.search = function (query) {
//	var self=this;
//	var defer=libQ.defer();

	// Mandatory, search. You can divide the search in sections using following functions

//	return defer.promise;
//};

//httpcaller.prototype._searchArtists = function (results) {

//};

//httpcaller.prototype._searchAlbums = function (results) {

//};

//httpcaller.prototype._searchPlaylists = function (results) {


//};

//httpcaller.prototype._searchTracks = function (results) {

//};

//httpcaller.prototype.goto=function(data){
//    var self=this
//    var defer=libQ.defer()

// Handle go to artist and go to album function

//     return defer.promise;
//};
