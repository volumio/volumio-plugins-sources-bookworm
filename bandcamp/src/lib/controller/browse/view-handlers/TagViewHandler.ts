import bandcamp from '../../../BandcampContext';
import type TagEntity from '../../../entities/TagEntity';
import { ModelType } from '../../../model';
import UIHelper from '../../../util/UIHelper';
import type View from './View';
import { type RenderedList, type RenderedPage } from './ViewHandler';
import { RendererType } from './renderers';
import { type RenderedListItem } from './renderers/BaseRenderer';
import BaseViewHandler from './BaseViewHandler';

export interface TagView extends View {
  name: 'tag';
  tagUrl: string;
  select?: string;
}

export default class TagViewHandler extends BaseViewHandler<TagView> {
  async browse(): Promise<RenderedPage> {
    return this.#browseTags();
  }

  async #browseTags(): Promise<RenderedPage> {
    const tags = await this.getModel(ModelType.Tag).getTags();
    const lists = [
      this.#getTagsList(
        tags,
        'tags',
        bandcamp.getI18n('BANDCAMP_TAGS'),
        'fa fa-tag'
      )
    ];

    return {
      navigation: {
        prev: { uri: this.constructPrevUri() },
        lists
      }
    };
  }

  #getTagsList(
    tags: Record<string, TagEntity[]>,
    key: string,
    title: string,
    icon: string
  ): RenderedList {
    const tagRenderer = this.getRenderer(RendererType.Tag);
    const listItems = tags[key].reduce<RenderedListItem[]>((result, tag) => {
      const rendered = tagRenderer.renderToListItem(tag);
      if (rendered) {
        result.push(rendered);
      }
      return result;
    }, []);

    return {
      title: UIHelper.addIconToListTitle(icon, title),
      availableListViews: ['list'],
      items: listItems
    };
  }
}
