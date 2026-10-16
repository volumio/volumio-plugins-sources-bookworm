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
    '@id': string;
    progs: {
        prog: {
            '@id': string;
            '@ft': string;
            '@to': string;
            title: string;
            pfm?: string;
            img: string;
        }[];
    };
}
//# sourceMappingURL=radiko-xml-station-model.d.ts.map