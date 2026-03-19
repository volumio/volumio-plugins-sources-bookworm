export namespace Display {
  export interface Page {
    navigation?: PageContents;
  }

  export interface PageHeader {
    service: 'rp2';
    type: 'album' | 'song' | 'playlist';
    uri: string;
    albumart?: string | null;
    title?: string | null;
    album?: string | null;
    artist?: string | null;
    year?: number | string | null;
    duration?: string | null;
    genre?: string | null;
  }

  export interface List {
    title?: string;
    availableListViews: ('list' | 'grid')[];
    items: ListItem[];
  }

  export interface PageContents {
    prev?: {
      uri?: string;
    };
    info?: PageHeader | null;
    lists?: List[];
  }

  export interface ListItem {
    service: 'rp2';
    type: 'folder' | 'song' | 'album' | 'item-no-menu' | 'mywebradio';
    tracknumber?: string;
    title: string;
    albumart?: string | null;
    artist?: string | null;
    album?: string | null;
    duration?: number | null;
    uri: string;
    icon?: string;
    favorite?: boolean;
  }
}
