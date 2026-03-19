/*
    RaspDacMini LCD Compositor
    Version: 3.0.0
    
    Author: Nerd (https://github.com/foonerd)
    Original code by Olivier Schwach (Audiophonics)
*/

// Verify we are running on a supported distribution
const distro = process.argv[2],
supported_distributions = ["moode", "volumio"];
if(!distro || !supported_distributions.includes(distro) ){
	console.warn("Unknown target distribution : ",distro, "\nHere are the supported distributions : ", supported_distributions.join() );
	process.exit();
}

// Framebuffer device to receive the rendered screen image
const targetBuffer = process.argv[3] || "/dev/fb1";


// Listen for playback data from the current distribution
var streamer;
switch(distro){
	case("moode"):
		const { moode_listener } = require("./utils/moodelistener.js");
		streamer = new moode_listener();
	break;
	case("volumio"):
		const { volumio_listener } = require("./utils/volumiolistener.js");
		streamer = new volumio_listener();
	break;
}

const fs = require("fs"); 
const cp = require("child_process");
const os = require("os");
const http = require("http");
const daccontrol = require("./utils/daccontrol.js");

// Ensure we use the native extension module compiled for the current architecture

const { Image, createCanvas, loadImage, DOMMatrix, ImageData  } = require('canvas');

// Main canvas (what's on it = what's displayed on screen)
const canvas = createCanvas(320, 240 );
const ctx = canvas.getContext("2d" );	

// Scene canvas (full height scene that scrolls vertically into main canvas)
const scenecanvas = createCanvas(320, 455 );
const scene_ctx = scenecanvas.getContext("2d" );

// Cover canvas to store album art + blur filter (avoids recalculating blur each cycle)
const StackBlur = require('stackblur-canvas'); 
const covercanvas = createCanvas(320, 240);
const coverctx = covercanvas.getContext("2d" );

const { panicMeter } = require('./utils/panicmeter.js');
const panicmeter = new panicMeter();	// Utility to monitor write collisions (when writing a frame while previous is still transferring)


// Native extension to convert compositor image to ILI9341 display format (also rotates screen)
const colorConvert = require('./utils/rgb565.node');

// Number of frames before text starts scrolling (after track change)
const base_refresh_track = 80;

const SCROLLTIME = 1600; // in ms


// Interval between render/write cycles
const UPDATE_INTERVAL = 20; // in ms

// Utility for vertical screen scroll ease-in ease-out effect
const { scrollAnimation  } = require('./utils/scroll_animation.js');
const scroll_animation = new scrollAnimation();
scroll_animation.plotScrollEase(SCROLLTIME / UPDATE_INTERVAL, 0, -215, 0.8);


// Variable states
var main_text_width = 0;				// Width in px of scrolling text block
var should_scroll = false;				// Is text scrolling
var main_text = "";						// Scrolling text string
var cachedRasterizedMainText = null;	// Canvas containing rasterized scrolling text doubled with separator
var textScrollerX = 0;					// Current scroll position of text
var refresh_track = 0;					// Frames to wait before starting scroll
var cover = {							// Current cover art and metadata
	imageData : new ImageData(320,240),
	height : null,
	width : null,
	src : null,
	need_redraw : true
};
var scene = {
	need_redraw : true,
	redrawzones : []
}
var display = {
  redrawzones : []
}
var mainMatrix =  new DOMMatrix([1,0,0,1,0,0]);	// Global matrix of main canvas (used for vertical scrolling)
var busy = false;								// Indicates if stream is free to write data
var last_ip = "";								// Last known IP address
var dacInput = "";								// Current input of Audiophonics ES9038Q2M DAC
var dacFilter = "?";							// Current filter of Audiophonics ES9038Q2M DAC

// All recurring actions
var bufwrite_interval = null;
var getfilter_interval = null;
var getinput_interval = null;
var getip_interval = null;
var getclock_interval = null;

// Debounce timestamps for repeat/shuffle (prevents rapid-fire toggling)
var lastRepeatTime = 0;
var lastShuffleTime = 0;
var DEBOUNCE_MS = 1500;


