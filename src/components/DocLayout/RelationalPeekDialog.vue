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
        <span class="text-caption text-grey-6"> {{ $t('pdfEditor.peek.selfValue') }}: </span>
        <span class="self-value-text" :class="{ 'text-grey-6': isSelfValuePending }">{{
          selfValueDisplay
        }}</span>
      </q-card-section>

      <!-- プレビュー: 対象がグループの場合も同じ領域・同じ見た目で表示する
           （グループの場合はメンバー全員をまとめて強調表示したプレビューになる） -->
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

      <!-- グループが対象の場合のみ: メンバー数・値算出方法の要約と、その設定を開くボタンを
           1行で表示する（緩和ルールの行ごとの調整ボタンと視覚的に揃えたスタイル） -->
      <q-card-section v-if="isGroup && groupInfo" class="q-pt-none group-value-row">
        <span class="text-caption text-grey-6">
          {{ $t('pdfEditor.peek.group.memberCount', { count: groupInfo?.memberIds.length ?? 0 }) }}
          ・
          {{
            groupInfo?.valueAggregation === undefined
              ? $t('pdfEditor.peek.group.aggregationUndefined')
              : groupInfo.valueAggregation.type === 'formula'
                ? $t('pdfEditor.peek.group.aggregationFormula')
                : $t('pdfEditor.peek.group.aggregationSum')
          }}
        </span>
        <q-btn
          flat
          round
          dense
          icon="functions"
          size="sm"
          color="primary"
          :title="$t('pdfEditor.peek.group.configureAggregation')"
          @click="aggregationDialogOpen = true"
        />
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">{{ $t('pdfEditor.peek.linkedAnnotations') }}</div>
        <p v-if="edges.length === 0" class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.peek.noRelations') }}
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
              {{ $t('pdfEditor.peek.otherValue') }}: {{ otherValueDisplay(edge) }}
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
                v-if="edge.relational.rule.type === 'equal'"
                flat
                round
                dense
                icon="tune"
                size="sm"
                :title="$t('pdfEditor.peek.editRule')"
                @click="openRuleEditDialog(edge)"
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

  <RelationalRuleEditDialog
    v-if="editingEdge"
    v-model:open="editDialogOpen"
    :file="prop.file"
    :edge="editingEdge"
    :self-annot-id="targetId"
  />

  <GroupValueAggregationDialog
    v-if="isGroup && groupInfo"
    v-model:open="aggregationDialogOpen"
    :file="prop.file"
    :group="groupInfo"
    @saved="onAggregationSaved"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore, type PeekTarget } from 'src/stores/editorStore';
import {
  useRelationalStore,
  edgeValueFor,
  otherEdgeValueFor,
  type RelationalEdge,
} from 'src/stores/relationalStore';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationGroup } from 'src/models/document/group';
import type { RelationalEndpointID } from 'src/models/relational/fileSchema';
import type { RelationalRuleType } from 'src/models/relational/ruleUtils';
import { formatValueWithFormula } from 'src/utils/calculation/formula';
import RelationalRuleEditDialog from 'src/components/DocLayout/RelationalRuleEditDialog.vue';
import GroupValueAggregationDialog from 'src/components/DocLayout/GroupValueAggregationDialog.vue';

interface Prop {
  target: PeekTarget;
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();

const open = defineModel<boolean>('open', { required: true });

const $q = useQuasar();
const api = useBackendApi();
const editorStore = useEditorStore();
const relationalStore = useRelationalStore();
const { t } = useI18n();

// 対象がグループの場合もアノテーションの場合も、関係性の端点としては同じIDとして扱う
const targetId = computed<RelationalEndpointID>(() => prop.target.id);
const isGroup = computed(() => prop.target.kind === 'group');

const previewSrc = ref<string>();
const previewLoading = ref(false);
// 現在プレビュー表示中の相手側ID（行のシングルクリックで切り替える。既定では先頭の相手側）。
// 相手側がアノテーション・グループのどちらでも、getRelationalEndpointPreviewImageが
// 両方を解決できるため、対象の種類を区別せずそのまま渡せる
const previewedAnnotId = ref<RelationalEndpointID>();

// グループが対象の場合の詳細情報（メンバー一覧・値算出方法）
const groupInfo = ref<AnnotationGroup>();
const aggregationDialogOpen = ref(false);

/** 対象がグループの場合のみ、その最新のグループ情報を取得する（アノテーション単体なら未設定に戻す） */
async function loadGroupInfo() {
  if (prop.target.kind !== 'group') {
    groupInfo.value = undefined;
    return;
  }
  const res = await api.getAnnotationGroup(prop.file, prop.target.id);
  groupInfo.value = res.ok ? res.data : undefined;
}

watch(
  () => prop.target,
  () => void loadGroupInfo(),
  { immediate: true },
);

/** 2つのファイルがcontainerID込みで同一かどうか（useAnnotationHistory.tsと同じ判定） */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
}

