/**
 * アノテーション描画コンポーネント（BoxAnnotation等）に共通する処理をまとめたコンポーザブル
 *
 * Vue 3の単一ファイルコンポーネントはクラス継承をサポートしないため、
 * 各アノテーション種別のコンポーネントに共通するロジック（関係性検証結果によるスタイル上書き、
 * 更新後オブジェクトの生成、ドラッグ・変形時のショートカット挙動）は継承の代わりに
 * コンポーザブルとして合成する。
 */

import { computed, ref, watch, type Ref } from 'vue';
import dayjs from 'dayjs';
import type Konva from 'konva';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { getRelationalStyleOverride } from '../relationalStyleOverride';
import { useModifierKeys } from './useModifierKeys';
import {
  lockToDominantAxis,
  applyCenteredResize,
  type Point,
  type Box,
} from 'src/utils/document/annotationDrag';

type KonvaEvent = Konva.KonvaEventObject<Event>;

export function useAnnotationShape<T extends AnnotationStyle>(props: { annotation: T }) {
  const relationalStore = useRelationalStore();
  const settingsStore = useSettingsStore();
  const { shiftKey, ctrlKey } = useModifierKeys();

  // 関係性の検証結果（OK/NG）による表示上書き。関連なし・検証保留中はundefined（元のスタイルを維持）
  const relationalOverride = computed(() =>
    getRelationalStyleOverride(
      relationalStore.statusForAnnotation(props.annotation.id),
      settingsStore.relationalVerificationStyle,
    ),
  );

  /** 現在のannotationにpatchを反映し、updatedAtを更新した新しいオブジェクトを返す */
  function withUpdatedTimestamp<P extends object>(patch: P): T & P {
    return { ...props.annotation, ...patch, updatedAt: dayjs().toISOString() };
  }

  // ドラッグ/変形/頂点編集などのジェスチャー中かどうか
  const isInteracting = ref(false);
  // 実際にkonvaノードへ渡すannotation。ジェスチャー中はpropsの更新を無視し、
  // 自動保存やOCR結果反映などによるDexie/liveQueryの再emitで座標が巻き戻る（ガタつく）のを防ぐ
  const displayAnnotation: Ref<T> = ref(props.annotation) as Ref<T>;
  watch(
    () => props.annotation,
    (next) => {
      if (!isInteracting.value) displayAnnotation.value = next;
    },
    { immediate: true },
  );

  /** ジェスチャー開始時に呼び、以降のprops更新を無視するようにする */
  function beginInteraction() {
    isInteracting.value = true;
  }

  /**
   * ジェスチャー終了時に呼び、props追従を再開する。
   *
   * `committed`にはこのジェスチャーで実際にemitした（=これからDB書き込みが反映されるはずの）
   * annotationを渡すこと。ここで`props.annotation`へ再同期すると、DB書き込み～liveQueryの
   * emitが返ってくるまでの間はまだ古い値のままなので、確定直後に一瞬古い座標へ巻き戻って見える
   * （がたつきの逆再発）。ジェスチャーで確定した値をそのまま表示し続け、後から追従してくる
   * props.annotationが同内容になった時点で自然に引き継ぐようにする。
   */
  function endInteraction(committed?: T) {
    isInteracting.value = false;
    displayAnnotation.value = committed ?? props.annotation;
  }

  // ============ ボディドラッグ（Shift軸ロック・Ctrl複製） ============

  // ドラッグ開始時の絶対座標（dragBoundFuncは絶対座標基準のため、拡大縮小・パン中でも
  // 正しく軸ロックできるよう絶対座標で保持する）
  const dragStartAbsPos = ref<Point | null>(null);

  /** ボディドラッグ開始時に呼ぶ。beginInteractionに加え、軸ロックの基準座標を保持する */
  function beginBodyDrag(node: Konva.Node) {
    beginInteraction();
    dragStartAbsPos.value = node.getAbsolutePosition();
  }

  /**
   * ドラッグ中の位置を制限するKonva用コールバック（Shift+dragで水平・垂直方向に制限する）
   *
   * ノードの`dragBoundFunc`設定にそのまま渡すことを想定している
   */
  function dragBoundFunc(pos: Point): Point {
    if (!shiftKey.value || !dragStartAbsPos.value) return pos;
    return lockToDominantAxis(dragStartAbsPos.value, pos);
  }

  /**
   * ボディドラッグ終了時の共通コミット処理
   *
   * Ctrl+drag複製はAnnotationLayer.vue側のステージレベル処理（プレビュー表示＋ドロップ位置での
   * 複製確定）に一本化しており、ここでは通常の移動更新のみを扱う。Ctrl押下中はそもそも
   * `draggable`をfalseにしてKonvaネイティブドラッグ自体を発生させない（各シェイプの
   * draggable算出を参照）ため、このコミット処理がCtrl押下中に呼ばれることはない
   */
  function commitBodyDrag(e: KonvaEvent, patch: { x: number; y: number }): T {
    const updated = withUpdatedTimestamp(patch);
    endInteraction(updated);
    return updated;
  }

  // ============ Transformer変形（Ctrl中心固定リサイズ、Box/Text向け） ============

  // 変形開始時のbox（左上原点のシェイプ専用。Circleは中心原点のため個別に扱う）
  const transformStartBox = ref<Box | null>(null);

  /**
   * Transformer変形開始時に呼ぶ。beginInteractionに加え、中心固定補正の基準boxを保持する
   *
   * `box`には変形対象の現在のx/y（左上）・width/height を渡すこと。KonvaのGroupノードは
   * 自身のwidth()/height()が実際の見た目のサイズと一致するとは限らない（例: TextBoxAnnotationの
   * 背景矩形は子要素にサイズを持つ）ため、ノードから直接読み取らず呼び出し元に計算させる
   */
  function beginTransform(box: Box) {
    beginInteraction();
    transformStartBox.value = box;
  }

  /**
   * Ctrl押下時のみ、中心固定になるようノードのx/yを補正する（左上原点のシェイプ専用）
   *
   * `newSize`にはリサイズ後の幅・高さを渡す。呼び出し元でscaleX/scaleYをリセットした後に呼ぶこと
   */
  function applyCenteredCorrection(
    node: Konva.Node,
    newSize: { width: number; height: number },
  ): void {
    if (!ctrlKey.value || !transformStartBox.value) return;
    const corrected = applyCenteredResize(transformStartBox.value, newSize);
    node.setAttrs({ x: corrected.x, y: corrected.y });
  }

  return {
    relationalOverride,
    withUpdatedTimestamp,
    displayAnnotation,
    beginInteraction,
    endInteraction,
    shiftKey,
    ctrlKey,
    beginBodyDrag,
    dragBoundFunc,
    commitBodyDrag,
    beginTransform,
    applyCenteredCorrection,
  };
}
