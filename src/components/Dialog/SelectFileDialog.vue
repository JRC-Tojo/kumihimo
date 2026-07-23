<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card style="min-width: 420px; max-width: 560px">
      <q-card-section>
        <div class="text-h6">{{ title }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none tree-scroll">
        <div v-if="loading" class="text-grey-6 text-caption q-pa-md text-center">
          {{ $t('message.loading') }}
        </div>
        <div v-else-if="nodes.length === 0" class="text-grey-6 text-caption q-pa-md text-center">
          {{ $t('explorer.emptyContainer') }}
        </div>
        <q-tree
          v-else
          v-model:expanded="expanded"
          v-model:selected="selectedKey"
          :nodes="nodes"
          node-key="key"
          accordion
          selected-color="primary"
        />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('button.cancel')" @click="onCancel" />
        <q-btn
          unelevated
          color="primary"
          :label="$t('button.select')"
          :disable="!selectedFile"
          @click="onConfirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialogPluginComponent } from 'quasar';
import type { QTreeNode } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElement, ContainerElementFile, ContainerID } from 'src/models/container';
import { directChildrenOf, sortElements } from 'src/components/MainLayout/Explorer/explorerTree';
import { getSupportedDocumentKind } from 'src/utils/document/supportedTypes';

interface Prop {
  title: string;
}
defineProps<Prop>();

defineEmits([...useDialogPluginComponent.emits]);
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent();

const { t: $t } = useI18n();
const api = useBackendApi();

const loading = ref(true);
const nodes = ref<QTreeNode[]>([]);
const expanded = ref<string[]>([])
const selectedKey = ref<string | null>(null);
const filesByKey = new Map<string, ContainerElementFile>();

/** 対象コンテナのファイルツリーをQTree用ノードへ再帰的に変換する（PDF以外のファイルは選択不可） */
function buildNodes(
  containerId: ContainerID,
  elements: Record<string, ContainerElement>,
  parentPath: string | null,
): QTreeNode[] {
  const children = sortElements(directChildrenOf(elements, parentPath));
  return children.map((element) => {
    const key = `${containerId}::${element.path}`;
    if (element.type === 'Folder') {
      return {
        key,
        label: element.path.split('/').pop() || element.path,
        icon: 'folder',
        selectable: false,
        children: buildNodes(containerId, elements, element.path),
      };
    }

    const isPdf = getSupportedDocumentKind(element.path) === 'pdf';
    if (isPdf) filesByKey.set(key, element);
    return {
      key,
      label: element.path.split('/').pop() || element.path,
      icon: isPdf ? 'picture_as_pdf' : 'insert_drive_file',
      selectable: isPdf,
      disabled: !isPdf,
    };
  });
}

onMounted(async () => {
  const containersRes = await api.getAllContainers();
  if (containersRes.ok) {
    const containerNodes: QTreeNode[] = [];
    for (const skel of containersRes.data) {
      const loadedRes = await api.loadContainer(skel.id);
      if (!loadedRes.ok) continue;
      const nodeKey = `container::${skel.id}`
      containerNodes.push({
        key: nodeKey,
        label: skel.name,
        icon: 'folder_open',
        selectable: false,
        children: buildNodes(skel.id, loadedRes.data.elements, null),
      });
      expanded.value.push(nodeKey)
    }
    nodes.value = containerNodes;
  }
  loading.value = false;
});

const selectedFile = computed(() =>
  selectedKey.value ? filesByKey.get(selectedKey.value) : undefined,
);

function onConfirm() {
  if (!selectedFile.value) return;
  onDialogOK(selectedFile.value);
}

function onCancel() {
  onDialogCancel();
}
</script>

<style scoped lang="scss">
.tree-scroll {
  max-height: 60vh;
  overflow-y: auto;
}
</style>
