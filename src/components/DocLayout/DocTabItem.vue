<template>
  <div class="tab-item" :class="{ active }" @click="emit('select')">
    <div class="tab-content">
      <q-icon name="description" class="tab-icon" />
      <span class="tab-title">{{ title }}</span>
      <span v-if="hasUnsavedChanges" class="unsaved-dot" :title="$t('explorer.unsavedChanges')" />
    </div>
    <q-btn
      flat
      dense
      round
      icon="close"
      size="xs"
      class="tab-close-btn"
      @click.stop="emit('close')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ContainerElementFile } from 'src/models/container';
import { Path } from 'src/utils/binary/path';
import { useUnsavedIndicator } from 'src/composables/useUnsavedIndicator';

interface Prop {
  file: ContainerElementFile;
  active: boolean;
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ select: []; close: [] }>();

const { t: $t } = useI18n();

const title = computed(() => new Path(prop.file.path).basename());
const { hasUnsavedChanges } = useUnsavedIndicator(computed(() => prop.file));
</script>

<style scoped lang="scss">
/*
 * .tab-item・.tab-content等の基本スタイルはDocTabsPage.vue側の<style scoped>で定義している。
 * Vueのscoped CSSは子コンポーネントのルート要素にも親のスコープが適用されるため、
 * ここではこのコンポーネント固有の要素（未保存インジケータ）のみ定義する
 */
.unsaved-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: $warning;
}
</style>
