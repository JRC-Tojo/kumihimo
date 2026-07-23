/**
 * プラグインへ注入するホストAPIのブリッジを構築する
 *
 * - 発見用ブリッジ（`buildDiscoveryBridge`）: 常時付与される画面構築API
 *   （`ui.registerEntryPoint`/`ui.addXField`系）のみを持つ。副作用は`DiscoveryState`への
 *   蓄積のみで、実データの読み書きは一切行わない
 * - 実行用ブリッジ（`buildExecutionBridge`）: `manifest.requiredHostApis`に基づき絞り込んだ
 *   実行時APIのみを持つ（最小権限）。ここで受け取る文字列・数値はすべてJSのプレーンな値であり、
 *   AssemblyScriptのポインタとの相互変換（マーシャリング）は`engines/wasmEngine.ts`が担う
 */
import { v4 as uuidv4 } from 'uuid';
import type { PluginManifest, PluginHostApiName } from 'src/models/plugin/manifest';
import type { PluginField, PluginEntryPointDescriptor } from 'src/models/plugin/discovery';
import type { PluginConfirmationMode, PluginPlanItem } from 'src/models/plugin/plan';
import type { PluginPanelBlock } from 'src/models/plugin/panel';
import type { PluginExecutionContext } from 'src/services/plugin/hostContext';
import { AnnotationID, ColorCode } from 'src/models/document/pdf';
import type { TextAnnotationStyle } from 'src/models/document/pdf';
import { buildRelationalRule } from 'src/models/relational/ruleUtils';
import { ANNOTATION_GEOMETRY } from 'src/services/document/annotationGeometry';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostFn = (...args: any[]) => unknown;

// ============ 発見用ブリッジ ============

export interface DiscoveryState {
  entryPoints: PluginEntryPointDescriptor[];
}

function addField(state: DiscoveryState, field: PluginField): void {
  const current = state.entryPoints[state.entryPoints.length - 1];
  // ui.registerEntryPointを呼ばずにフィールドを追加しようとした場合は無視する
  if (!current) return;
  current.fields.push(field);
}

export function buildDiscoveryBridge(state: DiscoveryState): Record<string, HostFn> {
  return {
    ui_register_entry_point: (entryId: string, label: string, description: string) => {
      state.entryPoints.push({ entryId, label, description, fields: [] });
    },
    ui_add_text_field: (
      fieldId: string,
      label: string,
      defaultValue: string,
      optional: boolean,
    ) => {
      addField(state, { fieldId, label, type: 'text', defaultValue, optional });
    },
    ui_add_number_field: (
      fieldId: string,
      label: string,
      defaultValue: number,
      optional: boolean,
    ) => {
      addField(state, { fieldId, label, type: 'number', defaultValue, optional });
    },
    ui_add_toggle_field: (fieldId: string, label: string, defaultValue: boolean) => {
      addField(state, { fieldId, label, type: 'toggle', defaultValue, optional: true });
    },
    ui_add_select_field: (
      fieldId: string,
      label: string,
      optionsCsv: string,
      defaultValue: string,
    ) => {
      addField(state, {
        fieldId,
        label,
        type: 'select',
        defaultValue,
        options: optionsCsv.split(',').filter((s) => s.length > 0),
        optional: true,
      });
    },
    ui_add_file_field: (fieldId: string, label: string, optional: boolean) => {
      addField(state, { fieldId, label, type: 'file', optional });
    },
  };
}

// ============ 実行用ブリッジ ============

export interface ExecutionState {
  blocks: PluginPanelBlock[];
  plan: PluginPlanItem[];
  // 既定値は最も安全な'perItem'。プラグインがplan.setConfirmationModeを呼ぶまではこれが適用される
  confirmationMode: PluginConfirmationMode;
  // `ui.reportError`が1回でも呼ばれた場合にtrueになる。WASM呼び出し自体は正常に返っても、
  // プラグイン自身が「このランは失敗した」と判断した場合はrun全体をエラー扱いにするため
  hasPluginReportedError?: boolean;
}

/** 不正な文字色が渡された場合は黒にフォールバックする */
function resolveColor(raw: string): ColorCode {
  const parsed = ColorCode.safeParse(raw);
  return parsed.success ? parsed.data : ColorCode.parse('#000000');
}

