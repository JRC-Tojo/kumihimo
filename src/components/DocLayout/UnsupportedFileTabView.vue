<template>
  <div class="unsupported-file-view">
    <q-icon name="block" size="3rem" color="grey-5" />
    <p class="q-mt-md text-grey-6">{{ $t('explorer.unsupportedFile') }}</p>
    <p class="text-caption text-grey-5">{{ fileName }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ContainerElementFile } from 'src/models/container';
import { Path } from 'src/utils/binary/path';

interface Prop {
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();

const fileName = computed(() => new Path(prop.file.path).basename());
</script>

<style lang="scss" scoped>
.unsupported-file-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
