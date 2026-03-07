// Auto-generated from ./src/UIConfig.json

import { type UIConfigButton, type UIConfigInput, type UIConfigSelect, type UIConfigSwitch } from "./UIConfig";
export type UIConfigSectionKey = 
              'section_general' | 
              'section_playback' | 
              'section_cache';

export type UIConfigSectionContentKeyOf<K extends UIConfigSectionKey> =
  K extends 'section_general' ?
    'credentialsType' | 
    'accessToken' | 
    'accessTokenGuide' | 
    'cookie' | 
    'cookieGuide' | 
    'locale' | 
    'itemsPerPage' | 
    'itemsPerSection' | 
    'combinedSearchResults' | 
    'loadFullPlaylistAlbum' :

  K extends 'section_playback' ?
    'skipPreviewTracks' | 
    'addPlayedToHistory' | 
    'logTranscodings' :

  K extends 'section_cache' ?
    'cacheMaxEntries' | 
    'cacheTTL' | 
    'clearCache' :

  never;

export type UIConfigElementOf<K extends UIConfigSectionKey, C extends UIConfigSectionContentKeyOf<K>> =
  K extends 'section_general' ? (
    C extends 'credentialsType' ? UIConfigSelect<K> :
    C extends 'accessToken' ? UIConfigInput<K, 'text'> :
    C extends 'accessTokenGuide' ? UIConfigButton<K> :
    C extends 'cookie' ? UIConfigInput<K, 'text'> :
    C extends 'cookieGuide' ? UIConfigButton<K> :
    C extends 'locale' ? UIConfigSelect<K> :
    C extends 'itemsPerPage' ? UIConfigInput<K, 'number'> :
    C extends 'itemsPerSection' ? UIConfigInput<K, 'number'> :
    C extends 'combinedSearchResults' ? UIConfigInput<K, 'number'> :
    C extends 'loadFullPlaylistAlbum' ? UIConfigSwitch<K> :
    never
  ) : 

  K extends 'section_playback' ? (
    C extends 'skipPreviewTracks' ? UIConfigSwitch<K> :
    C extends 'addPlayedToHistory' ? UIConfigSwitch<K> :
    C extends 'logTranscodings' ? UIConfigSwitch<K> :
    never
  ) : 

  K extends 'section_cache' ? (
    C extends 'cacheMaxEntries' ? UIConfigInput<K, 'number'> :
    C extends 'cacheTTL' ? UIConfigInput<K, 'number'> :
    C extends 'clearCache' ? UIConfigButton<K> :
    never
  ) : 

  never;

