'use strict';

const libQ = require('kew');
const NfcReader = require('./lib/nfc-reader');
const fs = require('fs');
const path = require('path');

const Player = require('./lib/player');
const { handleTagAction } = require('./lib/tag-handler');


module.exports = NfcMusic;

// =========================================================
// Constructor
// =========================================================
function NfcMusic(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;

    this.config = null;
    this.nfcReader = null;
    this.player = null;
    this.tags = {}; // persisted
    this.activeTag = null;
    this.activeEditTag = null;
    this.scannedTags = {}; //runtime (non-persisted)

    this.uiBusy = false; // prevent double UI refreshes
}

// =========================================================
// HELPERS (internal plugin functions)
// =========================================================


/*
 * LOAD TAGS
 * ---------------------------------------------------------
 * Laadt de tags.json file in het geheugen
 */
NfcMusic.prototype.getTagsDir = function () {
    // /data/configuration/system_hardware/nfc_music - blijft staan bij een
    // plugin-update of herinstallatie (de pluginmap zelf wordt dan vervangen).
    const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    return path.dirname(configFile);
};

NfcMusic.prototype.getTagsFile = function () {
    return path.join(this.getTagsDir(), 'tags.json');
};

/*
 * Eenmalige migratie: tags.json uit de oude locatie (pluginmap/config)
 * overzetten naar de configuratiemap.
 */
NfcMusic.prototype.migrateTagsFile = function () {
    const oldFile = path.join(__dirname, 'config', 'tags.json');
    const newFile = this.getTagsFile();

    try {
        if (!fs.existsSync(newFile) && fs.existsSync(oldFile)) {
            fs.mkdirSync(path.dirname(newFile), { recursive: true });
            fs.copyFileSync(oldFile, newFile);
            this.logger.info(`NFC Music: tags.json gemigreerd naar ${newFile}`);
        }
    } catch (e) {
        this.logger.error(`NFC Music: migratie tags.json mislukt: ${e}`);
    }
};

NfcMusic.prototype.loadTags = function () {

    const tagsFile = this.getTagsFile();

    if (!fs.existsSync(tagsFile)) {
        this.logger.info('NFC Music: nog geen tags.json, start met lege lijst');
        this.tags = {};
        return;
    }

    try {
        this.logger.info(`NFC Music: tags laden uit ${tagsFile}`);

        const raw = fs.readFileSync(tagsFile, 'utf8');
        this.tags = raw ? JSON.parse(raw) : {};

        this.logger.info(
            `NFC Music: ${Object.keys(this.tags).length} tag(s) geladen`
        );

    } catch (e) {
        this.logger.error(`tags.json read error: ${e}`);
        this.tags = {};
    }
};

/*
 * TAG STORAGE (atomic persist to disk)
 * ---------------------------------------------------------
 * Slaat de tags.json file op met de huidige tag configuratie
 */
NfcMusic.prototype.saveTags = function () {

    const dir = this.getTagsDir();
    const file = this.getTagsFile();
    const tmp = path.join(dir, 'tags.json.tmp');

    try {

        // safety check
        if (!this.tags || typeof this.tags !== 'object') {
            this.logger.error('Invalid tags structure, not saving');
            return;
        }

        fs.mkdirSync(dir, { recursive: true });

        // 1. serialize
        const json = JSON.stringify(this.tags, null, 2);

        // 2. write temp file
        fs.writeFileSync(tmp, json, 'utf8');

        // 3. backup (optional)
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, file + '.bak');
        }

        // 4. atomic replace
        fs.renameSync(tmp, file);

        this.logger.info('NFC Music: tags opgeslagen');

    } catch (e) {

        this.logger.error('tags.json write error: ' + e);

        // cleanup temp file als iets faalt
        try {
            if (fs.existsSync(tmp)) {
                fs.unlinkSync(tmp);
            }
        } catch (cleanupErr) {
            this.logger.warn('temp cleanup failed: ' + cleanupErr);
        }
    }
};

/*
 * Refresh UI
 * ---------------------------------------------------------
 * Ververst de UI-config en stuurt deze naar de frontend
 */
