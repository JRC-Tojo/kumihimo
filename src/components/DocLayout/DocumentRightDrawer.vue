<template>
  <div v-show="drawerOpen" class="document-right-drawer">
    <!-- アノテーション選択時の詳細 -->
    <div v-if="selectedAnnots.length > 0" class="drawer-section q-pa-md">
      <h6 class="q-my-none q-mb-md">{{ $t('pdfEditor.rightDrawer.annotation.title') }}</h6>
      <div class="annotation-properties">
        <!-- アノテーション型 -->
        <div class="property-group q-mb-md">
          <label class="property-label">{{ $t('pdfEditor.rightDrawer.annotation.type') }}</label>
          <div class="property-value">{{ selectedAnnotationType }}</div>
        </div>

        <!-- arrow/polyline: 開始側の矢じり形状・矢じりサイズ（終端側・線色等はスタイルパネルで調整する） -->
        <template v-if="isHeadedSelection">
          <div class="property-group q-mb-md">
            <label class="property-label">{{
              $t('pdfEditor.rightDrawer.annotation.startHead')
            }}</label>
            <q-select
              :model-value="startHead"
              :options="headOptions"
              emit-value
              map-options
              dense
              outlined
              @update:model-value="(v: ArrowHeadType) => (startHead = v)"
            />
          </div>
          <div class="property-group q-mb-md">
            <label class="property-label">{{
              $t('pdfEditor.rightDrawer.annotation.headSize')
            }}</label>
            <div class="slider-container">
              <q-slider
                :model-value="headSize ?? 10"
                :min="4"
                :max="40"
                :step="1"
                label
                @update:model-value="(v) => (headSize = v ?? undefined)"
              />
            </div>
          </div>
        </template>

        <!-- text: フォントウェイト・文字揃え・背景色（フォント種別/サイズ/文字色はスタイルパネルで調整する） -->
        <template v-if="isTextSelection">
          <div class="property-group q-mb-md">
            <label class="property-label">{{
              $t('pdfEditor.rightDrawer.annotation.fontWeight')
            }}</label>
            <q-select
              :model-value="fontWeight"
              :options="fontWeightOptions"
              emit-value
              map-options
              dense
              outlined
              @update:model-value="(v: number) => (fontWeight = v)"
            />
          </div>
          <div class="property-group q-mb-md">
            <label class="property-label">{{
              $t('pdfEditor.rightDrawer.annotation.textAlign')
            }}</label>
            <q-btn-toggle
              :model-value="textAlign"
              :options="textAlignOptions"
              dense
              @update:model-value="(v: 'left' | 'center' | 'right') => (textAlign = v)"
            />
          </div>
          <div class="property-group q-mb-md">
            <label class="property-label">{{
              $t('pdfEditor.rightDrawer.annotation.fillColor')
            }}</label>
            <StyleSwatchButton
              v-model="fillColor"
              :tooltip="$t('pdfEditor.rightDrawer.annotation.fillColor')"
            />
          </div>
        </template>

        <!-- 関係性設定 -->
        <q-separator class="q-my-md" />
        <div class="property-group q-mb-md">
          <label class="property-label">{{
            $t('pdfEditor.rightDrawer.annotation.relations')
          }}</label>
          <q-btn
            v-if="selectedAnnots.length === 1"
            outline
            color="primary"
            icon="link"
            :label="$t('pdfEditor.rightDrawer.annotation.addRelation')"
            size="sm"
            @click="onAddRelationClicked"
          />

          <!-- 既存のリンク一覧 -->
          <div v-if="selectedAnnots.length === 1" class="relation-list q-mt-sm">
            <p v-if="relationEdges.length === 0" class="text-caption text-grey-6 q-mb-none">
              {{ $t('pdfEditor.rightDrawer.annotation.noRelations') }}
            </p>
            <template v-else>
              <!-- 自身の値（比較のもう一方の基準として、一覧とは別に一度だけ表示） -->
              <div class="self-value q-mb-sm">
                <span class="text-caption text-grey-6">
                  {{ $t('pdfEditor.rightDrawer.annotation.selfValue') }}:
                </span>
                <span class="self-value-text">{{ selfValueDisplay }}</span>
              </div>

              <div v-for="edge in relationEdges" :key="edgeKey(edge)" class="relation-row q-mb-sm">
                <div class="relation-row-main">
                  <q-icon
                    :name="statusIcon(edge)"
                    :color="statusColor(edge)"
                    size="1.2rem"
                    class="q-mr-sm"
                  />
                  <span class="relation-target-label">{{ otherFileLabel(edge) }}</span>
                </div>
                <div class="relation-row-value q-mt-xs text-caption text-grey-7">
                  {{ $t('pdfEditor.rightDrawer.annotation.otherValue') }}:
                  {{ otherValueDisplay(edge) }}
                </div>
                <div class="relation-row-actions q-mt-xs">
                  <q-select
                    :model-value="edge.relational.rule.type"
                    :options="ruleTypeOptions"
                    emit-value
                    map-options
                    dense
                    outlined
                    class="rule-select"
                    @update:model-value="(v: RelationalRuleType) => onChangeRuleType(edge, v)"
                  />
                  <q-btn
                    flat
                    round
                    dense
                    icon="link_off"
                    size="sm"
                    color="negative"
                    @click="onRemoveRelation(edge)"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- 削除ボタン -->
        <q-separator class="q-my-md" />
        <q-btn
          outline
          color="negative"
          icon="delete"
          :label="$t('pdfEditor.rightDrawer.annotation.delete')"
          @click="deleteAnnot"
          class="full-width"
        />
      </div>
    </div>

    <!-- アノテーション未選択時 -->
    <div v-else class="drawer-empty q-pa-md">
      <q-icon name="info" size="2rem" color="grey-5" />
      <p class="q-mt-md text-grey-6">{{ $t('pdfEditor.rightDrawer.annotation.notSelected') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBackendApi } from 'src/apis/backendApi';
import dayjs from 'dayjs';
import { ColorCode, type AnnotationID, type AnnotationStyle } from 'src/models/document/pdf';
import type { ArrowHeadType } from 'src/models/document/pdf';
import type { ContainerElementFile } from 'src/models/container';
import { buildRelationalRule, type RelationalRuleType } from 'src/models/relational/ruleUtils';
import {
  useRelationalStore,
  edgeValueFor,
  otherEdgeValueFor,
  type RelationalEdge,
} from 'src/stores/relationalStore';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import StyleSwatchButton from './StyleSwatchButton.vue';

interface Prop {
  selectedAnnots: AnnotationStyle[];
  file: ContainerElementFile;
  /** 選択中の注釈を削除する（useAnnotationActionsの共有実装。DocumentTabView.vueから渡される） */
  onDeleteSelected: () => Promise<void>;
}
const prop = defineProps<Prop>();

const emit = defineEmits<{
  'add-relation': [annotId: AnnotationID];
}>();

const api = useBackendApi();
const relationalStore = useRelationalStore();
const { t } = useI18n();

const drawerOpen = defineModel<boolean>('drawerOpen', { required: true });

// アノテーションのプロパティ（初期値は単一選択の場合はプロパティを反映し、その他はundefinedを与える）
const getDefault = <K extends keyof AnnotationStyle>(
  styleKey: K,
): AnnotationStyle[K] | undefined => {
  if (prop.selectedAnnots.length === 1) {
    return prop.selectedAnnots[0]?.[styleKey];
  } else {
    return undefined;
  }
};
const selectedAnnotationType = computed(() => getDefault('type'));

/** 複数選択時、全アイテムで値が一致していればその値を、食い違っていればundefined（混在）を返す */
function commonValue<T, V>(items: T[], getter: (item: T) => V): V | undefined {
  if (items.length === 0) return undefined;
  const first = getter(items[0] as T);
  return items.every((item) => getter(item) === first) ? first : undefined;
}

/**
 * 選択中の各アノテーションに、種別に応じたpatchを適用して保存する（対象外の種別はnullを返してスキップする）
 */
async function applyPatch(
  building: (annot: AnnotationStyle) => Partial<AnnotationStyle> | null,
): Promise<void> {
  const now = dayjs().toISOString();
  await Promise.all(
    prop.selectedAnnots.map((annot) => {
      const patch = building(annot);
      if (!patch) return Promise.resolve();
      return api.registerAnnotationStyle(prop.file, {
        ...annot,
        ...patch,
        updatedAt: now,
      } as AnnotationStyle);
    }),
  );
}

// ================================ 型別の詳細プロパティ ================================
// スタイルパネル（AnnotationStylePanel.vue）で扱う共通4項目・種別ごとの主要項目とは別に、
// より細かい型別プロパティのみをここで扱う

const isHeadedSelection = computed(
  () =>
    prop.selectedAnnots.length > 0 &&
    prop.selectedAnnots.every((a) => a.type === 'arrow' || a.type === 'polyline'),
);
const isTextSelection = computed(
  () => prop.selectedAnnots.length > 0 && prop.selectedAnnots.every((a) => a.type === 'text'),
);

const headOptions: { label: string; value: ArrowHeadType }[] = [
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.none'), value: 'none' },
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.triangle'), value: 'triangle' },
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.open'), value: 'open' },
];

const startHead = computed<ArrowHeadType | undefined>({
  get: () =>
    commonValue(prop.selectedAnnots, (a) =>
      a.type === 'arrow' || a.type === 'polyline' ? a.startHead : undefined,
    ),
  set: (value) => {
    if (value === undefined) return;
    void applyPatch((annot) =>
      annot.type === 'arrow' || annot.type === 'polyline' ? { startHead: value } : null,
    );
  },
});

const headSize = computed<number | undefined>({
  get: () =>
    commonValue(prop.selectedAnnots, (a) =>
      a.type === 'arrow' || a.type === 'polyline' ? a.headSize : undefined,
    ),
  set: (value) => {
    if (value === undefined) return;
    void applyPatch((annot) =>
      annot.type === 'arrow' || annot.type === 'polyline' ? { headSize: value } : null,
    );
  },
});

const fontWeightOptions: { label: string; value: number }[] = [
  { label: t('pdfEditor.rightDrawer.annotation.fontWeightOptions.normal'), value: 400 },
  { label: t('pdfEditor.rightDrawer.annotation.fontWeightOptions.bold'), value: 700 },
];

const fontWeight = computed<number | undefined>({
  get: () =>
    commonValue(prop.selectedAnnots, (a) => (a.type === 'text' ? a.fontWeight : undefined)),
  set: (value) => {
    if (value === undefined) return;
    void applyPatch((annot) => (annot.type === 'text' ? { fontWeight: value } : null));
  },
});

const textAlignOptions: { icon: string; value: 'left' | 'center' | 'right' }[] = [
  { icon: 'format_align_left', value: 'left' },
  { icon: 'format_align_center', value: 'center' },
  { icon: 'format_align_right', value: 'right' },
];

const textAlign = computed<'left' | 'center' | 'right' | undefined>({
  get: () =>
    commonValue(prop.selectedAnnots, (a) => (a.type === 'text' ? a.textAlign : undefined)),
  set: (value) => {
    if (value === undefined) return;
    void applyPatch((annot) => (annot.type === 'text' ? { textAlign: value } : null));
  },
});

const fillColor = computed<string | undefined>({
  get: () =>
    commonValue(prop.selectedAnnots, (a) => (a.type === 'text' ? a.fillColor : undefined)),
  set: (value) => {
    if (value === undefined) return;
    const parsed = ColorCode.safeParse(value);
    if (!parsed.success) return;
    void applyPatch((annot) => (annot.type === 'text' ? { fillColor: parsed.data } : null));
  },
});

/**
 * アノテーションを削除
 *
 * 実処理は`useAnnotationActions`（キーボードショートカットのDeleteと共通）に委譲する
 */
const deleteAnnot = async () => {
  await prop.onDeleteSelected();
};

// ================================ 関係性 ================================

const selectedAnnotId = computed<AnnotationID | undefined>(() =>
  prop.selectedAnnots.length === 1 ? prop.selectedAnnots[0]?.id : undefined,
);

// 選択中アノテーションに紐づくエッジ一覧（src・target問わず）
const relationEdges = computed<RelationalEdge[]>(() => {
  if (selectedAnnotId.value === undefined) return [];
  return relationalStore.edgesForAnnotation(selectedAnnotId.value);
});

const ruleTypeOptions: { label: string; value: RelationalRuleType }[] = [
  { label: t('pdfEditor.tools.relational.equal'), value: 'equal' },
  { label: t('pdfEditor.tools.relational.link'), value: 'link' },
];

function edgeKey(edge: RelationalEdge): string {
  return `${edge.relational.srcID}|${edge.relational.targetID}`;
}

/**
 * エッジの相手側（selfId側ではない側）のアノテーションIDを返す
 */
function otherAnnotId(edge: RelationalEdge, selfId: AnnotationID): AnnotationID {
  return edge.relational.srcID === selfId ? edge.relational.targetID : edge.relational.srcID;
}

function statusIcon(edge: RelationalEdge): string {
  if (edge.checkedRule === undefined) return 'hourglass_empty';
  return edge.checkedRule.isOK ? 'check_circle' : 'cancel';
}

function statusColor(edge: RelationalEdge): string {
  if (edge.checkedRule === undefined) return 'grey-6';
  return edge.checkedRule.isOK ? 'positive' : 'negative';
}

/**
 * 検証結果の値を表示用の文字列に変換する（検証中は明示し、空文字列は空であることが分かるようにする）
 */
function displayValue(rawValue: string, edge: RelationalEdge): string {
  if (edge.checkedRule === undefined) return t('pdfEditor.rightDrawer.annotation.verifying');
  return rawValue === '' ? t('pdfEditor.rightDrawer.annotation.emptyValue') : rawValue;
}

// 自身（選択中のアノテーション）の値。どのエッジも同じ自身の値を返すため先頭のエッジから取得する
const selfValueDisplay = computed<string>(() => {
  const firstEdge = relationEdges.value[0];
  if (selectedAnnotId.value === undefined || firstEdge === undefined) return '';
  return displayValue(edgeValueFor(firstEdge, selectedAnnotId.value), firstEdge);
});

function otherValueDisplay(edge: RelationalEdge): string {
  if (selectedAnnotId.value === undefined) return '';
  return displayValue(otherEdgeValueFor(edge, selectedAnnotId.value), edge);
}

// 相手アノテーションが属するファイル名（解決できるまでは"..."を表示）
const otherFileLabelCache = ref<Record<AnnotationID, string>>({});

watch(
  relationEdges,
  async (edges) => {
    if (selectedAnnotId.value === undefined) return;
    for (const edge of edges) {
      const otherId = otherAnnotId(edge, selectedAnnotId.value);
      if (otherFileLabelCache.value[otherId] !== undefined) continue;

      const fileRes = await api.resolveAnnotationFile(otherId);
      otherFileLabelCache.value[otherId] = fileRes.ok
        ? fileRes.data.path.split('/').pop() || fileRes.data.path
        : '?';
    }
  },
  { immediate: true },
);

function otherFileLabel(edge: RelationalEdge): string {
  if (selectedAnnotId.value === undefined) return '...';
  return otherFileLabelCache.value[otherAnnotId(edge, selectedAnnotId.value)] ?? '...';
}

/**
 * 「リンクを追加」ボタン：親（DocumentTabView）に対になるアノテーションの待機開始を依頼する
 */
function onAddRelationClicked() {
  if (selectedAnnotId.value === undefined) return;
  emit('add-relation', selectedAnnotId.value);
}

/**
 * 編集対象のエッジについて、このファイルだけでなく相手側アノテーションのファイルの
 * 関係性キャッシュも合わせて更新する（別ファイル間の関係性が、開いていないタブ側の
 * キャッシュに古い情報が残ったままにならないようにする）
 */
async function refreshBothEndpoints(edge: RelationalEdge, selfId: AnnotationID) {
  await relationalStore.refreshFile(prop.file);

  const otherFileRes = await api.resolveAnnotationFile(otherAnnotId(edge, selfId));
  if (otherFileRes.ok && !isSameFile(otherFileRes.data, prop.file)) {
    await relationalStore.refreshFile(otherFileRes.data);
  }
}

function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
}

