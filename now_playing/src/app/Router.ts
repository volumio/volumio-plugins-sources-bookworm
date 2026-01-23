import express from 'express';

import * as handler from './Handler';
import np from '../lib/NowPlayingContext';

const router = express.Router();

function stdLogError(fn: string, error: unknown) {
  np.getLogger().error(np.getErrorMessage(`[now-playing] Caught error in router -> ${fn}:`, error, false));
}

router.get('/', (req, res) => {
  handler.index(req, res).catch((error: unknown) => stdLogError('index', error));
});

router.get('/preview', (req, res) => {
  handler.preview(req, res).catch((error: unknown) => stdLogError('preview', error));
});

router.get('/mybg', (req, res) => {
  handler.myBackground(req.query, res);
});

router.post('/api/:apiName/:method', (req, res) => {
  const {apiName, method} = req.params;
  handler.api(apiName, method, req.body, res).catch((error: unknown) => stdLogError(`api -> ${apiName}.${method}`, error));
});

router.get('/api/:apiName/:method', (req, res) => {
  const {apiName, method} = req.params;
  handler.api(apiName, method, req.query, res).catch((error: unknown) => stdLogError(`api -> ${apiName}.${method}`, error));
});

router.get('/font/:file', (req, res) => {
  const {file} = req.params;
  handler.font(file, res);
});

export default router;
