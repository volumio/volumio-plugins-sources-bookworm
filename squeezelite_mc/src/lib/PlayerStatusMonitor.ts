import EventEmitter from 'events';
import path from 'path';
import { fork, type ChildProcess } from 'child_process';
import sm from './SqueezeliteMCContext';
import { type PlayerStatus } from './types/Player';
import type Player from './types/Player';
import { type ServerCredentials } from './types/Server';
import { logChildProcessMessage } from './ChildProcessUtils';
import type { PlayerStatusMonitorChildMessage } from './PlayerStatusMonitorChild';

export default class PlayerStatusMonitor extends EventEmitter {
  #player: Player;
  #serverCredentials: ServerCredentials;
  #child: ChildProcess | null;
  #deferredEmitTimer: NodeJS.Timeout | null;
  #startPromise: Promise<void> | null;
  #startResolve: (() => void) | null;
  #startReject: ((error: unknown) => void) | null;

  constructor(player: Player, serverCredentials: ServerCredentials) {
    super();
    this.#player = player;
    this.#serverCredentials = serverCredentials;
    this.#child = null;
    this.#deferredEmitTimer = null;
    this.#startPromise = null;
    this.#startResolve = null;
    this.#startReject = null;
  }

  async start() {
    if (this.#child) {
      return this.#startPromise ?? Promise.resolve();
    }

    const childPath = this.#getChildModulePath();
    sm.getLogger().verbose(
      `[squeezelite_mc] PlayerStatusMonitor: fork child process at ${childPath}`
    );

    this.#child = fork(childPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    this.#startPromise = new Promise((resolve, reject) => {
      this.#startResolve = resolve;
      this.#startReject = reject;
    });

    this.#child.on('message', (message: PlayerStatusMonitorChildMessage) => {
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
        player: this.#player,
        serverCredentials: this.#serverCredentials
      }
    });

    return this.#startPromise;
  }

  async stop() {
    if (!this.#child) {
      return;
    }

    sm.getLogger().verbose(
      '[squeezelite_mc] PlayerStatusMonitor: stopping child process'
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
  }

  getPlayer() {
    return this.#player;
  }

  requestUpdate() {
    if (!this.#child || !this.#child.connected) {
      return;
    }

    this.#child.send({ type: 'requestUpdate' });
  }

  #handleChildMessage(message: PlayerStatusMonitorChildMessage) {
    switch (message.type) {
      case 'log':
        logChildProcessMessage(message.payload.level, message.payload.message);
        break;
      case 'started':
        sm.getLogger().verbose(
          '[squeezelite_mc] PlayerStatusMonitor: child process started'
        );
        this.#startResolve?.();
        this.#startResolve = null;
        this.#startReject = null;
        break;
      case 'update':
        this.#cancelPendingEmit();
        this.#deferredEmitTimer = setTimeout(() => {
          this.emit('update', message.payload);
        }, 200);
        break;
      case 'disconnect':
        this.emit('disconnect', this.#player);
        break;
      case 'error':
        if (this.#startReject) {
          this.#startReject(new Error(message.payload.message));
        } else {
          sm.getLogger().error(
            sm.getErrorMessage(
              '[squeezelite_mc] PlayerStatusMonitor: child process error:',
              message.payload.message
            )
          );
        }
        break;
    }
  }

  #handleChildExit(code: number | null, signal: NodeJS.Signals | null) {
    sm.getLogger().verbose(
      `[squeezelite_mc] PlayerStatusMonitor: child process exited (code: ${code}; signal: ${signal})`
    );
    this.#child = null;
    this.#cancelPendingEmit();

    if (this.#startReject) {
      this.#startReject(
        new Error(
          `PlayerStatusMonitor: child process exited unexpectedly (${code ?? 'unknown'}${
            signal ? `, signal ${signal}` : ''
          })`
        )
      );
      this.#startResolve = null;
      this.#startReject = null;
      return;
    }

    this.emit('disconnect', this.#player);
  }

  #handleChildError(error: Error) {
    sm.getLogger().error(
      sm.getErrorMessage(
        '[squeezelite_mc] PlayerStatusMonitor: child process error: ',
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

  #cancelPendingEmit() {
    if (this.#deferredEmitTimer) {
      clearTimeout(this.#deferredEmitTimer);
      this.#deferredEmitTimer = null;
    }
  }

  #getChildModulePath() {
    return path.join(__dirname, 'PlayerStatusMonitorChild.js');
  }

  emit(
    event: 'update',
    data: { player: Player; status: PlayerStatus }
  ): boolean;
  emit(event: 'disconnect', player: Player): boolean;
  emit<K>(eventName: string | symbol, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }

  on(
    event: 'update',
    listener: (data: { player: Player; status: PlayerStatus }) => void
  ): this;
  on(event: 'disconnect', listener: (player: Player) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
