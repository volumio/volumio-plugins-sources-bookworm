/*
 * DAC Control for Audiophonics I-Sabre Q2M
 * Provides ALSA mixer control for input switching and filter cycling
 * 
 * Replaces external apessq2m shell script with native Node.js implementation
 */

const { exec } = require('child_process');

// DAC identification
const DAC_NAME = 'I-Sabre Q2M DAC';

// ALSA mixer control names
const CONTROL_INPUT = 'I2S/SPDIF Select';
const CONTROL_FILTER = 'FIR Filter Type';

// Cache for card ID (discovered once at startup)
let cardId = null;

/**
 * Find the ALSA card ID for the I-Sabre Q2M DAC
 * @returns {Promise<string|null>} Card ID or null if not found
 */
function findCardId() {
    return new Promise((resolve) => {
        exec('aplay -l', (err, stdout) => {
            if (err) {
                resolve(null);
                return;
            }
            
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes(DAC_NAME)) {
                    const match = line.match(/^card (\d+)/);
                    if (match) {
                        resolve(match[1]);
                        return;
                    }
                }
            }
            resolve(null);
        });
    });
}

/**
 * Initialize DAC control - must be called before other functions
 * @returns {Promise<boolean>} True if DAC found
 */
async function init() {
    cardId = await findCardId();
    if (!cardId) {
        console.warn('DAC Control: I-Sabre Q2M DAC not found');
        return false;
    }
    console.log(`DAC Control: Found I-Sabre Q2M DAC on card ${cardId}`);
    return true;
}

/**
 * Get current value of an ALSA mixer control
 * @param {string} control - Control name
 * @returns {Promise<string|null>} Current value or null on error
 */
function getControlValue(control) {
    return new Promise((resolve) => {
        if (!cardId) {
            resolve(null);
            return;
        }
        
        exec(`amixer sget -c ${cardId} '${control}'`, (err, stdout) => {
            if (err) {
                resolve(null);
                return;
            }
            
            // Parse "Item0: 'value'" format
            const match = stdout.match(/Item0:\s*'([^']+)'/);
            if (match) {
                resolve(match[1]);
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Set value of an ALSA mixer control
 * @param {string} control - Control name
 * @param {string} value - New value
 * @returns {Promise<boolean>} True on success
 */
function setControlValue(control, value) {
    return new Promise((resolve) => {
        if (!cardId) {
            resolve(false);
            return;
        }
        
        exec(`amixer sset -c ${cardId} '${control}' '${value}'`, (err) => {
            resolve(!err);
        });
    });
}

/**
 * Get available items for a mixer control
 * @param {string} control - Control name
 * @returns {Promise<string[]>} Array of available values
 */
function getControlItems(control) {
    return new Promise((resolve) => {
        if (!cardId) {
            resolve([]);
            return;
        }
        
        exec(`amixer sget -c ${cardId} '${control}'`, (err, stdout) => {
            if (err) {
                resolve([]);
                return;
            }
            
            // Parse "Items: 'item1' 'item2' 'item3'" format
            const match = stdout.match(/Items:\s*(.+)/);
            if (match) {
                const items = match[1].match(/'([^']+)'/g);
                if (items) {
                    resolve(items.map(item => item.replace(/'/g, '')));
                    return;
                }
            }
            resolve([]);
        });
    });
}

/**
 * Get current DAC input (I2S or SPDIF)
 * @returns {Promise<string|null>}
 */
function getInput() {
    return getControlValue(CONTROL_INPUT);
}

/**
 * Toggle DAC input between I2S and SPDIF
 * @returns {Promise<string|null>} New input value or null on error
 */
async function toggleInput() {
    const current = await getInput();
    if (!current) return null;
    
    const newValue = (current === 'I2S') ? 'SPDIF' : 'I2S';
    const success = await setControlValue(CONTROL_INPUT, newValue);
    
    return success ? newValue : null;
}

/**
 * Get current DAC filter
 * @returns {Promise<string|null>}
 */
function getFilter() {
    return getControlValue(CONTROL_FILTER);
}

/**
 * Cycle to next DAC filter
 * @returns {Promise<string|null>} New filter value or null on error
 */
async function nextFilter() {
    const [current, items] = await Promise.all([
        getFilter(),
        getControlItems(CONTROL_FILTER)
    ]);
    
    if (!current || items.length === 0) return null;
    
    const currentIndex = items.indexOf(current);
    if (currentIndex === -1) return null;
    
    const nextIndex = (currentIndex + 1) % items.length;
    const newValue = items[nextIndex];
    
    const success = await setControlValue(CONTROL_FILTER, newValue);
    return success ? newValue : null;
}

/**
 * Check if DAC is available
 * @returns {boolean}
 */
function isAvailable() {
    return cardId !== null;
}

module.exports = {
    init,
    isAvailable,
    getInput,
    toggleInput,
    getFilter,
    nextFilter
};
