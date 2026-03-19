// Auto-generated from ./src/UIConfig.json

import {
  UIConfigButton,
  UIConfigSelect,
  UIConfigSwitch
} from './ui-config-types';
export type UIConfigSectionKey = 'section_general';

export type UIConfigSectionContentKeyOf<K extends UIConfigSectionKey> =
  K extends 'section_general' ?
    | 'audioQuality'
    | 'persistSession'
    | 'showChannel'
    | 'supportRP'
    | 'projectHome'
  : never;

export type UIConfigElementOf<
  K extends UIConfigSectionKey,
  C extends UIConfigSectionContentKeyOf<K>
> =
  K extends 'section_general' ?
    C extends 'audioQuality' ? UIConfigSelect<K>
    : C extends 'persistSession' ? UIConfigSwitch<K>
    : C extends 'showChannel' ? UIConfigSwitch<K>
    : C extends 'supportRP' ? UIConfigButton<K>
    : C extends 'projectHome' ? UIConfigButton<K>
    : never
  : never;
