/*
	I use this bit of code because sometimes the resolved URL for UPNP image is wrong 
	This function allows a moodelistener object to read the metadata on a file exposed by a UPNP url to get the cover view without using moOde built-in behaviours.
*/


const {makeTokenizer} = require('@tokenizer/http');

async function getCoverFromFileMeta(url, callback){
  
   const mm = await import('music-metadata');
  
	let result = null;
	try{
	  const httpTokenizer = await makeTokenizer(url);
	  const metadata = await mm.parseFromTokenizer(httpTokenizer);
	  result = metadata.common.picture;
	  return result;
	}
	catch(e){
		return(null);
	}
}

function postHandle(r){
	if(r && r.length) return r[0];
	return null;
}

function _wrapper(url, callback){
	getCoverFromFileMeta(url)
	.then( r =>{ 
		callback( postHandle(r));
	} )
	.catch( callback(null) );
}

module.exports.getCoverFromFileMeta = _wrapper;