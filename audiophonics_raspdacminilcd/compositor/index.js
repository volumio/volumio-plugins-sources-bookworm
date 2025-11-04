/*
	RaspDacMini LCD affichage écran.
	Version : 2.1.0
	Auteur : Olivier Schwach

*/

// Vérifier qu'on est bien dans une distrib connue.
const distro = process.argv[2],
supported_distributions = ["moode", "volumio"];
if(!distro || !supported_distributions.includes(distro) ){
	console.warn("Unknown target distribution : ",distro, "\nHere are the supported distributions : ", supported_distributions.join() );
	process.exit();
}

// Fichier qui doit recevoir le stream contenant l'image rendue de l'écran
const targetBuffer = process.argv[3] || "/dev/fb1";


// On écoute les données de lecture correspondantes à la distro actuelle
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

// On s'assure d'utiliser le module d'extension natif compilé pour l'architecture actuelle 

const { Image, createCanvas, loadImage, DOMMatrix, ImageData  } = require('canvas');

// Canvas principal (ce qui est dessus = ce qui est affiché à l'écran)
const canvas = createCanvas(320, 240 );
const ctx = canvas.getContext("2d" );	

// Canvas abstrait (la scène dans toute sa verticalité en pleine hauteur et qu'on fait défiler verticalement dans le canvas principal)
const scenecanvas = createCanvas(320, 455 );
const scene_ctx = scenecanvas.getContext("2d" );

// second canvas pour stocker l'image de la jaquette + le filtre flou (évite de recalculer le blur à chaque cycle)
const StackBlur = require('stackblur-canvas'); 
const covercanvas = createCanvas(320, 240);
const coverctx = covercanvas.getContext("2d" );

const { panicMeter } = require('./utils/panicmeter.js');
const panicmeter = new panicMeter();	// petit utilitaire surveiller les colisions en écriture (quand on tente d'écrire une frame alors que la précédente est encore en transfert)


// extension native pour convertir l'image du compositeur dans le format attendu par l'écran ili9341 (tourne l'écran aussi)
const colorConvert = require('./utils/rgb565.node');

// Nombre de frames avant que le texte ne commence à défiler (après un changement de piste) 
const base_refresh_track = 80;

const SCROLLTIME = 1600; // in ms


// Intervalle entre deux cycles de rendu / écriture
const UPDATE_INTERVAL = 20; // in ms

// petit utilitaire pour que le défilement vertical de l'écran ait un effet ease-in ease-out  
const { scrollAnimation  } = require('./utils/scroll_animation.js');
const scroll_animation = new scrollAnimation();
scroll_animation.plotScrollEase(SCROLLTIME / UPDATE_INTERVAL, 0, -215, 0.8);