// Default values that can be overridden by placing a config file in the same folder
var TIME_BEFORE_DEEPSLEEP = 900000; // in ms


// Utility to add leading zeros to a string
function leadingZero(a,b){
	if(!a){
		let r = "";
		while (b--) r+="0"
		return r;
	}
	return([1e15]+a).slice(-b)
}

// Drawing methods
function updateCover(img,src){
	
	// If previous cover is slow to load, this code may execute when track has already changed - don't update in that case
	if(src && src !== cover.src) return;
	
	let vratio = canvas.height / img.height, 
	canvasBoxData = [0, 0 ,canvas.width, canvas.height]; // Avoid rewriting everything each time
	
	cover.width = img.width * vratio;
	cover.height = canvas.height;
	cover.x = ( canvas.width - cover.width )/2;
	cover.y = ( canvas.height - cover.height )/2;
	coverctx.fillStyle="black";
	coverctx.fillRect(0,0,320,240);
	coverctx.drawImage(img,...canvasBoxData); // Draw stretched image across full width of secondary canvas
	let blur_imgdata = coverctx.getImageData(...canvasBoxData);	// Capture stretched image
	blur_imgdata = StackBlur.imageDataRGBA(blur_imgdata, ...canvasBoxData , 50); // Blur the stretched image
	coverctx.putImageData(blur_imgdata, 0, 0 );	// Reinject blurred stretched image into secondary canvas
	coverctx.drawImage(img, cover.x,cover.y, cover.width, cover.height);	// Draw original (non-blurred) image centered on top
	cover.imageData = coverctx.getImageData(...canvasBoxData); // Capture the result
	cover.need_redraw = true
}

// Use to provide custom image object independent of streamer's native implementation
function directUpdateCover(imageObject){
	cover.imageData = new ImageData(320,240);
	cover.src = null;
	if(!imageObject) return;
	let canvasImage =  new Image();
	if( imageObject && imageObject.data ) canvasImage.src = imageObject.data;
	updateCover( canvasImage, false );
}

// Volume widget
function updateVolumeIcon(ctx, x,y,w,h, level ){
	let zone = [x-2,y-4,w+6,h+6]
	ctx.clearRect(...zone);	// Values determined by trial and error
	
	
	ctx.strokeStyle = "white";
	ctx.fillStyle = "white";

	let y_grid = h/4,
		x_grid = w/20,
		px = (n)=>{ return x + x_grid*n },
		py = (n)=>{ return y + y_grid*n }
	
	// Speaker icon
	
	ctx.beginPath();
	ctx.moveTo( px(0) 	, py(1) );
	ctx.lineTo( px(0) 	, py(3) );
	ctx.lineTo( px(3) 	, py(3) );
	ctx.lineTo( px(8) 	, py(4) );
	ctx.lineTo( px(8)	, py(0) );
	ctx.lineTo( px(3)	, py(1) );
	ctx.closePath();
	ctx.fill();
	ctx.beginPath();
	// Draw sound waves based on volume level
	
	ctx.lineWidth = 2;
	
	if( !parseInt(level)  ){ // No volume: small cross
		ctx.moveTo( px(12) 	, py(0.5) );
		ctx.lineTo( px(19) 	, py(3.5) );
		ctx.moveTo( px(12) 	, py(3.5) );
		ctx.lineTo( px(19) 	, py(0.5) );
		ctx.stroke();
		return;
	}
	
	ctx.beginPath();	// Low volume: small wave
	ctx.moveTo( px(10) 	, py(3) );
	ctx.bezierCurveTo(	
		px(13)	, py(2.5), 
		px(13)	, py(1.5),
		px(10)	, py(1)
	);
	if( level > 33  ){ 	// Medium volume: second wave
		ctx.moveTo( px(14) 	, py(3.5) );
		ctx.bezierCurveTo(	
			px(17)	, py(2.5), 
			px(17)	, py(1.5),
			px(14)	, py(0.5)
		);
	}
	if( level > 66  ){ 	// High volume: third wave
		ctx.moveTo( px(19) 	, py(4) );
		ctx.bezierCurveTo(	
			px(20)	, py(2.5), 
			px(20)	, py(1.5),
			px(19)	, py(0)
		);
	}
	ctx.stroke();
	
}

