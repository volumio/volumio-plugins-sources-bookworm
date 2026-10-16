/**
 * 番組表XML(`PROG_DATE_AREA_URL`)をパースした結果のルート構造。
 */
export interface RadikoXMLData {
  radiko: {
    stations: {
      station: RadikoXMLStation[];
    };
  };
}

/**
 * 番組表XML内の1局分のデータ。
 */
export interface RadikoXMLStation {
  // 局ID
  '@id': string;
  progs: {
    prog: {
      // 番組ID(局IDと連結してDBのキーにする)
      '@id': string;
      // 放送開始時刻(`'yyyyMMddHHmmss'`)
      '@ft': string;
      // 放送終了時刻(`'yyyyMMddHHmmss'`)
      '@to': string;
      title: string;
      pfm?: string;
      img: string;
    }[];
  };
}
