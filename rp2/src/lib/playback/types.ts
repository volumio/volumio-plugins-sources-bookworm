export interface QueueItem {
  service: 'rp2';
  uri: string;
  albumart?: string;
  artist?: string;
  album?: string;
  name: string;
  title: string;
  duration?: number;
  samplerate?: string;
}
