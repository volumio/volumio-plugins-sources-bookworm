/**
 * 個別のラジオ局アイテム（Volumio の 1 アイテム表示に対応）
 */
export interface BrowseItem {
    service: string;
    type: string;
    title: string;
    albumart?: string;
    icon?: string;
    uri: string;
    artist?: string;
    album?: string;
    samplerate?: string;
    bitdepth?: number;
    channels?: number;
    favourite?: boolean;
    time?: string;
    duration?: number;
}
/**
 * Browse ページ内の 1 つのリスト（カテゴリや地域別に表示される）
 */
export interface BrowseList {
    title: string;
    availableListViews: string[];
    items: BrowseItem[];
    sortKey?: string;
}
/**
 * Volumio の UI に表示される全体構造（リストの配列 + 戻るリンクなど）
 */
export interface BrowseNavigation {
    lists: BrowseList[];
    prev?: {
        uri: string;
    };
}
/**
 * プラグインが返す Browse の結果
 */
export interface BrowseResult {
    navigation: BrowseNavigation;
    uri: string;
}
//# sourceMappingURL=browse-result-model.d.ts.map