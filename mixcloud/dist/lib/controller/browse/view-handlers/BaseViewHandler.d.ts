import { ModelType } from '../../../model';
import { type OptionBundle } from '../../../model/BaseModel';
import { type GetCloudcastsLoopFetchResult, type GetCloudcastsType } from '../../../model/CloudcastModel';
import type CloudcastModel from '../../../model/CloudcastModel';
import type DiscoverModel from '../../../model/DiscoverModel';
import type LiveStreamModel from '../../../model/LiveStreamModel';
import type PlaylistModel from '../../../model/PlaylistModel';
import type TagModel from '../../../model/TagModel';
import type UserModel from '../../../model/UserModel';
import { type UILink } from '../../../util/UIHelper';
import { type ExplodedTrackInfo } from './ExplodableViewHandler';
import { type PageRef } from './View';
import type View from './View';
import { type RenderedList, type RenderedPage } from './ViewHandler';
import type ViewHandler from './ViewHandler';
import { RendererType } from './renderers';
import { type RenderedListItem } from './renderers/BaseRenderer';
import type CloudcastRenderer from './renderers/CloudcastRenderer';
import type LiveStreamRenderer from './renderers/LiveStreamRenderer';
import type PlaylistRenderer from './renderers/PlaylistRenderer';
import type SlugRenderer from './renderers/SlugRenderer';
import type UserRenderer from './renderers/UserRenderer';
export default class BaseViewHandler<V extends View> implements ViewHandler {
    #private;
    constructor(uri: string, currentView: V, previousViews: View[]);
    browse(): Promise<RenderedPage>;
    explode(): Promise<ExplodedTrackInfo[]>;
    get uri(): string;
    get currentView(): V;
    get previousViews(): View[];
    protected getModel(type: ModelType.Cloudcast): CloudcastModel;
    protected getModel(type: ModelType.Discover): DiscoverModel;
    protected getModel(type: ModelType.Playlist): PlaylistModel;
    protected getModel(type: ModelType.Tag): TagModel;
    protected getModel(type: ModelType.User): UserModel;
    protected getModel(type: ModelType.LiveStream): LiveStreamModel;
    protected getRenderer(type: RendererType.Cloudcast): CloudcastRenderer;
    protected getRenderer(type: RendererType.Playlist): PlaylistRenderer;
    protected getRenderer(type: RendererType.Slug): SlugRenderer;
    protected getRenderer(type: RendererType.User): UserRenderer;
    protected getRenderer(type: RendererType.LiveStream): LiveStreamRenderer;
    protected constructPrevUri(): string;
    protected constructNextUri(nextPageRef: PageRef): string;
    protected constructNextPageItem(nextUri: string, title?: string): RenderedListItem;
    protected constructPrevViewLink(text: string): {
        url: string;
        text: string;
        onclick: string;
        icon: {
            type: "fa" | "mixcloud";
            float?: string;
            color?: string;
            class?: string;
        } | undefined;
    };
    constructPageRef(pageToken?: string | null, pageOffset?: number): PageRef | null;
    protected constructGoToViewLink(text: string, uri: string): UILink;
    protected getCloudcastList<T extends GetCloudcastsType>(cloudcasts: GetCloudcastsLoopFetchResult<T>, showMoreFromUser?: boolean): RenderedList;
    protected browseOptionValues<T extends OptionBundle<any>>(params: {
        getOptionBundle: () => Promise<T>;
        targetOption: string;
    }): Promise<RenderedPage>;
    protected getOptionList<T extends OptionBundle<any>>(params: {
        getOptionBundle: () => Promise<T>;
        currentSelected: {
            [K in keyof T]?: T[K]['values'][number]['value'];
        };
        showOptionName?: (option: keyof T) => boolean;
    }): Promise<RenderedList | null>;
}
//# sourceMappingURL=BaseViewHandler.d.ts.map