/**
 * ルール種別の変更：既存の1本を削除してから新しいルールで登録し直す
 */
async function onChangeRuleType(edge: RelationalEdge, newType: RelationalRuleType) {
  if (newType === edge.relational.rule.type || selectedAnnotId.value === undefined) return;

  // TODO: エラーハンドリング
  await api.removeRelationalEdge(edge.relational.srcID, edge.relational.targetID);
  await api.registRelationals({
    srcID: edge.relational.srcID,
    targetID: edge.relational.targetID,
    rule: buildRelationalRule(newType),
  });
  await refreshBothEndpoints(edge, selectedAnnotId.value);
}

/**
 * リンクの削除
 */
async function onRemoveRelation(edge: RelationalEdge) {
  if (selectedAnnotId.value === undefined) return;
  await api.removeRelationalEdge(edge.relational.srcID, edge.relational.targetID);
  await refreshBothEndpoints(edge, selectedAnnotId.value);
}
</script>

<style scoped lang="scss">
.document-right-drawer {
  width: 300px;
  height: 100%;
  background: white;
  border-left: 1px solid $grey-3;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  flex-shrink: 0;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: $grey-2;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-4;
    border-radius: 3px;

    &:hover {
      background: $grey-5;
    }
  }

  .drawer-section {
    h6 {
      font-weight: 600;
      font-size: 0.95rem;
      color: $primary;
    }
  }

  .annotation-properties {
    .property-group {
      .property-label {
        display: block;
        font-size: 0.85rem;
        font-weight: 500;
        color: $grey-8;
        margin-bottom: 0.5rem;
      }

      .property-value {
        padding: 0.75rem;
        background-color: $grey-2;
        border-radius: 6px;
        font-size: 0.9rem;
        color: $grey-7;
        border-left: 3px solid $primary;
      }
    }

    .slider-container {
      padding: 0.5rem 0;

      :deep(.q-slider) {
        .q-slider__track-container {
          margin: 0.75rem 0;
        }
      }
    }

    .relation-list {
      .self-value {
        font-size: 0.85rem;

        .self-value-text {
          font-family: monospace;
          word-break: break-all;
        }
      }

      .relation-row {
        padding: 0.5rem;
        border-radius: 6px;

        .relation-row-value {
          word-break: break-all;
        }

        .relation-row-main {
          display: flex;
          align-items: center;

          .relation-target-label {
            font-size: 0.85rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }

        .relation-row-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;

          .rule-select {
            flex: 1;
            min-width: 0;
          }
        }
      }
    }
  }

  .drawer-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    text-align: center;
    color: $grey-5;
  }
}

.body--dark .document-right-drawer {
  background: $dark;
  border-left-color: $grey-8;

  &::-webkit-scrollbar-track {
    background: $grey-8;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-7;

    &:hover {
      background: $grey-6;
    }
  }

  .drawer-section {
    h6 {
      color: $primary;
    }
  }

  .annotation-properties {
    .property-group {
      .property-label {
        color: $grey-3;
      }

      .property-value {
        background-color: $grey-8;
        color: $grey-4;
        border-left-color: $primary;
      }
    }

  }

  .drawer-empty {
    color: $grey-7;
  }
}
</style>
