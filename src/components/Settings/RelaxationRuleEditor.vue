<template>
  <div class="relaxation-rule-editor">
    <div class="column q-gutter-xs">
      <q-toggle
        :model-value="model.ignoreCase"
        :label="$t('settings.relationalRelaxation.ignoreCase')"
        @update:model-value="(v) => patch({ ignoreCase: v })"
      />
      <q-toggle
        :model-value="model.ignoreWhitespace"
        :label="$t('settings.relationalRelaxation.ignoreWhitespace')"
        @update:model-value="(v) => patch({ ignoreWhitespace: v })"
      />
      <q-toggle
        :model-value="model.ignoreWidth"
        :label="$t('settings.relationalRelaxation.ignoreWidth')"
        @update:model-value="(v) => patch({ ignoreWidth: v })"
      />
      <q-toggle
        :model-value="model.numericEquivalence"
        :label="$t('settings.relationalRelaxation.numericEquivalence')"
        @update:model-value="(v) => patch({ numericEquivalence: v })"
      />
    </div>

    <div class="equivalence-groups q-mt-md">
      <div class="text-caption text-grey-6">
        {{ $t('settings.relationalRelaxation.equivalenceGroups') }}
      </div>
      <div class="text-caption text-grey-6 q-mb-sm">
        {{ $t('settings.relationalRelaxation.equivalenceGroupsHint') }}
      </div>

      <div
        v-for="(group, gIdx) in model.equivalenceGroups"
        :key="gIdx"
        class="equivalence-group q-mb-sm"
      >
        <div class="row items-center q-gutter-xs">
          <q-badge v-for="(ch, cIdx) in group" :key="cIdx" outline color="primary">
            <span v-if="ch !== ''" class="q-px-xs">{{ ch }}</span>
            <input
              v-else
              class="char-input"
              :value="ch"
              :placeholder="$t('settings.relationalRelaxation.charPlaceholder')"
              @blur="
                (e) =>
                  setChar(gIdx, cIdx, String((e.target as HTMLInputElement | null)?.value ?? ''))
              "
            />
            <q-btn
              flat
              round
              dense
              color="negative"
              icon="close"
              size="xs"
              @click="removeChar(gIdx, cIdx)"
            />
          </q-badge>
          <q-btn flat round dense icon="add" size="sm" @click="addChar(gIdx)" />
          <q-btn
            flat
            dense
            size="sm"
            icon="delete"
            color="negative"
            :label="$t('settings.relationalRelaxation.removeGroup')"
            @click="removeGroup(gIdx)"
          />
        </div>
      </div>

      <q-btn
        flat
        dense
        size="sm"
        icon="add"
        :label="$t('settings.relationalRelaxation.addGroup')"
        @click="addGroup"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RelaxationOptions } from 'src/models/relational/relaxation';

const model = defineModel<RelaxationOptions>({ required: true });

/**
 * modelを常にトップレベルで再代入する（defineModelのemitはネストしたプロパティへの
 * 代入では発火しないため、親への保存通知を確実に効かせるためにオブジェクト全体を作り直す）
 */
function patch(partial: Partial<RelaxationOptions>) {
  model.value = { ...model.value, ...partial };
}

/**
 * 空の文字グループを1つ追加する（ユーザーが最初の文字を入力するまでは空のまま保持する）
 */
function addGroup() {
  patch({ equivalenceGroups: [...model.value.equivalenceGroups, ['']] });
}

/**
 * 指定インデックスのグループを削除する
 */
function removeGroup(groupIndex: number) {
  patch({
    equivalenceGroups: model.value.equivalenceGroups.filter((_, i) => i !== groupIndex),
  });
}

/**
 * 指定グループに空の文字を1つ追加する（入力欄が増え、ユーザーが続けて文字を入力できるようにする）
 */
function addChar(groupIndex: number) {
  const groups = model.value.equivalenceGroups.map((g, i) => (i === groupIndex ? [...g, ''] : g));
  patch({ equivalenceGroups: groups });
}

/**
 * 指定グループ内の指定インデックスの文字を書き換える
 */
function setChar(groupIndex: number, charIndex: number, value: string) {
  const groups = model.value.equivalenceGroups.map((g, i) =>
    i === groupIndex ? g.map((c, j) => (j === charIndex ? value : c)) : g,
  );
  patch({ equivalenceGroups: groups });
}

/**
 * 文字を削除する。グループが空になった場合はグループ自体も削除する
 * （スキーマ上グループは1文字以上を要求するため）
 */
function removeChar(groupIndex: number, charIndex: number) {
  const groups = model.value.equivalenceGroups
    .map((g, i) => (i === groupIndex ? g.filter((_, j) => j !== charIndex) : g))
    .filter((g) => g.length > 0);
  patch({ equivalenceGroups: groups });
}
</script>

<style scoped lang="scss">
.relaxation-rule-editor {
  min-width: 260px;
  max-width: 400px;
}

.char-input {
  width: 64px;
}
</style>
