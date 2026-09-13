/**
 * Volumio Plugin API type definitions.
 *
 * These interfaces describe the Volumio 3 plugin contract as used by music
 * service plugins (browse sources, playback, search). Derived from the
 * volumio3-backend source, ytmusic plugin, and Spotify plugin.
 *
 * No runtime code — types only.
 */

// ── Core Volumio context & services ──────────────────────────────────

/** Logger provided by Volumio to plugins. */
export interface VolumioLogger {
  info(msg: string): void;
  error(msg: string): void;
  warn(msg: string): void;
}

/** The context object passed to every Volumio plugin constructor. */
export interface VolumioContext {
  coreCommand: VolumioCoreCommand;
  logger: VolumioLogger;
}

/** Core command router — the main Volumio service bus. */
export interface VolumioCoreCommand {
  pushConsoleMessage(msg: string): void;
  servicePushState(state: VolumioState, serviceName: string): void;
  volumioAddToBrowseSources(source: BrowseSource): void;
  volumioRemoveToBrowseSources(source: BrowseSource): void;

  stateMachine: VolumioStateMachine;
  pluginManager: VolumioPluginManager;
}

/** Volumio's state machine — manages playback queue and state. */
export interface VolumioStateMachine {
  setConsumeUpdateService(service: string | undefined, state?: boolean, remove?: boolean): void;
  previous(): PromiseLike<unknown>;
  prefetchDone: boolean;
}

/** Volumio plugin manager — used to get references to other plugins. */
export interface VolumioPluginManager {
  getPlugin(category: string, name: string): MpdPlugin | undefined;
}

/** MPD command descriptor for batch operations via sendMpdCommandArray. */
export interface MpdCommandEntry {
  command: string;
  parameters: string[];
}

/** Subset of the MPD plugin interface used for playback. */
export interface MpdPlugin {
  sendMpdCommand(command: string, params: string[]): PromiseLike<unknown>;
  sendMpdCommandArray(commands: MpdCommandEntry[]): PromiseLike<unknown>;
  stop(): PromiseLike<unknown>;
  pause(): PromiseLike<unknown>;
  resume(): PromiseLike<unknown>;
  next(): PromiseLike<unknown>;
  seek(position: number): PromiseLike<unknown>;
  clientMpd: {
    sendCommand(command: unknown, callback: (err: unknown, msg: string) => void): void;
  };
}

// ── Playback state ───────────────────────────────────────────────────

/** The state object pushed to Volumio via servicePushState. */
export interface VolumioState {
  status: "play" | "pause" | "stop";
  service: string;
  title: string;
  artist: string;
  album: string;
  albumart: string;
  uri: string;
  seek: number;
  duration: number;
  samplerate?: string;
  bitdepth?: string;
  trackType?: string;
}

// ── Queue ────────────────────────────────────────────────────────────

/** Track format for Volumio's queue (returned by explodeUri). */
export interface QueueItem {
  uri: string;
  service: string;
  name: string;
  artist: string;
  album: string;
  albumart: string;
  duration: number;
  type: "track";
  trackType?: string;
  samplerate?: string;
  bitdepth?: string;
}

// ── Browse navigation ────────────────────────────────────────────────

/** A source entry shown in Volumio's browse root. */
export interface BrowseSource {
  name: string;
  uri: string;
  plugin_type: string;
  plugin_name: string;
  albumart: string;
}

/**
 * Info header shown at the top of a browse page.
 * When type is "song", Volumio renders album art + "Play Next / Add to queue /
 * Add to Playlist" action buttons. uri must be explodable via explodeUri.
 */
export interface NavigationInfo {
  service: string;
  type: "song";
  uri: string;
  albumart: string;
  album?: string;
  artist?: string;
}

/** The full response from handleBrowseUri. */
export interface NavigationPage {
  navigation: {
    prev: { uri: string };
    info?: NavigationInfo;
    lists: NavigationList[];
  };
}

/** A list section within a navigation page. */
export interface NavigationList {
  title?: string;
  icon?: string;
  availableListViews: ("list" | "grid")[];
  items: NavigationListItem[];
}

/** A single item in a navigation list. */
export interface NavigationListItem {
  service: string;
  type: "folder" | "song" | "item";
  title: string;
  artist?: string;
  album?: string;
  albumart?: string;
  uri: string;
  icon?: string;
  duration?: number;
}

// ── Search ───────────────────────────────────────────────────────────

/** The query object passed to the search method. */
export interface SearchQuery {
  value: string;
  type?: string;
}

/** A section of search results (one per content type). */
export interface SearchResultSection {
  title: string;
  icon?: string;
  availableListViews: ("list" | "grid")[];
  items: NavigationListItem[];
}
