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

        <q-input
          v-model="name"
          dense
          outlined
          :label="$t('plugins.sideload.nameLabel')"
          :disable="installing"
          class="q-mb-sm"
        />
        <q-input
          v-model="description"
          type="textarea"
          autogrow
          dense
          outlined
          :label="$t('plugins.sideload.descriptionLabel')"
          :disable="installing"
          class="q-mb-sm"
        />
        <q-select
          v-model="runtime"
          dense
          outlined
          :options="runtimeOptions"
          :label="$t('plugins.sideload.runtimeLabel')"
          :disable="installing"
          class="q-mb-sm"
        />
        <q-select
          v-model="requiredHostApis"
          multiple
          use-chips
          dense
          outlined
          :options="hostApiOptions"
          :label="$t('plugins.sideload.requiredHostApisLabel')"
          :disable="installing"
          class="q-mb-sm"
        />
        <q-input
          v-model="version"
          dense
          outlined
          :label="$t('plugins.sideload.versionLabel')"
          :disable="installing"
          class="q-mb-sm"
        />

        <q-file
          v-model="binaryFile"
          :label="$t('plugins.sideload.binaryFile')"
          dense
          outlined
          :disable="installing"
        />
        <q-file
          v-model="iconFile"
          :label="$t('plugins.sideload.iconFile')"
          class="q-mt-sm"
          dense
          outlined
          accept="image/*"
          clearable
          :disable="installing"
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
            :disable="!canInstall"
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
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePluginStore } from 'src/stores/pluginStore';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';
import { PluginHostApiName, PluginRuntime } from 'src/models/plugin/manifest';

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

const runtimeOptions = [...PluginRuntime.options];
const hostApiOptions = [...PluginHostApiName.options];

const name = ref('');
const description = ref('');
const runtime = ref<PluginRuntime>('wasm');
const requiredHostApis = ref<PluginHostApiName[]>([]);
const version = ref('1.0.0');
const binaryFile = ref<File | null>(null);
const iconFile = ref<File | null>(null);
const errorMessage = ref('');
const successMessage = ref('');
const installing = ref(false);

const canInstall = computed(
  () => name.value.trim().length > 0 && binaryFile.value !== null && !installing.value,
);

function onCancel() {
  emit('update:modelValue', false);
}

function resetForm() {
  name.value = '';
  description.value = '';
  runtime.value = 'wasm';
  requiredHostApis.value = [];
  version.value = '1.0.0';
  binaryFile.value = null;
  iconFile.value = null;
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
  const binaryFileValue = binaryFile.value;
  if (!binaryFileValue) return;
  errorMessage.value = '';
  successMessage.value = '';

  // 同名のサイドロード済みプラグインが既にあれば、上書きになる旨を警告する
  // （カタログ版が存在するだけでは警告しない。カタログとサイドロードは共存が正常系のため）
  const existing = pluginStore.installed.find(
    (e) => e.source === 'sideload' && e.manifest.name === name.value,
  );
  if (existing) {
    const confirmed = await confirmDialog({
      title: $t('plugins.sideload.overwriteWarningTitle'),
      message: $t('plugins.sideload.overwriteWarningMessage', { name: name.value }),
      severity: 'negative',
    });
    if (!confirmed) return;
  }

  installing.value = true;
  try {
    const binary = await readFileAsUint8Array(binaryFileValue);
    const icon = iconFile.value ? await readFileAsUint8Array(iconFile.value) : undefined;

    const draft = {
      name: name.value,
      description: description.value,
      runtime: runtime.value,
      mainFile: binaryFileValue.name,
      ...(iconFile.value ? { iconFile: iconFile.value.name } : {}),
      requiredHostApis: requiredHostApis.value,
      version: version.value,
    };

    const ok = await pluginStore.installFromFile(draft, binary, icon);
    if (!ok) {
      errorMessage.value = $t('plugins.errors.installFailed');
      return;
    }

    resetForm();
    successMessage.value = $t('plugins.sideload.installSuccess');
    emit('installed');
  } finally {
    installing.value = false;
  }
}
</script>