// Etats variables
var main_text_width = 0;				// la largeur en px du bloc texte défilant
var should_scroll = false;				// est-ce que le texte défile
var main_text = "";						// la chaine de caractère du texte défilant
var cachedRasterizedMainText = null;	// canvas contenant une représentation du texte défilant doublé séparé par un tiret
var textScrollerX = 0;					// l'état actuel du défilement du texte
var refresh_track = 0;					// combien de frame faut-il encore attendre avant de commencer le défilement
var cover = {							// la couverture actuelle & ses métadonnées
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
var mainMatrix =  new DOMMatrix([1,0,0,1,0,0]);	// matrice globale du canvas principale (sert au défilement vertical)
var busy = false;								// indique si le stream est libre pour écrire des données
var last_ip = "";								// dernière ip connue
var dacInput = "";								// entrée actuelle du DAC Audiphonics ES9038Q2M
var dacFilter = "?";							// filtre actuel du DAC Audiphonics ES9038Q2M

// toutes les actions récurentes
var bufwrite_interval = null;
var getfilter_interval = null;
var getinput_interval = null;
var getip_interval = null;
var getclock_interval = null;



// valeurs par défaut qu'on peut surcharger en mettant un fichier de configuration dans le même dossier que ce fichier
var TIME_BEFORE_DEEPSLEEP = 900000; // in ms


// utilitaire pour rajouter des zéros devant à une chaine de caractères
function leadingZero(a,b){
	if(!a){
		let r = "";
		while (b--) r+="0"
		return r;
	}
	return([1e15]+a).slice(-b)
}

// Methodes de dessin
function updateCover(img,src){
	
	// si la cover précédente est longue à charger, il est possible que ce bout de code s'exécute alors que la piste a déjà changé, on ne met pas à jour si c'est le cas 
	if(src && src !== cover.src) return;
	
	let vratio = canvas.height / img.height, 
	canvasBoxData = [0, 0 ,canvas.width, canvas.height]; // éviter de tout réecrire à chaque fois. 
	
	cover.width = img.width * vratio;
	cover.height = canvas.height;
	cover.x = ( canvas.width - cover.width )/2;
	cover.y = ( canvas.height - cover.height )/2;
	coverctx.fillStyle="black";
	coverctx.fillRect(0,0,320,240);
	coverctx.drawImage(img,...canvasBoxData); // On dessine l'image étirée dans toute la largeur du canvas secondaire
	let blur_imgdata = coverctx.getImageData(...canvasBoxData);	// On capture l'image étirée
	blur_imgdata = StackBlur.imageDataRGBA(blur_imgdata, ...canvasBoxData , 50); // On floute l'image étirée
	coverctx.putImageData(blur_imgdata, 0, 0 );	// On réinjecte l'image étirée floutée dans le canvas secondaire
	coverctx.drawImage(img, cover.x,cover.y, cover.width, cover.height);	// On dessine l'image de base (non-floutée) au centre par dessus
	cover.imageData = coverctx.getImageData(...canvasBoxData); // On capture l'ensemble 
	cover.need_redraw = true
}

// à utiliser pour fournir son propre objet image indépendant de ce que le streamer trouve dans son implémentation native
function directUpdateCover(imageObject){
	cover.imageData = new ImageData(320,240);
	cover.src = null;
	if(!imageObject) return;
	let canvasImage =  new Image();
	if( imageObject && imageObject.data ) canvasImage.src = imageObject.data;
	updateCover( canvasImage, false );
}

// widget volume
function updateVolumeIcon(ctx, x,y,w,h, level ){
	let zone = [x-2,y-4,w+6,h+6]
	ctx.clearRect(...zone);	// Valeurs déterminées par tatonnage. Ce serait pénible de devoir changer la taille du widget volume
	
	
	ctx.strokeStyle = "white";
	ctx.fillStyle = "white";

	let y_grid = h/4,
		x_grid = w/20,
		px = (n)=>{ return x + x_grid*n },
		py = (n)=>{ return y + y_grid*n }
	
	// logo du Haut-parleur
	
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
	// on dessine des petites ondes sonores en fonction du volume (interface sympa) 
	
	ctx.lineWidth = 2;
	
	if( !parseInt(level)  ){ // pas de volume : petite croix
		ctx.moveTo( px(12) 	, py(0.5) );
		ctx.lineTo( px(19) 	, py(3.5) );
		ctx.moveTo( px(12) 	, py(3.5) );
		ctx.lineTo( px(19) 	, py(0.5) );
		ctx.stroke();
		return;
	}
	
	ctx.beginPath();	// volume bas : petite onde	
	ctx.moveTo( px(10) 	, py(3) );
	ctx.bezierCurveTo(	
		px(13)	, py(2.5), 
		px(13)	, py(1.5),
		px(10)	, py(1)
	);
	if( level > 33  ){ 	// moyen volume : 2eme petite onde
		ctx.moveTo( px(14) 	, py(3.5) );
		ctx.bezierCurveTo(	
			px(17)	, py(2.5), 
			px(17)	, py(1.5),
			px(14)	, py(0.5)
		);
	}
	if( level > 66  ){ 	// volume élevé : 3eme petite onde
		ctx.moveTo( px(19) 	, py(4) );
		ctx.bezierCurveTo(	
			px(20)	, py(2.5), 
			px(20)	, py(1.5),
			px(19)	, py(0)
		);
	}
	ctx.stroke();
	
}

// widget play / pause / stop
function updateStateIcon(ctx, x,y,w,h, state ){
	ctx.clearRect(x,y,w,h);
	ctx.fillStyle = "white";
	ctx.strokeStyle = "white";
	
	if(state === "play"){
		// play : un triangle
		ctx.beginPath();
		ctx.moveTo(x,y);
		ctx.lineTo(x,y+h);
		ctx.lineTo(x+w,(y+h)/2);
		ctx.closePath();
		ctx.fill();
		return;
	}	
	if(state === "pause"){
		// pause : deux rectangles
		ctx.clearRect(x,y,w,h);
		ctx.fillRect(x,y,w/3,h);
		ctx.fillRect(x,y,w/3,h);
		ctx.fillRect(x+w/1.5,y,w/3,h);
		return;
	}
		// default : stop ( carré )
	ctx.fillRect(x,y,w,h);
	
}

// fn utilitaire pour écrire une ligne sur la page 2
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

// tous les évenements du streamer
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
streamer.on("line0", (data)=>{ updateMetaDataText(data, 7, 270, 20) } );
streamer.on("line1", (data)=>{ updateMetaDataText(data, 7, 295, 20) } );
streamer.on("line2", (data)=>{ updateMetaDataText(data, 7, 320, 20) } );
streamer.on("line3", (data)=>{ updateMetaDataText(data, 7, 345, 20) } );
streamer.on("line4", (data)=>{ updateMetaDataText(data, 7, 370, 20) } );
streamer.on("line5", (data)=>{ updateMetaDataText(data, 7, 395, 20) } );
streamer.on("line6", (data)=>{ updateMetaDataText(data, 7, 420, 20) } );
streamer.on("coverChange", (data)=>{
	if(data === cover.src) return; // ne pas recharger l'image actuelle
	cover.imageData = new ImageData(320,240);
	cover.src = data;
	loadImage( data ).then((img)=>{updateCover(img,data)})
	.catch(	err => { console.warn('Erreur lors du chargement de la couverture.', err)	} ); // il faudrait un fallback cover ici
});
streamer.on("directCoverChange", directUpdateCover);
streamer.on("trackChange", (data)=>{
	should_scroll = false;
	main_text = streamer.formatedMainString;
	ctx.font = "25px arial";
	main_text_width = ctx.measureText( main_text + " - " ).width;
	
	//  est-ce que le texte est assez court pour tenir dans toute la largeur de l'écran ? 
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
		main_text = main_text + " - " + main_text + " - "; // On double le texte pour que le début du texte sorte déjà du bord droit alors que la fin sort encore du bord gauche
	
		scene_ctx.clearRect(0, 210 ,320, 30); // au cas où il reste un morceau de texte statique sur le canvas scenecanvas
			
		// On fill le canvas prévu pour le text avec un raster corespondant au texte doublé
	
		let double_text_width = ctx.measureText( main_text ).width;
		delete cachedRasterizedMainText; // vraiment utile ?
		cachedRasterizedMainText = createCanvas(double_text_width, 30);
		cached_ctx = cachedRasterizedMainText.getContext("2d" );
		
		// petit arrière-plan noir semi-transparent pour la lisibilité
		cached_ctx.fillStyle = "rgba(0,0,0,0.7)";
		cached_ctx.fillRect(0, 0 ,double_text_width, 30);
		
		// on écrit le texte
		cached_ctx.fillStyle = "white";
		cached_ctx.font = "25px arial";
		cached_ctx.fillText( main_text, 0, 25 );
		
		// on remet le compteur du scroller à zéro
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
    cp.exec(`apessq2m get_filter`,handle);
    function handle(rerr,data){
        if(rerr){ 
            return;
        }
        let _dacFilter = data.replace("\n","").replace("minimum","min");
		if(dacFilter === _dacFilter) return;
		dacFilter = _dacFilter;
		updateMetaDataText("DAC : " + dacFilter, 7, 445, 20);
    }
}
get_filter();
getfilter_interval = setInterval(get_filter, 2000);

function get_input(){
    cp.exec(`apessq2m get_input`,handle);
    function handle(rerr,_dacInput){
      _dacInput = _dacInput.trim();
      if(rerr || dacInput === _dacInput){return;}
      dacInput = _dacInput;
      handleSpdif();
    }
}
get_input();
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


function soft_exit_sleep(){
	try{streamer.resetIdleTimeout()}
	catch(err){}	
}
// Serveur HTTP pour répondre aux commandes externes 
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
		
		case("poweroff"): 
			soft_exit_sleep();
			res.end();
			printShutDownAndDie();
		break;
	}
}	


