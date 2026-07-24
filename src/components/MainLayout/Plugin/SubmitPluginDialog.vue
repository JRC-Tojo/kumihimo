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
          :disable="submitting"
        />
        <q-file
          v-model="binaryFile"
          :label="$t('plugins.submission.binaryFile')"
          class="q-mt-sm"
          dense
          outlined
          :disable="submitting"
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
          :disable="submitting"
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
            :label="submitButtonLabel"
            :disable="!manifestFile || !binaryFile || !githubConnected || submitting"
            :loading="submitting"
            @click="onSubmit"
          />
        </div>

        <div class="q-my-md" />

        <!-- マイ申請一覧（プラグイン単位でグルーピング） -->
        <div class="row items-center q-mb-xs">
          <div class="text-subtitle2">{{ $t('plugins.submission.mySubmissionsTitle') }}</div>
          <q-space />
          <q-btn
            flat
            dense
            round
            icon="refresh"
            size="sm"
            :loading="loadingSubmissions"
            :disable="refreshCooldown"
            @click="loadSubmissions"
          >
            <q-tooltip>{{ $t('plugins.actions.refresh') }}</q-tooltip>
          </q-btn>
        </div>
        <div
          v-if="loadingSubmissions && mySubmissions.length === 0"
          class="text-grey-6 text-caption q-pa-sm"
        >
          {{ $t('message.loading') }}
        </div>
        <div v-else-if="submissionGroups.length === 0" class="text-grey-6 text-caption q-pa-sm">
          {{ $t('plugins.submission.noSubmissions') }}
        </div>
        <q-list v-else separator>
          <PluginSubmissionGroup
            v-for="group in submissionGroups"
            :key="group.pluginId"
            :plugin-name="group.pluginName"
            :submissions="group.submissions"
            @withdraw="onWithdraw"
            @unpublish="onUnpublish"
          />
        </q-list>

        <div class="q-my-md" />

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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Notify } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { PluginSubmission } from 'src/models/plugin/submission';
import type { PluginID } from 'src/models/plugin/manifest';
import { sniffImageFormat, hasExtensionForImageFormat } from 'src/utils/binary/imageSniff';
import PluginSubmissionGroup from './PluginSubmissionGroup.vue';

// ストアリポジトリCI（validateIcon.mjs）と同じ上限。事前に検証し、クライアント側で早期に弾く
const ICON_MAX_SIZE_BYTES = 512 * 1024;
// 更新ボタンの連打によるリクエスト過多を防ぐためのクールダウン
const REFRESH_COOLDOWN_MS = 3000;

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
const refreshCooldown = ref(false);

const submitButtonLabel = computed(() =>
  submitting.value ? $t('plugins.submission.submitting') : $t('button.upload'),
);

interface SubmissionGroup {
  pluginId: string;
  pluginName: string;
  submissions: PluginSubmission[];
}

// マイ申請をプラグイン単位（manifest.id）でグルーピングし、各グループ内はsubmittedAt降順にする
const submissionGroups = computed<SubmissionGroup[]>(() => {
  const groups = new Map<string, PluginSubmission[]>();
  for (const submission of mySubmissions.value) {
    const list = groups.get(submission.manifest.id) ?? [];
    list.push(submission);
    groups.set(submission.manifest.id, list);
  }
  return Array.from(groups.entries()).map(([pluginId, submissions]) => {
    submissions.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    return { pluginId, pluginName: submissions[0]?.manifest.name ?? pluginId, submissions };
  });
});

/** 指定プラグインについて、終端状態（published/withdrawn）でない指定kindの申請を探す */
function findActiveSubmission(
  pluginId: string,
  kind: PluginSubmission['kind'],
): PluginSubmission | undefined {
  return mySubmissions.value.find(
    (s) =>
      s.manifest.id === pluginId &&
      s.kind === kind &&
      s.status !== 'published' &&
      s.status !== 'withdrawn',
  );
}

