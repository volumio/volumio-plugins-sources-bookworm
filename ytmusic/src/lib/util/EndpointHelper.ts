import {type BrowseEndpoint, type EndpointOf} from '../types/Endpoint';
import type Endpoint from '../types/Endpoint';
import { EndpointType } from '../types/Endpoint';

const EXCLUDE_ENDPOINT_BROWSE_IDS = [
  'SPreport_history',
  'SPaccount_overview',
  'SPunlimited'
];

export default class EndpointHelper {

  static validate(endpoint?: Endpoint): boolean {
    if (!endpoint?.type) {
      return false;
    }

    switch (endpoint.type) {
      case EndpointType.Browse:
        return !!endpoint.payload?.browseId && !EXCLUDE_ENDPOINT_BROWSE_IDS.includes(endpoint.payload.browseId);

      case EndpointType.Watch:
        return !!endpoint.payload?.videoId || !!endpoint.payload?.playlistId;

      case EndpointType.Search:
        return !!endpoint.payload?.query;

      case EndpointType.BrowseContinuation:
      case EndpointType.SearchContinuation:
        return !!endpoint.payload?.token;

      default:
        return false;
    }
  }

  static isType<K extends EndpointType[]>(endpoint: Endpoint | null | undefined, ...types: K): endpoint is EndpointOf<K[number]> {
    if (!endpoint) {
      return false;
    }
    return types.some((t) => endpoint.type === t);
  }

  static isChannelEndpoint(endpoint?: Endpoint | null): endpoint is BrowseEndpoint {
    if (!this.isType(endpoint, EndpointType.Browse)) {
      return false;
    }

    return endpoint.payload.browseId.startsWith('UC') ||
      endpoint.payload.browseId.startsWith('FEmusic_library_privately_owned_artist');
  }

  static isAlbumEndpoint(endpoint?: Endpoint | null): endpoint is BrowseEndpoint {
    if (!this.isType(endpoint, EndpointType.Browse)) {
      return false;
    }

    return endpoint.payload.browseId.startsWith('MPR') ||
      endpoint.payload.browseId.startsWith('FEmusic_library_privately_owned_release');
  }

  static isPodcastEndpoint(endpoint?: Endpoint | null): endpoint is BrowseEndpoint {
    if (!this.isType(endpoint, EndpointType.Browse)) {
      return false;
    }

    return endpoint.payload.browseId.startsWith('MPSPPL');
  }
}
