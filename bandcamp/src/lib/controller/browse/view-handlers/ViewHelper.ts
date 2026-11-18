import { type UriEmbeddedQueueItem } from './ExplodableViewHandler';
import type View from './View';

export default class ViewHelper {
  static getViewsFromUri(uri: string): View[] {
    const segments = uri.split('/');
    if (segments[0] !== 'bandcamp') {
      return [];
    }

    const result: View[] = [];

    segments.forEach((segment, index) => {
      let view: View;
      if (index === 0) {
        // 'bandcamp/...'
        view = {
          name: 'root'
        };
      } else {
        view = this.#getViewFromUriSegment(segment);
      }
      result.push(view);
    });

    return result;
  }

  static constructUriSegmentFromView(view: View) {
    let segment: string;
    if (view.name === 'root') {
      segment = 'bandcamp';
    } else {
      segment = view.name;
    }

    const skip = [
      'name',
      'pageRef',
      'prevPageRefs',
      'noExplode',
      'combinedSearch',
      'inSection'
    ];
    Object.keys(view)
      .filter((key) => !skip.includes(key))
      .forEach((key) => {
        if (view[key] !== undefined) {
          if (typeof view[key] === 'object') {
            segment += `@${key}:o=${encodeURIComponent(JSON.stringify(view[key]))}`;
          } else {
            segment += `@${key}=${encodeURIComponent(view[key])}`;
          }
        }
      });

    if (view.prevPageRefs) {
      segment += `@$prevPageRefs=${encodeURIComponent(JSON.stringify(view.prevPageRefs))}`;
    }

    if (view.pageRef) {
      segment += `@pageRef=${encodeURIComponent(JSON.stringify(view.pageRef))}`;
    }

    return segment;
  }

  static #getViewFromUriSegment(segment: string): View {
    const result: View = {
      name: '',
      startIndex: 0
    };
    segment.split('@').forEach((s) => {
      const equalIndex = s.indexOf('=');
      if (equalIndex < 0) {
        result.name = s;
      } else {
        let key = s.substring(0, equalIndex);
        const value = decodeURIComponent(s.substring(equalIndex + 1));
        if (key === 'pageRef' || key === 'prevPageRefs') {
          result[key] = JSON.parse(value);
        } else if (key.endsWith(':o')) {
          // `value` is object
          key = key.substring(0, key.length - 2);
          result[key] = JSON.parse(value);
        } else {
          result[key] = value;
        }
      }
    });

    return result;
  }

  static constructUriFromViews(views: View[]) {
    const segments = views.map((view) =>
      this.constructUriSegmentFromView(view)
    );
    return segments.join('/');
  }

  static setUriEmbeddedQueueItem(uri: string, item: UriEmbeddedQueueItem) {
    const views = this.getViewsFromUri(uri);
    const currentView = views.at(-1);
    if (!currentView) {
      return uri;
    }
    currentView.explode = item;
    return this.constructUriFromViews(views);
  }
}