async function loadSubmissions() {
  if (refreshCooldown.value) return;
  loadingSubmissions.value = true;
  try {
    const res = await api.getPluginSubmissions();
    githubConnected.value = res.ok || res.error.key !== 'PLUGIN_GITHUB_TOKEN_MISSING';
    mySubmissions.value = res.ok ? res.data : [];
  } finally {
    loadingSubmissions.value = false;
    refreshCooldown.value = true;
    setTimeout(() => {
      refreshCooldown.value = false;
    }, REFRESH_COOLDOWN_MS);
  }
}

/** 取得済みの申請一覧に、新しい申請結果を反映する（同一PR番号があれば置き換え、なければ追加） */
function mergeSubmission(submission: PluginSubmission) {
  const idx = mySubmissions.value.findIndex((s) => s.prNumber === submission.prNumber);
  if (idx === -1) mySubmissions.value = [submission, ...mySubmissions.value];
  else mySubmissions.value = mySubmissions.value.map((s, i) => (i === idx ? submission : s));
}

// ダイアログを開いている間、CI検証結果やマージ状況を自動的に反映できるよう定期的に再取得する
// （フロントエンドのみの構成のためWebhook等でのプッシュ通知はできず、ポーリングで代替する）
const SUBMISSIONS_POLL_INTERVAL_MS = 30_000;
let pollTimer: ReturnType<typeof setInterval> | undefined;

function stopSubmissionsPolling() {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startSubmissionsPolling() {
  stopSubmissionsPolling();
  pollTimer = setInterval(() => {
    if (!loadingSubmissions.value) void loadSubmissions();
  }, SUBMISSIONS_POLL_INTERVAL_MS);
}

watch(
  () => prop.modelValue,
  (isOpen) => {
    if (isOpen) {
      validationErrors.value = [];
      successMessage.value = '';
      void loadSubmissions();
      startSubmissionsPolling();
    } else {
      stopSubmissionsPolling();
    }
  },
);

onBeforeUnmount(stopSubmissionsPolling);

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

  let manifestText: string;
  try {
    manifestText = await readFileAsText(manifestFile.value);
  } catch {
    validationErrors.value = [$t('plugins.errors.loadFileFailed')];
    return;
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    validationErrors.value = [$t('plugins.errors.manifestInvalid')];
    return;
  }

  const declaredId =
    typeof manifestJson === 'object' && manifestJson !== null && 'id' in manifestJson
      ? (manifestJson as { id?: unknown }).id
      : undefined;
  if (typeof declaredId === 'string' && findActiveSubmission(declaredId, 'unpublish')) {
    validationErrors.value = [$t('plugins.errors.unpublishInProgress')];
    return;
  }

  submitting.value = true;
  try {
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
    // submitPlugin自体がGitHub側の反映待ち（リトライ）を内包して返すため、ここでは
    // 返ってきた結果をそのまま一覧へマージするだけでよい（直後にgetSubmissionsを
    // 呼び直すと検索APIの索引反映待ちで404・空振りしやすいため、あえて呼ばない）
    const res = await api.submitPlugin(manifestJson, binary, icon);
    if (!res.ok) {
      validationErrors.value = [res.error.error.message || $t('plugins.errors.manifestInvalid')];
      return;
    }

    manifestFile.value = null;
    binaryFile.value = null;
    iconFile.value = null;
    successMessage.value = $t('plugins.submission.submitSuccess');
    mergeSubmission(res.data);
    emit('submitted');
  } finally {
    submitting.value = false;
  }
}

async function onUnpublish(pluginId: PluginID) {
  if (findActiveSubmission(pluginId, 'submit')) {
    Notify.create({ type: 'negative', message: $t('plugins.errors.submitInProgress') });
    return;
  }
  const res = await api.unpublishPlugin(pluginId);
  if (res.ok) mergeSubmission(res.data);
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
