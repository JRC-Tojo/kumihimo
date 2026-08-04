<template>
  <q-dialog ref="dialogRef" persistent @hide="onDialogHide">
    <q-card style="min-width: 360px">
      <q-card-section>
        <div class="text-h6">{{ title }}</div>
      </q-card-section>

      <q-card-section v-if="message" class="q-pt-none">
        {{ message }}
      </q-card-section>

      <q-card-section v-if="variant === 'prompt'" class="q-pt-none row items-center q-gutter-md">
        <q-input
          v-model="promptValue"
          dense
          autofocus
          :label="promptLabel"
          @keyup.enter="onConfirm"
          class="col"
        />
        <AnnotationPresetPreview
          v-if="previewStyle"
          :annotation-style="previewStyle"
          style="scale: 1.5"
        />
      </q-card-section>

      <q-card-actions align="right">
        <template v-if="variant === 'unsavedChanges'">
          <q-btn flat :label="$t('button.cancel')" @click="onCancelClick" />
          <q-btn flat color="negative" :label="$t('explorer.discardAndClose')" @click="onDiscard" />
          <q-btn
            unelevated
            color="primary"
            :label="$t('explorer.saveAndClose')"
            @click="onSaveAndClose"
          />
        </template>
        <template v-else-if="variant === 'importPresets'">
          <q-btn flat :label="$t('button.cancel')" @click="onCancelClick" />
          <q-btn
            flat
            color="negative"
            :label="$t('settings.annotationTools.importReplace')"
            @click="onReplace"
          />
          <q-btn
            unelevated
            color="primary"
            :label="$t('settings.annotationTools.importAppend')"
            @click="onAppend"
          />
        </template>
        <template v-else>
          <q-btn flat :label="$t('button.cancel')" @click="onCancelClick" />
          <q-btn
            flat
            :color="severity === 'negative' ? 'negative' : 'primary'"
            label="OK"
            @click="onConfirm"
          />
        </template>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useDialogPluginComponent } from 'quasar';
import { useI18n } from 'vue-i18n';
import AnnotationPresetPreview from 'src/components/DocLayout/AnnotationPresetPreview.vue';
import type { DrawingAnnotationStyle } from 'src/models/docPage';

interface Prop {
  title: string;
  message?: string;
  variant?: 'confirm' | 'prompt' | 'unsavedChanges' | 'importPresets';
  severity?: 'normal' | 'negative';
  promptInitialValue?: string;
  promptLabel?: string;
  /** promptバリアントのみ対象。指定した場合、入力欄の上に新規追加スタイルのプレビューを表示する */
  previewStyle?: DrawingAnnotationStyle;
}
const prop = withDefaults(defineProps<Prop>(), {
  message: '',
  variant: 'confirm',
  severity: 'normal',
  promptInitialValue: '',
  promptLabel: '',
});

defineEmits([...useDialogPluginComponent.emits]);
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent();

const { t: $t } = useI18n();
const promptValue = ref(prop.promptInitialValue);

/**
 * confirm/prompt共通の確定処理（promptの場合は入力値をペイロードとして返す）
 */
function onConfirm() {
  onDialogOK(prop.variant === 'prompt' ? promptValue.value : undefined);
}

function onDiscard() {
  onDialogOK('discard');
}

function onSaveAndClose() {
  onDialogOK('save');
}

function onReplace() {
  onDialogOK('replace');
}

function onAppend() {
  onDialogOK('append');
}

function onCancelClick() {
  onDialogCancel();
}
</script>

<style scoped lang="scss">
.prompt-preview {
  display: flex;
  justify-content: center;
}
</style>
