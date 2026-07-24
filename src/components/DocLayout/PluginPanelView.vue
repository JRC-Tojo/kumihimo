<template>
  <div class="plugin-panel-view">
    <div class="plugin-panel-form q-pa-sm">
      <div class="text-subtitle2 q-mb-xs">{{ manifest?.name }}</div>

      <q-select
        v-if="descriptors.length > 1"
        v-model="selectedEntryId"
        :options="entryOptions"
        emit-value
        map-options
        dense
        outlined
        class="q-mb-sm"
      />
      <div v-if="selectedDescriptor?.description" class="text-caption text-grey-6 q-mb-sm">
        {{ selectedDescriptor.description }}
      </div>

      <div class="q-gutter-sm">
        <template v-for="field in selectedDescriptor?.fields ?? []" :key="field.fieldId">
          <q-input
            v-if="field.type === 'text'"
            v-model="fieldValues[field.fieldId] as string"
            dense
            outlined
            :label="field.label"
          />
          <q-input
            v-else-if="field.type === 'number'"
            v-model.number="fieldValues[field.fieldId] as number"
            type="number"
            dense
            outlined
            :label="field.label"
          />
          <q-toggle
            v-else-if="field.type === 'toggle'"
            v-model="fieldValues[field.fieldId] as boolean"
            :label="field.label"
          />
          <q-select
            v-else-if="field.type === 'select'"
            v-model="fieldValues[field.fieldId] as string"
            dense
            outlined
            :label="field.label"
            :options="field.options ?? []"
          />
          <div v-else-if="field.type === 'file'" class="row items-center q-gutter-xs">
            <q-btn
              dense
              outlined
              icon="description"
              :label="field.label"
              @click="onPickFile(field.fieldId, field.label)"
            />
            <span class="text-caption text-grey-7">
              {{ fileFieldValues[field.fieldId]?.path ?? $t('plugins.run.noFileSelected') }}
            </span>
          </div>
        </template>
      </div>

      <q-btn
        class="q-mt-sm"
        unelevated
        color="primary"
        :label="$t('plugins.run.runButton')"
        :loading="running"
        :disable="!selectedDescriptor"
        @click="onRun"
      />
    </div>

    <q-separator />

    <div v-if="runState" class="plugin-panel-result">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Notify } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import { usePluginStore } from 'src/stores/pluginStore';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';
import { selectFileDialog } from 'src/components/Dialog/selectFileDialog';
import type { PluginID } from 'src/models/plugin/manifest';
import type { PluginInstallSource } from 'src/models/plugin/installation';
import type { PluginEntryPointDescriptor } from 'src/models/plugin/discovery';
import type { PluginRunState, PluginPanelBlock } from 'src/models/plugin/panel';
import type { PluginPlanItem } from 'src/models/plugin/plan';
import type { ContainerElementFile } from 'src/models/container';
import PanelProgressBlock from './PluginPanel/PanelProgressBlock.vue';
import PanelLogBlock from './PluginPanel/PanelLogBlock.vue';
import PanelTextBlock from './PluginPanel/PanelTextBlock.vue';

