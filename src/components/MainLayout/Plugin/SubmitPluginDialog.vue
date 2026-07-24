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
        <div class="text-subtitle2 q-mb-xs">
          {{
            isUpdateMode
              ? $t('plugins.submission.updateModeTitle', { name: updateTarget?.name })
              : $t('plugins.submission.newSubmissionTitle')
          }}
        </div>

        <q-input
          v-model="name"
          dense
          outlined
          :label="$t('plugins.submission.nameLabel')"
          :disable="submitting"
          class="q-mb-sm"
        />
        <q-input
          v-model="description"
          type="textarea"
          autogrow
          dense
          outlined
          :label="$t('plugins.submission.descriptionLabel')"
          :disable="submitting"
          class="q-mb-sm"
        />
        <q-select
          v-model="runtime"
          dense
          outlined
          :options="runtimeOptions"
          :label="$t('plugins.submission.runtimeLabel')"
          :disable="submitting"
          class="q-mb-sm"
        />
        <q-select
          v-model="requiredHostApis"
          multiple
          use-chips
          dense
          outlined
          :options="hostApiOptions"
          :label="$t('plugins.submission.requiredHostApisLabel')"
          :disable="submitting"
          class="q-mb-sm"
        />

        <!-- バージョン: 新規申請は自由入力、アップデートはメジャー/マイナー/パッチのボタン選択式 -->
        <q-input
          v-if="!isUpdateMode"
          v-model="initialVersion"
          dense
          outlined
          :label="$t('plugins.submission.initialVersionLabel')"
          :disable="submitting"
          class="q-mb-sm"
        />
        <template v-else>
          <div class="text-caption text-grey-8 q-mb-xs">
            {{ $t('plugins.submission.currentVersionLabel') }}: v{{ currentVersion }}
          </div>
          <div class="row items-center q-gutter-sm q-mb-sm">
            <q-btn-toggle
              v-if="parsedCurrentVersion"
              v-model="bumpKind"
              dense
              no-caps
              toggle-color="primary"
              :options="bumpOptions"
              :disable="submitting"
            />
            <q-input
              v-else
              v-model="manualBumpedVersion"
              dense
              outlined
              :label="$t('plugins.submission.manualVersionLabel')"
              :disable="submitting"
            />
            <span v-if="nextVersion" class="text-caption">
              {{
                $t('plugins.submission.versionPreview', { from: currentVersion, to: nextVersion })
              }}
            </span>
          </div>
          <div class="row justify-end q-mb-sm">
            <q-btn
              flat
              dense
              :label="$t('plugins.submission.cancelUpdate')"
              :disable="submitting"
              @click="cancelUpdate"
            />
          </div>
        </template>

        <q-file
          v-model="binaryFile"
          :label="$t('plugins.submission.binaryFile')"
          dense
          outlined
          :disable="submitting"
        />
        <q-file
          v-model="iconFile"
          :label="$t('plugins.submission.iconFile')"
          :hint="isUpdateMode ? $t('plugins.submission.iconFileHint') : undefined"
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
            :disable="!canSubmit"
            :loading="submitting"
            @click="onSubmit"
          />
        </div>

        <!-- 入力内容がストア一覧でどう見えるかのライブプレビュー -->
        <div class="text-subtitle2 q-mt-md q-mb-xs">
          {{ $t('plugins.submission.storePreviewTitle') }}
        </div>
        <q-list bordered separator>
          <PluginListItem
            :manifest="previewManifest"
            :installed="false"
            :icon-src="previewIconSrc"
            preview
          />
        </q-list>

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
            @update="startUpdate"
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
import { usePluginStore } from 'src/stores/pluginStore';
import type { PluginSubmission } from 'src/models/plugin/submission';
import type { PluginID, PluginManifest } from 'src/models/plugin/manifest';
import { PluginHostApiName, PluginRuntime } from 'src/models/plugin/manifest';
import { sniffImageFormat, hasExtensionForImageFormat } from 'src/utils/binary/imageSniff';
import { bumpVersion, parseSemver } from 'src/utils/version/semver';
import type { VersionBumpKind } from 'src/utils/version/semver';
import PluginSubmissionGroup from './PluginSubmissionGroup.vue';
import PluginListItem from './PluginListItem.vue';

