<template>
  <div class="plugin-panel-view">
    <div v-if="!runState" class="text-grey-6 q-pa-md">{{ $t('plugins.panel.running') }}</div>

    <template v-else>
      <PanelProgressBlock
        v-for="(block, i) in progressBlocks"
        :key="`progress-${i}`"
        :block="block"
      />
      <PanelLogBlock v-for="(block, i) in logBlocks" :key="`log-${i}`" :block="block" />
      <PanelTextBlock v-for="(block, i) in textBlocks" :key="`text-${i}`" :block="block" />

      <div v-if="pendingPerItem.length > 0" class="q-pa-sm">
        <div class="text-subtitle2 q-mb-xs">{{ $t('plugins.panel.pendingApprovalTitle') }}</div>
        <q-list bordered separator>
          <q-item v-for="item in pendingPerItem" :key="item.id">
            <q-item-section>{{ describePlanItem(item) }}</q-item-section>
            <q-item-section side>
              <div class="row q-gutter-xs">
                <q-btn
                  dense
                  flat
                  color="positive"
                  :label="$t('plugins.panel.approve')"
                  @click="approve(item.id)"
                />
                <q-btn
                  dense
                  flat
                  color="negative"
                  :label="$t('plugins.panel.reject')"
                  @click="reject(item.id)"
                />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import type { PluginRunState } from 'src/models/plugin/panel';
import type { PluginPanelBlock } from 'src/models/plugin/panel';
import type { PluginPlanItem } from 'src/models/plugin/plan';
import PanelProgressBlock from './PluginPanel/PanelProgressBlock.vue';
import PanelLogBlock from './PluginPanel/PanelLogBlock.vue';
import PanelTextBlock from './PluginPanel/PanelTextBlock.vue';

interface Prop {
  runId: string;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();
const api = useBackendApi();
const runState = ref<PluginRunState>();

const observed = api.observePluginRunState(prop.runId);
let stopObservation: (() => void) | undefined;
if (observed.ok) {
  const subscription = observed.data.subscribe((value) => {
    runState.value = value;
  });
  stopObservation = () => subscription.unsubscribe();
}
onBeforeUnmount(() => stopObservation?.());

function blocksOfKind<K extends PluginPanelBlock['kind']>(kind: K) {
  return (runState.value?.blocks ?? []).filter(
    (b): b is Extract<PluginPanelBlock, { kind: K }> => b.kind === kind,
  );
}

const progressBlocks = computed(() => blocksOfKind('progress'));
const logBlocks = computed(() => blocksOfKind('log'));
const textBlocks = computed(() => blocksOfKind('text'));

const pendingPerItem = computed(() =>
  (runState.value?.plan ?? []).filter(
    (item) => item.confirmationMode === 'perItem' && item.status === 'planned',
  ),
);

function describePlanItem(item: PluginPlanItem): string {
  switch (item.kind) {
    case 'annotationCreate':
      return `${$t('plugins.panel.kindCreate')} (p.${item.style.pageNumber})`;
    case 'annotationUpdate':
      return `${$t('plugins.panel.kindUpdate')}: ${item.annotId}`;
    case 'annotationRemove':
      return `${$t('plugins.panel.kindRemove')}: ${item.annotId}`;
    case 'relationalCreate':
      return $t('plugins.panel.kindRelationalCreate');
    case 'relationalRemove':
      return $t('plugins.panel.kindRelationalRemove');
  }
}

async function approve(itemId: string) {
  await api.approvePluginPlanItems(prop.runId, [itemId]);
}

async function reject(itemId: string) {
  await api.rejectPluginPlanItems(prop.runId, [itemId]);
}
</script>

<style scoped lang="scss">
.plugin-panel-view {
  height: 100%;
  overflow-y: auto;
}
</style>