/**
 * グループの値算出方法の変更後、prop.fileだけでなく、関係性の相手側の端点が属する
 * 全ファイルのrelationalStoreキャッシュも合わせて再検証する。相手側のファイルが
 * 既にキャッシュ読み込み済みの場合、prop.fileのみ再検証すると相手側タブの表示が
 * 古いまま（stale）になってしまうため（useAnnotationHistory.tsの
 * refreshRelationalCachesAfterと同じ考え方）
 */
async function refreshRelationalCachesAfterAggregationSaved(): Promise<void> {
  const targetEdges = edges.value;
  await relationalStore.refreshFile(prop.file);

  await Promise.all(
    targetEdges.map(async (edge) => {
      const otherFileRes = await api.resolveAnnotationFile(otherAnnotId(edge));
      if (otherFileRes.ok && !isSameFile(otherFileRes.data, prop.file)) {
        await relationalStore.refreshFile(otherFileRes.data);
      }
    }),
  );
}

/** 値算出方法ダイアログでの保存完了を受けて、表示中のグループ情報と関係性キャッシュを更新する */
function onAggregationSaved(updated: AnnotationGroup) {
  groupInfo.value = updated;
  void refreshRelationalCachesAfterAggregationSaved();
}

const edges = computed<RelationalEdge[]>(() => relationalStore.edgesForAnnotation(targetId.value));

const otherFileLabelCache = ref<Record<RelationalEndpointID, string>>({});

// アノテーション別の緩和ルール編集ダイアログの対象エッジ
const editingEdge = ref<RelationalEdge>();
const editDialogOpen = ref(false);

function openRuleEditDialog(edge: RelationalEdge) {
  editingEdge.value = edge;
  editDialogOpen.value = true;
}

