<template>
  <q-dialog v-model="open">
    <q-card class="group-value-aggregation-card">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ $t('pdfEditor.peek.group.aggregationDialog.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section>
        <p class="text-caption text-grey-6 q-mb-sm">
          {{ $t('pdfEditor.peek.group.aggregationDialog.hint') }}
        </p>
        <q-option-group v-model="selectedType" :options="typeOptions" type="radio" />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat dense :label="$t('pdfEditor.peek.ruleEdit.cancel')" v-close-popup />
        <q-btn
          flat
          dense
          color="primary"
          :label="$t('pdfEditor.peek.ruleEdit.save')"
          @click="onSave"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * グループ全体を代表する値の算出方法を設定するダイアログ
 *
 * v1では「合計（メンバーの数値を合算）」のみを選択肢に持つが、`GroupValueAggregation`が
 * discriminated unionのため、将来の算出方式追加は`typeOptions`を増やすだけで済む
 */
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationGroup, GroupValueAggregation } from 'src/models/document/group';

interface Prop {
  file: ContainerElementFile;
  group: AnnotationGroup;
}
const prop = defineProps<Prop>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [AnnotationGroup] }>();

const { t } = useI18n();
const $q = useQuasar();
const api = useBackendApi();

type AggregationType = GroupValueAggregation['type'];
const selectedType = ref<AggregationType>('sum');

const typeOptions: { label: string; value: AggregationType }[] = [
  { label: t('pdfEditor.peek.group.aggregationDialog.sum'), value: 'sum' },
];

// ダイアログを開くたびに、現在のグループの設定から初期値を再構築する
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    selectedType.value = prop.group.valueAggregation?.type ?? 'sum';
  },
  { immediate: true },
);

async function onSave() {
  const res = await api.updateGroupValueAggregation(prop.file, prop.group.id, {
    type: selectedType.value,
  });
  if (!res.ok) {
    $q.notify({
      type: 'negative',
      message: t('pdfEditor.peek.group.aggregationDialog.saveFailed'),
    });
    return;
  }
  emit('saved', res.data);
  open.value = false;
}
</script>

<style scoped lang="scss">
.group-value-aggregation-card {
  width: 360px;
  max-width: 90vw;
}
</style>
