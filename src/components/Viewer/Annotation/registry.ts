/**
 * アノテーション種別ごとのViewer層情報（描画コンポーネント・アイコン・Transformer対応可否）をまとめたレジストリ
 *
 * `AnnotationLayer.vue`・`src/stores/editorTools.ts`はこのレジストリのみを見て種別ごとの分岐を行う。
 * 新しいアノテーション種別を追加する際は、models/document/pdf.tsへの型追加に加えてこのファイルへ
 * 1エントリ追加するだけでよい。`Record<AnnotationStyle['type'], AnnotationTypeModule>`により、
 * 型追加後にエントリ登録を忘れるとコンパイルエラーになる。
 */

import type { Component } from 'vue';
import type { AnnotationStyle } from 'src/models/document/pdf';
import {
  ANNOTATION_GEOMETRY,
  type AnnotationGeometryModule,
} from 'src/services/document/annotationGeometry';
import BoxAnnotation from './BoxAnnotation.vue';
import LineAnnotation from './LineAnnotation.vue';
import CircleAnnotation from './CircleAnnotation.vue';
import ArrowAnnotation from './ArrowAnnotation.vue';

export interface AnnotationTypeModule {
  geometry: AnnotationGeometryModule;
  /** アノテーション実体を描画するVueコンポーネント（annotation/isEditing/isSelected props、update/delete emit） */
  component: Component;
  /** 描画中プレビューに使うkonvaタグ名（vue-konvaが自動登録する`v-xxx`コンポーネント） */
  previewComponent: string;
  /** プリセットボタン（サブツールバー）に使うMaterial Iconsのアイコン名 */
  icon: string;
  /** メインツールバーのアノテーション種別選択ボタンに使うMaterial Iconsのアイコン名（presetのiconとは意図的に別デザインにできる） */
  mainToolIcon: string;
  /** trueの場合、選択時に共有のv-transformerでリサイズする。falseの場合は各コンポーネントが個別のアンカーでリサイズ・編集を行う */
  supportsTransformer: boolean;
}

export const ANNOTATION_REGISTRY: Record<AnnotationStyle['type'], AnnotationTypeModule> = {
  box: {
    geometry: ANNOTATION_GEOMETRY.box,
    component: BoxAnnotation,
    previewComponent: 'v-rect',
    icon: 'check_box_outline_blank',
    mainToolIcon: 'crop_square',
    supportsTransformer: true,
  },
  line: {
    geometry: ANNOTATION_GEOMETRY.line,
    component: LineAnnotation,
    previewComponent: 'v-line',
    icon: 'horizontal_rule',
    mainToolIcon: 'edit',
    supportsTransformer: false,
  },
  circle: {
    geometry: ANNOTATION_GEOMETRY.circle,
    component: CircleAnnotation,
    previewComponent: 'v-circle',
    icon: 'circle',
    mainToolIcon: 'circle',
    supportsTransformer: true,
  },
  arrow: {
    geometry: ANNOTATION_GEOMETRY.arrow,
    component: ArrowAnnotation,
    previewComponent: 'v-arrow',
    icon: 'north_east',
    mainToolIcon: 'north_east',
    supportsTransformer: false,
  },
};

export type AnnotationTypeKey = keyof typeof ANNOTATION_REGISTRY;