function otherAnnotId(edge: RelationalEdge): RelationalEndpointID {
  return edge.relational.srcID === targetId.value
    ? edge.relational.targetID
    : edge.relational.srcID;
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
 * 指定したアノテーションの側（src/target）に設定されている計算式を返す
 *
 * `equal`ルールでない場合や計算式が未設定の場合はundefined
 */
function formulaForAnnot(edge: RelationalEdge, annotId: RelationalEndpointID): string | undefined {
  const rule = edge.relational.rule;
  if (rule.type !== 'equal') return undefined;
  return edge.relational.srcID === annotId ? rule.srcFormula : rule.targetFormula;
}

/**
 * 検証結果の値を表示用の文字列に変換する（検証中は明示し、空文字列は空であることが分かるように
 * したうえで、そのアノテーション側に計算式が設定されていれば式と結果も併記する）
 */
function displayValue(
  rawValue: string,
  edge: RelationalEdge,
  annotId: RelationalEndpointID,
): string {
  if (edge.checkedRule === undefined) return t('pdfEditor.peek.verifying');
  if (rawValue === '') return t('pdfEditor.peek.emptyValue');
  return formatValueWithFormula(rawValue, formulaForAnnot(edge, annotId));
}

// 自身の値。どのエッジも同じ自身の値を返すため先頭のエッジから取得する
const selfValueDisplay = computed<string>(() => {
  const firstEdge = edges.value[0];
  if (firstEdge === undefined) return '';
  return displayValue(edgeValueFor(firstEdge, targetId.value), firstEdge, targetId.value);
});

// 自身の値がまだ読み込み中（アノテーションの移動・リサイズ直後の再読み込み待ち等）かどうか。
// 表示を灰色にして「値が未確定であること」が一目で分かるようにする
const isSelfValuePending = computed<boolean>(() => {
  const firstEdge = edges.value[0];
  return firstEdge !== undefined && firstEdge.checkedRule === undefined;
});

function otherValueDisplay(edge: RelationalEdge): string {
  return displayValue(otherEdgeValueFor(edge, targetId.value), edge, otherAnnotId(edge));
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

  const ok = await relationalStore.changeRelationalRuleType(
    prop.file,
    edge,
    targetId.value,
    newType,
  );
  if (!ok) {
    $q.notify({ type: 'negative', message: t('pdfEditor.tools.relational.changeFailed') });
  }
}

/**
 * リンクの削除。削除したエッジが現在プレビュー中だった場合、プレビュー対象をリセットし、
 * 残りのエッジがあれば`watch(edges, ...)`が新しい先頭エッジを自動選択する
 */
async function onRemoveRelation(edge: RelationalEdge) {
  const selfId = targetId.value;
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
 * 指定した端点（アノテーションまたはグループ）が属するファイルを新規タブで開き、
 * それが存在するページへ遷移する（先頭ページが開かれてしまわないよう、ページ番号をopenTabに渡す）
 *
 * `openTab`の`focusAnnotId`は本来アノテーション専用だが、グループIDを渡した場合も
 * `AnnotationLayer.vue`側の選択展開（groupStore.memberSet）によりグループ全体の選択に
 * 解決されるため、ここでは端点の種類を区別せずそのまま渡す
 */
async function focusAnnotationInNewTab(id: RelationalEndpointID) {
  const fileRes = await api.resolveAnnotationFile(id);
  if (!fileRes.ok) return;

  const pageRes = await api.getAnnotationPageNumber(id);
  editorStore.openTab(fileRes.data, pageRes.ok ? pageRes.data : undefined, id as AnnotationID);
  open.value = false;
}

/**
 * ダブルクリックした行の相手アノテーションが属するファイルを新規タブで開く
 */
async function openOtherFile(edge: RelationalEdge) {
  await focusAnnotationInNewTab(otherAnnotId(edge));
}

/**
 * 現在プレビュー中のアノテーションが属するファイルを新規タブで開く
 */
async function openPreviewedFile() {
  if (previewedAnnotId.value === undefined) return;
  await focusAnnotationInNewTab(previewedAnnotId.value);
}

// プレビュー対象が未選択の場合、先頭の相手アノテーションを既定のプレビュー対象にする。
// 関係性が0件になった場合は、前に表示していた別アノテーションのプレビューが残らないよう
// 明示的にリセットする
watch(
  edges,
  (newEdges) => {
    if (newEdges.length === 0) {
      previewedAnnotId.value = undefined;
      return;
    }
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
    const res = await api.getRelationalEndpointPreviewImage(annotId);
    previewSrc.value = res.ok ? res.data : undefined;
    previewLoading.value = false;
  },
  { immediate: true },
);

watch(edges, (newEdges) => void resolveOtherFileLabels(newEdges), { immediate: true });

// ダイアログを開くたびに、先頭の相手アノテーションを既定のプレビュー対象にする
// （関係性が無い場合は明示的にundefinedへ戻し、直前に見ていた別アノテーションの
// プレビューが残らないようにする）
watch(open, (isOpen) => {
  if (!isOpen) return;
  const firstEdge = edges.value[0];
  previewedAnnotId.value = firstEdge !== undefined ? otherAnnotId(firstEdge) : undefined;
});

// ダイアログの表示中（開いた時・対象アノテーションが切り替わった時）に、移動・リサイズ直後
// でも「自身の値」が最新化されるよう明示的に再検証を要求する。`edgesForAnnotation`は
// リアクティブなgetterのため、再検証完了後は自動的に画面へ反映される
watch(
  [open, targetId],
  ([isOpen]) => {
    if (isOpen) void relationalStore.refreshFile(prop.file);
  },
  { immediate: true },
);

// 「自身の値」が読み込み中（アノテーション編集直後の内容再読み込み待ち等）の間は、通常は
// DocumentTabView.vue側のアノテーション変化監視で自動的に再検証されるはずだが、それだけに
// 頼らず一定間隔でリトライすることで、読み込み完了を確実に取りこぼさないようにする。
// ダイアログが閉じられた・値が確定した場合はその時点でリトライを打ち切る
const PENDING_RETRY_INTERVAL_MS = 1000;
const PENDING_RETRY_MAX_COUNT = 15; // 約15秒経っても解決しない場合はリトライを諦める
let pendingRetryTimer: ReturnType<typeof setTimeout> | undefined;
let pendingRetryCount = 0;

function clearPendingRetryTimer() {
  if (pendingRetryTimer !== undefined) {
    clearTimeout(pendingRetryTimer);
    pendingRetryTimer = undefined;
  }
}

async function runPendingRetry() {
  pendingRetryTimer = undefined;
  pendingRetryCount += 1;
  if (!open.value) return;

  await relationalStore.refreshFile(prop.file);
  if (open.value && isSelfValuePending.value) schedulePendingRetry();
}

function schedulePendingRetry() {
  clearPendingRetryTimer();
  if (pendingRetryCount >= PENDING_RETRY_MAX_COUNT) return;

  pendingRetryTimer = setTimeout(() => void runPendingRetry(), PENDING_RETRY_INTERVAL_MS);
}

watch(
  [isSelfValuePending, open],
  ([isPending, isOpen]) => {
    if (!isPending || !isOpen) {
      clearPendingRetryTimer();
      pendingRetryCount = 0;
      return;
    }
    schedulePendingRetry();
  },
  { immediate: true },
);

onBeforeUnmount(clearPendingRetryTimer);
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

.group-value-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
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
    border-color: var(--q-primary);
    background-color: rgba(var(--q-primary-rgb), 0.06);
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
  background-color: rgba(var(--q-primary-rgb), 0.15);
}
</style>