interface Prop {
  pluginId: PluginID;
  source: PluginInstallSource;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();
const api = useBackendApi();
const pluginStore = usePluginStore();

const manifest = computed(
  () =>
    pluginStore.installed.find(
      (entry) => entry.manifest.id === prop.pluginId && entry.source === prop.source,
    )?.manifest,
);

const descriptors = ref<PluginEntryPointDescriptor[]>([]);
const selectedEntryId = ref<string>();
const fieldValues = reactive<Record<string, string | number | boolean>>({});
// 'file'型フィールド（対象文書の選択）はWASMへ値として渡せないため、他の入力値とは
// 別のreactiveで保持する（`ui.addFileField`宣言順に`targetFiles`として解決する）
const fileFieldValues = reactive<Record<string, ContainerElementFile | undefined>>({});
const running = ref(false);
const runState = ref<PluginRunState>();

const selectedDescriptor = computed(() =>
  descriptors.value.find((d) => d.entryId === selectedEntryId.value),
);
const entryOptions = computed(() =>
  descriptors.value.map((d) => ({ label: d.label, value: d.entryId })),
);

function resetFieldValues(descriptor: PluginEntryPointDescriptor | undefined) {
  for (const key of Object.keys(fieldValues)) delete fieldValues[key];
  for (const key of Object.keys(fileFieldValues)) delete fileFieldValues[key];
  if (!descriptor) return;
  for (const field of descriptor.fields) {
    if (field.type !== 'file') fieldValues[field.fieldId] = field.defaultValue;
  }
}

watch(selectedDescriptor, (descriptor) => resetFieldValues(descriptor));

/**
 * 「対象文書」フィールドのファイル選択ダイアログを開く（Explorerのデータ層を再利用した
 * 選択専用ダイアログ。既存Explorerパネルの選択状態・DnD等とは独立している）
 */
async function onPickFile(fieldId: string, label: string) {
  const file = await selectFileDialog({ title: label });
  if (file) fileFieldValues[fieldId] = file;
}

onMounted(async () => {
  const res = await api.discoverPluginEntryPoints(prop.pluginId, prop.source);
  if (res.ok) {
    descriptors.value = res.data;
    selectedEntryId.value = res.data[0]?.entryId;
  }
});

let stopObservation: (() => void) | undefined;
function subscribeToRun(runId: string) {
  stopObservation?.();
  stopObservation = undefined;
  const observed = api.observePluginRunState(runId);
  if (observed.ok) {
    const subscription = observed.data.subscribe((value) => {
      runState.value = value;
    });
    stopObservation = () => subscription.unsubscribe();
  }
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

/**
 * 実行ボタン押下時の処理。プラン項目のうち`once`確認モードのものは、実行完了直後に
 * 一括確認ダイアログを1回だけ表示する（`perItem`はタブ内の承認待ちリストで都度扱う）
 */
async function onRun() {
  const descriptor = selectedDescriptor.value;
  if (!descriptor) return;

  const fileFields = descriptor.fields.filter((field) => field.type === 'file');
  const missingRequired = fileFields.find(
    (field) => !field.optional && !fileFieldValues[field.fieldId],
  );
  if (missingRequired) {
    Notify.create({ type: 'negative', message: $t('plugins.run.fileFieldRequired') });
    return;
  }
  const targetFiles = fileFields
    .map((field) => fileFieldValues[field.fieldId])
    .filter((file): file is ContainerElementFile => file !== undefined);

  running.value = true;
  try {
    const runRes = await api.runPluginEntryPoint(
      prop.pluginId,
      prop.source,
      descriptor.entryId,
      { ...fieldValues },
      targetFiles,
    );
    if (!runRes.ok) {
      Notify.create({
        type: 'negative',
        message: `${$t('plugins.errors.runFailed')}: ${runRes.error.error.message}`,
      });
      return;
    }
    const newRunState = runRes.data;
    subscribeToRun(newRunState.runId);
    runState.value = newRunState;

    const onceItems = newRunState.plan.filter(
      (item) => item.confirmationMode === 'once' && item.status === 'planned',
    );
    if (onceItems.length > 0) {
      const ids = onceItems.map((item) => item.id);
      const approved = await confirmDialog({
        title: $t('plugins.run.batchConfirmTitle'),
        message: $t('plugins.run.batchConfirmMessage', { count: onceItems.length }),
      });
      if (approved) {
        await api.approvePluginPlanItems(newRunState.runId, ids);
      } else {
        await api.rejectPluginPlanItems(newRunState.runId, ids);
      }
    }
  } finally {
    running.value = false;
  }
}

async function approve(itemId: string) {
  if (!runState.value) return;
  await api.approvePluginPlanItems(runState.value.runId, [itemId]);
}

async function reject(itemId: string) {
  if (!runState.value) return;
  await api.rejectPluginPlanItems(runState.value.runId, [itemId]);
}
</script>

<style scoped lang="scss">
.plugin-panel-view {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.plugin-panel-result {
  flex: 1 1 0;
}
</style>
