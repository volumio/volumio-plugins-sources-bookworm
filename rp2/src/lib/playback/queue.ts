import { parseUri } from '../util';
import { type QueueItem } from './types';

export function getQueueItems(uri: string) {
  const view = parseUri(uri).pop();
  if (!view) {
    throw Error(`Invalid URI "${uri}"`);
  }
  if (!view.params.qi) {
    throw Error(`Invalid URI "${uri}"`);
  }
  try {
    const queueItem = JSON.parse(view.params.qi) as QueueItem;
    return Promise.resolve([queueItem]);
  } catch (error) {
    throw Error(`Queue item could not be parsed from ${uri}`);
  }
}