// Play / pause / stop widget
function updateStateIcon(ctx, x,y,w,h, state ){
	ctx.clearRect(x,y,w,h);
	ctx.fillStyle = "white";
	ctx.strokeStyle = "white";
	
	if(state === "play"){
		// Play: triangle
		ctx.beginPath();
		ctx.moveTo(x,y);
		ctx.lineTo(x,y+h);
		ctx.lineTo(x+w,(y+h)/2);
		ctx.closePath();
		ctx.fill();
		return;
	}	
	if(state === "pause"){
		// Pause: two rectangles
		ctx.clearRect(x,y,w,h);
		ctx.fillRect(x,y,w/3,h);
		ctx.fillRect(x,y,w/3,h);
		ctx.fillRect(x+w/1.5,y,w/3,h);
		return;
	}
		// Default: stop (square)
	ctx.fillRect(x,y,w,h);
	
}

// Repeat icon widget
function updateRepeatIcon(ctx, x, y, w, h, active){
	ctx.clearRect(x-1, y-1, w+2, h+2);
	ctx.strokeStyle = active ? "white" : "rgba(255,255,255,0.3)";
	ctx.fillStyle = active ? "white" : "rgba(255,255,255,0.3)";
	ctx.lineWidth = 1.5;
	
	// Circular arrow for repeat
	let cx = x + w/2;
	let cy = y + h/2;
	let r = Math.min(w, h) / 2 - 2;
	
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0.3, Math.PI * 1.7);
	ctx.stroke();
	
	// Arrow head
	let ax = cx + r * Math.cos(0.3);
	let ay = cy + r * Math.sin(0.3);
	ctx.beginPath();
	ctx.moveTo(ax - 3, ay - 2);
	ctx.lineTo(ax + 2, ay);
	ctx.lineTo(ax - 1, ay + 3);
	ctx.fill();
}

// widget shuffle icon
function updateShuffleIcon(ctx, x, y, w, h, active){
	ctx.clearRect(x-1, y-1, w+2, h+2);
	ctx.strokeStyle = active ? "white" : "rgba(255,255,255,0.3)";
	ctx.fillStyle = active ? "white" : "rgba(255,255,255,0.3)";
	ctx.lineWidth = 1.5;
	
	// Crossed arrows for shuffle
	let x1 = x + 2;
	let x2 = x + w - 2;
	let y1 = y + 3;
	let y2 = y + h - 3;
	
	// First arrow (top-left to bottom-right)
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2 - 3, y2);
	ctx.stroke();
	
	// Second arrow (bottom-left to top-right)
	ctx.beginPath();
	ctx.moveTo(x1, y2);
	ctx.lineTo(x2 - 3, y1);
	ctx.stroke();
	
	// Arrow heads on right side
	ctx.beginPath();
	ctx.moveTo(x2, y1);
	ctx.lineTo(x2 - 4, y1 - 2);
	ctx.lineTo(x2 - 4, y1 + 2);
	ctx.closePath();
	ctx.fill();
	
	ctx.beginPath();
	ctx.moveTo(x2, y2);
	ctx.lineTo(x2 - 4, y2 - 2);
	ctx.lineTo(x2 - 4, y2 + 2);
	ctx.closePath();
	ctx.fill();
}

// Utility function to write a line on page 2
function updateMetaDataText(txt, x, y ,h){
	let zone = [x,y-h,320,h+4];
	scene_ctx.fillStyle = "white";
	scene_ctx.font = `${h}px sans-serif`;
	scene_ctx.clearRect(...zone);
	scene_ctx.fillText( txt, x, y );
  
  safeAddZone2Redraw(zone,scene.redrawzones )
}

function handleSpdif(){
  
  scroll_animation.reset();
  textScrollerX = 0;
  refresh_track = base_refresh_track;
  if(dacInput === "SPDIF"){
    ctx.setTransform(mainMatrix);
    let fontsize = 100;
    ctx.clearRect(0,0,320,240);
    ctx.fillStyle = "white";
    ctx.font = `${fontsize}px arial`;
    ctx.textAlign = 'center';
    ctx.fillText( "SPDIF", 320/2, (fontsize + 240)/2 );
    ctx.textAlign = 'left';
    scene.need_redraw = true;
  }
  
  cover.need_redraw = true;
}