function parseTags(tagsCsv: string): string[] {
  return tagsCsv
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function updateProgressBlock(state: ExecutionState, percent: number): void {
  const existing = state.blocks.find(
    (b): b is Extract<PluginPanelBlock, { kind: 'progress' }> => b.kind === 'progress',
  );
  if (existing) {
    existing.percent = percent;
  } else {
    state.blocks.push({ kind: 'progress', label: '', percent });
  }
}

/** プラグインが`ui.log`で送った行を、単一の蓄積されるログブロックに追加する */
function appendLogLine(state: ExecutionState, message: string): void {
  const existing = state.blocks.find(
    (b): b is Extract<PluginPanelBlock, { kind: 'log' }> => b.kind === 'log',
  );
  if (existing) {
    existing.lines.push(message);
  } else {
    state.blocks.push({ kind: 'log', lines: [message] });
  }
}

/**
 * プラグインが`ui.reportError`で自発的に報告したエラーをテキストブロックとして追加する。
 * WASM呼び出し自体は正常に返る場合でも、ラン全体を`'error'`扱いにするためのフラグを立てる
 * （`run.ts`の`status`判定を参照）
 */
function appendPluginReportedError(state: ExecutionState, message: string): void {
  state.blocks.push({ kind: 'text', text: message, severity: 'error' });
  state.hasPluginReportedError = true;
}

/**
 * `annotId`が属する`ctx.targetFiles`内の添字を、各ファイルの先読み済み`existingAnnotations`
 * を横断検索して自動解決する（`plan.updateAnnotation`/`plan.removeAnnotation`はプラグイン側から
 * fileIndexを指定させず、ホスト側でこれにより所属ファイルを特定する）
 */
function resolveAnnotationFileIndex(
  ctx: PluginExecutionContext,
  annotId: string,
): number | undefined {
  const index = ctx.fileContexts.findIndex((fc) =>
    fc.existingAnnotations.some((a) => a.style.id === annotId),
  );
  return index === -1 ? undefined : index;
}

function toAnnotationJson(info: AnnotationInfo) {
  const box = ANNOTATION_GEOMETRY[info.style.type].boundingBox(info.style);
  return {
    id: info.style.id,
    page: info.style.pageNumber,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    type: info.style.type,
    text: info.context.text ?? '',
    author: info.style.author,
    tags: info.style.tags ?? [],
  };
}

interface AddAnnotationArgs {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fontSize: number;
  tagsCsv: string;
}

function buildTextAnnotationStyle(
  id: AnnotationID,
  manifest: PluginManifest,
  args: AddAnnotationArgs,
): TextAnnotationStyle {
  const now = new Date().toISOString();
  const color = resolveColor(args.color);
  return {
    id,
    type: 'text',
    pageNumber: args.page,
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    text: args.text,
    fontFamily: 'sans-serif',
    fontSize: args.fontSize,
    fontWeight: 400,
    textColor: color,
    textAlign: 'center',
    color,
    strokeWidth: 0,
    strokeType: 'solid',
    createdAt: now,
    updatedAt: now,
    comment: {},
    // なりすまし防止のため、プラグインが作成するアノテーションのauthorは常にプラグイン名を強制する
    author: manifest.name,
    tags: parseTags(args.tagsCsv),
  };
}

/**
 * `manifest.requiredHostApis`に基づき絞り込んだ実行時APIのブリッジを構築する
 */
export function buildExecutionBridge(
  manifest: PluginManifest,
  ctx: PluginExecutionContext,
  state: ExecutionState,
): Record<string, HostFn> {
  const master: Record<PluginHostApiName, { hostKey: string; fn: HostFn }> = {
    'ui.reportProgress': {
      hostKey: 'ui_report_progress',
      fn: (percent: number) => updateProgressBlock(state, percent),
    },
    'ui.log': {
      hostKey: 'ui_log',
      fn: (message: string) => appendLogLine(state, message),
    },
    'ui.reportError': {
      hostKey: 'ui_report_error',
      fn: (message: string) => appendPluginReportedError(state, message),
    },
    'plan.setConfirmationMode': {
      hostKey: 'plan_set_confirmation_mode',
      fn: (mode: string) => {
        if (mode === 'once' || mode === 'perItem') state.confirmationMode = mode;
      },
    },
    'plan.addAnnotation': {
      hostKey: 'plan_add_annotation',
      fn: (
        fileIndex: number,
        page: number,
        x: number,
        y: number,
        width: number,
        height: number,
        text: string,
        color: string,
        fontSize: number,
        tagsCsv: string,
      ) => {
        const targetFile = ctx.targetFiles[fileIndex];
        if (!targetFile) return '';
        const planItemId = uuidv4();
        const style = buildTextAnnotationStyle(AnnotationID.parse(uuidv4()), manifest, {
          page,
          x,
          y,
          width,
          height,
          text,
          color,
          fontSize,
          tagsCsv,
        });
        state.plan.push({
          id: planItemId,
          kind: 'annotationCreate',
          confirmationMode: state.confirmationMode,
          status: 'planned',
          file: { containerID: targetFile.containerID, path: targetFile.path },
          style,
        });
        return planItemId;
      },
    },
    'plan.updateAnnotation': {
      hostKey: 'plan_update_annotation',
      fn: (
        annotId: string,
        x: number,
        y: number,
        width: number,
        height: number,
        text: string,
        color: string,
        fontSize: number,
        tagsCsv: string,
      ) => {
        const idRes = AnnotationID.safeParse(annotId);
        const fileIndex = idRes.success ? resolveAnnotationFileIndex(ctx, annotId) : undefined;
        const targetFile = fileIndex !== undefined ? ctx.targetFiles[fileIndex] : undefined;
        const existing =
          fileIndex !== undefined
            ? ctx.fileContexts[fileIndex]?.existingAnnotations.find((a) => a.style.id === annotId)
            : undefined;
        if (!idRes.success || !targetFile || !existing || existing.style.type !== 'text') {
          return '';
        }

        const planItemId = uuidv4();
        const style: TextAnnotationStyle = {
          ...existing.style,
          x,
          y,
          width,
          height,
          text,
          color: resolveColor(color),
          textColor: resolveColor(color),
          fontSize,
          updatedAt: new Date().toISOString(),
          tags: parseTags(tagsCsv),
        };
        state.plan.push({
          id: planItemId,
          kind: 'annotationUpdate',
          confirmationMode: state.confirmationMode,
          status: 'planned',
          file: { containerID: targetFile.containerID, path: targetFile.path },
          annotId: idRes.data,
          style,
        });
        return planItemId;
      },
    },
    'plan.removeAnnotation': {
      hostKey: 'plan_remove_annotation',
      fn: (annotId: string) => {
        const idRes = AnnotationID.safeParse(annotId);
        const fileIndex = idRes.success ? resolveAnnotationFileIndex(ctx, annotId) : undefined;
        const targetFile = fileIndex !== undefined ? ctx.targetFiles[fileIndex] : undefined;
        if (!idRes.success || !targetFile) return '';

        const planItemId = uuidv4();
        state.plan.push({
          id: planItemId,
          kind: 'annotationRemove',
          confirmationMode: state.confirmationMode,
          status: 'planned',
          file: { containerID: targetFile.containerID, path: targetFile.path },
          annotId: idRes.data,
        });
        return planItemId;
      },
    },
    'plan.addRelational': {
      hostKey: 'plan_add_relational',
      fn: (srcAnnotId: string, targetAnnotId: string, ruleType: string) => {
        const srcRes = AnnotationID.safeParse(srcAnnotId);
        const targetRes = AnnotationID.safeParse(targetAnnotId);
        if (!srcRes.success || !targetRes.success) return '';

        const planItemId = uuidv4();
        state.plan.push({
          id: planItemId,
          kind: 'relationalCreate',
          confirmationMode: state.confirmationMode,
          status: 'planned',
          relational: {
            srcID: srcRes.data,
            targetID: targetRes.data,
            rule: buildRelationalRule(ruleType === 'equal' ? 'equal' : 'link'),
          },
        });
        return planItemId;
      },
    },
    'plan.removeRelational': {
      hostKey: 'plan_remove_relational',
      fn: (srcAnnotId: string, targetAnnotId: string) => {
        const srcRes = AnnotationID.safeParse(srcAnnotId);
        const targetRes = AnnotationID.safeParse(targetAnnotId);
        if (!srcRes.success || !targetRes.success) return '';

        const planItemId = uuidv4();
        state.plan.push({
          id: planItemId,
          kind: 'relationalRemove',
          confirmationMode: state.confirmationMode,
          status: 'planned',
          srcId: srcRes.data,
          targetId: targetRes.data,
        });
        return planItemId;
      },
    },
    'doc.getProjectMetadata': {
      hostKey: 'doc_get_project_metadata',
      fn: (fileIndex: number) => ctx.fileContexts[fileIndex]?.metadataJson ?? '{}',
    },
    'doc.getPageSize': {
      hostKey: 'doc_get_page_size',
      fn: (fileIndex: number, page: number) =>
        JSON.stringify(ctx.fileContexts[fileIndex]?.pageSizes.get(page) ?? { width: 0, height: 0 }),
    },
    'doc.getPageTextBlocks': {
      hostKey: 'doc_get_page_text_blocks',
      fn: (fileIndex: number, page: number) =>
        ctx.fileContexts[fileIndex]?.pageTextBlocksJson.get(page) ?? '[]',
    },
    'doc.getPageImage': {
      hostKey: 'doc_get_page_image',
      fn: (fileIndex: number, page: number) =>
        ctx.fileContexts[fileIndex]?.pageImages.get(page) ?? '',
    },
    'doc.getAnnotationsByFile': {
      hostKey: 'doc_get_annotations_by_file',
      fn: (fileIndex: number) =>
        JSON.stringify(
          (ctx.fileContexts[fileIndex]?.existingAnnotations ?? []).map(toAnnotationJson),
        ),
    },
    'doc.getAnnotationIdsByTag': {
      hostKey: 'doc_get_annotation_ids_by_tag',
      fn: (fileIndex: number, tag: string) =>
        (ctx.fileContexts[fileIndex]?.existingAnnotations ?? [])
          .filter((a) => a.style.tags?.includes(tag))
          .map((a) => a.style.id)
          .join(','),
    },
  };

  const bridge: Record<string, HostFn> = {};
  for (const apiName of manifest.requiredHostApis) {
    const impl = master[apiName];
    if (impl) bridge[impl.hostKey] = impl.fn;
  }
  return bridge;
}
