<template>
  <div class="explorer-view">
    <div class="explorer-view-header">
      <q-btn flat dense round icon="add" size="sm" @click="showNewContainerDialog = true">
        <q-tooltip>{{ $t('explorer.addContainer') }}</q-tooltip>
      </q-btn>
    </div>

    <ExpContainer
      v-for="container in containers"
      :key="container.id"
      :container="container"
      @closed="loadContainers"
    />

    <q-btn
      v-show="containers.length === 0"
      outline
      :label="$t('explorer.demo')"
      color="primary"
      class="full-width q-my-sm"
      @click="onCreateDemo"
    />

    <NewContainerDialog v-model="showNewContainerDialog" @created="loadContainers" />
  </div>
</template>

<script setup lang="ts">
import { useBackendApi } from 'src/apis/backendApi';
import { ref, onMounted } from 'vue';
import ExpContainer from './Explorer/ExpContainer.vue';
import NewContainerDialog from './Explorer/NewContainerDialog.vue';
import { createDemoData } from 'src/utils/appInitializer.js';
import type { ContainerSkel } from 'src/models/container.js';

const api = useBackendApi();

const containers = ref<ContainerSkel[]>([]);
const showNewContainerDialog = ref(false);

async function loadContainers() {
  const apiRes = await api.getAllContainers();
  if (apiRes.ok) {
    containers.value = apiRes.data;
  }
}

async function onCreateDemo() {
  await createDemoData();
  await loadContainers();
}

onMounted(loadContainers);
</script>

<style lang="scss" scoped>
.explorer-view-header {
  display: flex;
  justify-content: flex-end;
}
</style>
