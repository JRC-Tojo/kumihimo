<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    @update:model-value="(val) => emit('update:modelValue', val)"
  >
    <q-card style="min-width: 480px; max-width: 640px">
      <q-card-section>
        <div class="text-h6">{{ $t('plugins.submission.dialogTitle') }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none scroll-body">
        <q-banner v-if="!githubConnected" dense class="bg-warning text-white q-mb-md">
          {{ $t('plugins.submission.githubNotConnected') }}
        </q-banner>

        <!-- 新規申請 / バージョン更新 -->
        <div class="text-subtitle2 q-mb-xs">{{ $t('plugins.submission.newSubmissionTitle') }}</div>
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
        <q-file
          v-model="iconFile"
          :label="$t('plugins.submission.iconFile')"
          :hint="$t('plugins.submission.iconFileHint')"
          class="q-mt-sm"
          dense
          outlined
          accept="image/*"
          clearable
        />

        <q-banner v-if="validationErrors.length > 0" dense class="bg-negative text-white q-mt-sm">
          <div>{{ $t('plugins.submission.validationErrors') }}</div>
          <ul class="q-my-none">
            <li v-for="(err, i) in validationErrors" :key="i">{{ err }}</li>
          </ul>
        </q-banner>
        <q-banner v-if="successMessage" dense class="bg-positive text-white q-mt-sm">
          {{ successMessage }}
        </q-banner>

        <div class="row justify-end q-mt-sm">
          <q-btn
            unelevated
            color="primary"
            :label="$t('button.upload')"
            :disable="!manifestFile || !binaryFile || !githubConnected"
            :loading="submitting"
            @click="onSubmit"
          />
        </div>

        <q-separator class="q-my-md" />

        <!-- マイ申請一覧 -->
        <div class="text-subtitle2 q-mb-xs">{{ $t('plugins.submission.mySubmissionsTitle') }}</div>
        <div v-if="loadingSubmissions" class="text-grey-6 text-caption q-pa-sm">
          {{ $t('message.loading') }}
        </div>
        <div v-else-if="mySubmissions.length === 0" class="text-grey-6 text-caption q-pa-sm">
          {{ $t('plugins.submission.noSubmissions') }}
        </div>
        <q-list v-else separator class="q-gutter-y-sm">
          <PluginSubmissionItem
            v-for="submission in mySubmissions"
            :key="submission.prNumber"
            :submission="submission"
            @publish="onPublish(submission.prNumber)"
            @unpublish="onUnpublish(submission.manifest.id)"
            @withdraw="onWithdraw(submission.prNumber)"
          />
        </q-list>

        <q-separator class="q-my-md" />

        <!-- 公開の流れ・開発者向けドキュメント -->
        <div class="text-subtitle2 q-mb-xs">{{ $t('plugins.submission.helpTitle') }}</div>
        <ol class="q-my-none q-pl-md text-caption">
          <li>{{ $t('plugins.submission.helpStep1') }}</li>
          <li>{{ $t('plugins.submission.helpStep2') }}</li>
          <li>{{ $t('plugins.submission.helpStep3') }}</li>
        </ol>
        <div class="q-mt-sm">
          <a :href="devGuideUrl" target="_blank" rel="noopener">{{
            $t('plugins.submission.devGuideLink')
          }}</a>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('button.close')" @click="onCancel" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import type { PluginSubmission } from 'src/models/plugin/submission';
import type { PluginID } from 'src/models/plugin/manifest';
import { sniffImageFormat, hasExtensionForImageFormat } from 'src/utils/binary/imageSniff';
import PluginSubmissionItem from './PluginSubmissionItem.vue';

// ストアリポジトリCI（validateIcon.mjs）と同じ上限。事前に検証し、クライアント側で早期に弾く
const ICON_MAX_SIZE_BYTES = 512 * 1024;

interface Prop {
  modelValue: boolean;
}
const prop = defineProps<Prop>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  submitted: [];
}>();

const { t: $t } = useI18n();
const api = useBackendApi();

