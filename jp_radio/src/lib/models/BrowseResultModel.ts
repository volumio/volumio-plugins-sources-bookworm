// 個別のラジオ局アイテム（Volumio の 1 アイテム表示に対応）
export interface BrowseItem {
  // サービス名（例: 'webradio'）
  service: string;
  // アイテムの種類（例: 'webradio', 'folder' など）
  type: string;
  // タイトル（例: 放送局名 + 番組名）
  title: string;
  // 表示用の画像 URL（例: 局のロゴや番組アートワーク）
  albumart?: string;
  // 選択時に再生や遷移に使用される URI
  uri: string;
  // プレイヤー内部で使われる任意の名前（未使用でも可）
  artist?: string;
  album?: string;
  // サンプルレート（例: '44.1kHz'）
  samplerate?: string;
  // ビット深度（例: 16）
  bitdepth?: number;
  // チャンネル数（例: 2）
  channels?: number;
}

// Browse ページ内の 1 つのリスト（カテゴリや地域別に表示される）
export interface BrowseList {
  // リストのタイトル（例: '関東', '北海道'）
  title: string;
  // 使用可能なリスト表示タイプ（例: 'list', 'grid'）
  availableListViews: string[];
  // 表示されるアイテムの配列
  items: BrowseItem[];
}

// Volumio の UI に表示される全体構造（リストの配列 + 戻るリンクなど）
export interface BrowseNavigation {
  // 表示されるリスト（複数可）
  lists: BrowseList[];
  // 「戻る」ナビゲーションに使う URI（省略可能）
  prev?: { uri: string };
}

// プラグインが返す Browse の結果
export interface BrowseResult {
  // ナビゲーション構造（リストや戻るリンクを含む）
  navigation: BrowseNavigation;
  // 現在の URI
  uri: string;
}
