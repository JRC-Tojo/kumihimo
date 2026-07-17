/**
 * アノテーション描画コンポーネント（BoxAnnotation等）に共通する処理をまとめたコンポーザブル
 *
 * Vue 3の単一ファイルコンポーネントはクラス継承をサポートしないため、
 * 各アノテーション種別のコンポーネントに共通するロジック（関係性検証結果によるスタイル上書き、
 * 更新後オブジェクトの生成）は継承の代わりにコンポーザブルとして合成する。
 */

import { computed, ref, watch, type Ref } from 'vue';
import dayjs from 'dayjs';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { getRelationalStyleOverride } from '../relationalStyleOverride';

export function useAnnotationShape<T extends AnnotationStyle>(props: { annotation: T }) {
  const relationalStore = useRelationalStore();
  const settingsStore = useSettingsStore();

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

  return {
    relationalOverride,
    withUpdatedTimestamp,
    displayAnnotation,
    beginInteraction,
    endInteraction,
  };
}
