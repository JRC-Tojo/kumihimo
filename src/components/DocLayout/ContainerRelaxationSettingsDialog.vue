<template>
  <q-dialog v-model="open">
    <q-card class="container-relaxation-dialog">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ $t('pdfEditor.tools.relational.containerSettings.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="q-pt-none">
        <p class="text-caption text-grey-6">
          {{ $t('pdfEditor.tools.relational.containerSettings.description') }}
        </p>

        <q-spinner v-if="loading" color="primary" size="2em" />
        <RelaxationRuleEditor v-else-if="relaxation !== undefined" v-model="relaxation" />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat dense :label="$t('pdfEditor.tools.relational.cancel')" v-close-popup />
        <q-btn
          flat
          dense
          color="primary"
          :label="$t('button.save')"
          :disable="relaxation === undefined"
          @click="onSave"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * コンテナ単位の関係性緩和ルール編集ダイアログ
 *
 * `.kumihimo/settings.json`（コンテナルート）に保存される緩和ルールを編集する。
 * ブラウザ単位のアプリ設定ではないため、同一コンテナを開いた誰にとっても同じ既定値になる
 */
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerID } from 'src/models/container';
import type { RelaxationOptions } from 'src/models/relational/relaxation';
import { sanitizeRelaxationOptions } from 'src/utils/text/relaxedCompare';
import RelaxationRuleEditor from 'src/components/Settings/RelaxationRuleEditor.vue';

interface Prop {
  containerID: ContainerID;
}
const prop = defineProps<Prop>();

const open = defineModel<boolean>('open', { required: true });

const $q = useQuasar();
const { t } = useI18n();
const api = useBackendApi();

const loading = ref(false);
const relaxation = ref<RelaxationOptions>();

async function load() {
  loading.value = true;
  const res = await api.getContainerRelaxationSettings(prop.containerID);
  relaxation.value = res.ok ? res.data : undefined;
  loading.value = false;
}

watch(
  open,
  (isOpen) => {
    if (isOpen) void load();
  },
  { immediate: true },
);

/**
 * 編集中の緩和ルールを保存する
 *
 * 入力途中の空欄（同一視グループの空文字要素）は保存前に取り除いてから送信する
 */
async function onSave() {
  if (relaxation.value === undefined) return;

  const res = await api.saveContainerRelaxationSettings(
    prop.containerID,
    sanitizeRelaxationOptions(relaxation.value),
  );
  if (!res.ok) {
    $q.notify({
      type: 'negative',
      message: t('pdfEditor.tools.relational.containerSettings.saveFailed'),
    });
    return;
  }
  open.value = false;
}
</script>

<style scoped lang="scss">
.container-relaxation-dialog {
  width: 420px;
  max-width: 90vw;
}
</style>