NfcMusic.prototype.refreshUI = function () {
    const router = this.commandRouter;

    return new Promise((resolve) => {
        router.getUIConfigOnPlugin(
            'system_hardware',
            'nfc_music',
            {}
        ).then(config => {
            this.uiBusy = false;
            router.broadcastMessage('pushUiConfig', config);
            resolve();
        }).fail(err => {
            this.uiBusy = false;
            this.logger.error('UI refresh failed: ' + err);
            resolve();
        });
    });
};

// =========================================================
// Plugin Start Lifecycle
// =========================================================
NfcMusic.prototype.onStart = function () {

    this.logger.info('NFC Music: plugin starten');

    // =========================================================
    // 1. TAG STORAGE INITIALISATIE (persisted state)
    // =========================================================

    this.migrateTagsFile();
    this.loadTags();


    // =========================================================
    // 2. PLAYER INITIALISATIE (playback engine wrapper)
    // =========================================================

    this.player = new Player({
        logger: this.logger,
        commandRouter: this.commandRouter
    });


    // =========================================================
    // 3. TAG HANDLER (LOGICA LAYER - tijdelijk verwijderd)
    // =========================================================

    /*
     * Tag handler (refactor fase)
     * -> later verplaatsen naar /lib/tag-handler.js
     */


    // =========================================================
    // 4. NFC READER INITIALISATIE (hardware / event source)
    // =========================================================

    this.nfcReader = new NfcReader({

        logger: this.logger,

        onTag: async (uid) => {

            this.logger.info(`NFC Music: tag ontvangen: ${uid}`);

            // =================================================
            // 4.1.1 STATE UPDATE
            // =================================================

            this.activeTag = uid;

            // optioneel: runtime cache (voor UI edit flow later)
            this.scannedTags[uid] = this.tags[uid] || {
                name: `Onbekende tag (${uid})`,
                actions: []
            };

            // =================================================
            // 4.1.2 PLAYBACK ENGINE
            // =================================================

            try {

                const tag = this.tags[uid];

                if (!tag) {
                    this.logger.warn(`NFC Music: onbekende tag: ${uid}`);
                    return;
                }

                for (const action of tag.actions) {
                    await handleTagAction(action, this.player, this.logger);
                }

            } catch (error) {
                this.logger.error(`NFC Music: tag verwerken mislukt: ${error.message}`);
            }

            // =================================================
            // 4.1.3 UI REFRESH
            // =================================================

            return this.refreshUI();
        }
    });


    // =========================================================
    // 5. NFC START (hardware activation)
    // =========================================================

    this.nfcReader.start();

    this.logger.info(
        'NFC Music: NFC reader geïnitialiseerd'
    );

    return libQ.resolve();
};

// =====================================================
// onStop (plugin stop lifecycle)
// =====================================================
NfcMusic.prototype.onStop = function () {

    this.logger.info('NFC Music: stopping plugin');

    // =====================================================
    // 1. NFC READER STOP
    // =====================================================

    if (this.nfcReader) {
        try {
            this.nfcReader.stop();
            this.logger.info('NFC Music: NFC reader gestopt');
        } catch (e) {
            this.logger.error('NFC Music: error stopping reader ' + e);
        }
    }

    this.nfcReader = null;

    // =====================================================
    // 2. RUNTIME STATE RESET
    // =====================================================

    this.activeTag = null;
    this.scannedTags = {};

    // =====================================================
    // 3. PLAYER CLEANUP (optioneel maar netjes)
    // =====================================================

    if (this.player && this.player.stop) {
        try {
            this.player.stop();
        } catch (e) {
            this.logger.error('Player stop error ' + e);
        }
    }

    this.player = null;

    return libQ.resolve();
};

// =====================================================
// Plugin restart lifecycle
// =====================================================
NfcMusic.prototype.onRestart = function () {

    this.logger.info('NFC Music: plugin herstart');

    // Herstart = zelfde als stop/start cycle light
    this.activeTag = null;
    this.scannedTags = {};

    return libQ.resolve();
};

// ===========================================================
// UI CONFIGURATIE (dynamisch opgebouwd)
// ===========================================================

