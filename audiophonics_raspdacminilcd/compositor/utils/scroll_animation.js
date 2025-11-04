/*
scrollAnimation version 1

Auteur Olivier Schwach
Version 0.4

Implémentation basique de la fonction logistique pour faire des transitions "ease-in ease-out" 
Conçu pour faire des animations agréables avec un canvas js 



	USAGE : 
	
		const scroll_animation = new scrollAnimation();
		scroll_animation.plotScrollEase(80, 0, -215, 0.8);
		
		//animation de scroll vertical sur 215 px
		let cycles = 80;
		while(cycles--){
			let verticalOffset = scroll_animation.cycle();
			console.log ( new DOMMatrix([1,0,0,1,0,verticalOffset]) );
		}
		
		
		
+ d'info sur fonction logistique https://en.wikipedia.org/wiki/Logistic_function 		
*/



function scrollAnimation(){
	this.frames = [0];
	this.isOver = false;
	this.currentStep = 0;
	this.direction = 1;
	this.isPlaying = false;
	this.hasPlayedThisCycle = false;
	this.lastFrame = this.frames[0];
}

scrollAnimation.prototype.cycle = function(){
	this.hasPlayedThisCycle = false;
	if(this.isOver || !this.isPlaying ) return this.lastFrame;
	
	let targetIndex = this.currentStep + this.direction;
	this.hasPlayedThisCycle = true;
	if(targetIndex < 0 || targetIndex >= this.frames.length -1 ){
		this.isOver = true;
		this.isPlaying = false;
		return this.lastFrame;
	}
	this.currentStep = targetIndex;
	this.lastFrame = this.frames[targetIndex];
	return this.frames[targetIndex];
}

scrollAnimation.prototype.play = function(){
	this.isOver = false;
	this.isPlaying = true;
}

scrollAnimation.prototype.toggle = function(){
	if(this.isOver){
		this.direction *= -1;
		this.play();
	}
	else if(this.isPlaying){ // permet un "animation cancelling" rudimentaire (ne recalcule pas le scrollEase à partir de la position actuelle, mais joue le cycle déjà écoulé en sens inverse)
		this.direction *= -1;	
	}
	else this.play();
}

scrollAnimation.prototype.reset = function(){
	this.isOver = false;
	this.isPlaying = false;
	this.currentStep = 0;
	this.direction = 1;
	this.lastFrame = this.frames[0];
}

scrollAnimation.prototype.plotScrollEase = function( frames, start,  end , q   ){
	this.frames = [], 
		x = start , 
		max = end-1, 
		midpoint = (end - start)    /2
		K = 1 / midpoint * q *10,
		step = (end - start) / frames,
		i = 0;
	while(i  < frames-1 ){
        let currentX = start + i * step;
		this.frames.push( 
           parseInt( 1/ ( 1+ Math.exp(  -K * (currentX -midpoint)  ) ) * end ) // parseInt = un peu moins de travail pour le rendu matriciel
        );
		i++;
	}
	this.frames.push(end);
}


exports.scrollAnimation = scrollAnimation;