'use strict'; 
const fs = require('fs'); 
const path = require('path'); 

const CONFIG_DIR = path.join(__dirname, '..', 'config'); 
const TOKEN_FILE = path.join(CONFIG_DIR, 'spotify.json'); 

class TokenStore {
    constructor() { 
      this.ensureConfigDir();
    }
    ensureConfigDir() { if (!fs.existsSync(CONFIG_DIR)) { 
            fs.mkdirSync(CONFIG_DIR, {
                recursive: true, mode: 0o700
            });
        }
        // Zorg ervoor dat de directory ook bij een bestaande 
        // installatie de juiste permissies heeft.
        fs.chmodSync(CONFIG_DIR, 0o700);
    }
    load() { if (!fs.existsSync(TOKEN_FILE)) { return null;
        }
        const data = fs.readFileSync( TOKEN_FILE, 'utf8' ); 

       return JSON.parse(data);
    }
    save(data) { const tempFile = TOKEN_FILE + '.tmp'; 
        fs.writeFileSync(
            tempFile, JSON.stringify(data, null, 2), { encoding: 
                'utf8', mode: 0o600
            }
        ); fs.chmodSync(tempFile, 0o600); fs.renameSync( tempFile, 
            TOKEN_FILE
        ); fs.chmodSync(TOKEN_FILE, 0o600);
    }
    exists() { return fs.existsSync(TOKEN_FILE);
    }
}
module.exports = TokenStore;