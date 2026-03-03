import { AudioQuality } from '@patrickkfkan/rp.js';
import rp2 from '../RP2Context';

export type PluginConfigKey = keyof PluginConfigSchema;
export type PluginConfigValue<T extends PluginConfigKey> =
  PluginConfigSchema[T]['defaultValue'];

export interface PluginConfigSchemaEntry<T, U = false> {
  defaultValue: T;
  json: U;
}

export interface PluginConfigSchema {
  audioQuality: PluginConfigSchemaEntry<AudioQuality>;
  persistSession: PluginConfigSchemaEntry<boolean>;
  sessionData: PluginConfigSchemaEntry<string | null>;
}

export const PLUGIN_CONFIG_SCHEMA: PluginConfigSchema = {
  audioQuality: { defaultValue: AudioQuality.Flac, json: false },
  persistSession: { defaultValue: true, json: false },
  sessionData: { defaultValue: null, json: false }
};

export function getAudioQualityOptions() {
  return [
    {
      label: rp2.getI18n('RP2_LOW'),
      value: AudioQuality.Low
    },
    {
      label: rp2.getI18n('RP2_MED'),
      value: AudioQuality.Med
    },
    {
      label: rp2.getI18n('RP2_HIGH'),
      value: AudioQuality.High
    },
    {
      label: rp2.getI18n('RP2_ULTRA'),
      value: AudioQuality.Ultra
    },
    {
      label: rp2.getI18n('RP2_FLAC'),
      value: AudioQuality.Flac
    }
  ];
}
