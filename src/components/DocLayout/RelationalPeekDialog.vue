<template>
  <q-dialog v-model="open">
    <q-card class="relational-peek-card">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ $t('pdfEditor.peek.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <!-- 自身の値（比較のもう一方の基準として表示） -->
      <q-card-section class="q-py-none">
        <span class="text-caption text-grey-6">
          {{ $t('pdfEditor.rightDrawer.annotation.selfValue') }}:
        </span>
        <span class="self-value-text">{{ selfValueDisplay }}</span>
      </q-card-section>

      <q-card-section class="preview-section">
        <q-spinner v-if="previewLoading" color="primary" size="2em" />
        <q-img v-else-if="previewSrc" :src="previewSrc" class="preview-image" fit="contain" />
        <p v-else class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.peek.previewUnavailable') }}
        </p>
      </q-card-section>
      <q-card-actions align="right" class="q-pt-none">
        <q-btn
          flat
          dense
          size="sm"
          icon="open_in_new"
          color="primary"
          :label="$t('pdfEditor.peek.openDocument')"
          :disable="previewedAnnotId === undefined"
          @click="openPreviewedFile"
        />
      </q-card-actions>

      <q-separator />

      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">{{ $t('pdfEditor.peek.linkedAnnotations') }}</div>
        <p v-if="edges.length === 0" class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.rightDrawer.annotation.noRelations') }}
        </p>
        <template v-else>
          <p class="text-caption text-grey-6 q-mb-sm">
            {{ $t('pdfEditor.peek.rowHint') }}
          </p>
          <div
            v-for="edge in edges"
            :key="edgeKey(edge)"
            :class="['relation-row', { active: otherAnnotId(edge) === previewedAnnotId }]"
            @click="previewedAnnotId = otherAnnotId(edge)"
            @dblclick="openOtherFile(edge)"
          >
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
              {{ $t('pdfEditor.rightDrawer.annotation.otherValue') }}: {{ otherValueDisplay(edge) }}
            </div>
            <div class="relation-row-actions q-mt-xs" @click.stop @dblclick.stop>
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
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import {
  useRelationalStore,
  edgeValueFor,
  otherEdgeValueFor,
  type RelationalEdge,
} from 'src/stores/relationalStore';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { RelationalRuleType } from 'src/models/relational/ruleUtils';

interface Prop {
  annotId: AnnotationID;
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();

const open = defineModel<boolean>('open', { required: true });

const $q = useQuasar();
const api = useBackendApi();
const editorStore = useEditorStore();
const relationalStore = useRelationalStore();
const { t } = useI18n();

const previewSrc = ref<string>();
const previewLoading = ref(false);
// 現在プレビュー表示中のアノテーションID（行のシングルクリックで切り替える。既定では先頭の相手アノテーション）
const previewedAnnotId = ref<AnnotationID>();

const edges = computed<RelationalEdge[]>(() => relationalStore.edgesForAnnotation(prop.annotId));

const otherFileLabelCache = ref<Record<AnnotationID, string>>({});

function otherAnnotId(edge: RelationalEdge): AnnotationID {
  return edge.relational.srcID === prop.annotId ? edge.relational.targetID : edge.relational.srcID;
}

function edgeKey(edge: RelationalEdge): string {
  return `${edge.relational.srcID}|${edge.relational.targetID}`;
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

// 自身の値。どのエッジも同じ自身の値を返すため先頭のエッジから取得する
const selfValueDisplay = computed<string>(() => {
  const firstEdge = edges.value[0];
  if (firstEdge === undefined) return '';
  return displayValue(edgeValueFor(firstEdge, prop.annotId), firstEdge);
});

function otherValueDisplay(edge: RelationalEdge): string {
  return displayValue(otherEdgeValueFor(edge, prop.annotId), edge);
}

function otherFileLabel(edge: RelationalEdge): string {
  return otherFileLabelCache.value[otherAnnotId(edge)] ?? '...';
}

const ruleTypeOptions: { label: string; value: RelationalRuleType }[] = [
  { label: t('pdfEditor.tools.relational.equal'), value: 'equal' },
  { label: t('pdfEditor.tools.relational.link'), value: 'link' },
];

/**
 * ルール種別の変更：既存の1本を削除してから新しいルールで登録し直す（失敗時は元のルールへロールバック）
 */
async function onChangeRuleType(edge: RelationalEdge, newType: RelationalRuleType) {
  if (newType === edge.relational.rule.type) return;

  const ok = await relationalStore.changeRelationalRuleType(prop.file, edge, prop.annotId, newType);
  if (!ok) {
    $q.notify({ type: 'negative', message: t('pdfEditor.tools.relational.changeFailed') });
  }
}

/**
 * リンクの削除。削除したエッジが現在プレビュー中だった場合、プレビュー対象をリセットし、
 * 残りのエッジがあれば`watch(edges, ...)`が新しい先頭エッジを自動選択する
 */
async function onRemoveRelation(edge: RelationalEdge) {
  const selfId = prop.annotId;
  const removeRes = await api.removeRelationalEdge(edge.relational.srcID, edge.relational.targetID);
  if (!removeRes.ok) {
    $q.notify({ type: 'negative', message: t('pdfEditor.tools.relational.changeFailed') });
    return;
  }
  if (previewedAnnotId.value === otherAnnotId(edge)) previewedAnnotId.value = undefined;
  await relationalStore.refreshEdgeBothEndpoints(prop.file, edge, selfId);
}

/**
 * 相手アノテーションのファイル名を解決してキャッシュする
 */
async function resolveOtherFileLabels(targetEdges: RelationalEdge[]) {
  for (const edge of targetEdges) {
    const otherId = otherAnnotId(edge);
    if (otherFileLabelCache.value[otherId] !== undefined) continue;

    const fileRes = await api.resolveAnnotationFile(otherId);
    otherFileLabelCache.value[otherId] = fileRes.ok
      ? fileRes.data.path.split('/').pop() || fileRes.data.path
      : '?';
  }
}

/**
 * ダブルクリックした行の相手アノテーションが属するファイルを新規タブで開く
 */
async function openOtherFile(edge: RelationalEdge) {
  const fileRes = await api.resolveAnnotationFile(otherAnnotId(edge));
  if (!fileRes.ok) return;

  editorStore.openTab(fileRes.data);
  open.value = false;
}

/**
 * 現在プレビュー中のアノテーションが属するファイルを新規タブで開く
 */
async function openPreviewedFile() {
  if (previewedAnnotId.value === undefined) return;

  const fileRes = await api.resolveAnnotationFile(previewedAnnotId.value);
  if (!fileRes.ok) return;

  editorStore.openTab(fileRes.data);
  open.value = false;
}

// プレビュー対象が未選択の場合、先頭の相手アノテーションを既定のプレビュー対象にする
watch(
  edges,
  (newEdges) => {
    if (previewedAnnotId.value !== undefined) return;
    const firstEdge = newEdges[0];
    if (firstEdge !== undefined) previewedAnnotId.value = otherAnnotId(firstEdge);
  },
  { immediate: true },
);

// プレビュー対象（自身ではなく選択中の相手アノテーション）が変わるたびに画像を取得する
watch(
  previewedAnnotId,
  async (annotId) => {
    if (annotId === undefined) {
      previewSrc.value = undefined;
      return;
    }
    previewLoading.value = true;
    const res = await api.getAnnotationPreviewImage(annotId);
    previewSrc.value = res.ok ? res.data : undefined;
    previewLoading.value = false;
  },
  { immediate: true },
);

watch(edges, (newEdges) => void resolveOtherFileLabels(newEdges), { immediate: true });

// ダイアログを開くたびに、未選択なら先頭の相手アノテーションを既定のプレビュー対象にする
watch(open, (isOpen) => {
  if (!isOpen) return;
  const firstEdge = edges.value[0];
  if (firstEdge !== undefined) previewedAnnotId.value = otherAnnotId(firstEdge);
});
</script>

<style scoped lang="scss">
.relational-peek-card {
  width: 480px;
  max-width: 90vw;
}

.self-value-text {
  font-family: monospace;
  word-break: break-all;
}

.preview-section {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 160px;
  background-color: $grey-2;
}

.body--dark .preview-section {
  background-color: $grey-9;
}

.preview-image {
  max-height: 260px;
}

.relation-row {
  padding: 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;

  &:hover {
    background-color: $grey-2;
  }

  &.active {
    border-color: $primary;
    background-color: rgba($primary, 0.06);
  }

  .relation-row-main {
    display: flex;
    align-items: center;
  }

  .relation-target-label {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .relation-row-value {
    word-break: break-all;
  }

  .relation-row-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: default;

    .rule-select {
      flex: 1;
      min-width: 0;
    }
  }
}

.body--dark .relation-row:hover {
  background-color: $grey-8;
}

.body--dark .relation-row.active {
  background-color: rgba($primary, 0.15);
}
</style>
