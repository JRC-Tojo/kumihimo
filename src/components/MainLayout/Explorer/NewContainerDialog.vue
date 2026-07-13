<template>
  <q-dialog v-model="showModel">
    <q-card style="min-width: 420px">
      <q-card-section>
        <div class="text-h6">{{ $t('explorer.addContainer') }}</div>
      </q-card-section>

      <q-tabs v-model="activeTab" dense align="justify">
        <q-tab name="local" :label="$t('explorer.localFolder')" />
        <q-tab name="demo" :label="$t('explorer.demo')" />
        <q-tab name="workspace" :label="$t('explorer.workspaceFile')" />
        <q-tab name="recent" :label="$t('explorer.recentContainers')" />
      </q-tabs>

      <q-separator />

      <q-tab-panels v-model="activeTab" animated>
        <q-tab-panel name="local">
          <p class="text-caption">{{ $t('explorer.localFolderDesc') }}</p>
          <q-btn
            color="primary"
            :loading="isBusy"
            :label="$t('explorer.selectFolder')"
            @click="onPickLocalFolder"
          />
        </q-tab-panel>

        <q-tab-panel name="demo">
          <p class="text-caption">{{ $t('settings.sampleData.createDesc') }}</p>
          <q-btn
            color="primary"
            :loading="isBusy"
            :label="$t('explorer.demo')"
            @click="onCreateDemo"
          />
        </q-tab-panel>

        <q-tab-panel name="workspace">
          <p class="text-caption">{{ $t('explorer.workspaceFileDesc') }}</p>
          <q-btn
            color="primary"
            :loading="isBusy"
            :label="$t('explorer.selectWorkspaceFile')"
            @click="onPickWorkspaceFile"
          />
        </q-tab-panel>

        <q-tab-panel name="recent">
          <q-list v-if="recentContainers.length > 0" separator>
            <q-item
              v-for="entry in recentContainers"
              :key="entry.id"
              clickable
              :disable="entry.type === 'box' || isBusy"
              @click="onReloadRecent(entry)"
            >
              <q-item-section avatar>
                <q-icon :name="containerIcon(entry.type)" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ entry.name }}</q-item-label>
                <q-item-label caption>
                  {{ entry.type === 'box' ? $t('explorer.notSupportedContainerType') : entry.type }}
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
          <p v-else class="text-caption">{{ $t('search.noResults') }}</p>
        </q-tab-panel>
      </q-tab-panels>

      <q-card-actions align="right">
        <q-btn v-close-popup flat :label="$t('button.close')" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Notify } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerType, RecentContainerEntry } from 'src/models/container';
import { createDemoData } from 'src/utils/appInitializer.js';
import { parseWorkspaceFile, isRelativeWorkspacePath } from 'src/utils/workspace/vscodeWorkspace';
import { Path } from 'src/utils/binary/path';

interface Prop {
  modelValue: boolean;
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; created: [] }>();

const { t: $t } = useI18n();
const api = useBackendApi();

const showModel = computed({
  get: () => prop.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const activeTab = ref<'local' | 'demo' | 'workspace' | 'recent'>('local');
const isBusy = ref(false);
const recentContainers = ref<RecentContainerEntry[]>([]);

watch(showModel, async (isShown) => {
  if (!isShown) return;
  const res = await api.getRecentContainers();
  if (res.ok) recentContainers.value = res.data;
});

function containerIcon(type: ContainerType): string {
  switch (type) {
    case 'local':
      return 'folder_shared';
    case 'box':
      return 'cloud';
    default:
      return 'storage';
  }
}

async function onPickLocalFolder() {
  isBusy.value = true;
  try {
    const pickedRes = await api.pickLocalDirectory();
    if (!pickedRes.ok) return;

    const createdRes = await api.createContainer('local', pickedRes.data.name, '.');
    if (!createdRes.ok) {
      Notify.create({ type: 'negative', message: $t('error.failedToCreateDocument') });
      return;
    }

    await api.loadContainer(createdRes.data.id);
    emit('created');
    showModel.value = false;
  } finally {
    isBusy.value = false;
  }
}

async function onCreateDemo() {
  isBusy.value = true;
  try {
    await createDemoData();
    emit('created');
    showModel.value = false;
  } finally {
    isBusy.value = false;
  }
}

async function onReloadRecent(entry: RecentContainerEntry) {
  if (entry.type === 'box') return;
  isBusy.value = true;
  try {
    await api.loadContainer(entry.id);
    emit('created');
    showModel.value = false;
  } finally {
    isBusy.value = false;
  }
}

async function onPickWorkspaceFile() {
  isBusy.value = true;
  try {
    const [workspaceHandle] = await window.showOpenFilePicker({
      types: [
        { description: 'VSCode Workspace', accept: { 'application/json': ['.code-workspace'] } },
      ],
    });
    if (!workspaceHandle) return;

    const workspaceFile = await workspaceHandle.getFile();
    const parsed = parseWorkspaceFile(await workspaceFile.text());
    if (!parsed.ok) {
      Notify.create({ type: 'negative', message: $t('error.failedToLoadDocument') });
      return;
    }

    const parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

    for (const folder of parsed.value.folders) {
      if (!isRelativeWorkspacePath(folder.path)) {
        Notify.create({
          type: 'warning',
          message: `${folder.path}: ${$t('explorer.workspaceAbsolutePathSkipped')}`,
        });
        continue;
      }

      try {
        const segments = folder.path.split('/').filter((seg) => seg !== '' && seg !== '.');
        let dirHandle = parentHandle;
        for (const seg of segments) {
          dirHandle = await dirHandle.getDirectoryHandle(seg);
        }

        const folderName = folder.name ?? new Path(folder.path).basename();
        await api.registerLocalDirectoryHandle(dirHandle);
        const createdRes = await api.createContainer('local', folderName, '.');
        if (createdRes.ok) await api.loadContainer(createdRes.data.id);
      } catch {
        Notify.create({
          type: 'warning',
          message: `${folder.path}: ${$t('explorer.workspaceFolderNotFound')}`,
        });
      }
    }

    emit('created');
    showModel.value = false;
  } catch {
    // ユーザーがピッカーをキャンセルした場合等はエラー表示不要
  } finally {
    isBusy.value = false;
  }
}
</script>
