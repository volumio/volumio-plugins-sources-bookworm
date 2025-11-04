/*
Module Moode listener 
By Olivier SCHWACH
version 2.2

** USAGE

const { moode_listener } = require("./moodelistener.js");
var moode = new moode_listener(host,refreshrate);
moode.on("volumeChange", function(data){ console.log(data) });


** Defaults parameters if not specified : 
    @ host (string) : "127.0.0.1"
    @ refreshrate_ms (int) : 1000
	
	
	
	
** 	TODO 
	- Detect spotify as a source 
	- Use sqlite instead of a rest handshake to get a token ? Nah it's not WAL so it crashes if trying to read volume while user changes volume
  
	
*/

const http = require('http');
const EventEmitter = require('events').EventEmitter;
const inherits = require('util').inherits;
const cp = require('child_process');
const { getCoverFromFileMeta } = require('./upnp_albumart_fallback.js');



function moode_listener(host,refreshrate_ms){
    this.cookie = "";
    this.host = host || '127.0.0.1';
    this.refreshrate_ms = refreshrate_ms || 1000;
    this.auth(true);
    this.ready = false;
    this.waiting = false;
    this.state = "stop";
    this.formatedMainString = "";
    this.data = {};
    this.watchingIdle = false;
    this.iddle = false;
    this._iddleTimeout = null;
    this.iddletime = 900;
	
}

inherits(moode_listener, EventEmitter);
exports.moode_listener = moode_listener;

moode_listener.prototype.send_reqp = async function(path){
  
   const url = new URL(`http://${this.host}/${path}`);
   const headers = {
      "Connection": "keep-alive",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "DNT": "1"
    }
    
   if(this.cookie?.PHPSESSID) headers.Cookie = `PHPSESSID=${this.cookie?.PHPSESSID}`

   const response = await fetch(url, {
    method: 'GET',  headers 
   });
   
    let req_cookie;
    try{
      req_cookie = Object.fromEntries(
      response?.headers.get('set-cookie')
      ?.split(/;\s?/)
      ?.map(x=> x.split("="))
      );
    }
    catch(err){
     req_cookie = null;
    }
    if(req_cookie){
      console.log("got cookie");
      this.cookie = req_cookie;
    }
    
    return response.text();
    
} 


moode_listener.prototype.auth = async function(){
    await this.send_reqp("/");
    if(this.cookie){
      this.emit("ready");
      this.ready = true
      this.listen();
      console.log("Auth ok", this.cookie);
    }
    else {
      console.log("Auth failed, retrying in 5s");
      await this.sleep(5000);
      await this.auth();
    }
    
    
} 
 
moode_listener.prototype.getData = async function(){
  let raw;
  
  try{
    raw = await Promise.all([
      this.send_reqp("command/cfg-table.php?cmd=get_cfg_system"),
      this.send_reqp("engine-mpd.php")
    ]);

    const data_sys = JSON.parse(raw[0]);
    const data_mpd = JSON.parse(raw[1]);
    const data = {...data_sys, ...data_mpd};
    data.volume = parseInt(data.volknob);
    if(!!parseInt(data.volmute)) data.volume = 0;
    return data;
  }
  catch(e){
    console.warn("Error, cannot read data from moode", e,"data is :", raw,"...");
    return null;
  }
}

moode_listener.prototype.refreshData = async function(){
  
  
  const reqdata = await this.getData();
  this.compareData(reqdata);
  
}

moode_listener.prototype.compareData = function(data){
	
	let changes = [];
	for(d in data){
		if( this.data[d] === data[d]  ) continue;
		this.data[d] = data[d];
		changes.push([d , this.data[d]])
	}
	
	for(change of changes){
		this.processChanges(...change);
	}
}

moode_listener.prototype.getFallbackCoverFromMeta = function(){
	let handle = ()=>{
		getCoverFromFileMeta( this.data.file, 
			(imageObject)=>{
				if(!imageObject) return null;
				this.emit("directCoverChange",imageObject)
			}	
		);
	}
	// ne pas essayer de lire les metadonnées du fichier si son URL n'est pas encore exposée
	if(this.data.file){
		handle();
		return;
	}
	else{
		this.once("file", handle);
		return;
	}
}