// ストアリポジトリCI（validateIcon.mjs）と同じ上限。事前に検証し、クライアント側で早期に弾く
const ICON_MAX_SIZE_BYTES = 512 * 1024;
// 更新ボタンの連打によるリクエスト過多を防ぐためのクールダウン
const REFRESH_COOLDOWN_MS = 3000;
// プレビュー表示専用のダミーid（実際には送信されない。PluginListItemはidを表示しないため
// 見た目には影響しない）
const PREVIEW_ID = '00000000-0000-4000-8000-000000000000' as PluginManifest['id'];

const runtimeOptions = [...PluginRuntime.options];
const hostApiOptions = [...PluginHostApiName.options];

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
const pluginStore = usePluginStore();

const devGuideUrl =
  'https://github.com/JRC-Tojo/RD-PluginStock/blob/main/docs/PLUGIN_DEVELOPMENT_GUIDE.md';

const name = ref('');
const description = ref('');
const runtime = ref<PluginRuntime>('wasm');
const requiredHostApis = ref<PluginHostApiName[]>([]);
const initialVersion = ref('1.0.0');
const binaryFile = ref<File | null>(null);
const iconFile = ref<File | null>(null);
const validationErrors = ref<string[]>([]);
const successMessage = ref('');
const submitting = ref(false);

// アップデートモード（設定されていれば、対象プラグインのバージョン更新申請になる）
const updateTarget = ref<PluginManifest>();
const bumpKind = ref<VersionBumpKind>();
// 現行バージョンがx.y.z形式でパースできない場合のフォールバック手入力
const manualBumpedVersion = ref('');

const githubConnected = ref(true);
const mySubmissions = ref<PluginSubmission[]>([]);
const loadingSubmissions = ref(false);
const refreshCooldown = ref(false);

const bumpOptions = computed(() => [
  { label: $t('plugins.submission.bumpMajor'), value: 'major' as const },
  { label: $t('plugins.submission.bumpMinor'), value: 'minor' as const },
  { label: $t('plugins.submission.bumpPatch'), value: 'patch' as const },
]);

const isUpdateMode = computed(() => updateTarget.value !== undefined);
const currentVersion = computed(() => updateTarget.value?.version ?? '');
const parsedCurrentVersion = computed(() => parseSemver(currentVersion.value));
const nextVersion = computed(() => {
  if (!bumpKind.value || !parsedCurrentVersion.value) return undefined;
  return bumpVersion(currentVersion.value, bumpKind.value);
});
const previewVersion = computed(() =>
  isUpdateMode.value ? (nextVersion.value ?? currentVersion.value) : initialVersion.value,
);

const submitButtonLabel = computed(() => {
  if (submitting.value) return $t('plugins.submission.submitting');
  return isUpdateMode.value ? $t('plugins.submission.submitUpdate') : $t('button.upload');
});

const canSubmit = computed(() => {
  if (!name.value.trim() || !binaryFile.value || !githubConnected.value || submitting.value) {
    return false;
  }
  if (!isUpdateMode.value) return initialVersion.value.trim().length > 0;
  return !!nextVersion.value || manualBumpedVersion.value.trim().length > 0;
});

// 新規に選択したアイコン画像のプレビュー用object URL（選び直すたびに前のものを解放する）
const newIconObjectUrl = ref<string>();
watch(iconFile, (file) => {
  if (newIconObjectUrl.value) {
    URL.revokeObjectURL(newIconObjectUrl.value);
    newIconObjectUrl.value = undefined;
  }
  if (file) newIconObjectUrl.value = URL.createObjectURL(file);
});
onBeforeUnmount(() => {
  if (newIconObjectUrl.value) URL.revokeObjectURL(newIconObjectUrl.value);
});

// フォーム入力から組み立てる、ストア一覧での表示プレビュー用マニフェスト（送信はされない）
const previewManifest = computed<PluginManifest>(() => ({
  id: updateTarget.value?.id ?? PREVIEW_ID,
  name: name.value,
  version: previewVersion.value,
  description: description.value,
  runtime: runtime.value,
  mainFile: binaryFile.value?.name ?? '',
  requiredHostApis: requiredHostApis.value,
}));

