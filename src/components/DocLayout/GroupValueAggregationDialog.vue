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

      <!-- 数式モード: 各メンバーのプレビュー・割り当てられた変数名の一覧と、式の入力・
           ライブプレビューを表示する。多数のアノテーションがグループ化されていても見やすいよう
           一覧はスクロール領域にする -->
      <q-card-section v-if="selectedType === 'formula'" class="q-pt-none">
        <q-list bordered dense class="q-mb-sm member-list">
          <q-item v-for="member in memberRows" :key="member.id">
            <q-item-section avatar>
              <q-img
                v-if="member.previewSrc"
                :src="member.previewSrc"
                class="member-preview-img"
                fit="cover"
              />
              <q-avatar v-else rounded size="5rem" :style="{ backgroundColor: member.color }">
                <q-icon :name="member.icon" size="3rem" color="white" />
              </q-avatar>
            </q-item-section>
            <q-item-section>
              <div class="row">
                <span class="text-weight-bold">{{ member.letter }}</span>
                <span class="text-grey-6 q-mx-sm"> = </span>
                <span>{{ member.label }}</span>
              </div>
            </q-item-section>
          </q-item>
        </q-list>

        <q-input
          v-model="expression"
          dense
          outlined
          :label="$t('pdfEditor.peek.group.aggregationDialog.formulaLabel')"
          placeholder="A - B + 3"
        />
        <p class="text-caption text-grey-6 q-mb-none">
          {{ $t('pdfEditor.peek.group.aggregationDialog.formulaHint') }}
        </p>

        <p v-if="expression !== ''" class="text-caption q-mt-sm q-mb-none">
          <template v-if="formulaPreview !== undefined">
            {{ $t('pdfEditor.peek.group.aggregationDialog.formulaPreview') }}: {{ formulaPreview }}
          </template>
          <span v-else class="text-negative">{{
            $t('pdfEditor.peek.group.aggregationDialog.formulaInvalid')
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
          :disable="formulaInvalid"
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
 * 「合計（メンバーの数値を合算）」と「数式（memberIds順に割り当てたA, B, C...の変数を使った
 * 四則演算）」の2種類を持つ。`GroupValueAggregation`がdiscriminated unionのため、
 * 将来の算出方式追加は`typeOptions`とonSaveの分岐を増やすだけで済む
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import { useAnnotationHistory } from 'src/components/DocLayout/composables/useAnnotationHistory';
import { ANNOTATION_REGISTRY } from 'src/components/Viewer/Annotation/registry';
import { evaluateExpression, roundFormulaResult } from 'src/utils/calculation/formula';
import { buildVariableMap, letterForMemberIndex } from 'src/utils/calculation/groupFormula';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationGroup, GroupValueAggregation } from 'src/models/document/group';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';

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
const history = useAnnotationHistory();

type AggregationType = GroupValueAggregation['type'];
const selectedType = ref<AggregationType>('sum');
const expression = ref('');

const typeOptions: { label: string; value: AggregationType }[] = [
  { label: t('pdfEditor.peek.group.aggregationDialog.sum'), value: 'sum' },
  { label: t('pdfEditor.peek.group.aggregationDialog.formula'), value: 'formula' },
];

// ダイアログを開くたびに、現在のグループの設定から初期値を再構築する
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const aggregation = prop.group.valueAggregation;
    selectedType.value = aggregation?.type ?? 'sum';
    expression.value = aggregation?.type === 'formula' ? aggregation.expression : '';
    void loadMemberInfos();
  },
  { immediate: true },
);

// メンバー一覧（数式モードの変数対応表示に使う。memberIds順を保つ）
const memberInfos = ref<AnnotationInfo[]>([]);
// メンバーごとのプレビュー画像（読み込み中・失敗時は該当IDのエントリ無し＝種別アイコンにフォールバック）
const previewsByMemberId = ref<Map<AnnotationID, string>>(new Map());

/**
 * グループの全メンバーのアノテーション情報を取得し、`memberIds`の順序で並べて保持する。
 * 取得後、続けて各メンバーのプレビュー画像も読み込む
 */
