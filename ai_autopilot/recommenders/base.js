'use strict';

/**
 * Recommender interface.
 *   recommend(history, feedback) -> Promise<{artist, title}|null>
 *
 * history is sorted oldest -> newest; may be empty.
 * feedback = { likes: [...], dislikes: [...] }, newest first; may be empty.
 * Each feedback item: { uri, artist, title, rating, source, at }
 */
class BaseRecommender {
  constructor({ config, logger, log }) {
    this.config = config || {};
    this.logger = logger || console;
    this.log = log || (() => {});
  }

  recommend(/* history, feedback */) {
    return Promise.reject(new Error('recommend() not implemented'));
  }
}

module.exports = BaseRecommender;
