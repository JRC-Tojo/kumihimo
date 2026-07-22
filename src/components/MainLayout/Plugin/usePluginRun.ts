/**
 * プラグインの実行フロー（対象文書の解決→入力ダイアログ→実行→承認）をまとめたcomposable
 *
 * ダイアログ表示はVue層の責務のため、サービス層（`services/plugin/run.ts`）ではなく
 * ここに実行制御ロジックを置く
 */
import { useI18n } from 'vue-i18n';
import { Notify } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';
import { invokePluginEntryPointDialog } from 'src/components/Dialog/pluginEntryPointDialog';
import type { PluginManifest } from 'src/models/plugin/manifest';

export function usePluginRun() {
  const { t: $t } = useI18n();
  const api = useBackendApi();
  const editorStore = useEditorStore();

  async function runPlugin(manifest: PluginManifest): Promise<void> {
    const targetFile = editorStore.getActiveTab(editorStore.activeSide);
    if (!targetFile) {
      Notify.create({ type: 'negative', message: $t('plugins.run.noOpenDocument') });
      return;
    }

    const descriptorsRes = await api.discoverPluginEntryPoints(manifest.id);
    if (!descriptorsRes.ok || descriptorsRes.data.length === 0) {
      Notify.create({ type: 'negative', message: $t('plugins.errors.runFailed') });
      return;
    }
    // v1では最初のエントリポイントのみをサポートする（複数エントリポイントの選択UIは次イテレーション）
    const descriptor = descriptorsRes.data[0]!;

    const fieldValues = await invokePluginEntryPointDialog({
      pluginName: manifest.name,
      fields: descriptor.fields,
    });
    if (!fieldValues) return;

    const runRes = await api.runPluginEntryPoint(
      manifest.id,
      descriptor.entryId,
      fieldValues,
      targetFile,
    );
    if (!runRes.ok) {
      Notify.create({ type: 'negative', message: $t('plugins.errors.runFailed') });
      return;
    }
    const runState = runRes.data;

    const onceItems = runState.plan.filter(
      (item) => item.confirmationMode === 'once' && item.status === 'planned',
    );
    const perItemItems = runState.plan.filter(
      (item) => item.confirmationMode === 'perItem' && item.status === 'planned',
    );

    if (onceItems.length > 0) {
      const ids = onceItems.map((item) => item.id);
      const approved = await confirmDialog({
        title: $t('plugins.run.batchConfirmTitle'),
        message: $t('plugins.run.batchConfirmMessage', { count: onceItems.length }),
      });
      if (approved) {
        await api.approvePluginPlanItems(runState.runId, ids);
      } else {
        await api.rejectPluginPlanItems(runState.runId, ids);
      }
    }

    if (perItemItems.length > 0 || runState.blocks.length > 0) {
      editorStore.openPluginTab(manifest.id, runState.runId, manifest.name);
    }
  }

  return { runPlugin };
}
