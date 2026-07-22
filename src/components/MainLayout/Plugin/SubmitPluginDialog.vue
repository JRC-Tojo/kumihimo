<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    @update:model-value="(val) => emit('update:modelValue', val)"
  >
    <q-card style="min-width: 400px">
      <q-card-section>
        <div class="text-h6">{{ $t('plugins.submission.dialogTitle') }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-file
          v-model="manifestFile"
          :label="$t('plugins.submission.manifestFile')"
          accept=".json"
          dense
          outlined
        />
        <q-file
          v-model="binaryFile"
          :label="$t('plugins.submission.binaryFile')"
          class="q-mt-sm"
          dense
          outlined
        />

        <q-banner v-if="validationErrors.length > 0" dense class="bg-negative text-white q-mt-sm">
          <div>{{ $t('plugins.submission.validationErrors') }}</div>
          <ul class="q-my-none">
            <li v-for="(err, i) in validationErrors" :key="i">{{ err }}</li>
          </ul>
        </q-banner>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('button.cancel')" @click="onCancel" />
        <q-btn
          unelevated
          color="primary"
          :label="$t('button.upload')"
          :disable="!manifestFile || !binaryFile"
          :loading="submitting"
          @click="onSubmit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';

interface Prop {
  modelValue: boolean;
}
defineProps<Prop>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  submitted: [];
}>();

const { t: $t } = useI18n();
const api = useBackendApi();

const manifestFile = ref<File | null>(null);
const binaryFile = ref<File | null>(null);
const validationErrors = ref<string[]>([]);
const submitting = ref(false);

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

async function onSubmit() {
  if (!manifestFile.value || !binaryFile.value) return;
  validationErrors.value = [];
  submitting.value = true;

  try {
    const manifestText = await readFileAsText(manifestFile.value);
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestText);
    } catch {
      validationErrors.value = [$t('plugins.errors.manifestInvalid')];
      return;
    }

    const binary = await readFileAsUint8Array(binaryFile.value);
    const res = await api.submitPlugin(manifestJson, binary);
    if (!res.ok) {
      validationErrors.value = [$t('plugins.errors.manifestInvalid')];
      return;
    }

    manifestFile.value = null;
    binaryFile.value = null;
    emit('submitted');
    emit('update:modelValue', false);
  } finally {
    submitting.value = false;
  }
}
</script>
