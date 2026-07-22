<template>
  <q-dialog :model-value="modelValue" @update:model-value="(val) => emit('update:modelValue', val)">
    <q-card v-if="manifest" style="min-width: 360px; max-width: 480px">
      <q-card-section>
        <div class="text-h6">{{ manifest.name }}</div>
        <div class="text-caption text-grey-7">
          {{ manifest.id }} · v{{ manifest.version }} · {{ manifest.runtime }}
        </div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        {{ manifest.description }}
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="text-subtitle2 q-mb-xs">{{ $t('plugins.details.requiredHostApis') }}</div>
        <div v-if="manifest.requiredHostApis.length === 0" class="text-caption text-grey-6">—</div>
        <div v-else class="row q-gutter-xs">
          <q-chip v-for="api in manifest.requiredHostApis" :key="api" dense square>{{
            api
          }}</q-chip>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('button.close')" @click="emit('update:modelValue', false)" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PluginManifest } from 'src/models/plugin/manifest';

interface Prop {
  modelValue: boolean;
  manifest: PluginManifest | undefined;
}
defineProps<Prop>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
}>();

const { t: $t } = useI18n();
</script>
