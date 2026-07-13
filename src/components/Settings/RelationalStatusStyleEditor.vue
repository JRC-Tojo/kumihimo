<template>
  <div class="relational-status-style-editor">
    <div class="row items-center q-gutter-md">
      <div class="color-field">
        <span class="text-caption">{{ $t('settings.relationalVerification.strokeColor') }}</span>
        <input v-model="model.strokeColor" type="color" />
      </div>
      <div class="color-field">
        <span class="text-caption">{{ $t('settings.relationalVerification.fillColor') }}</span>
        <input v-model="model.fillColor" type="color" />
      </div>
    </div>

    <div class="slider-field q-mt-sm">
      <span class="text-caption">
        {{ $t('settings.relationalVerification.strokeWidth') }}: {{ model.strokeWidth }}
      </span>
      <q-slider v-model="model.strokeWidth" :min="1" :max="10" :step="0.5" dense />
    </div>

    <div class="slider-field q-mt-sm">
      <span class="text-caption">
        {{ $t('settings.relationalVerification.fillOpacity') }}: {{ model.fillOpacity }}
      </span>
      <q-slider v-model="model.fillOpacity" :min="0" :max="1" :step="0.05" dense />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RelationalStatusStyle } from 'src/models/relational/style';

const model = defineModel<RelationalStatusStyle>({ required: true });
</script>

<style scoped lang="scss">
.relational-status-style-editor {
  min-width: 220px;
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

.slider-field {
  min-width: 200px;
}
</style>