// All streamer events
streamer.on("volumeChange", (data)=>{
	let zonetxt = [285, 0 , 320-285, 16];
	let zonepic = [260,2, 20, 12];
	updateVolumeIcon(scene_ctx, ...zonepic , data);
  
	scene_ctx.clearRect(...zonetxt);
	scene_ctx.fillStyle = "white";
	scene_ctx.font = "14px sans-serif";
	scene_ctx.fillText( leadingZero(streamer.data.volume, 3), 285, 14 );
  
  safeAddZone2Redraw(zonetxt, scene.redrawzones)
  safeAddZone2Redraw(zonepic, scene.redrawzones)
  
});
streamer.on("muteChange", (data)=>{
	if(data === true  ) streamer.emit("volumeChange",0);
	else streamer.emit("volumeChange",streamer.data.volume);
});
streamer.on("stateChange", (data)=>{  
  const zone = [4,4, 10, 10];
  updateStateIcon(scene_ctx, ...zone, data);
  safeAddZone2Redraw( zone, scene.redrawzones );
});
streamer.on("repeatChange", (data)=>{
  const zone = [226, 3, 12, 12];
  updateRepeatIcon(scene_ctx, ...zone, data === true);
  safeAddZone2Redraw( zone, scene.redrawzones );
});
streamer.on("randomChange", (data)=>{
  const zone = [242, 3, 12, 12];
  updateShuffleIcon(scene_ctx, ...zone, data === true);
  safeAddZone2Redraw( zone, scene.redrawzones );
});
streamer.on("line0", (data)=>{ updateMetaDataText(data, 7, 270, 20) } );
streamer.on("line1", (data)=>{ updateMetaDataText(data, 7, 295, 20) } );
streamer.on("line2", (data)=>{ updateMetaDataText(data, 7, 320, 20) } );
streamer.on("line3", (data)=>{ updateMetaDataText(data, 7, 345, 20) } );
streamer.on("line4", (data)=>{ updateMetaDataText(data, 7, 370, 20) } );
streamer.on("line5", (data)=>{ updateMetaDataText(data, 7, 395, 20) } );
streamer.on("line6", (data)=>{ updateMetaDataText(data, 7, 420, 20) } );
streamer.on("coverChange", (data)=>{
	if(data === cover.src) return; // Don't reload current image
	cover.imageData = new ImageData(320,240);
	cover.src = data;
	loadImage( data ).then((img)=>{updateCover(img,data)})
	.catch(	err => { console.warn('Error loading cover art.', err)	} ); // Should add fallback cover here
});
streamer.on("directCoverChange", directUpdateCover);
streamer.on("trackChange", (data)=>{
	should_scroll = false;
	main_text = streamer.formatedMainString;
	ctx.font = "25px arial";
	main_text_width = ctx.measureText( main_text + " - " ).width;
	
	// Is text short enough to fit in full screen width?
	if( main_text_width <= canvas.width ){
    let zone = [0, 210 ,320, 30];
		should_scroll = false;
    
    scene_ctx.clearRect( ...zone );
		scene_ctx.fillStyle = "rgba(0,0,0,0.7)";
		scene_ctx.fillRect( ...zone );
		scene_ctx.fillStyle = "white";
		scene_ctx.font = "25px arial";
		scene_ctx.textAlign = 'center';
		scene_ctx.fillText( main_text, 320/2, 210+25 );
		scene_ctx.textAlign = 'left';
    safeAddZone2Redraw( zone, scene.redrawzones );
	}
	else{
		should_scroll = true;
		main_text = main_text + " - " + main_text + " - "; // Double text so start exits right edge while end still exits left edge
	
		scene_ctx.clearRect(0, 210 ,320, 30); // Clear any remaining static text on scenecanvas
			
		// Fill the text canvas with a raster of the doubled text
	
		let double_text_width = ctx.measureText( main_text ).width;
		delete cachedRasterizedMainText; // Really needed?
		cachedRasterizedMainText = createCanvas(double_text_width, 30);
		cached_ctx = cachedRasterizedMainText.getContext("2d" );
		
		// Semi-transparent black background for readability
		cached_ctx.fillStyle = "rgba(0,0,0,0.7)";
		cached_ctx.fillRect(0, 0 ,double_text_width, 30);
		
		// Write the text
		cached_ctx.fillStyle = "white";
		cached_ctx.font = "25px arial";
		cached_ctx.fillText( main_text, 0, 25 );
		
		// Reset scroller counter to zero
		textScrollerX = 0;
		refresh_track = base_refresh_track;
	}
});
streamer.on("seekChange", (data)=>{

  const zone = [0,207,320,3];
  
	scene_ctx.clearRect(...zone);
  scene_ctx.fillStyle="rgba(0,0,0,1)";
  scene_ctx.fillRect(...zone);
  
  scene_ctx.fillStyle="#a74a0c";
	scene_ctx.fillRect(0,207, parseInt( 320 * data.ratiobar ) ,3);
  safeAddZone2Redraw( zone, scene.redrawzones );
});

