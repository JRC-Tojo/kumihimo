<template>
  <q-dialog v-model="open">
    <q-card class="relational-rule-edit-card">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ $t('pdfEditor.peek.ruleEdit.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section>
        <q-toggle v-model="overrideEnabled" :label="$t('pdfEditor.peek.ruleEdit.overrideGlobal')" />
        <p class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.peek.ruleEdit.overrideGlobalHint') }}
        </p>

        <RelaxationRuleEditor v-if="overrideEnabled" v-model="localRelaxation" class="q-mt-sm" />
      </q-card-section>

      <q-separator />

      <q-card-section>
        <q-input
          v-model="ownFormula"
          dense
          outlined
          :label="$t('pdfEditor.peek.ruleEdit.ownFormula')"
          placeholder="x * 1.09"
        />
        <p class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.peek.ruleEdit.ownFormulaHint') }}
        </p>

        <p v-if="otherFormula !== undefined" class="text-caption text-grey-6 q-mb-none q-mt-sm">
          {{ $t('pdfEditor.peek.ruleEdit.otherFormula') }}: <code>{{ otherFormula }}</code>
        </p>

        <p v-if="ownFormula !== ''" class="text-caption q-mt-sm q-mb-none">
          <template v-if="formulaPreview !== undefined">
            {{ $t('pdfEditor.peek.ruleEdit.formulaPreview') }}: {{ formulaPreview }}
          </template>
          <span v-else class="text-negative">{{
            $t('pdfEditor.peek.ruleEdit.formulaInvalid')
          }}</span>
        </p>
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
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import { useRelationalStore, edgeValueFor, type RelationalEdge } from 'src/stores/relationalStore';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { RelationalRule } from 'src/models/relational/fileSchema';
import {
  DEFAULT_RELAXATION_OPTIONS,
  type RelaxationOptions,
} from 'src/models/relational/relaxation';
import {
  evaluateFormula,
  parseNumericValue,
  roundFormulaResult,
} from 'src/utils/calculation/formula';
import { sanitizeRelaxationOptions } from 'src/utils/text/relaxedCompare';
import RelaxationRuleEditor from 'src/components/Settings/RelaxationRuleEditor.vue';

interface Prop {
  file: ContainerElementFile;
  edge: RelationalEdge;
  selfAnnotId: AnnotationID;
}
const prop = defineProps<Prop>();

const open = defineModel<boolean>('open', { required: true });

const $q = useQuasar();
const { t } = useI18n();
const api = useBackendApi();
const relationalStore = useRelationalStore();

const isSrcSelf = computed(() => prop.edge.relational.srcID === prop.selfAnnotId);

const overrideEnabled = ref(false);
const localRelaxation = ref<RelaxationOptions>(DEFAULT_RELAXATION_OPTIONS);
const ownFormula = ref('');

const otherFormula = computed<string | undefined>(() => {
  const rule = prop.edge.relational.rule;
  if (rule.type !== 'equal') return undefined;
  return isSrcSelf.value ? rule.targetFormula : rule.srcFormula;
});

/**
 * ダイアログを開くたびに、現在の`edge`のルールから編集用のローカル状態を再構築する
 *
 * 上書きが無効な場合にエディタへ表示する初期値は、コンテナルートの設定ファイル
 * （`.kumihimo/settings.json`）から取得する（同一コンテナを開いた誰にとっても
 * 同じ既定値になる、ブラウザ単位ではないコンテナ単位の設定のため）
 */
async function resetFromEdge() {
  const rule = prop.edge.relational.rule;
  if (rule.type !== 'equal') return;

  overrideEnabled.value = rule.relaxation !== undefined;
  ownFormula.value = (isSrcSelf.value ? rule.srcFormula : rule.targetFormula) ?? '';

  if (rule.relaxation !== undefined) {
    localRelaxation.value = rule.relaxation;
    return;
  }
  const containerRelaxationRes = await api.getContainerRelaxationSettings(prop.file.containerID);
  localRelaxation.value = containerRelaxationRes.ok
    ? containerRelaxationRes.data
    : DEFAULT_RELAXATION_OPTIONS;
}

watch(
  open,
  (isOpen) => {
    if (isOpen) void resetFromEdge();
  },
  { immediate: true },
);

/**
 * 自身の生値（OCR抽出値）に現在入力中の計算式を適用したプレビュー値
 *
 * 数値化できない、または式が不正な場合はundefined（生値のまま比較されることを画面上で示す）
 */
const formulaPreview = computed<string | undefined>(() => {
  if (ownFormula.value === '') return undefined;

  const rawValue = edgeValueFor(prop.edge, prop.selfAnnotId);
  const x = parseNumericValue(rawValue.normalize('NFKC'));
  if (x === undefined) return undefined;

  const result = evaluateFormula(ownFormula.value, x);
  return result === undefined ? undefined : String(roundFormulaResult(result));
});

/**
 * 編集内容から新しいルールを組み立てて保存する
 *
 * 保存に失敗した場合は元のルールを維持したまま通知のみ行い、成功した場合はダイアログを閉じる
 */
async function onSave() {
  const rule = prop.edge.relational.rule;
  if (rule.type !== 'equal') return;

  const newRule: RelationalRule = {
    type: 'equal',
    constVal: rule.constVal,
    relaxation: overrideEnabled.value
      ? sanitizeRelaxationOptions(localRelaxation.value)
      : undefined,
    srcFormula: isSrcSelf.value ? ownFormula.value || undefined : rule.srcFormula,
    targetFormula: isSrcSelf.value ? rule.targetFormula : ownFormula.value || undefined,
  };

  const ok = await relationalStore.updateRelationalRule(
    prop.file,
    prop.edge,
    prop.selfAnnotId,
    newRule,
  );
  if (!ok) {
    $q.notify({ type: 'negative', message: t('pdfEditor.peek.ruleEdit.saveFailed') });
    return;
  }
  open.value = false;
}
</script>

<style scoped lang="scss">
.relational-rule-edit-card {
  width: 420px;
  max-width: 90vw;
}
</style>
