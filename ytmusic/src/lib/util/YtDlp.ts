import { YtDlp } from "volumio-yt-dlp";
import ytmusic from "../YTMusicContext";

const WD = '/data/plugins/music_service/ytmusic/.yt-dlp';

function createYtDlpInstance() {
  return new YtDlp({
    workingDir: WD,
    cookies: ytmusic.getConfigValue('cookie'),
    logger: {
      info: (msg) => ytmusic.getLogger().info(`[ytmusic] [yt-dlp] ${msg}`),
      warn: (msg) => ytmusic.getLogger().warn(`[ytmusic] [yt-dlp] ${msg}`),
      debug: (msg) => ytmusic.getLogger().verbose(`[ytmusic] [yt-dlp] ${msg}`),
      error: (msg) => ytmusic.getLogger().error(`[ytmusic] [yt-dlp] ${msg}`),
    }
  });
}

export class YtDlpWrapper {

  static #ytDlp: YtDlp | null = null;

  static getInstance() {
    if (!this.#ytDlp) {
      this.#ytDlp = createYtDlpInstance();
    }
    return this.#ytDlp;
  }

  static refresh() {
    const ytDlp = this.getInstance();
    const cookie = ytmusic.getConfigValue('cookie');
    if (cookie) {
      ytDlp.setCookies(cookie);
    }
    else {
      ytDlp.setCookies(null);
    }
  }
}