<template>
  <q-dialog ref="dialogRef" persistent @hide="onDialogHide">
    <q-card style="min-width: 360px">
      <q-card-section>
        <div class="text-h6">{{ pluginName }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none q-gutter-sm">
        <template v-for="field in fields" :key="field.fieldId">
          <q-input
            v-if="field.type === 'text'"
            v-model="values[field.fieldId] as string"
            dense
            :label="field.label"
          />
          <q-input
            v-else-if="field.type === 'number'"
            v-model.number="values[field.fieldId] as number"
            type="number"
            dense
            :label="field.label"
          />
          <q-toggle
            v-else-if="field.type === 'toggle'"
            v-model="values[field.fieldId] as boolean"
            :label="field.label"
          />
          <q-select
            v-else-if="field.type === 'select'"
            v-model="values[field.fieldId] as string"
            dense
            :label="field.label"
            :options="field.options ?? []"
          />
        </template>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('button.cancel')" @click="onCancel" />
        <q-btn unelevated color="primary" :label="$t('plugins.run.runButton')" @click="onConfirm" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { useDialogPluginComponent } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { PluginField } from 'src/models/plugin/discovery';

interface Prop {
  pluginName: string;
  fields: PluginField[];
}
const prop = defineProps<Prop>();

defineEmits([...useDialogPluginComponent.emits]);
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent();

const { t: $t } = useI18n();

const values = reactive<Record<string, string | number | boolean>>(
  Object.fromEntries(prop.fields.map((f) => [f.fieldId, f.defaultValue])),
);

function onConfirm() {
  onDialogOK({ ...values });
}

function onCancel() {
  onDialogCancel();
}
</script>