function get_filter(){
    daccontrol.getFilter().then(function(data){
        if(!data) return;
        let _dacFilter = data.replace("minimum","min");
        if(dacFilter === _dacFilter) return;
        dacFilter = _dacFilter;
        updateMetaDataText("DAC : " + dacFilter, 7, 445, 20);
    });
}
get_filter();
getfilter_interval = setInterval(get_filter, 2000);

function get_input(){
    daccontrol.getInput().then(function(_dacInput){
        if(!_dacInput) return;
        _dacInput = _dacInput.trim();
        if(dacInput === _dacInput) return;
        dacInput = _dacInput;
        handleSpdif();
    });
}
// Initialize DAC control then start polling
daccontrol.init().then(function(){
    get_input();
});
// getinput_interval = setInterval(get_input, 2000);

var clear_ip = function(){};
var clear_clock = function(){};
function monitor_ip(){
	let current_ipv4 = "",
	fontsize = 14,
	x = 21, 
	y = 15,
	width = 0;
	
 
  
	try{
		let ips = os.networkInterfaces(), ip = "No network.";
		for(a in ips){
			if( ips[a][0]["address"] !== "127.0.0.1" && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ips[a][0]["address"]) ){
				// Validate complete IP - must have 4 octets and not end with dot
				let testIP = ips[a][0]["address"];
				let octets = testIP.split('.');
				if(octets.length === 4 && octets[3] !== '' && testIP[testIP.length-1] !== '.'){
					ip = testIP;
					break;
				}
			}
		}
		current_ipv4 = ip;
	}
	catch(e){current_ipv4 =  "No network.";}
	if(last_ip === current_ipv4 ) return;
	last_ip = current_ipv4;
	
	scene_ctx.fillStyle = "white";
	scene_ctx.font = `${fontsize}px sans-serif`;
	clear_ip();
	scene_ctx.fillText( current_ipv4, x, y );
	width = scene_ctx.measureText( current_ipv4 ).width;
  

  
	clear_ip=()=>{ 	
    const zone =[x,y-fontsize,width,fontsize];
    scene_ctx.clearRect(...zone);   
    safeAddZone2Redraw(zone, scene.redrawzones);
  }
}
monitor_ip();
getip_interval = setInterval(monitor_ip, 5000);

function monitor_clock(){
	let date = new Date(), 
	current_clock = "",
	fontsize = 14,
	x = 165, 
	y = 15,
	width = 0;
	
	current_clock = leadingZero( date.getHours(), 2 ) + ":" + leadingZero( date.getMinutes(), 2 );
	scene_ctx.fillStyle = "white";	
	scene_ctx.font = `${fontsize}px sans-serif`;
	clear_clock();
	scene_ctx.fillText( current_clock, x, y );
	width = scene_ctx.measureText( current_clock ).width;
  
  const zone =[x,y-fontsize,width,fontsize];
  safeAddZone2Redraw(zone, scene.redrawzones);
  
	clear_clock =()=>{ scene_ctx.clearRect(...zone);	}
}
monitor_clock();
getclock_interval = setInterval(monitor_clock, 1000*30);

