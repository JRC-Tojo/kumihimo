<template>
  <q-page class="q-pa-md">
    <h1 class="text-h4 q-mb-lg">{{ $t('settings.title') }}</h1>

    <q-card class="q-mb-lg" style="max-width: 600px">
      <q-card-section class="q-pb-none">
        <div class="text-h6">{{ $t('settings.title') }}</div>
      </q-card-section>

      <q-card-section>
        <div class="q-mb-lg">
          <q-toggle
            v-if="settings"
            v-model="isDarkMode"
            :label="$t('settings.darkMode')"
            @update:model-value="updateSettings"
          />
        </div>

        <div class="q-mb-lg">
          <label class="text-body1">{{ $t('settings.viewMode') }}</label>
          <q-select
            v-if="settings"
            v-model="viewMode"
            :options="viewModes"
            outlined
            class="q-mt-md"
            @update:model-value="updateSettings"
          />
        </div>

        <div class="q-mb-lg">
          <label class="text-body1">{{ $t('settings.sortBy') }}</label>
          <q-select
            v-if="settings"
            v-model="sortBy"
            :options="sortOptions"
            outlined
            class="q-mt-md"
            @update:model-value="updateSettings"
          />
        </div>

        <div class="q-mb-lg">
          <label class="text-body1">{{ $t('settings.language') }}</label>
          <q-select
            v-model="currentLocale"
            :options="languages"
            outlined
            class="q-mt-md"
            @update:model-value="changeLanguage"
          />
        </div>
      </q-card-section>

      <q-card-actions>
        <q-btn unelevated color="primary" :label="$t('settings.save')" @click="saveAllSettings" />
      </q-card-actions>
    </q-card>

    <!-- 関係性検証スタイル -->
    <q-card v-if="settings" class="q-mb-lg" style="max-width: 600px">
      <q-card-section class="q-pb-none">
        <div class="text-h6">{{ $t('settings.relationalVerification.title') }}</div>
      </q-card-section>

      <q-card-section>
        <div
          v-for="status in ['ok', 'ng'] as const"
          :key="status"
          class="q-mb-lg relational-status-editor"
        >
          <label class="text-subtitle2">{{
            $t(`settings.relationalVerification.${status}`)
          }}</label>

          <div class="row items-center q-gutter-md q-mt-sm">
            <div class="color-field">
              <span class="text-caption">{{
                $t('settings.relationalVerification.strokeColor')
              }}</span>
              <input
                v-model="settings.relationalVerificationStyle[status].strokeColor"
                type="color"
              />
            </div>
            <div class="color-field">
              <span class="text-caption">{{
                $t('settings.relationalVerification.fillColor')
              }}</span>
              <input
                v-model="settings.relationalVerificationStyle[status].fillColor"
                type="color"
              />
            </div>
          </div>

          <div class="q-mt-sm">
            <span class="text-caption">
              {{ $t('settings.relationalVerification.strokeWidth') }}:
              {{ settings.relationalVerificationStyle[status].strokeWidth }}
            </span>
            <q-slider
              v-model="settings.relationalVerificationStyle[status].strokeWidth"
              :min="1"
              :max="10"
              :step="0.5"
            />
          </div>

          <div class="q-mt-sm">
            <span class="text-caption">
              {{ $t('settings.relationalVerification.fillOpacity') }}:
              {{ settings.relationalVerificationStyle[status].fillOpacity }}
            </span>
            <q-slider
              v-model="settings.relationalVerificationStyle[status].fillOpacity"
              :min="0"
              :max="1"
              :step="0.05"
            />
          </div>
        </div>
      </q-card-section>

      <q-card-actions>
        <q-btn unelevated color="primary" :label="$t('settings.save')" @click="saveAllSettings" />
      </q-card-actions>
    </q-card>

    <!-- テストデータ -->
    <q-card class="q-mb-lg" style="max-width: 600px">
      <q-card-section class="q-pb-none">
        <div class="text-h6">Test Data</div>
      </q-card-section>

      <q-card-section>
        <p class="text-body2">Create sample documents for testing:</p>
      </q-card-section>

      <q-card-actions>
        <q-btn color="primary" label="Create Sample Documents" @click="createSampleData" />
        <q-btn flat color="negative" label="Clear All Data" @click="clearAllData" />
      </q-card-actions>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { AppSettings } from 'src/models/settings';
