import sc from '../SoundCloudContext';
import BaseModel from './BaseModel';
import Mapper from './Mapper';

export interface SelectionModelGetSelectionsParams {
  type: 'mixed' | 'charts';
}

export default class SelectionModel extends BaseModel {

  async getSelections(params: SelectionModelGetSelectionsParams) {
    const api = this.getSoundCloudAPI();
    const collection = await sc.getCache().getOrSet(
      this.getCacheKeyForFetch('selections', { ...params }),
      () => {
        switch (params.type) {
          case 'mixed':
            return api.getMixedSelections();
          case 'charts':
            return api.getCharts();
        }
      }
    );
    const mapPromises = collection.items.map((item) =>
      Mapper.mapSelection(item).catch(() => null),
    );
    const mapped = await Promise.all(mapPromises);
    return mapped.filter((item) => item !== null);
  }
}