NfcMusic.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();

    var lang_code = self.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    ).then(function (uiconf) {

        var sectionLastScanned = uiconf.sections[0];
        var sectionPickExisting = uiconf.sections[1];
        var sectionEditTag = uiconf.sections[2];

        self.buildLastScannedSection(sectionLastScanned);
        self.buildPickExistingSection(sectionPickExisting);
        self.buildEditTagSection(sectionEditTag);

        defer.resolve(uiconf);

    }).fail(function (error) {
        self.logger.error('NFC Music: getUIConfig faalde: ' + error);
        defer.reject(new Error());
    });

    return defer.promise;
};


// -----------------------------------------------------------
// Sectie 1: laatst gescande tag
// -----------------------------------------------------------
NfcMusic.prototype.buildLastScannedSection = function (section) {
    var self = this;
    var uid = self.activeTag;

    self.logger.info('NFC Music DEBUG: buildLastScannedSection uid=[' + uid + '] type=' + typeof uid); //tmp logging

    if (!uid) {
        section.content.push({
            id: 'last_scanned_info',
            element: 'input', type: 'text',
            label: 'Status',
            value: 'Nog geen tag gescand sinds de laatste herstart.'
        });
        return;
    }

    var existing = self.tags[uid];

    section.content.push({
        id: 'last_scanned_uid',
        element: 'input', type: 'text',
        label: 'UID',
        value: uid
    });

    section.content.push({
        id: 'last_scanned_name',
        element: 'input', type: 'text',
        label: 'Naam',
        value: existing ? existing.name : 'Nog niet geregistreerd (nieuwe tag)'
    });

    section.content.push({
        id: 'edit_last_scanned_button',
        element: 'button',
        label: 'Bewerk deze tag',
        onClick: {
            type: 'controller',
            endpoint: 'system_hardware/nfc_music',
            method: 'editLastScanned'
        }
    });
};


// -----------------------------------------------------------
// Sectie 2: bestaande tag kiezen
// -----------------------------------------------------------
NfcMusic.prototype.buildPickExistingSection = function (section) {
    var self = this;

    var entries = Object.keys(self.tags).map(function (uid) {
        return { uid: uid, name: self.tags[uid].name || uid };
    });

    if (entries.length === 0) {
        section.content.push({
            id: 'no_existing_tags',
            element: 'input', type: 'text',
            label: 'Info',
            value: 'Er zijn nog geen tags geregistreerd.'
        });
        return;
    }

    entries.sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });

    var options = entries.map(function (e) {
        return { value: e.uid, label: e.name + ' (' + e.uid + ')' };
    });

    var defaultOption = self.activeEditTag
        ? options.find(function (o) { return o.value === self.activeEditTag; })
        : null;

    section.content.push({
        id: 'existingTagUid',
        element: 'select',
        label: 'Tag',
        value: defaultOption || options[0],
        options: options
    });
};