// Initialize repeat/shuffle icons (off state)
updateRepeatIcon(scene_ctx, 226, 3, 12, 12, false);
updateShuffleIcon(scene_ctx, 242, 3, 12, 12, false);


function soft_exit_sleep(){
	try{streamer.resetIdleTimeout()}
	catch(err){}	
}
// HTTP server to respond to external commands
http.createServer(server).listen(4153);
function server( req,res ){
	let url = req.url.split("/")[1],
		_url = url.split("="),	
		cmd = _url[0],
		param = _url[1] || "?";
		param = decodeURIComponent(param);
	switch(cmd){
		
		case("switch_view"): 
			soft_exit_sleep();
			if(dacInput !== "SPDIF") scroll_animation.toggle();	
			res.end();
		break;
		
		case("toggle_input"):
			soft_exit_sleep();
			daccontrol.toggleInput().then(function(newInput){
				if(newInput){
					dacInput = newInput;
					handleSpdif();
					res.end(newInput);
				} else {
					res.end("error");
				}
			});
		break;
		
		case("next_filter"):
			soft_exit_sleep();
			daccontrol.nextFilter().then(function(newFilter){
				if(newFilter){
					dacFilter = newFilter.replace("minimum","min");
					updateMetaDataText("DAC : " + dacFilter, 7, 445, 20);
					res.end(newFilter);
				} else {
					res.end("error");
				}
			});
		break;
		
		case("filter_change"): 
			soft_exit_sleep();
			dacFilter = param.replace("minimum","min");
			updateMetaDataText("DAC : " + dacFilter, 7, 445, 20);
			res.end();
		break;
		
		case("input"): 
			soft_exit_sleep();
			dacInput = param.trim();
      handleSpdif();
			res.end();
		break;
		
		case("nosleep"): 
			soft_exit_sleep();
			res.end();
		break;
		
		case("toggle_repeat"):
			soft_exit_sleep();
			let nowRepeat = Date.now();
			if(nowRepeat - lastRepeatTime < DEBOUNCE_MS){
				res.end("debounced");
				break;
			}
			lastRepeatTime = nowRepeat;
			cp.exec('/usr/local/bin/volumio repeat', function(err, stdout, stderr){
				if(err) res.end("error");
				else res.end("ok");
			});
		break;
		
		case("toggle_shuffle"):
			soft_exit_sleep();
			let nowShuffle = Date.now();
			if(nowShuffle - lastShuffleTime < DEBOUNCE_MS){
				res.end("debounced");
				break;
			}
			lastShuffleTime = nowShuffle;
			cp.exec('/usr/local/bin/volumio random', function(err, stdout, stderr){
				if(err) res.end("error");
				else res.end("ok");
			});
		break;
		
		case("poweroff"): 
			soft_exit_sleep();
			res.end();
			printShutDownAndDie();
		break;
	}
}	


