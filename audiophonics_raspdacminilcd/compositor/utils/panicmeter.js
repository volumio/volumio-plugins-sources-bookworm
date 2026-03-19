function panicMeter(){
	this.error_count = 0;
	this.error_release = 500;
	this.error_threshold = 5;
}

panicMeter.prototype.registerError = function(){
	if (this.error_count++ >= this.error_threshold ) process.exit(1);
	console.warn(`Panic ${this.error_count} / ${this.error_threshold}`)
	const dumpError =()=>{this.error_count--;}
	setTimeout( dumpError, this.error_release );
}	


exports.panicMeter = panicMeter;