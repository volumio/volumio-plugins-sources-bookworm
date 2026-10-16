"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAreaFilter = exports.resolveAreaIdArray = void 0;
/**
 * 自身のエリア情報文字列(`Radiko.getMyAreaId()`の戻り値、`'JP13/AreaFree'`形式)と
 * 局一覧に実際に含まれる全エリアIDから、番組表取得対象のエリアID配列を決定する。
 * エリアフリー会員は、設定画面(`radikoAreas`)でエリアを選択していればそのエリアのみ、
 * 未選択(空配列)なら全国47エリア。エリアフリーでなければ局一覧に実際に含まれる全エリア
 * (関東圏の他エリア局などを含む、BAYFM78/NACK5/YFMのような局の番組情報欠落を防ぐため)、
 * それも空なら自エリア+JP13にフォールバックする。
 * @param myAreaId `Radiko.getMyAreaId()`の戻り値(`'JP13/AreaFree'`形式)。未初期化の場合はundefined。
 * @param stationAreaIdArray 局一覧に実際に含まれる全エリアIDの一覧。
 * @param selectedAreaIdArray エリアフリー会員が設定画面で選択したエリアIDの一覧。未指定/空なら全国47エリアを対象にする。
 * @returns 番組表取得対象とすべきエリアIDの配列。
 */
function resolveAreaIdArray(myAreaId, stationAreaIdArray, selectedAreaIdArray = []) {
    let idArray;
    if (myAreaId !== undefined) {
        idArray = myAreaId.split('/');
    }
    else {
        idArray = [];
    }
    if (idArray[1] === 'AreaFree') {
        if (selectedAreaIdArray.length > 0) {
            return [...selectedAreaIdArray];
        }
        return Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);
    }
    if (stationAreaIdArray.length > 0) {
        return [...stationAreaIdArray];
    }
    return [idArray[0], 'JP13'];
}
exports.resolveAreaIdArray = resolveAreaIdArray;
/**
 * 局一覧のBrowse表示(ライブ/タイムフリー/検索)を「エリア選択」設定で絞り込むべきエリアID集合を返す。
 * エリアフリー会員が設定画面で1つ以上エリアを選択している場合のみ絞り込みを行い、
 * それ以外(非エリアフリー会員、または未選択)はnull(絞り込みなし=全局対象)を返す。
 * @param myAreaId `Radiko.getMyAreaId()`の戻り値(`'JP13/AreaFree'`形式)。未初期化の場合はundefined。
 * @param selectedAreaIdArray エリアフリー会員が設定画面で選択したエリアIDの一覧。
 * @returns 絞り込み対象のエリアID集合。絞り込み不要ならnull。
 */
function resolveAreaFilter(myAreaId, selectedAreaIdArray) {
    if (selectedAreaIdArray.length === 0) {
        return null;
    }
    const memberType = myAreaId?.split('/')[1];
    if (memberType !== 'AreaFree') {
        return null;
    }
    return new Set(selectedAreaIdArray);
}
exports.resolveAreaFilter = resolveAreaFilter;
//# sourceMappingURL=area-resolver.js.map