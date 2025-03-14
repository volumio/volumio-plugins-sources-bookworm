import type PlaylistEntity from './PlaylistEntity';
interface SelectionEntity {
    type: 'selection';
    id?: string | null;
    title?: string | null;
    items: PlaylistEntity[];
}
export default SelectionEntity;
//# sourceMappingURL=SelectionEntity.d.ts.map