// -----------------------------------------------------------
// Sectie 3: tag bewerken
// -----------------------------------------------------------
NfcMusic.prototype.buildEditTagSection = function (section) {
    var self = this;
    var uid = self.activeEditTag;

    if (!uid) {
        section.content.push({
            id: 'edit_tag_info',
            element: 'input', type: 'text',
            label: 'Info',
            value: 'Kies eerst een tag hierboven (laatst gescand, of uit de lijst) om te bewerken.'
        });
        return;
    }

    var tag = self.tags[uid] || { name: uid, actions: [] };
    var firstAction = tag.actions && tag.actions[0] ? tag.actions[0] : null;
    var actionKey = self.combinedActionTypeKey(firstAction);
    var actionData = (firstAction && firstAction.data) ? firstAction.data : {};

    var actionTypeOptions = [
        { value: 'local_track', label: 'Lokaal: los nummer' },
        { value: 'local_album', label: 'Lokaal: album' },
        { value: 'local_playlist', label: 'Lokaal: playlist' },
        { value: 'spotify_album', label: 'Spotify: album' },
        { value: 'spotify_playlist', label: 'Spotify: playlist' }
    ];

    section.content.push({
        id: 'edit_tag_uid',
        element: 'input', type: 'text',
        label: 'UID',
        value: uid
    });

    section.content.push({
        id: 'name',
        element: 'input',
        type: 'text',
        label: 'Naam',
        value: tag.name || uid
    });

    section.content.push({
        id: 'actionType',
        element: 'select',
        label: 'Actietype',
        value: actionTypeOptions.find(function (o) { return o.value === actionKey; }) || actionTypeOptions[1],
        options: actionTypeOptions
    });

    // --- Lokaal: los nummer ---
    section.content.push({
        id: 'track_titel',
        element: 'input',
        type: 'text',
        label: 'Titel Nummer',
        value: actionData.title || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });
    section.content.push({
        id: 'track_artist',
        element: 'input',
        type: 'text',
        label: 'Artiest',
        value: actionData.artist || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });
    section.content.push({
        id: 'track_album',
        element: 'input',
        type: 'text',
        label: 'Album (optioneel)',
        value: actionData.album || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });
/* track_uri niet meer nodig ivm search in player.js, maar kan nog wel gebruikt worden als fallback */
    section.content.push({
        id: 'track_uri',
        element: 'input',
        type: 'text',
        label: 'Track URI (optioneel)',
        doc: 'Volledig pad zoals Volumio het kent, bijv. music-library/NAS/.../nummer.flac',
        value: actionData.uri || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });

    // --- Lokaal: album ---
    section.content.push({
        id: 'album_artist',
        element: 'input',
        type: 'text',
        label: 'Artiest',
        value: actionKey === 'local_album' ? (actionData.artist || '') : '',
        visibleIf: { field: 'actionType', value: 'local_album' }
    });
    section.content.push({
        id: 'album_naam',
        element: 'input',
        type: 'text',
        label: 'Albumnaam',
        value: actionKey === 'local_album' ? (actionData.album || '') : '',
        visibleIf: { field: 'actionType', value: 'local_album' }
    });

    // --- Lokaal: playlist ---
    section.content.push({
        id: 'playlist_naam',
        element: 'input',
        type: 'text',
        label: 'Playlistnaam',
        value: actionKey === 'local_playlist' ? (actionData.name || '') : '',
        visibleIf: { field: 'actionType', value: 'local_playlist' }
    });

    // --- Spotify: album ---
    section.content.push({
        id: 'spotify_album_uri',
        element: 'input',
        type: 'text',
        label: 'Spotify album URI',
        doc: 'bijv. spotify:album:xxxxxxxx',
        value: actionKey === 'spotify_album' ? (actionData.uri || '') : '',
        visibleIf: { field: 'actionType', value: 'spotify_album' }
    });

    // --- Spotify: playlist ---
    section.content.push({
        id: 'spotify_playlist_uri',
        element: 'input',
        type: 'text',
        label: 'Spotify playlist URI',
        doc: 'bijv. spotify:playlist:xxxxxxxx',
        value: actionKey === 'spotify_playlist' ? (actionData.uri || '') : '',
        visibleIf: { field: 'actionType', value: 'spotify_playlist' }
    });

    section.content.push({
        id: 'delete_tag_button',
        element: 'button',
        label: 'Verwijder deze tag',
        onClick: {
            type: 'controller',
            endpoint: 'system_hardware/nfc_music',
            method: 'deleteCurrentTag'
        }
    });
};


// ===========================================================
// ACTIES VANUIT DE UI
// ===========================================================

NfcMusic.prototype.editLastScanned = function () {
    var self = this;

    if (!self.activeTag) {
        self.commandRouter.pushToastMessage('error', 'NFC Music', 'Nog geen tag gescand');
        return libQ.resolve({});
    }

    self.activeEditTag = self.activeTag;
    return self.refreshUI();
};

NfcMusic.prototype.selectTagToEdit = function (data) {
    var self = this;

    var uid = (data.existingTagUid && data.existingTagUid.value)
        ? data.existingTagUid.value
        : data.existingTagUid;

    if (!uid) {
        self.commandRouter.pushToastMessage('error', 'NFC Music', 'Geen tag geselecteerd');
        return libQ.resolve({});
    }

    self.activeEditTag = uid;
    return self.refreshUI();
};