const devGuideUrl =
  'https://github.com/JRC-Tojo/RD-PluginStock/blob/main/docs/PLUGIN_DEVELOPMENT_GUIDE.md';

const manifestFile = ref<File | null>(null);
const binaryFile = ref<File | null>(null);
const iconFile = ref<File | null>(null);
const validationErrors = ref<string[]>([]);
const successMessage = ref('');
const submitting = ref(false);

const githubConnected = ref(true);
const mySubmissions = ref<PluginSubmission[]>([]);
const loadingSubmissions = ref(false);

async function loadSubmissions() {
  loadingSubmissions.value = true;
  try {
    const res = await api.getPluginSubmissions();
    githubConnected.value = res.ok || res.error.key !== 'PLUGIN_GITHUB_TOKEN_MISSING';
    mySubmissions.value = res.ok ? res.data : [];
  } finally {
    loadingSubmissions.value = false;
  }
}

watch(
  () => prop.modelValue,
  (isOpen) => {
    if (isOpen) {
      validationErrors.value = [];
      successMessage.value = '';
      void loadSubmissions();
    }
  },
);

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

/**
 * アイコン画像を事前検証する（ストアリポジトリCIのvalidateIcon.mjsと同じ基準）。
 * 問題なければ読み込んだバイト列を返し、問題があれば検証エラーメッセージを返す
 */
async function validateAndReadIcon(
  file: File,
  declaredIconFile: unknown,
): Promise<{ icon: Uint8Array } | { error: string }> {
  if (typeof declaredIconFile !== 'string' || !declaredIconFile) {
    return { error: $t('plugins.submission.iconFileMissingInManifest') };
  }
  if (file.size > ICON_MAX_SIZE_BYTES) {
    return { error: $t('plugins.submission.iconFileTooLarge') };
  }

  const icon = await readFileAsUint8Array(file);
  const format = sniffImageFormat(icon);
  if (!format) {
    return { error: $t('plugins.submission.iconFileUnsupportedFormat') };
  }
  if (!hasExtensionForImageFormat(declaredIconFile, format)) {
    return { error: $t('plugins.submission.iconFileExtensionMismatch') };
  }

  return { icon };
}

async function onSubmit() {
  if (!manifestFile.value || !binaryFile.value) return;
  validationErrors.value = [];
  successMessage.value = '';
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

    const declaredIconFile =
      typeof manifestJson === 'object' && manifestJson !== null && 'iconFile' in manifestJson
        ? (manifestJson as { iconFile?: unknown }).iconFile
        : undefined;

    let icon: Uint8Array | undefined;
    if (iconFile.value) {
      const iconResult = await validateAndReadIcon(iconFile.value, declaredIconFile);
      if ('error' in iconResult) {
        validationErrors.value = [iconResult.error];
        return;
      }
      icon = iconResult.icon;
    }

    const binary = await readFileAsUint8Array(binaryFile.value);
    const res = await api.submitPlugin(manifestJson, binary, icon);
    if (!res.ok) {
      validationErrors.value = [res.error.error.message || $t('plugins.errors.manifestInvalid')];
      return;
    }

    manifestFile.value = null;
    binaryFile.value = null;
    iconFile.value = null;
    successMessage.value = $t('plugins.submission.submitSuccess');
    await loadSubmissions();
    emit('submitted');
  } finally {
    submitting.value = false;
  }
}

async function onPublish(prNumber: number) {
  await api.republishPluginSubmission(prNumber);
  await loadSubmissions();
  emit('submitted');
}

async function onUnpublish(pluginId: PluginID) {
  await api.unpublishPlugin(pluginId);
  await loadSubmissions();
  emit('submitted');
}

async function onWithdraw(prNumber: number) {
  await api.withdrawPluginSubmission(prNumber);
  await loadSubmissions();
  emit('submitted');
}
</script>

<style scoped lang="scss">
.scroll-body {
  max-height: 70vh;
  overflow-y: auto;
}
</style>