moode_listener.prototype.processChanges = function(key,data){ 
	
	if( ["title", "artist", "album"].includes(key) ){
		this.formatMainString();
		this.emit( "trackChange", this.formatedMainString );
		if(this.state === "play") this.resetIdleTimeout(); // sinon les webradios sortent l'écran de veille 
	}
	else if(key === "state"){
		this.state = data;
		this.resetIdleTimeout();
		this.emit( "stateChange", data );
	}
	else if( ["song_percent", "time", "elapsed"].includes(key)){
		this.seekFormat();
		this.emit( "seekChange", this.formatedSeek );
	}
	else if(key === "bitrate"){
		this.emit( "bitRateChange", data );
		this.emit( "line2", "Bit Rate : " + data );
	}
	else if(key === "volume"){
		this.resetIdleTimeout();
		this.emit( "volumeChange", data );
	}
	else if(key === "audio_sample_rate"){
		this.emit( "sampleRateChange", data );
		this.emit( "line0", "Sample Rate : " + data );
	}
	else if(key === "audio_sample_depth"){
		this.emit( "sampleDepthChange", data );
		this.emit( "line1", "Sample Depth : " + data );
	}
	else if(key === "coverurl"){
		if(data === 'sudo: /var/www/util/upnp_albumart.py: command not found'){
			this.getFallbackCoverFromMeta();
			return;
		}
		
		if ( /http:\/\//.test(data) ){
			this.emit( "coverChange",data );
			return;
		}
		if(data[0] !== "/") data = "/"+data;
		this.emit( "coverChange","http://"+this.host+data  );
	}
	else if(key === "file"){
		this.emit( "file", data );
	}
	else if(key === "audio_channels"){
		this.emit( "channelsChange", data );
		this.emit( "line3", "Channels : " + data );
	}
	else if(key === "encoded"){
		let pdata = data.replace(/audio/gi, "");
		this.emit( "encodingChange", pdata );
		this.emit( "line4", "Track Type : " + pdata );
	}
	else if(key === "song"){
		let pdata = parseInt(data)+1;
		this.emit( "songIdChange", pdata );
		this.emit( "line5", "Playlist : " + pdata + " / " + this.data.playlistlength );
	}
	else if(key === "repeat"){
		this.emit( "repeatChange", data );
		this.emit( "line6", "Repeat : " + data );
	}
};

moode_listener.prototype.sleep = function(n){
  return new Promise((resolve,reject)=>{
    setTimeout(resolve,n);
  });
}



moode_listener.prototype.listen = function(){
  setInterval( async ()=>{
      if(this.waiting) return;
      this.waiting = true;
      await this.refreshData();
      this.waiting = false;
      // if(data) this.emit("data",data);
    
  },this.refreshrate_ms);
}

moode_listener.prototype.seekFormat = function (){
	
	let ratiobar, 
		seek_string, 
		seek = this.data.elapsed, 
		song_percent = this.data.song_percent,
		duration = this.data.duration;
	try{
		if(!duration) ratiobar = 0;
		else ratiobar = (song_percent/100);
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
		seek = new Date(seek * 1000).toISOString().substr(14, 5);
	}
	catch(e){
	
		seek = "";
	}
	seek_string = seek + " / "+ duration;
	
	this.formatedSeek = {seek_string:seek_string,ratiobar:ratiobar};
	
	return( this.formatedSeek );
}

moode_listener.prototype.formatMainString = function (){
	this.formatedMainString = this.data.title + (this.data.artist?" - " + this.data.artist:"") + (this.data.album?" - " + this.data.album:"");
}

moode_listener.prototype.watchIdleState = function(iddletime){
	this.watchingIdle = true;
	this.iddletime = iddletime;
	clearTimeout(this._iddleTimeout);
	this._iddleTimeout = setTimeout( ()=>{
		if(! this.watchingIdle ) return;
		this.iddle = true;
		this.emit("iddleStart")
	}, this.iddletime );
}

moode_listener.prototype.resetIdleTimeout = function(){
	if(! this.watchingIdle ) return;
	if( this.iddle  ) this.emit("iddleStop");
	this.iddle = false;
	this._iddleTimeout.refresh();
}
moode_listener.prototype.clearIdleTimeout = function(){
	this.watchingIdle = false;
	if( this.iddle  ) this.emit("iddleStop");
	this.iddle = false;
	clearTimeout(this._iddleTimeout);
}