// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';
import ni from 'network-interfaces';

export function jsPromiseToKew(promise: Promise<any>): any {
  const defer = libQ.defer();

  promise.then((result) => {
    defer.resolve(result);
  })
    .catch((error: unknown) => {
      defer.reject(error);
    });

  return defer.promise;
}

export function kewToJSPromise(promise: any): Promise<any> {
  // Guard against a JS promise from being passed to this function.
  if (typeof promise.catch === 'function' && typeof promise.fail === 'undefined') {
    // JS promise - return as is
    return promise;
  }
  return new Promise((resolve, reject) => {
    promise.then((result: any) => {
      resolve(result);
    })
      .fail((error: any) => {
        reject(error instanceof Error ? error : Error(String(error)));
      });
  });
}

export function getNetworkInterfaces() {
  const ifNames = ni.getInterfaces({
    internal: false,
    ipVersion: 4
  });
  return ifNames.map((v) => {
    return {
      name: v,
      ip: ni.toIp(v, {})
    };
  });
}

export function hasNetworkInterface(ifName: string): boolean {
  return !!getNetworkInterfaces().find((info) => info.name === ifName);
}

export function getErrorMessage(message: string, error: any, stack = true): string {
  let result = message;
  if (typeof error == 'object') {
    if (error.message) {
      result += ` ${error.message}`;
    }
    if (error.info) { // InnertubeError has this
      result += `: ${error.info}`;
    }
    if (error.cause) {
      result += `: ${getErrorMessage('', error.cause, stack)}`;
    }
    if (stack && error.stack) {
      result += ` ${error.stack}`;
    }
  }
  else if (typeof error == 'string') {
    result += ` ${error}`;
  }
  return result.trim();
}