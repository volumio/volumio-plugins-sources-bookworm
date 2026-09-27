import { type Logger } from 'lms-player-monitor';
import sm from './SqueezeliteMCContext';

export type ChildProcessLogLevel = keyof Logger;

export type ChildMessage = {
  type: 'log';
  payload: { level: ChildProcessLogLevel; message: string };
};

export function logChildProcessMessage(
  level: ChildProcessLogLevel,
  message: string
) {
  switch (level) {
    case 'debug':
      sm.getLogger().verbose(message);
      break;
    case 'error':
      sm.getLogger().error(message);
      break;
    case 'info':
      sm.getLogger().info(message);
      break;
    case 'warn':
      sm.getLogger().warn(message);
      break;
  }
}
