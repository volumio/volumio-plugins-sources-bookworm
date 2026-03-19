const io = require('socket.io-client' );
const EventEmitter = require('events').EventEmitter;
const inherits = require('util').inherits;
const cp = require('child_process');

function volumio_listener(host,refreshrate_ms){
    this.host = host || 'http://localhost:3000';
    this.refreshrate_ms = refreshrate_ms || 1000;
    this.ready = false;
    this.waiting = false;
    this.state = "stop";
    this.formatedMainString = "";
    this.data = {};
	this.watchingIdle = false;
	this.firstRequestConsumed = false;
	this.listen();
	this.iddle = false;
	this._iddleTimeout = null;
	this.iddletime = 900;
	
}

inherits(volumio_listener, EventEmitter);
exports.volumio_listener = volumio_listener;


/*
	Compare data vs this.data and execute processChange for each key with a new value.
*/
volumio_listener.prototype.compareData = function(data){
	let changes = [];
	for(d in data){
		let previous_data = this.data[d];
		if(this.data[d] === data[d]  ) continue; 			// Do nothing if no change
		this.data[d] = data[d];  				 			// Otherwise update known streamer state
		changes.push([d , this.data[d]]);	// Mark this change to be propagated
	}
	for(change of changes){
		this.processChanges(...change);			 			// Propagate each change
	}
}

// Resolve each state change
volumio_listener.prototype.processChanges = function(key,data){ 
	
	if( ["title", "artist", "album"].includes(key) ){			// Track change
		this.formatMainString();								
		this.emit( "trackChange", this.formatedMainString );	
		if(this.state === "play") this.resetIdleTimeout(); 		// Track can change outside playback (web radios). Don't exit sleep in that case.
	}
	else if(key === "status"){									// State change (play/pause/stop)
		this.state = data;
		this.resetIdleTimeout();
		this.emit( "stateChange", data );
	}
	else if( ["duration", "seek"].includes(key)){				// Timeline progress
		this.resetIdleTimeout();
		this.seekFormat();
		this.emit( "seekChange", this.formatedSeek );
	}
	else if(key === "bitrate"){
		this.emit( "bitRateChange", data );
		this.emit( "line2", "Bit Rate : " + data );
	}
	else if(key === "volume"){									// Volume change
		this.resetIdleTimeout();
		this.emit( "volumeChange", data );
	}
	else if(key === "mute"){									// Mute state change
		this.resetIdleTimeout();
		this.emit( "muteChange", data );
	}
	else if(key === "samplerate"){
		this.emit( "sampleRateChange", data );
		this.emit( "line0", "Sample Rate : " + data );
	}
	else if(key === "bitdepth"){
		this.emit( "sampleDepthChange", data );
		this.emit( "line1", "Sample Depth : " + data );
	}
	else if(key === "albumart"){								// Cover art change
			

		if(data === "/albumart"){
		/*
			"/albumart" is the default address when no cover is available.
			It also appears during track change, which often causes
			an unpleasant effect on the LCD where the image changes rapidly.
			
			This "if" block limits this phenomenon
		*/
			let waitAndEmit, delayedEmit, cancelDelayedEmit;
			
			delayedEmit = ()=>{this.emit( "coverChange",this.host+data );}
			waitAndEmit = setTimeout(delayedEmit, 5000);		// Wait 5 seconds before propagating "/albumart"
			cancelDelayedEmit = ()=>{clearTimeout(waitAndEmit);}
			this.once("coverChange", cancelDelayedEmit);		// Cancel propagation if next track finished loading before timeout
			return;
		}
		
		if ( /https?:\/\//.test(data) ){		// Remote address
			this.emit( "coverChange",data );
			return;
		}
		if(data[0] !== "/") data = "/"+data;	// Local address
		this.emit( "coverChange",this.host+data );
	}
	else if(key === "uri"){
		this.emit( "file", data );
	}
	else if(key === "channels"){
		this.emit( "channelsChange", data );
		this.emit( "line3", "Channels : " + data );
	}
	else if(key === "trackType"){
		
		let pdata = data.replace(/audio/gi, "");
		this.emit( "encodingChange", pdata );
		this.emit( "line4", "Track Type : " + pdata );
	}
	else if(key === "position"){
		let pdata = parseInt(data)+1;
		this.emit( "songIdChange", pdata );
		let playlistlength = 1;
		if(this.data && this.data.playlistlength) playlistlength = this.data.playlistlength;
		this.emit( "line5", "Playlist : " + pdata + " / " + playlistlength );
	}
	else if(["repeat", "repeatSingle"].includes(key)){
		this.emit( "repeatChange", data );
	}
	else if(key === "random"){
		this.emit( "randomChange", data );
	}
};

