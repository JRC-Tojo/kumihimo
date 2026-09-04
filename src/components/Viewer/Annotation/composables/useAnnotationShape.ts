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
import type { AnnotationGroupID } from 'src/models/document/group';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { getRelationalStyleOverride } from '../relationalStyleOverride';
import { useModifierKeys } from './useModifierKeys';
import { resolveAnnotationEcho } from 'src/utils/document/annotationWritePending';
import {
  lockToDominantAxis,
  applyCenteredResize,
  type Point,
  type Box,
} from 'src/utils/document/annotationDrag';
import { strokeTypeToDash } from 'src/utils/document/strokeDash';
import { blendModeToComposite } from 'src/utils/document/blendMode';
import { hexToRgba } from 'src/utils/color/hexToRgba';

type KonvaEvent = Konva.KonvaEventObject<Event>;

export function useAnnotationShape<T extends AnnotationStyle>(props: {
  annotation: T;
  // このアノテーションが所属するグループのID（グループに属していなければundefined）。
  // グループを端点とする関係性の検証結果も、自分自身の表示スタイルへ反映するために使う
  groupId?: AnnotationGroupID | undefined;
  // このアノテーションが属するファイルの関係性一覧読み込みが直近で失敗しているか
  // （`relationalStore.hasLoadError`参照）。trueの間は、実際にこのアノテーションが関係性を
  // 持つかどうかを判定できないため、通常の検証状態に関わらずNGと同じスタイルで警告表示する
  relationalLoadError?: boolean | undefined;
}) {
  const relationalStore = useRelationalStore();
  const settingsStore = useSettingsStore();
  const { shiftKey, ctrlKey } = useModifierKeys();

  // 関係性の検証結果（OK/NG）による表示上書き。関連なし・検証保留中はundefined（元のスタイルを維持）。
  // 自分自身を端点とする関係性だけでなく、所属グループを端点とする関係性の検証結果も合わせて見る
  const relationalOverride = computed(() => {
    const status = props.relationalLoadError
      ? 'error'
      : relationalStore.statusForAnnotationIncludingGroup(props.annotation.id, props.groupId);
    return getRelationalStyleOverride(status, settingsStore.relationalVerificationStyle);
  });

  /** 現在のannotationにpatchを反映し、updatedAtを更新した新しいオブジェクトを返す */
  function withUpdatedTimestamp<P extends object>(patch: P): T & P {
    return { ...props.annotation, ...patch, updatedAt: dayjs().toISOString() };
  }

  // ドラッグ/変形/頂点編集などのジェスチャー中かどうか
  const isInteracting = ref(false);
  // 実際にkonvaノードへ渡すannotation。ジェスチャー中はpropsの更新を無視し、
  // 自動保存やOCR結果反映などによるDexie/liveQueryの再emitで座標が巻き戻る（ガタつく）のを防ぐ。
  // ジェスチャー終了後も、resolveAnnotationEchoが「自分が最後にローカルで書き込もうとした
  // 内容とちょうど一致するエコーか」を判定し、一致するまでは古い/中間状態のpropsの更新を
  // 無視する。DBへの書き込み自体はファイル単位で発行順に確定するが、DB購読（liveQuery）側の
  // 反映はその確定から幾らか遅れて非同期に届くため、「自分の書き込みのPromiseが解決した」
  // だけで判定してしまうと、実際にはまだ古い内容のままのpropsを一度受け入れてしまい、
  // 一度確定して見えた変更が古い状態へ巻き戻ってから再度追いつく（ちらつく）ことがある。
  // 内容が一致するエコーそのものを待つことで、書き込みの完了タイミングに関わらず
  // 中間状態を一切表示しないようにする（annotationWritePending.ts参照）
  const displayAnnotation: Ref<T> = ref(props.annotation) as Ref<T>;
  watch(
    () => props.annotation,
    (next) => {
      if (isInteracting.value) return;
      if (!resolveAnnotationEcho(next)) return;
      displayAnnotation.value = next;
    },
    { immediate: true },
  );

  // 線種（破線・点線等）に対応するKonvaのdash設定。全種別の描画コンポーネントで共通利用する
  const strokeDash = computed(() =>
    strokeTypeToDash(displayAnnotation.value.strokeType, displayAnnotation.value.strokeWidth || 2),
  );

  // 半透明の図形を下地の文書とどう合成するか（既定は通常の重ね描き）。全種別の描画コンポーネントで共通利用する
  const globalCompositeOperation = computed(() =>
    blendModeToComposite(displayAnnotation.value.blendMode),
  );

  // 当たり判定の太さ。以前は見た目の線幅を最大4倍・最低12pxまで広げていたため、
  // 近接する別のアノテーションを誤って選択してしまう問題があった（Issue #82）。
  // 延長方向のみ制御可能な種別（line/arrow/polyline/polygon）は実際の太さを参照できるため、
  // 見た目の線幅（strokeWidth）とそのまま一致させる。strokeWidthが取得できない場合のみ、
  // 誤選択が起きにくいよう以前より細めの定数へフォールバックする
  const HIT_STROKE_WIDTH_FALLBACK = 4;
  const hitStrokeWidth = computed(
    () => displayAnnotation.value.strokeWidth || HIT_STROKE_WIDTH_FALLBACK,
  );

  /**
   * 明示的な不透明度（strokeOpacity/fillOpacity）が未設定の場合、後方互換のため
   * 旧`opacity`フィールド（枠線・塗り共通の単一値だった名残）にフォールバックする
   */
  function resolveOpacity(explicit: number | undefined): number {
    return explicit ?? displayAnnotation.value.opacity ?? 1;
  }

  /**
   * 線色に線の不透明度をrgbaで合成する（fillと同じ「未設定＝色なし」の規約に揃える）
   *
   * `resolveFill`と対になる関数。色が未設定（「線色なし」）の場合は`'transparent'`を返し、
   * Konvaのノードに実際の枠線が描画されないようにする
   */
  function resolveStroke(color: string | undefined, strokeOpacity: number | undefined): string {
    if (!color) return 'transparent';
    return hexToRgba(color, resolveOpacity(strokeOpacity));
  }

  /**
   * 枠線色。Konvaのノードはfill/strokeそれぞれ個別のopacityを持たないため、
   * 線の不透明度は色側にrgba合成して表現する。関係性の検証結果による上書きがあれば優先する
   */
  const resolvedStroke = computed(() => {
    if (relationalOverride.value) {
      return hexToRgba(
        relationalOverride.value.stroke,
        resolveOpacity(displayAnnotation.value.strokeOpacity),
      );
    }
    return resolveStroke(displayAnnotation.value.color, displayAnnotation.value.strokeOpacity);
  });

  /**
   * 塗り色に塗りの不透明度をrgbaで合成する（box/circle/polygon/textのみ呼び出す）
   *
   * 関係性の検証結果による上書きがある場合、上書き側は既に検証スタイル定義の不透明度を
   * 含んだrgba値のためそのまま優先し、アノテーション自体のfillOpacityは重ねて適用しない
   */
  function resolveFill(fillColor: string | undefined, fillOpacity: number | undefined): string {
    if (relationalOverride.value) return relationalOverride.value.fill;
    if (!fillColor) return 'transparent';
    return hexToRgba(fillColor, resolveOpacity(fillOpacity));
  }

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
    strokeDash,
    globalCompositeOperation,
    hitStrokeWidth,
    resolveOpacity,
    resolvedStroke,
    resolveStroke,
    resolveFill,
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
