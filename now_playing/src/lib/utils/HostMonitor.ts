import { EventEmitter } from "events";
import np from '../NowPlayingContext';

export interface HostMonitorEvents {
  change: (previous: string, current: string) => void;
}

export class HostMonitor extends EventEmitter {
  #timer: NodeJS.Timeout | null = null;
  #host: string;

  constructor() {
    super();
    this.#host = np.getDeviceInfo(true).host;
  }

  start() {
    if (this.#timer) {
      return;
    }

    this.#timer = setInterval(() => {
      const { host } = np.getDeviceInfo(true);
      const oldHost = this.#host;
      if (host !== oldHost) {
        this.#host = host;
        this.emit('change', oldHost, host);
      }
    }, 15000);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  emit<E extends keyof HostMonitorEvents>(eventName: E, ...args: Parameters<HostMonitorEvents[E]>): boolean {
    return super.emit(eventName, ...args);
  }

  on<E extends keyof HostMonitorEvents>(eventName: E, listener: HostMonitorEvents[E]): this {
    return super.on(eventName, listener);
  }

  once<E extends keyof HostMonitorEvents>(eventName: E, listener: HostMonitorEvents[E]): this {
    return super.once(eventName, listener);
  }

  off<E extends keyof HostMonitorEvents>(eventName: E, listener: HostMonitorEvents[E]): this {
    return super.off(eventName, listener);
  }
}