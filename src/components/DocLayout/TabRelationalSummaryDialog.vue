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
        <q-list v-else separator>
          <q-item v-for="edge in edges" :key="edgeKey(edge)">
            <q-item-section avatar>
              <q-icon :name="statusIcon(edge)" :color="statusColor(edge)" size="1.2rem" />
            </q-item-section>
            <q-item-section>
              <q-item-label>
                <a class="endpoint-link" @click="openAnnotation(edge.relational.srcID)">{{
                  endpointLabel(edge.relational.srcID)
                }}</a>
                <q-icon name="sync_alt" size="1rem" class="q-mx-xs" />
                <a class="endpoint-link" @click="openAnnotation(edge.relational.targetID)">{{
                  endpointLabel(edge.relational.targetID)
                }}</a>
              </q-item-label>
            </q-item-section>
          </q-item>
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

function endpointLabel(annotId: AnnotationID): string {
  return endpointLabelCache.value[annotId] ?? '...';
}

/** 各エッジの両端アノテーションについて、属するファイル名を解決してキャッシュする */
async function resolveEndpointLabels(targetEdges: RelationalEdge[]) {
  const ids = targetEdges.flatMap((edge) => [edge.relational.srcID, edge.relational.targetID]);
  for (const id of ids) {
    if (endpointLabelCache.value[id] !== undefined) continue;
    const fileRes = await api.resolveAnnotationFile(id);
    endpointLabelCache.value[id] = fileRes.ok
      ? (fileRes.data.path.split('/').pop() ?? fileRes.data.path)
      : '?';
  }
}

/** クリックされたアノテーションが属するファイルを新規タブで開き、そのページへ遷移する */
async function openAnnotation(annotId: AnnotationID) {
  const fileRes = await api.resolveAnnotationFile(annotId);
  if (!fileRes.ok) return;

  const pageRes = await api.getAnnotationPageNumber(annotId);
  editorStore.openTab(fileRes.data, pageRes.ok ? pageRes.data : undefined, annotId);
  open.value = false;
}

watch(edges, (newEdges) => void resolveEndpointLabels(newEdges), { immediate: true });

// ダイアログを開くたびに最新の検証結果を取得する
watch(
  open,
  async (isOpen) => {
    if (!isOpen) return;
    loading.value = true;
    await relationalStore.refreshFile(prop.file);
    loading.value = false;
  },
  { immediate: true },
);
</script>

<style scoped lang="scss">
.tab-relational-summary-card {
  width: 480px;
  max-width: 90vw;
}

.endpoint-link {
  cursor: pointer;
  color: var(--q-primary);
  text-decoration: underline;
}
</style>