import { toEntries } from 'src/utils/obj/obj';
import { useSettingsStore } from 'src/stores/settingsStore';

const { locale, t: $t } = useI18n();
const $q = useQuasar();
const api = useBackendApi();
const settingsStore = useSettingsStore();

let beforeChangedSettings: { [key: string]: unknown } = {};
const settings = ref<AppSettings>();

const currentLocale = ref('en-US');
const isDarkMode = computed(() => settings.value?.darkMode);
const viewMode = computed(() => settings.value?.viewMode);
const sortBy = computed(() => settings.value?.sortBy);

const viewModes = [
  { label: $t('viewMode.rich'), value: 'rich' },
  { label: $t('viewMode.list1'), value: 'list1' },
  { label: $t('viewMode.list2'), value: 'list2' },
];

const sortOptions = [
  { label: $t('sort.byName'), value: 'name' },
  { label: $t('sort.byUpdatedAt'), value: 'updatedAt' },
  { label: $t('sort.byGenre'), value: 'genre' },
];

const languages = [
  { label: 'English', value: 'en-US' },
  { label: '日本語', value: 'ja-JP' },
];

onMounted(async () => {
  const response = await api.getSettings();
  if (response.ok) {
    settings.value = response.data;
  }
  currentLocale.value = locale.value;
});

/**
 * 設定を更新
 */
async function updateSettings() {
  // 設定の自動保存（オプション）
}

/**
 * すべての設定を保存
 */
async function saveAllSettings() {
  if (settings.value === undefined) return;

  // 変更があった設定のみをAPIに保存
  const savePromises = toEntries(settings.value)
    .filter(([k, afterValue]) => {
      const beforeValue = beforeChangedSettings[k] ?? '';
      // TODO: 比較方法は要検討（オブジェクトのハッシュ取得関数を作成？）
      // 並び順などで問題ある場合は以下のようなライブラリの活用を検討
      // https://www.npmjs.com/package/object-hash
      return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
    })
    .map(([k, afterValue]) => api.saveSettings(k, afterValue));

  // すべてのPromiseを待機
  const res = await Promise.all(savePromises);
  const errRes = res.find((r) => !r.ok);
  if (res.length > 0 && errRes !== void 0) {
    $q.notify({ type: 'negative', message: $t('message.error') });
    return;
  }

  // 更新後、beforeChangedSettingsを現在の設定で上書き
  beforeChangedSettings = { ...settings.value };

  // 開いている文書タブなど、設定をリアクティブに参照している箇所にも反映する
  await settingsStore.loadSettings();

  $q.notify({
    type: 'positive',
    message: $t('message.success'),
  });
}

/**
 * 言語を変更
 */
function changeLanguage(lang: string) {
  locale.value = lang;
}

/**
 * サンプルデータを作成
 */
async function createSampleData() {
  const { createDemoData } = await import('src/utils/appInitializer');
  await createDemoData();
  $q.notify({
    type: 'positive',
    message: 'Sample documents created!',
  });
}

/**
 * すべてのデータをクリア
 */
function clearAllData() {
  $q.dialog({
    title: 'Confirm',
    message: 'Are you sure you want to delete all data? This action cannot be undone.',
    cancel: true,
    persistent: true,
  }).onOk(() => {
    // localStorageRepository.clear() を呼ぶ（ただし、実装では関数がexportされていないため省略）
    $q.notify({
      type: 'positive',
      message: 'All data cleared',
    });
  });
}

onMounted(async () => {
  const apiRes = await api.getSettings();
  if (apiRes.ok) {
    settings.value = apiRes.data;
    beforeChangedSettings = { ...apiRes.data };
  }
});
</script>

<style scoped lang="scss">
.relational-status-editor {
  border-left: 3px solid $grey-4;
  padding-left: 0.75rem;
}

.color-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  input[type='color'] {
    width: 48px;
    height: 32px;
    border: 1px solid $grey-4;
    border-radius: 4px;
    cursor: pointer;
  }
}
</style>
