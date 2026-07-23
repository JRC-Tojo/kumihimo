<template>
  <q-item class="plugin-list-item">
    <q-item-section avatar>
      <q-avatar v-if="iconSrc" size="32px" square>
        <img :src="iconSrc" />
      </q-avatar>
      <q-icon v-else name="extension" color="primary" />
    </q-item-section>

    <q-item-section>
      <q-item-label>
        {{ manifest.name }}
        <q-badge v-if="sideloaded" outline color="orange" class="q-ml-xs">{{
          $t('plugins.list.localBadge')
        }}</q-badge>
      </q-item-label>
      <q-item-label caption lines="2">{{ manifest.description }}</q-item-label>
      <q-item-label caption>{{ $t('plugins.list.version') }}: {{ manifest.version }}</q-item-label>
    </q-item-section>

    <q-item-section side>
      <div class="row items-center q-gutter-xs">
        <q-btn
          v-if="installed"
          flat
          dense
          round
          icon="play_arrow"
          size="sm"
          :disable="manifest.runtime !== 'wasm'"
          @click="emit('run')"
        >
          <q-tooltip>{{ $t('plugins.actions.run') }}</q-tooltip>
        </q-btn>
        <q-btn
          v-if="!installed"
          flat
          dense
          round
          icon="download"
          size="sm"
          @click="emit('install')"
        >
          <q-tooltip>{{ $t('plugins.actions.install') }}</q-tooltip>
        </q-btn>
        <q-btn
          v-if="installed"
          flat
          dense
          round
          icon="delete"
          size="sm"
          color="negative"
          @click="emit('uninstall')"
        >
          <q-tooltip>{{ $t('plugins.actions.uninstall') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense round icon="info" size="sm" @click="emit('details')">
          <q-tooltip>{{ $t('plugins.actions.details') }}</q-tooltip>
        </q-btn>
      </div>
    </q-item-section>
  </q-item>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PluginManifest } from 'src/models/plugin/manifest';

interface Prop {
  manifest: PluginManifest;
  installed: boolean;
  iconSrc: string | undefined;
  sideloaded?: boolean | undefined;
}
defineProps<Prop>();

const emit = defineEmits<{
  run: [];
  install: [];
  uninstall: [];
  details: [];
}>();

const { t: $t } = useI18n();
</script>