async function loadMemberInfos() {
  const res = await api.getAnnotationsByFile(prop.file);
  if (!res.ok) {
    memberInfos.value = [];
    previewsByMemberId.value = new Map();
    return;
  }
  const byId = new Map(res.data.map((info) => [info.style.id, info]));
  memberInfos.value = prop.group.memberIds
    .map((id) => byId.get(id))
    .filter((info): info is AnnotationInfo => info !== undefined);
  void loadMemberPreviews(memberInfos.value.map((info) => info.style.id));
}

/**
 * どのアノテーションがどの文字に対応するか視覚的に判別できるよう、メンバーごとに
 * 単体アノテーション用のプレビュー画像を並列取得する（多数メンバーでもダイアログを開いた
 * 際の待ち時間を抑えるため）
 */
async function loadMemberPreviews(ids: AnnotationID[]): Promise<void> {
  const entries = await Promise.all(
    ids.map(async (id) => {
      const res = await api.getRelationalEndpointPreviewImage(id, 1);
      return res.ok ? ([id, res.data] as const) : undefined;
    }),
  );
  previewsByMemberId.value = new Map(
    entries.filter((e): e is [AnnotationID, string] => e !== undefined),
  );
}

const memberRows = computed(() =>
  memberInfos.value.map((info, index) => ({
    id: info.style.id,
    letter: letterForMemberIndex(index),
    icon: ANNOTATION_REGISTRY[info.style.type].icon,
    color: info.style.color ?? '#9e9e9e',
    previewSrc: previewsByMemberId.value.get(info.style.id),
    label:
      info.context.text === undefined
        ? t('pdfEditor.peek.group.aggregationDialog.memberValuePending')
        : info.context.text,
  })),
);

/**
 * 現在入力中の数式を、読み込み済みメンバーの値で評価したライブプレビュー
 *
 * メンバーの値が数値化できない・式が不正な場合はundefined（インラインバリデーションを兼ねる）
 */
const formulaPreview = computed<string | undefined>(() => {
  if (expression.value === '') return undefined;

  const variableIds = buildVariableMap(prop.group.memberIds);
  const variables: Record<string, number> = {};
  for (const [letter, id] of variableIds) {
    const info = memberInfos.value.find((m) => m.style.id === id);
    const text = info?.context.text;
    if (text === undefined) return undefined;
    const num = Number(text.normalize('NFKC').trim());
    if (!Number.isFinite(num)) return undefined;
    variables[letter] = num;
  }

  const result = evaluateExpression(expression.value, variables);
  return result === undefined ? undefined : String(roundFormulaResult(result));
});

// 数式モードで式が不正（構文エラー・未定義変数参照・非数値メンバー等）な場合はtrue
// `formulaPreview`（ライブプレビュー用の評価結果）をそのまま再利用し、保存ボタンの
// 無効化・保存処理前のガードの両方で単一の判定基準として使う
const formulaInvalid = computed(
  () => selectedType.value === 'formula' && formulaPreview.value === undefined,
);

/**
 * 選択中の値算出方法（sum/formula）を保存し、Undo履歴に記録してダイアログを閉じる。
 * 数式が不正な場合は保存自体を行わない
 */
async function onSave() {
  // API呼び出し前に数式の妥当性を再検証し、不正なデータが永続化されるのを防ぐ
  // （ボタンのdisable制御と同じ判定だが、念のため保存処理側でも二重にガードする）
  if (formulaInvalid.value) {
    $q.notify({
      type: 'negative',
      message: t('pdfEditor.peek.group.aggregationDialog.formulaInvalid'),
    });
    return;
  }

  const previous = prop.group.valueAggregation;
  const next: GroupValueAggregation =
    selectedType.value === 'formula'
      ? { type: 'formula', expression: expression.value }
      : { type: 'sum' };
  const res = await api.updateGroupValueAggregation(prop.file, prop.group.id, next);
  if (!res.ok) {
    $q.notify({
      type: 'negative',
      message: t('pdfEditor.peek.group.aggregationDialog.saveFailed'),
    });
    return;
  }
  history.recordGroupAggregationChanged(prop.file, prop.group.id, previous, next);
  emit('saved', res.data);
  open.value = false;
}
</script>

<style scoped lang="scss">
.group-value-aggregation-card {
  width: 420px;
  max-width: 90vw;
}

.member-list {
  max-height: 240px;
  overflow-y: auto;
}

.member-preview-img {
  width: 5rem;
  height: 5rem;
  border-radius: 4px;
}
</style>
