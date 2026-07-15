<template>
  <div class="text-file-view">
    <div class="text-file-toolbar">
      <span class="text-caption text-grey-7">{{ fileName }}</span>
    </div>
    <div v-if="isLoading" class="text-file-loading">
      <q-spinner size="2em" />
    </div>
    <pre v-else class="text-file-content">{{ content }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ContainerElementFile } from 'src/models/container';
import { useBackendApi } from 'src/apis/backendApi';
import { Path } from 'src/utils/binary/path';

interface Prop {
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();

const api = useBackendApi();
const content = ref('');
const isLoading = ref(true);

const fileName = computed(() => new Path(prop.file.path).basename());

async function load() {
  isLoading.value = true;
  const res = await api.getDocumentText(prop.file);
  content.value = res.ok ? res.data : '';
  isLoading.value = false;
}

watch(() => prop.file, load, { immediate: true });
</script>

<style lang="scss" scoped>
.text-file-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.text-file-toolbar {
  padding: 4px 12px;
  border-bottom: 1px solid $grey-3;
}

.text-file-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.text-file-content {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
}
</style>
