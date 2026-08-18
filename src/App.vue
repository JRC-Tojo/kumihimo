<template>
  <LockScreen v-if="!isUnlocked" @unlocked="onUnlocked" />
  <router-view v-else />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import LockScreen from './components/Lock/LockScreen.vue';
import { useEditorStore } from './stores/editorStore';
import { callLeftHeaderTools, callRightHeaderTools } from './stores/editorTools';
import { useSettingsStore } from './stores/settingsStore';

const { t } = useI18n();
const editorStore = useEditorStore();
const settingsStore = useSettingsStore();

const isUnlocked = computed(() => settingsStore.appSettings?.unlocked === true);

// アプリ設定をフロントエンドで読み込み
void settingsStore.loadSettings();

// 解除済み状態（既存の端末で最初から解除済みだった場合／今回新たに解除した場合の両方）に
// なった時点で一度だけエディタの初期化処理を実行する
const stopWatchUnlocked = watch(isUnlocked, (unlocked) => {
  if (!unlocked) return;
  editorStore.initStore(callLeftHeaderTools(t), callRightHeaderTools(t));
  stopWatchUnlocked();
});

/**
 * ロック画面解除後、設定のフラグを即座に反映する（実際の保存はAPI側で完了済み）
 */
function onUnlocked() {
  settingsStore.markUnlocked();
}
</script>