// アイコンのプレビュー: 新規選択があればそちらを優先し、無ければアップデート対象の
// 公開済みアイコン（既にロード済みのカタログキャッシュから引く。追加のfetchは行わない）
const previewIconSrc = computed(() => {
  if (newIconObjectUrl.value) return newIconObjectUrl.value;
  if (!updateTarget.value) return undefined;
  const targetId = updateTarget.value.id;
  return pluginStore.catalog.find((entry) => entry.manifest.id === targetId)?.iconUrl;
});

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
      void pluginStore.loadCatalog();
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

/** フォーム全体を新規申請モードの初期状態に戻す */
function resetForm() {
  name.value = '';
  description.value = '';
  runtime.value = 'wasm';
  requiredHostApis.value = [];
  initialVersion.value = '1.0.0';
  bumpKind.value = undefined;
  manualBumpedVersion.value = '';
  binaryFile.value = null;
  iconFile.value = null;
}

/** 「アップデート」ボタン押下時: フォームを公開済みマニフェストの内容でプリフィルする */
function startUpdate(manifest: PluginManifest) {
  updateTarget.value = manifest;
  name.value = manifest.name;
  description.value = manifest.description;
  runtime.value = manifest.runtime;
  requiredHostApis.value = [...manifest.requiredHostApis];
  bumpKind.value = undefined;
  manualBumpedVersion.value = '';
  // 本体ファイルは誤操作防止のため必ず選び直させる。アイコンは変更したい場合のみ選び直す
  binaryFile.value = null;
  iconFile.value = null;
  validationErrors.value = [];
  successMessage.value = '';
}

function cancelUpdate() {
  updateTarget.value = undefined;
  resetForm();
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
async function validateAndReadIcon(file: File): Promise<{ icon: Uint8Array } | { error: string }> {
  if (file.size > ICON_MAX_SIZE_BYTES) {
    return { error: $t('plugins.submission.iconFileTooLarge') };
  }

  const icon = await readFileAsUint8Array(file);
  const format = sniffImageFormat(icon);
  if (!format) {
    return { error: $t('plugins.submission.iconFileUnsupportedFormat') };
  }
  if (!hasExtensionForImageFormat(file.name, format)) {
    return { error: $t('plugins.submission.iconFileExtensionMismatch') };
  }

  return { icon };
}

/** 「申請する」ボタン押下時: アイコン・バイナリを検証したうえでGitHubへ申請を送信する */
async function onSubmit() {
  const binaryFileValue = binaryFile.value;
  if (!binaryFileValue) return;
  validationErrors.value = [];
  successMessage.value = '';

  if (updateTarget.value && findActiveSubmission(updateTarget.value.id, 'unpublish')) {
    validationErrors.value = [$t('plugins.errors.unpublishInProgress')];
    return;
  }

  submitting.value = true;
  try {
    let icon: Uint8Array | undefined;
    if (iconFile.value) {
      const iconResult = await validateAndReadIcon(iconFile.value);
      if ('error' in iconResult) {
        validationErrors.value = [iconResult.error];
        return;
      }
      icon = iconResult.icon;
    }

    const binary = await readFileAsUint8Array(binaryFileValue);

    // iconFile: 新規選択があればそのファイル名。無ければアップデート時のみ既存の値を引き継ぐ
    // （省略すると公開済みのiconFile参照が消えてしまうため、新規申請時のみ本当に省略してよい）
    const iconFileName = iconFile.value ? iconFile.value.name : updateTarget.value?.iconFile;
    const versionToSubmit = isUpdateMode.value
      ? (nextVersion.value ?? manualBumpedVersion.value)
      : initialVersion.value;

    const draft = {
      name: name.value,
      description: description.value,
      runtime: runtime.value,
      mainFile: binaryFileValue.name,
      ...(iconFileName ? { iconFile: iconFileName } : {}),
      requiredHostApis: requiredHostApis.value,
      version: versionToSubmit,
    };

    const res = await api.submitPlugin(draft, binary, icon, updateTarget.value?.id);
    if (!res.ok) {
      validationErrors.value = [res.error.error.message || $t('plugins.errors.manifestInvalid')];
      return;
    }

    cancelUpdate();
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