// Final image composition
function Vdraw(){
  
	//console.time("draw");
	let verticalOffset = 0;
	if(dacInput !== "SPDIF"){ // If SPDIF active, show fixed text in center so skip full redraw 
  
		verticalOffset = scroll_animation.cycle();
		ctx.setTransform(mainMatrix);
		
		let matrix_with_offset = new DOMMatrix([1,0,0,1,0,verticalOffset]);
	
		// Background: cover image
		if(cover.imageData){
			if(cover.need_redraw || scroll_animation.hasPlayedThisCycle){ // Case where full cover needs (re)drawing
				// ctx.clearRect(0,0,320, 18);
				ctx.drawImage(covercanvas,0,0); 
				scene.need_redraw = true;
				cover.need_redraw = false;
			}
			else if(should_scroll){ // Need to (re)draw part of cover under scrolling text

				 let overflow = (210 + verticalOffset)
				 if(overflow > 0 ) overflow = 0;
				 let txtzoneoffset = [0,210 + verticalOffset - overflow,320,30 +overflow]
				 ctx.drawImage(covercanvas, ...txtzoneoffset, ...txtzoneoffset);
			}
		}
		ctx.setTransform( matrix_with_offset );
		
		// Album title scroll
		if( should_scroll ){ 
			if(textScrollerX + main_text_width  <= 0 ) textScrollerX = 0;
		  
      let relative_zone = [0, 210, 320 , 30];
			// If text needs scrolling, it was pre-drawn into variable width canvas
			// and we scroll that canvas
			ctx.drawImage( cachedRasterizedMainText, -textScrollerX, 0, 320, 30, 0, 210, 320, 30  );
      
			
			if( refresh_track ) refresh_track--; // Don't update scroll cursor before static frames expire (just after track change)
			else{
        safeAddZone2Redraw(relative_zone, display.redrawzones);
        textScrollerX--;
      }
		}

		

		
		if(scene.need_redraw || scroll_animation.hasPlayedThisCycle ){ // Redraw entire scene
			// Top bar of screen
			// Semi-transparent black background for readability
      ctx.fillStyle = "rgba(0,0,0,0.7)";		
      let zoneTop = [0,0,320, 18];
			ctx.fillRect(...zoneTop);

      let zoneA = [0, 240 ,320, 240];
			ctx.fillRect(...zoneA);
			ctx.setTransform(mainMatrix);
      let zone = [0, 0 , 320 , 240];
      let relative_zone = [0, 0-verticalOffset , 320 , 240];

			ctx.drawImage(scenecanvas, ...relative_zone, ...zone);
			scene.redrawzones = [];
			scene.need_redraw = false;
      safeAddZone2Redraw(zone, display.redrawzones)
		}
		else if(scene.redrawzones.length){  // Redraw parts of scene
      
			ctx.setTransform(mainMatrix);
			ctx.fillStyle = "rgba(0,0,0,0.7)";					
	
			
			const zones = scene.redrawzones.filter( z=>z[1]+z[3] + verticalOffset > 0 && z[1] + verticalOffset < 240  ); // Only update what's visible
			const relative_zones = zones.map(z=>z.map(v=>v)); // deepclone
			relative_zones.forEach(z=>{
				z[1]+=verticalOffset;
			});
			// zone = position in scene canvas
			// relative_zone = position in main canvas
			while(zones.length){
				let zone = zones.pop();
				let relative_zone = relative_zones.pop();
				ctx.clearRect(...relative_zone); 
				if(cover.imageData){
					ctx.drawImage(covercanvas,  ...relative_zone, ...relative_zone);
				}
				ctx.fillRect(...relative_zone);
				ctx.drawImage(scenecanvas, ...zone,...relative_zone);
        safeAddZone2Redraw(relative_zone, display.redrawzones);
				
			}
			scene.redrawzones = [];
		}
	}	
	else if(scene.need_redraw || scene.redrawzones.length){ // SPDIF view
      // Top bar of screen
      // Semi-transparent black background for readability
      const zone = [0,0,320, 18];
      ctx.clearRect(...zone);
      ctx.fillStyle = "rgba(0,0,0,0.5)";			
      ctx.fillRect(...zone);
    
      ctx.setTransform(mainMatrix);
      ctx.drawImage(scenecanvas, ...zone, ...zone);
      display.redrawzones.push(zone);
      scene.need_redraw = false;
      scene.redrawzones = [];
    
	}

	
	//console.timeEnd("draw");
}

// Basic dirtyRect implementation (since fbcp-ili9341 is no longer available, screen driver writes are much slower)
function safeAddZone2Redraw(zone, list){
  zone = zone.map(x => x<0?0:x); // Never update negative values (TODO: should also check overflows)
  if( list.find( testzone=>{
    for(let i in zone) if( zone[i] !== testzone[i]) return false;
    return true;   
  })) return;
  list.push(zone)  
}


function updateFB(){

	if(busy) return panicmeter.registerError();
	busy = true;

	Vdraw();
  
  if(! display.redrawzones.length) return fbcb();
  display.redrawzones = [];
  
  // console.log("draw")
  
 
	const buff = canvas.toBuffer("raw");

  const converted = colorConvert.rgb888ToRgb565(buff);
  
    streamFile.cork()
    write(converted);
    process.nextTick(() =>{
    streamFile.uncork();
     process.nextTick(()=>{
       fbcb()
     })
    
  });
  
  
}

