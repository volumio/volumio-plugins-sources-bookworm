import sm from './SqueezeliteMCContext';
import EventEmitter from 'events';
import path from 'path';
import { fork, type ChildProcess } from 'child_process';
import type Player from './types/Player';
import { type ServerCredentials } from './types/Server';
import { type PlayerFinderChildMessage } from './PlayerFinderChild';
import { logChildProcessMessage } from './ChildProcessUtils';

export enum PlayerFinderStatus {
  Started = 'started',
  Stopped = 'stopped'
}

export interface PlayerFinderOptions {
  serverCredentials?: ServerCredentials;
  // Emit events only when player matches criteria
  eventFilter?: {
    playerIP?: string | string[];
    playerName?: string | string[];
    playerId?: string | string[];
  };
}

export interface PlayerFinderEvents {
  found: (players: Player[]) => void;
  lost: (players: Player[]) => void;
  error: (errorMessage: string) => void;
}

export default class PlayerFinder extends EventEmitter {
  #status: PlayerFinderStatus;
  #child: ChildProcess | null;
  #startPromise: Promise<void> | null;
  #startResolve: (() => void) | null;
  #startReject: ((error: unknown) => void) | null;

  constructor() {
    super();
    this.#status = PlayerFinderStatus.Stopped;
    this.#child = null;
    this.#startPromise = null;
    this.#startResolve = null;
    this.#startReject = null;
  }

  start(opts: PlayerFinderOptions = {}) {
    if (this.#child) {
      return this.#startPromise ?? Promise.resolve();
    }

    const childPath = this.#getChildModulePath();
    sm.getLogger().verbose(
      `[squeezelite_mc] PlayerFinder: fork child process at ${childPath}`
    );

    this.#child = fork(childPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    this.#startPromise = new Promise((resolve, reject) => {
      this.#startResolve = resolve;
      this.#startReject = reject;
    });

    this.#child.on('message', (message: PlayerFinderChildMessage) => {
      this.#handleChildMessage(message);
    });

    this.#child.on('exit', (code, signal) => {
      this.#handleChildExit(code, signal);
    });

    this.#child.on('error', (error) => {
      this.#handleChildError(error);
    });

    this.#child.send({
      type: 'start',
      payload: {
        serverCredentials: opts.serverCredentials,
        eventFilter: opts.eventFilter
      }
    });

    this.#status = PlayerFinderStatus.Started;
    return this.#startPromise;
  }

  async stop() {
    if (!this.#child) {
      return;
    }

    sm.getLogger().verbose(
      '[squeezelite_mc] PlayerFinder: stopping child process'
    );

    const child = this.#child;
    this.#child = null;

    if (child.connected) {
      child.send({ type: 'stop' });
      child.disconnect();
    }

    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      if (!child.connected) {
        resolve();
      }
    });

    this.#status = PlayerFinderStatus.Stopped;
  }

  getStatus() {
    return this.#status;
  }

  #handleChildMessage(message: PlayerFinderChildMessage) {
    switch (message.type) {
      case 'log':
        logChildProcessMessage(message.payload.level, message.payload.message);
        break;
      case 'started':
        sm.getLogger().verbose(
          '[squeezelite_mc] PlayerFinder: child process started'
        );
        this.#startResolve?.();
        this.#startResolve = null;
        this.#startReject = null;
        break;
      case 'found':
        this.emit('found', message.payload);
        break;
      case 'lost':
        this.emit('lost', message.payload);
        break;
      case 'error':
        if (this.#startReject) {
          this.#startReject(new Error(message.payload.message));
        } else {
          sm.getLogger().error(
            sm.getErrorMessage(
              '[squeezelite_mc] PlayerFinder: child process error:',
              message.payload.message
            )
          );
        }
        this.emit('error', message.payload.message);
        break;
    }
  }

  #handleChildExit(code: number | null, signal: NodeJS.Signals | null) {
    sm.getLogger().verbose(
      `[squeezelite_mc] PlayerFinder: child process exited (code: ${code}; signal: ${signal})`
    );
    this.#child = null;

    if (this.#startReject) {
      this.#startReject(
        new Error(
          `PlayerFinder: child process exited unexpectedly (${code ?? 'unknown'}${
            signal ? `, signal ${signal}` : ''
          })`
        )
      );
      this.#startResolve = null;
      this.#startReject = null;
    }
  }

  #handleChildError(error: Error) {
    sm.getLogger().error(
      sm.getErrorMessage(
        '[squeezelite_mc] PlayerFinder: child process error: ',
        error
      )
    );
    if (this.#startReject) {
      this.#startReject(error);
      this.#startResolve = null;
      this.#startReject = null;
      return;
    }
  }

  #getChildModulePath() {
    return path.join(__dirname, 'PlayerFinderChild.js');
  }

  on<E extends keyof PlayerFinderEvents>(
    eventName: E,
    listener: PlayerFinderEvents[E]
  ): this {
    return super.on(eventName, listener);
  }
}
