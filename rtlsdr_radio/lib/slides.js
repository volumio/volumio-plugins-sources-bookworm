'use strict';

// The pictures a DAB station sends with its programme (the slideshow).
//
// The decoder writes every picture it has received whole into its output folder, under
// a name of its own making (slide_<number>.jpg or .png, the numbers rising), never under
// the name the broadcaster gives it. The newest is the one to show.
//
// A screen cannot be handed a file on the player: it is handed an address of Volumio's
// artwork endpoint, which serves pictures from inside a plugin's folder. So the
// decoder's folder is reached through a link in the plugin's folder, as the station
// logos are. The endpoint tells screens to keep a picture for a month, and the
// decoder's numbers start again with every station played, so the address also carries
// the time the picture was written: no two pictures ever share an address.

var fs = require('fs-extra');
var path = require('path');

var LINK = path.join(__dirname, '..', 'slides');
var ICON_PREFIX = 'music_service/rtlsdr_radio/slides/';
var NAME = /^slide_(\d+)\.(jpg|png)$/;

// How many of the newest pictures are left in the folder; the folder is in memory
var KEEP = 3;

// options.dir: the decoder's output folder
function Slides(options) {
  options = options || {};
  this.dir = options.dir;
  this.link = options.link === undefined ? LINK : options.link;
  this.logger = options.logger || { info: function() {}, error: function() {} };
}

// The link through which screens reach the pictures. Made again at every start of the
// plugin: an update takes it away with the plugin's folder.
Slides.prototype.prepare = function() {
  if (!this.link) {
    return;
  }
  try {
    var found = null;
    try {
      found = fs.lstatSync(this.link);
    } catch (e) {
      // not there yet
    }
    if (found && found.isSymbolicLink() && fs.readlinkSync(this.link) === this.dir) {
      return;
    }
    if (found) {
      fs.removeSync(this.link);
    }
    fs.symlinkSync(this.dir, this.link);
  } catch (e) {
    this.logger.info('[RTL-SDR Radio] Slides: cannot prepare the link to ' + this.dir + ': ' + e.message);
  }
};

// The newest picture the station has sent: { file, icon }, or null when it has sent
// none. icon is what Volumio's artwork endpoint takes as sourceicon. Pictures older than
// the last few are removed on the way.
Slides.prototype.newest = function() {
  var self = this;
  var slides;
  try {
    slides = fs.readdirSync(self.dir).map(function(file) {
      var match = NAME.exec(file);
      return match ? { file: file, number: parseInt(match[1], 10) } : null;
    }).filter(Boolean).sort(function(a, b) { return a.number - b.number; });
  } catch (e) {
    return null;
  }

  slides.slice(0, -KEEP).forEach(function(old) {
    try {
      fs.unlinkSync(path.join(self.dir, old.file));
    } catch (e) {
      // gone already
    }
  });

  // The newest that is there in full; the decoder puts a picture in place in one move,
  // so an empty file is one that something else left behind
  for (var i = slides.length - 1; i >= 0; i--) {
    try {
      var stat = fs.statSync(path.join(self.dir, slides[i].file));
      if (stat.size > 0) {
        return {
          file: slides[i].file,
          icon: ICON_PREFIX + slides[i].file + '&v=' + Math.floor(stat.mtimeMs).toString(36)
        };
      }
    } catch (e) {
      // removed in the meantime
    }
  }
  return null;
};

module.exports = Slides;
module.exports.ICON_PREFIX = ICON_PREFIX;
