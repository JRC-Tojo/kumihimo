<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card style="min-width: 420px; max-width: 560px">
      <q-card-section>
        <div class="text-h6">{{ $t('pdfEditor.tools.save.saveAsDialog.title') }}</div>
      </q-card-section>

      <q-card-section v-if="isPdf" class="q-pt-none">
        <div class="text-caption text-grey-7 q-mb-xs">
          {{ $t('pdfEditor.tools.save.saveAsDialog.mode.title') }}
        </div>
        <q-option-group v-model="mode" dense :options="modeOptions" color="primary" />
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="text-caption text-grey-7 q-mb-xs">
          {{ $t('pdfEditor.tools.save.saveAsDialog.destination') }}
        </div>
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
          class="dest-tree"
        />
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-input
          v-model="fileName"
          dense
          outlined
          :label="$t('pdfEditor.tools.save.saveAsDialog.fileName')"
          :suffix="extension"
        />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('button.cancel')" @click="onCancel" />
        <q-btn
          unelevated
          color="primary"
          :label="$t('button.save')"
          :disable="!canConfirm"
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
import { Path } from 'src/utils/binary/path';
import type { SaveAsMode } from 'src/utils/document/saveDocumentAs';
import type { SaveAsDialogResult } from 'src/components/Dialog/saveAsDialog';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';

interface Prop {
  sourceFile: ContainerElementFile;
}
const prop = defineProps<Prop>();

defineEmits([...useDialogPluginComponent.emits]);
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent();

const { t: $t } = useI18n();
const api = useBackendApi();

const isPdf = getSupportedDocumentKind(prop.sourceFile.path) === 'pdf';
const extension = new Path(prop.sourceFile.path).extname();

const mode = ref<SaveAsMode>('documentOnly');
const modeOptions = [
  {
    label: $t('pdfEditor.tools.save.saveAsDialog.mode.documentOnly'),
    value: 'documentOnly' as SaveAsMode,
  },
  {
    label: $t('pdfEditor.tools.save.saveAsDialog.mode.embedAnnotations'),
    value: 'embedAnnotations' as SaveAsMode,
  },
  {
    label: $t('pdfEditor.tools.save.saveAsDialog.mode.annotationsAsComments'),
    value: 'annotationsAsComments' as SaveAsMode,
  },
];

const fileName = ref(new Path(prop.sourceFile.path).stemname());

const loading = ref(true);
const nodes = ref<QTreeNode[]>([]);
const expanded = ref<string[]>([]);
const selectedKey = ref<string | null>(null);
/** ツリーノードのkeyから、実際の保存先（コンテナID・フォルダパス）を引くための対応表 */
const destByKey = new Map<string, { containerID: ContainerID; folderPath: string }>();
/** 上書き確認用に、コンテナごとの既存要素一覧を保持する（onMountedで取得済みのデータを再利用） */
const elementsByContainer = new Map<ContainerID, Record<string, ContainerElement>>();

/** フォルダのみを対象に、コンテナ内のフォルダツリーをQTree用ノードへ再帰的に変換する */
function buildFolderNodes(
  containerId: ContainerID,
  elements: Record<string, ContainerElement>,
  parentPath: string | null,
): QTreeNode[] {
  const folders = sortElements(directChildrenOf(elements, parentPath)).filter(
    (e) => e.type === 'Folder',
  );
  return folders.map((folder) => {
    const key = `${containerId}::${folder.path}`;
    destByKey.set(key, { containerID: containerId, folderPath: folder.path });
    return {
      key,
      label: folder.path.split('/').pop() || folder.path,
      icon: 'folder',
      selectable: true,
      children: buildFolderNodes(containerId, elements, folder.path),
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
      elementsByContainer.set(skel.id, loadedRes.data.elements);

      const rootKey = `container::${skel.id}`;
      destByKey.set(rootKey, { containerID: skel.id, folderPath: '.' });
      containerNodes.push({
        key: rootKey,
        label: skel.name,
        icon: 'folder_open',
        selectable: true,
        children: buildFolderNodes(skel.id, loadedRes.data.elements, null),
      });
      expanded.value.push(rootKey);

      if (skel.id === prop.sourceFile.containerID) {
        const parentPath = new Path(prop.sourceFile.path).parent().path;
        const defaultKey = parentPath === '.' ? rootKey : `${skel.id}::${parentPath}`;
        if (destByKey.has(defaultKey)) {
          selectedKey.value = defaultKey;
          // 選択先まで辿れるよう、途中のフォルダも展開しておく
          const segments = parentPath === '.' ? [] : parentPath.split('/');
          let cumulative = '';
          for (const segment of segments) {
            cumulative = cumulative ? `${cumulative}/${segment}` : segment;
            expanded.value.push(`${skel.id}::${cumulative}`);
          }
        }
      }
    }
    nodes.value = containerNodes;
  }
  loading.value = false;
});

const canConfirm = computed(
  () => !!selectedKey.value && fileName.value.trim().length > 0 && destByKey.has(selectedKey.value),
);

async function onConfirm() {
  if (!selectedKey.value) return;
  const dest = destByKey.get(selectedKey.value);
  if (!dest) return;

  const filePath = new Path(dest.folderPath).child(`${fileName.value.trim()}${extension}`).path;

  const existingElement = elementsByContainer.get(dest.containerID)?.[filePath];
  if (existingElement?.type === 'File') {
    const confirmed = await confirmDialog({
      title: $t('pdfEditor.tools.save.saveAsDialog.overwriteConfirm.title'),
      message: $t('pdfEditor.tools.save.saveAsDialog.overwriteConfirm.message', {
        name: `${fileName.value.trim()}${extension}`,
      }),
      severity: 'negative',
    });
    if (!confirmed) return;
  }

  const result: SaveAsDialogResult = {
    containerID: dest.containerID,
    filePath,
    mode: isPdf ? mode.value : 'documentOnly',
  };
  onDialogOK(result);
}

function onCancel() {
  onDialogCancel();
}
</script>

<style scoped lang="scss">
.dest-tree {
  max-height: 40vh;
  overflow-y: auto;
}
</style>
