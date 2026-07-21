<template>
  <router-view />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useEditorStore } from './stores/editorStore';
import { callLeftHeaderTools, callRightHeaderTools } from './stores/editorTools';
import { useSettingsStore } from './stores/settingsStore';

const { t } = useI18n();
const editorStore = useEditorStore();
const settingsStore = useSettingsStore();

// アプリ設定をフロントエンドで読み込み
void settingsStore.loadSettings();

// エディタの初期化処理を実行
editorStore.initStore(callLeftHeaderTools(t), callRightHeaderTools(t));
</script>
