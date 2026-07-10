<template>
  <q-dialog v-model="open" @hide="onHide">
    <q-card class="relational-peek-card">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ $t('pdfEditor.peek.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="preview-section">
        <q-spinner v-if="previewLoading" color="primary" size="2em" />
        <q-img v-else-if="previewSrc" :src="previewSrc" class="preview-image" fit="contain" />
        <p v-else class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.peek.previewUnavailable') }}
        </p>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">{{ $t('pdfEditor.peek.linkedAnnotations') }}</div>
        <p v-if="edges.length === 0" class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.rightDrawer.annotation.noRelations') }}
        </p>
        <p v-else class="text-caption text-grey-6 q-mb-sm">
          {{ $t('pdfEditor.peek.openHint') }}
        </p>
        <div
          v-for="edge in edges"
          :key="edgeKey(edge)"
          class="relation-row"
          @dblclick="openOtherFile(edge)"
        >
          <q-icon
            :name="statusIcon(edge)"
            :color="statusColor(edge)"
            size="1.2rem"
            class="q-mr-sm"
          />
          <span class="relation-target-label">{{ otherFileLabel(edge) }}</span>
          <q-badge outline color="primary" class="q-ml-sm">
            {{ $t(`pdfEditor.tools.relational.${edge.relational.rule.type}`) }}
          </q-badge>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import { useRelationalStore, type RelationalEdge } from 'src/stores/relationalStore';
import type { AnnotationID } from 'src/models/document/pdf';

interface Prop {
  annotId: AnnotationID;
}
const prop = defineProps<Prop>();

const open = defineModel<boolean>('open', { required: true });

const api = useBackendApi();
const editorStore = useEditorStore();
const relationalStore = useRelationalStore();

const previewSrc = ref<string>();
const previewLoading = ref(false);

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

function otherFileLabel(edge: RelationalEdge): string {
  return otherFileLabelCache.value[otherAnnotId(edge)] ?? '...';
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

function onHide() {
  previewSrc.value = undefined;
}

watch(
  () => prop.annotId,
  async (annotId) => {
    previewLoading.value = true;
    const res = await api.getAnnotationPreviewImage(annotId);
    previewSrc.value = res.ok ? res.data : undefined;
    previewLoading.value = false;
  },
  { immediate: true },
);

watch(edges, (newEdges) => void resolveOtherFileLabels(newEdges), { immediate: true });
</script>

<style scoped lang="scss">
.relational-peek-card {
  width: 480px;
  max-width: 90vw;
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
  display: flex;
  align-items: center;
  padding: 0.5rem;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background-color: $grey-2;
  }

  .relation-target-label {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.body--dark .relation-row:hover {
  background-color: $grey-8;
}
</style>