NfcMusic.prototype.saveTag = async function (data) {
    var self = this;
    var uid = self.activeEditTag;

    if (!uid) {
        self.logger.error('saveTag: geen activeEditTag gezet');
        self.commandRouter.pushToastMessage('error', 'NFC Music', 'Er is geen tag geselecteerd om op te slaan');
        return {};
    }

    if (self.uiBusy) {
        self.logger.warn('saveTag blocked (UI busy)');
        return {};
    }
    self.uiBusy = true;

    try {
        var actionType = (data.actionType && data.actionType.value) ? data.actionType.value : data.actionType;
        var action = self.buildActionFromForm(actionType, data);

        if (!action) {
            self.commandRouter.pushToastMessage('error', 'NFC Music', 'Onbekend actietype: ' + actionType);
            return {};
        }

        self.tags[uid] = {
            name: (data.name || uid).trim(),
            actions: [action]
        };

        self.saveTags();

        self.commandRouter.pushToastMessage('success', 'NFC Music', 'Tag ' + uid + ' opgeslagen');

        await self.refreshUI();

    } catch (err) {
        self.logger.error('saveTag error: ' + err);
        self.commandRouter.pushToastMessage('error', 'NFC Music', 'Opslaan mislukt: ' + err.message);
    } finally {
        self.uiBusy = false;
    }

    return {};
};

NfcMusic.prototype.deleteCurrentTag = async function () {
    var self = this;
    var uid = self.activeEditTag;

    if (!uid) {
        self.commandRouter.pushToastMessage('error', 'NFC Music', 'Geen tag geselecteerd om te verwijderen');
        return {};
    }

    delete self.tags[uid];
    self.saveTags();
    self.activeEditTag = null;

    self.commandRouter.pushToastMessage('success', 'NFC Music', 'Tag ' + uid + ' verwijderd');

    await self.refreshUI();
    return {};
};


// ===========================================================
// HELPERS
// ===========================================================

/*
 * Zet een (source, type) combinatie om naar de dropdown-waarde,
 * bijv. { type: 'album', source: 'spotify' } -> 'spotify_album'
 */
NfcMusic.prototype.combinedActionTypeKey = function (action) {
    if (!action) {
        return 'local_album';
    }
    var source = action.source || 'local';
    var type = action.type || 'album';
    return source + '_' + type;
};

/*
 * Bouwt het actions[0]-object precies zoals tag-handler.js het verwacht,
 * op basis van de dropdown-waarde en de bijbehorende formuliervelden.
 */
NfcMusic.prototype.buildActionFromForm = function (actionType, data) {
    switch (actionType) {

        case 'local_track':
            return {
                action: 'play',
                type: 'track',
                source: 'local',
                data: {
                    uri: (data.track_uri || '').trim(),
                    title: (data.track_titel || '').trim(),
                    artist: (data.track_artist || '').trim(),
                    album: (data.track_album || '').trim()
                }
            };

        case 'local_album':
            return {
                action: 'play',
                type: 'album',
                source: 'local',
                data: {
                    artist: (data.album_artist || '').trim(),
                    album: (data.album_naam || '').trim()
                }
            };

        case 'local_playlist':
            return {
                action: 'play',
                type: 'playlist',
                source: 'local',
                data: {
                    name: (data.playlist_naam || '').trim()
                }
            };

        case 'spotify_album':
            return {
                action: 'play',
                type: 'album',
                source: 'spotify',
                data: {
                    uri: (data.spotify_album_uri || '').trim()
                }
            };

        case 'spotify_playlist':
            return {
                action: 'play',
                type: 'playlist',
                source: 'spotify',
                data: {
                    uri: (data.spotify_playlist_uri || '').trim()
                }
            };

        default:
            return null;
    }
};

// =========================================================
// UI ACTION HANDLERS (called from frontend buttons)
// =========================================================

/*
 * getConfigurationFiles()
 * ---------------------------------------------------------
 * Definieert welke config files Volumio moet laden.
 * Altijd laten staan. Verplichte lifecycle hook. 
 */
NfcMusic.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};


// =========================================================
// CONFIG GETTER / SETTER WRAPPER
// =========================================================

/*
 * getConf()
 * ---------------------------------------------------------
 * Haalt plugin config waarde op
 */
NfcMusic.prototype.getConf = function (varName) {
    return this.config.get(varName);
};


/*
 * setConf()
 * ---------------------------------------------------------
 * Schrijft plugin config waarde weg
 */
NfcMusic.prototype.setConf = function (varName, varValue) {
    this.config.set(varName, varValue);
};