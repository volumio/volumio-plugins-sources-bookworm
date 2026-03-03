// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';

export interface View {
  name: string;
  params: Record<string, string>;
}

/**
 *
 * @param uri 'rp2/{view}@{param0=...}@{param1=...}'
 * @returns
 */
export function parseUri(uri: string) {
  if (!uri.startsWith('rp2/')) {
    return [];
  }
  const views = uri.split('/').reduce<View[]>((result, segment, i) => {
    if (i === 0) {
      // rp2
      result.push({ name: 'root', params: {} });
      return result;
    }

    const splitted = segment.split('@');
    const viewName = splitted.shift();
    if (!viewName) {
      return result;
    }

    const params = splitted.reduce<Record<string, string>>((acc, qs) => {
      const [key, value] = qs.split('=');
      if (key && value !== undefined) {
        acc[key] = decodeURIComponent(value);
      }
      return acc;
    }, {});

    result.push({
      name: viewName,
      params
    });

    return result;
  }, []);
  return views;
}

export function jsPromiseToKew<T>(promise: Promise<T>): any {
  const defer = libQ.defer();

  promise
    .then((result) => {
      defer.resolve(result);
    })
    .catch((error: unknown) => {
      defer.reject(error);
    });

  return defer.promise;
}

export function kewToJSPromise(promise: any): Promise<any> {
  // Guard against a JS promise from being passed to this function.
  if (
    typeof promise.catch === 'function' &&
    typeof promise.fail === 'undefined'
  ) {
    // JS promise - return as is
    return promise;
  }
  return new Promise((resolve, reject) => {
    promise
      .then((result: any) => {
        resolve(result);
      })
      .fail((error: unknown) => {
        reject(error instanceof Error ? error : Error(String(error)));
      });
  });
}