// Composition finale de l'image
function Vdraw(){
  
	//console.time("draw");
	let verticalOffset = 0;
	if(dacInput !== "SPDIF"){ // Si SPDIF actif, on affiche un texte fixe au milieu donc on évite de tout redessiner 
  
		verticalOffset = scroll_animation.cycle();
		ctx.setTransform(mainMatrix);
		
		let matrix_with_offset = new DOMMatrix([1,0,0,1,0,verticalOffset]);
	
		// tout à l'arrière plan : la coverimage
		if(cover.imageData){
			if(cover.need_redraw || scroll_animation.hasPlayedThisCycle){ // cas où il faut (re)dessiner toute la cover
				// ctx.clearRect(0,0,320, 18);
				ctx.drawImage(covercanvas,0,0); 
				scene.need_redraw = true;
				cover.need_redraw = false;
			}
			else if(should_scroll){ // il faut (re)dessiner la partie de la cover qui est sous le texte défilant

				 let overflow = (210 + verticalOffset)
				 if(overflow > 0 ) overflow = 0;
				 let txtzoneoffset = [0,210 + verticalOffset - overflow,320,30 +overflow]
				 ctx.drawImage(covercanvas, ...txtzoneoffset, ...txtzoneoffset);
			}
		}
		ctx.setTransform( matrix_with_offset );
		
		// titre album scroll
		if( should_scroll ){ 
			if(textScrollerX + main_text_width  <= 0 ) textScrollerX = 0;
		  
      let relative_zone = [0, 210, 320 , 30];
			// Si le texte doit défiler, on l'a dessiné préalablement dans un canvas de largeur variable 
			// et c'est ce canvas en question qu'on fait défiler.
			ctx.drawImage( cachedRasterizedMainText, -textScrollerX, 0, 320, 30, 0, 210, 320, 30  );
      
			
			if( refresh_track ) refresh_track--; // ne pas updater le curseur de scroll avant d'avoir écoulé les frames statiques (juste après un changement de morceau)
			else{
        safeAddZone2Redraw(relative_zone, display.redrawzones);
        textScrollerX--;
      }
		}

		

		
		if(scene.need_redraw || scroll_animation.hasPlayedThisCycle ){ // redessiner toute la scene
			// Barre du haut de l'écran	s
			// petit arrière-plan noir semi-transparent pour la lisibilité
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
		else if(scene.redrawzones.length){  // redessiner parties de la scene
      
			ctx.setTransform(mainMatrix);
			ctx.fillStyle = "rgba(0,0,0,0.7)";					
	
			
			const zones = scene.redrawzones.filter( z=>z[1]+z[3] + verticalOffset > 0 && z[1] + verticalOffset < 240  ); // on ne maj que ce qui est visible
			const relative_zones = zones.map(z=>z.map(v=>v)); // deepclone
			relative_zones.forEach(z=>{
				z[1]+=verticalOffset;
			});
			// zone = position dans le canvas scene
			// relative_zone = position dans le canvas principal
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
	else if(scene.need_redraw || scene.redrawzones.length){ // vue spdif
      // Barre du haut de l'écran	
      // petit arrière-plan noir semi-transparent pour la lisibilité
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

// implémentation dirtyRect basique (maintenant que fbcp-ili9341 n'est plus disponible, le driver écran est beaucoup moins performant en écriture)
function safeAddZone2Redraw(zone, list){
  zone = zone.map(x => x<0?0:x); // on ne va jamais update une valeur négative ( todo : ça serait pas mal de check aussi les overflows)
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