volumio_listener.prototype.listen = function(){
	console.log("[volumiolistener] Connecting to:", this.host);
	this._socket = io.connect(this.host);
	
	this._socket.on("connect", () => {
		console.log("[volumiolistener] Connected to Volumio");
	});
	
	this._socket.on("error", (error) => {
		console.error("[volumiolistener] Connection error:", error);
	});
	
	this.api_caller = setInterval( ()=>{
		if(this.waiting || this.state !== "play") return;
		this.waiting = true;
		this._socket.emit("getState");
		this._socket.emit("getQueue");
	}, this.refreshrate_ms );

	this._socket.emit("getState");
	
	this._socket.on("pushState", (data)=>{ // Streamer state changes
		if(!this.firstRequestConsumed){
			this.firstRequestConsumed = true;
			this._socket.emit("getState");
			return;
		}
		this.compareData(data);
		this.waiting = false;
	})
	this._socket.emit("getQueue");
	this._socket.on("pushQueue", (resdata)=> {	// Playlist changes
		if(resdata && resdata[0]){
			let additionnalTrackData = resdata[0], filteredData = {};
			filteredData.playlistlength = resdata.length;
			this.compareData(filteredData);}
		}
	);
}

volumio_listener.prototype.seekFormat = function (){
	
	let ratiobar, 
		seek_string, 
		seek = this.data.seek,
		duration = this.data.duration;
		
		
	try{
		if(!duration) ratiobar = 0;
		else ratiobar =  seek / (duration * 1000) ;
	}
	catch(e){
		ratiobar = 0;
	}	
	try{
		duration = new Date(duration * 1000).toISOString().substr(14, 5);
	}
	catch(e){
		duration = "00:00";
	}
	try{
		seek = new Date(seek).toISOString().substr(14, 5);
	}
	catch(e){
		seek = "";
	}
	seek_string = seek + " / "+ duration;
	this.formatedSeek = {seek_string:seek_string,ratiobar:ratiobar};
	return(this.formatedSeek);
}

volumio_listener.prototype.formatMainString = function (){
	this.formatedMainString = this.data.title + (this.data.artist?" - " + this.data.artist:"") + (this.data.album?" - " + this.data.album:"");
}

// Consider streamer inactive (sleeping) after a certain period of inactivity
volumio_listener.prototype.watchIdleState = function(iddletime){
	this.watchingIdle = true;
	this.iddletime = iddletime;
	clearTimeout(this._iddleTimeout);
	this._iddleTimeout = setTimeout( ()=>{
		if(! this.watchingIdle ) return;
		this.iddle = true;
		this.emit("iddleStart")
	}, this.iddletime );
}

volumio_listener.prototype.resetIdleTimeout = function(){
	if(! this.watchingIdle ) return;
	if( this.iddle  ) this.emit("iddleStop");
	this.iddle = false;
	this._iddleTimeout.refresh();
}
volumio_listener.prototype.clearIdleTimeout = function(){
	this.watchingIdle = false;
	if( this.iddle  ) this.emit("iddleStop");
	this.iddle = false;
	clearTimeout(this._iddleTimeout);
}
