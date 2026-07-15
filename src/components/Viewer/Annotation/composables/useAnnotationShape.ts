/**
 * アノテーション描画コンポーネント（BoxAnnotation等）に共通する処理をまとめたコンポーザブル
 *
 * Vue 3の単一ファイルコンポーネントはクラス継承をサポートしないため、
 * 各アノテーション種別のコンポーネントに共通するロジック（関係性検証結果によるスタイル上書き、
 * 更新後オブジェクトの生成）は継承の代わりにコンポーザブルとして合成する。
 */

import { computed } from 'vue';
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

  return { relationalOverride, withUpdatedTimestamp };
}
