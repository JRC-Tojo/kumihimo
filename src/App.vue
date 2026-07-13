<template>
  <router-view />
</template>

<script setup lang="ts">
import { useSettingsStore } from './stores/settingsStore';

const settingsStore = useSettingsStore()

// アプリ設定をフロントエンドで読み込み
void settingsStore.loadSettings();
</script>