function write(buff){
  streamFile.pos = 0;
  streamFile.write(buff);
}

function fbcb(err,data){
  // console.timeEnd("display")
	busy = false;
	if ( err ) console.warn( err, data );
}


function printShutDownAndDie(){
	[
		bufwrite_interval,
		getfilter_interval,
		getinput_interval,
		getip_interval,
		getclock_interval
	].forEach(clearInterval);
	busy = true;
	const fontsize = 40;
	ctx.clearRect(0,0,320,240);
	ctx.fillStyle = "white";
	ctx.font = `${fontsize}px arial`;
	ctx.textAlign = 'center';
	ctx.fillText( "SHUTTING", 320/2, 79  );
	ctx.fillText( "DOWN", 320/2, 131  );
	const buff = canvas.toBuffer("raw");
	const converted = colorConvert.rgb888ToRgb565(buff);
  streamFile.uncork();
	write(converted );
  streamFile.destroy();
  process.exit(0);
}


const streamFile = fs.createWriteStream(targetBuffer);
  streamFile.on('error', (e)=>{console.warn(e);
  process.exit()
})

// Show startup message
ctx.fillStyle = "black";
ctx.fillRect(0, 0, 320, 240);
ctx.fillStyle = "white";
ctx.font = "24px sans-serif";
ctx.textAlign = "center";
ctx.fillText("Starting...", 160, 120);
const buff = canvas.toBuffer("raw");
const converted = colorConvert.rgb888ToRgb565(buff);
streamFile.write(converted);
console.log("[Startup] Displayed startup message");


// Read sleep timeout configuration
// Priority: 1) Environment variable (from systemd service)
//           2) Config file (for standalone testing)
//           3) Default value (900 seconds)
var TIME_BEFORE_DEEPSLEEP = 900000; // default in ms

// Check environment variable first (Volumio plugin integration)
if (process.env.SLEEP_AFTER) {
	try {
		var sleep_seconds = parseInt(process.env.SLEEP_AFTER);
		if (!isNaN(sleep_seconds) && sleep_seconds >= 0) {
			TIME_BEFORE_DEEPSLEEP = sleep_seconds * 1000;
			console.log("[Config] Using SLEEP_AFTER from environment:", sleep_seconds, "seconds");
		}
	} catch(e) {
		console.log("[Config] Invalid SLEEP_AFTER environment variable, using default");
	}
}

// Try to read config file (for standalone testing or moOde compatibility)
fs.readFile("config.json",(err,data)=>{
	if(err) {
		if (!process.env.SLEEP_AFTER) {
			console.log("[Config] Cannot read config file. Using default settings.");
		}
	}
	else{
		try { 
			data = JSON.parse( data.toString() );
			// Only use config file if environment variable not set
			if (!process.env.SLEEP_AFTER && data.sleep_after && data.sleep_after.value) {
				TIME_BEFORE_DEEPSLEEP = (data.sleep_after.value * 1000) || TIME_BEFORE_DEEPSLEEP;
				console.log("[Config] Using sleep_after from config.json:", data.sleep_after.value, "seconds");
			}
		
		} catch(e){
			if (!process.env.SLEEP_AFTER) {
				console.log("[Config] Cannot parse config file. Using default settings.");
			}
		}
	}
	
	console.log("[Config] Final SLEEP_AFTER value:", TIME_BEFORE_DEEPSLEEP / 1000, "seconds");
	streamer.watchIdleState(TIME_BEFORE_DEEPSLEEP);
	bufwrite_interval = setInterval(updateFB, UPDATE_INTERVAL)

	streamer.on("iddleStart", function(){
		clearInterval(bufwrite_interval);
		buff = Buffer.alloc(320*240*2);
		buff.fill(0x00);
    busy = true;
    streamFile.cork();
		write( buff );
    streamFile.uncork();
    busy = false;
    
	});
	streamer.on("iddleStop", function(){
		clearInterval(bufwrite_interval);
		bufwrite_interval = setInterval(updateFB, UPDATE_INTERVAL)
	});

});







