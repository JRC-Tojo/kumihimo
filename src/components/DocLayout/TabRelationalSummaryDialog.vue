<template>
  <q-dialog v-model="open">
    <q-card class="tab-relational-summary-card">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ $t('pdfEditor.tabs.relationalSummary.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section>
        <q-spinner v-if="loading" color="primary" size="2em" />
        <p v-else-if="edges.length === 0" class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.tabs.relationalSummary.noRelations') }}
        </p>
        <q-list v-else bordered separator class="rounded-borders">
          <!-- 既定では折りたたみ、開いた項目のみ両端のプレビュー・登録内容・検証結果を読み込む -->
          <q-expansion-item
            v-for="edge in edges"
            :key="edgeKey(edge)"
            dense-toggle
            :model-value="expandedKeys.has(edgeKey(edge))"
            @update:model-value="(v: boolean) => onToggleExpand(edge, v)"
          >
            <template #header>
              <q-item-section avatar>
                <q-icon :name="statusIcon(edge)" :color="statusColor(edge)" size="1.2rem" />
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  {{ endpointLabel(edge.relational.srcID) }}
                  <q-icon name="sync_alt" size="1rem" class="q-mx-xs" />
                  {{ endpointLabel(edge.relational.targetID) }}
                </q-item-label>
              </q-item-section>
            </template>

            <q-card flat class="detail-card q-pa-sm">
              <div class="row q-col-gutter-sm">
                <div class="col-6 endpoint-detail">
                  <div class="text-caption text-grey-6 ellipsis">
                    {{ endpointLabel(edge.relational.srcID) }}
                  </div>
                  <div class="preview-box">
                    <q-spinner
                      v-if="isPreviewLoading(edge.relational.srcID)"
                      color="primary"
                      size="1.5em"
                    />
                    <q-img
                      v-else-if="previewSrc(edge.relational.srcID)"
                      :src="previewSrc(edge.relational.srcID)!"
                      fit="contain"
                      class="preview-image"
                    />
                    <span v-else class="text-caption text-grey-6">
                      {{ $t('pdfEditor.peek.previewUnavailable') }}
                    </span>
                  </div>
                  <div class="text-caption q-mt-xs value-line">
                    {{ $t('pdfEditor.tabs.relationalSummary.srcValue') }}:
                    {{ valueDisplay(edge, edge.srcVal, srcFormula(edge)) }}
                  </div>
                  <q-btn
                    flat
                    dense
                    size="sm"
                    icon="open_in_new"
                    :label="$t('pdfEditor.peek.openDocument')"
                    @click="openAnnotation(edge.relational.srcID)"
                  />
                </div>
                <div class="col-6 endpoint-detail">
                  <div class="text-caption text-grey-6 ellipsis">
                    {{ endpointLabel(edge.relational.targetID) }}
                  </div>
                  <div class="preview-box">
                    <q-spinner
                      v-if="isPreviewLoading(edge.relational.targetID)"
                      color="primary"
                      size="1.5em"
                    />
                    <q-img
                      v-else-if="previewSrc(edge.relational.targetID)"
                      :src="previewSrc(edge.relational.targetID)!"
                      fit="contain"
                      class="preview-image"
                    />
                    <span v-else class="text-caption text-grey-6">
                      {{ $t('pdfEditor.peek.previewUnavailable') }}
                    </span>
                  </div>
                  <div class="text-caption q-mt-xs value-line">
                    {{ $t('pdfEditor.tabs.relationalSummary.targetValue') }}:
                    {{ valueDisplay(edge, edge.targetVal, targetFormula(edge)) }}
                  </div>
                  <q-btn
                    flat
                    dense
                    size="sm"
                    icon="open_in_new"
                    :label="$t('pdfEditor.peek.openDocument')"
                    @click="openAnnotation(edge.relational.targetID)"
                  />
                </div>
              </div>

              <q-separator class="q-my-sm" />

              <div class="text-caption">
                {{ $t('pdfEditor.tabs.relationalSummary.ruleLabel') }}:
                {{ ruleTypeLabel(edge) }}
              </div>
            </q-card>
          </q-expansion-item>
        </q-list>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import { useRelationalStore, fileKey, type RelationalEdge } from 'src/stores/relationalStore';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import { formatValueWithFormula } from 'src/utils/calculation/formula';

interface Prop {
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();
const open = defineModel<boolean>('open', { required: true });

const { t: $t } = useI18n();
const api = useBackendApi();
const editorStore = useEditorStore();
const relationalStore = useRelationalStore();

const loading = ref(false);
const endpointLabelCache = ref<Record<AnnotationID, string>>({});

// このファイルが関わる関係性一覧（src・target問わず）。ファイル単位のキャッシュをそのまま参照する
const edges = computed<RelationalEdge[]>(
  () => relationalStore.edgesByFileKey[fileKey(prop.file)] ?? [],
);

/**
 * エッジ（関係性）の一意キーを生成する
 * @param edge 関係性エッジ
 * @returns `${srcID}|${targetID}` 形式のキー
 */
function edgeKey(edge: RelationalEdge): string {
  return `${edge.relational.srcID}|${edge.relational.targetID}`;
}

/**
 * 関係性の検証ステータスに応じたアイコン名を返す
 * - 未検証: hourglass_empty
 * - 成功: check_circle
 * - 失敗: cancel
 */
function statusIcon(edge: RelationalEdge): string {
  if (edge.checkedRule === undefined) return 'hourglass_empty';
  return edge.checkedRule.isOK ? 'check_circle' : 'cancel';
}

/**
 * 検証ステータスに応じた色表現を返す（Quasarのカラー名）
 */
function statusColor(edge: RelationalEdge): string {
  if (edge.checkedRule === undefined) return 'grey-6';
  return edge.checkedRule.isOK ? 'positive' : 'negative';
}

/**
 * キャッシュからアノテーションの属するファイル名ラベルを取得する
 * 未解決の場合は '...' を返す
 */
function endpointLabel(annotId: AnnotationID): string {
  return endpointLabelCache.value[annotId] ?? '...';
}

/**
 * エッジの関係性種別をローカライズされた文字列で返す
 */
function ruleTypeLabel(edge: RelationalEdge): string {
  return edge.relational.rule.type === 'equal'
    ? $t('pdfEditor.tools.relational.equal')
    : $t('pdfEditor.tools.relational.link');
}

/**
 * src 側に適用される計算式を返す（equal のみ）
 */
function srcFormula(edge: RelationalEdge): string | undefined {
  const rule = edge.relational.rule;
  return rule.type === 'equal' ? rule.srcFormula : undefined;
}

/**
 * target 側に適用される計算式を返す（equal のみ）
 */
function targetFormula(edge: RelationalEdge): string | undefined {
  const rule = edge.relational.rule;
  return rule.type === 'equal' ? rule.targetFormula : undefined;
}

/**
 * 検証結果の値を表示用の文字列に変換する（検証中は明示し、空文字列は空であることが分かるように
 * したうえで、計算式が設定されていれば式と結果も併記する）。RelationalPeekDialog.vueと同じ表示規約
 */
function valueDisplay(edge: RelationalEdge, rawValue: string, formula: string | undefined): string {
  if (edge.checkedRule === undefined) return $t('pdfEditor.peek.verifying');
  if (rawValue === '') return $t('pdfEditor.peek.emptyValue');
  return formatValueWithFormula(rawValue, formula);
}

/**
 * 各エッジの両端アノテーションについて、属するファイル名を解決してキャッシュする
 *
 * 流れ:
 * 1. 指定されたエッジ群から全アノテーションIDを収集
 * 2. 未解決のアノテーションIDについて api.resolveAnnotationFile を呼び出す
 * 3. 取得できたファイルパスから Path.basename を使ってファイル名を抽出してキャッシュへ保存
 */
async function resolveEndpointLabels(targetEdges: RelationalEdge[]) {
  const ids = targetEdges.flatMap((edge) => [edge.relational.srcID, edge.relational.targetID]);
  for (const id of ids) {
    if (endpointLabelCache.value[id] !== undefined) continue;
    const fileRes = await api.resolveAnnotationFile(id);
    endpointLabelCache.value[id] = fileRes.ok
      ? new Path(fileRes.data.path).basename()
      : '?';
  }
}

// 展開中の項目（edgeKey）。展開時のみ両端のプレビューを取得する（一覧表示だけで全件分の
// プレビューを先読みすると、関係性が多いファイルで無駄なAPI呼び出しが増えるため）
const expandedKeys = ref<Set<string>>(new Set());
// アノテーションIDごとのプレビュー画像。undefined=未取得、null=取得済みだが利用不可
const previewCache = ref<Record<AnnotationID, string | null>>({});
const previewLoadingIds = ref<Set<AnnotationID>>(new Set());

/**
 * プレビューキャッシュから画像URLを取得する（未取得なら undefined）
 */
function previewSrc(annotId: AnnotationID): string | undefined {
  return previewCache.value[annotId] ?? undefined;
}

/**
 * 指定アノテーションのプレビューがロード中かを返す
 */
function isPreviewLoading(annotId: AnnotationID): boolean {
  return previewLoadingIds.value.has(annotId);
}

/**
 * 指定アノテーションのプレビュー画像を、未取得の場合のみ取得してキャッシュする
 *
 * 流れ:
 * 1. 既にキャッシュが存在するかロード中であれば何もしない
 * 2. ロード状態を追加し、APIから画像を取得
 * 3. 成功すればプレビューキャッシュに格納、失敗なら null を格納
 * 4. ロード状態から削除する
 */
async function ensurePreview(annotId: AnnotationID) {
  if (previewCache.value[annotId] !== undefined || previewLoadingIds.value.has(annotId)) return;

  previewLoadingIds.value.add(annotId);
  const res = await api.getAnnotationPreviewImage(annotId);
  previewCache.value[annotId] = res.ok ? res.data : null;
  previewLoadingIds.value.delete(annotId);
}

/**
 * エッジの展開／折りたたみが切り替わった時の処理
 *
 * - 展開した場合は両端のプレビュー取得を開始する
 * - 折りたたんだ場合は展開キーを除去する（プレビューはキャッシュとして残す）
 */
function onToggleExpand(edge: RelationalEdge, isOpen: boolean) {
  const key = edgeKey(edge);
  if (isOpen) {
    expandedKeys.value.add(key);
    void ensurePreview(edge.relational.srcID);
    void ensurePreview(edge.relational.targetID);
  } else {
    expandedKeys.value.delete(key);
  }
}

/**
 * クリックされたアノテーションが属するファイルを新規タブで開き、そのページへ遷移する
 *
 * 流れ:
 * 1. api.resolveAnnotationFile でアノテーションの所属ファイルを解決
 * 2. api.getAnnotationPageNumber でページ番号を取得（無ければ undefined）
 * 3. editorStore.openTab で新規タブを開き、選択状態を設定してダイアログを閉じる
 */
async function openAnnotation(annotId: AnnotationID) {
  const fileRes = await api.resolveAnnotationFile(annotId);
  if (!fileRes.ok) return;

  const pageRes = await api.getAnnotationPageNumber(annotId);
  editorStore.openTab(fileRes.data, pageRes.ok ? pageRes.data : undefined, annotId);
  open.value = false;
}

watch(edges, (newEdges) => void resolveEndpointLabels(newEdges), { immediate: true });

// ダイアログを開くたびに最新の検証結果を取得し、展開状態・プレビューキャッシュもリセットする
watch(
  open,
  async (isOpen) => {
    if (!isOpen) {
      expandedKeys.value = new Set();
      previewCache.value = {};
      return;
    }
    loading.value = true;
    await relationalStore.refreshFile(prop.file);
    loading.value = false;
  },
  { immediate: true },
);
</script>

<style scoped lang="scss">
.tab-relational-summary-card {
  width: 560px;
  max-width: 90vw;
}

.detail-card {
  background: $grey-1;
}

.body--dark .detail-card {
  background: $grey-9;
}

.endpoint-detail {
  min-width: 0;
}

.preview-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  background-color: $grey-2;
  border-radius: 4px;
}

.body--dark .preview-box {
  background-color: $grey-8;
}

.preview-image {
  max-height: 140px;
  max-width: 100%;
}

.value-line {
  word-break: break-all;
}
</style>
