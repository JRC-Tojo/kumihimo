<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    @update:model-value="(val) => emit('update:modelValue', val)"
  >
    <q-card style="min-width: 480px; max-width: 640px">
      <q-card-section>
        <div class="text-h6">{{ $t('plugins.sideload.dialogTitle') }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="text-caption text-grey-8 q-mb-md">{{ $t('plugins.sideload.helpText') }}</div>

        <q-file
          v-model="manifestFile"
          :label="$t('plugins.sideload.manifestFile')"
          accept=".json"
          dense
          outlined
        />
        <q-file
          v-model="binaryFile"
          :label="$t('plugins.sideload.binaryFile')"
          class="q-mt-sm"
          dense
          outlined
        />
        <q-file
          v-model="iconFile"
          :label="$t('plugins.sideload.iconFile')"
          class="q-mt-sm"
          dense
          outlined
          accept="image/*"
          clearable
        />

        <q-banner v-if="errorMessage" dense class="bg-negative text-white q-mt-sm">
          {{ errorMessage }}
        </q-banner>
        <q-banner v-if="successMessage" dense class="bg-positive text-white q-mt-sm">
          {{ successMessage }}
        </q-banner>

        <div class="row justify-end q-mt-sm">
          <q-btn
            unelevated
            color="primary"
            :label="$t('plugins.actions.sideload')"
            :disable="!manifestFile || !binaryFile"
            :loading="installing"
            @click="onInstall"
          />
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('button.close')" @click="onCancel" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePluginStore } from 'src/stores/pluginStore';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';

interface Prop {
  modelValue: boolean;
}
defineProps<Prop>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  installed: [];
}>();

const { t: $t } = useI18n();
const pluginStore = usePluginStore();

const manifestFile = ref<File | null>(null);
const binaryFile = ref<File | null>(null);
const iconFile = ref<File | null>(null);
const errorMessage = ref('');
const successMessage = ref('');
const installing = ref(false);

function onCancel() {
  emit('update:modelValue', false);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(result instanceof ArrayBuffer ? new Uint8Array(result) : new Uint8Array());
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function onInstall() {
  if (!manifestFile.value || !binaryFile.value) return;
  errorMessage.value = '';
  successMessage.value = '';

  const manifestText = await readFileAsText(manifestFile.value);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    errorMessage.value = $t('plugins.errors.manifestInvalid');
    return;
  }

  const declaredId =
    typeof manifestJson === 'object' && manifestJson !== null && 'id' in manifestJson
      ? (manifestJson as { id?: unknown }).id
      : undefined;
  if (typeof declaredId === 'string' && pluginStore.installed.some((e) => e.manifest.id === declaredId)) {
    const confirmed = await confirmDialog({
      title: $t('plugins.sideload.overwriteWarningTitle'),
      message: $t('plugins.sideload.overwriteWarningMessage', { id: declaredId }),
      severity: 'negative',
    });
    if (!confirmed) return;
  }

  installing.value = true;
  try {
    const binary = await readFileAsUint8Array(binaryFile.value);
    const icon = iconFile.value ? await readFileAsUint8Array(iconFile.value) : undefined;
    const ok = await pluginStore.installFromFile(manifestJson, binary, icon);
    if (!ok) {
      errorMessage.value = $t('plugins.errors.installFailed');
      return;
    }

    manifestFile.value = null;
    binaryFile.value = null;
    iconFile.value = null;
    successMessage.value = $t('plugins.sideload.installSuccess');
    emit('installed');
  } finally {
    installing.value = false;
  }
}
</script>
