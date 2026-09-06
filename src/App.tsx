import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { BetweenHorizontalStart, Box, Boxes, Camera, Check, ChevronDown, ChevronRight, ChevronUp, Code2, Copy, Download, Ellipsis, ExternalLink, Eye, EyeOff, FileBox, FlipHorizontal2, Focus, FolderOpen, Grid3X3, Info, Keyboard, Layers3, Maximize2, Move3D, Network, Orbit, PaintBucket, Pause, Play, Redo2, Repeat2, RotateCcw, Ruler, Scale, Scan, ScanBox, ScissorsLineDashed, Settings2, Share2, Sun, Undo2, Upload, View, X } from 'lucide-react';
import packageMetadata from '../package.json';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { defaultAppSettings, loadAppSettings, parseAppSettingsJson, resolveThemePreference, saveAppSettings, serializeAppSettings, type AccentColor, type AppSettings, type DisplayUnitPreference, type ThemePreference, type ViewportBackground } from '@/settings';
import type { Viewer } from '@/viewer/Viewer';
import { calibrationMultiplier, linearUnitSymbols, metricDisplayForDimensions, metricDisplayForLength, sourceUnitConversionText, unitToMeters } from '@/viewer/linearUnits';
import { defaultForwardAxis, forwardAxes, isForwardAxisCompatible } from '@/viewer/orientationAxes';
import { isLoadCancellation, loadSizeNotice } from '@/viewer/loadControl';
import { registerPreloadedFileBuffer } from '@/viewer/localFile';
import { clearCadCache, getCadCacheStats } from '@/viewer/cadCache';
import { decodeSharedView, encodeSharedView } from '@/viewer/sharedView';
import { defaultMaterialPresetOptions, findMaterialPreset, finishRoughness, materialCategoryNames, materialPresets, type MaterialFinish, type MaterialPresetOptions, type MaterialTone } from '@/viewer/materialPresets';
import { isNativeShell } from '@/nativeShell';
import type { AnimationClipInfo, CameraProjection, CameraState, DisplayMode, ForwardAxis, LightingPreset, LightingSettings, LinearUnit, LoadProgress, MaterialApplyScope, MaterialEditState, MeasurementState, ModelInfo, RotationMode, SceneNode, SelectionInfo, UpAxis, ViewerTheme } from '@/viewer/types';
import type { ProjectResourceRecoveryIssue } from '@/project/projectFormat';

const acceptedExtensions = ['.kea3d', '.glb', '.gltf', '.stl', '.3mf', '.obj', '.mtl', '.ply', '.fbx', '.dae', '.step', '.stp', '.iges', '.igs', '.brep', '.blend', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ktx2'].join(',');
const productWebsite = 'https://kea3d.com';
const coreSourceRelease = `https://github.com/SinaGh121/kea3d-core/releases/tag/v${packageMetadata.version}`;
const legalDocuments = {
  license: {
    title: 'Kea3D Core license',
    description: 'Mozilla Public License 2.0 · bundled with this app',
    load: () => import('../LICENSE?raw').then(({ default: content }) => content),
  },
  thirdParty: {
    title: 'Third-party notices',
    description: 'Licenses and attributions for bundled components',
    load: () => import('../THIRD_PARTY_NOTICES.md?raw').then(({ default: content }) => content),
  },
} as const;
type NativeOpenFile = { id: number; name: string; size: number; requiresStreaming: boolean; sourceUrl: string | null; nativeCadAvailable: boolean; relativePath: string | null };
type NativeOpenBytes = ArrayBuffer | Uint8Array | number[];
type ThumbnailProviderStatus = { available: boolean; enabled: boolean; format: string };
type ProjectResourceRecoveryState = { files: File[]; issues: ProjectResourceRecoveryIssue[] };
const windowsThumbnailPreferenceKey = 'kea3d.windows-thumbnails.preference.v1';
const ProjectRecoveryPanel = lazy(() => import('@/project/ProjectRecoveryPanel'));

function windowsThumbnailPreference(): 'enabled' | 'disabled' | null {
  try {
    const value = window.localStorage.getItem(windowsThumbnailPreferenceKey);
    return value === 'enabled' || value === 'disabled' ? value : null;
  } catch {
    return null;
  }
}

function saveWindowsThumbnailPreference(value: 'enabled' | 'disabled'): void {
  try {
    window.localStorage.setItem(windowsThumbnailPreferenceKey, value);
  } catch {
    // Registration still works when WebView storage is unavailable.
  }
}

type AndroidNativeFileBridge = {
  postMessage(message: string): void;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
};

declare global {
  interface Window {
    kea3dNativeFile?: AndroidNativeFileBridge;
  }
}

function normalizeNativeOpenBytes(response: NativeOpenBytes): ArrayBuffer {
  if (response instanceof ArrayBuffer) return response;
  const source = Array.isArray(response) ? Uint8Array.from(response) : response;
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function readAndroidContentUri(
  bridge: AndroidNativeFileBridge,
  uri: string,
  expectedSize: number,
  onProgress: (value: number) => void,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const bytes = expectedSize > 0 ? new Uint8Array(expectedSize) : null;
    const chunks: Uint8Array[] = [];
    let offset = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      bridge.onmessage = null;
      if (error) {
        bridge.postMessage(JSON.stringify({ action: 'cancel' }));
        reject(error);
        return;
      }
      if (bytes) {
        if (offset !== bytes.byteLength) {
          reject(new Error(`The file provider returned ${offset} bytes instead of ${bytes.byteLength}.`));
        } else {
          resolve(bytes.buffer);
        }
        return;
      }
      const combined = new Uint8Array(offset);
      let chunkOffset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, chunkOffset);
        chunkOffset += chunk.byteLength;
      }
      resolve(combined.buffer);
    };

    bridge.onmessage = ({ data }) => {
      try {
        if (typeof data === 'string') {
          if (data === 'done') finish();
          else if (data.startsWith('error:')) finish(new Error(data.slice(6)));
          return;
        }
        const chunk = new Uint8Array(data);
        if (bytes) {
          if (offset + chunk.byteLength > bytes.byteLength) {
            finish(new Error('The file provider returned more data than expected.'));
            return;
          }
          bytes.set(chunk, offset);
        } else {
          chunks.push(chunk);
        }
        offset += chunk.byteLength;
        if (expectedSize > 0) onProgress(offset / expectedSize);
        bridge.postMessage(JSON.stringify({ action: 'next' }));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    bridge.postMessage(JSON.stringify({ action: 'open', uri, expectedSize }));
  });
}

const stageLabels: Record<LoadProgress['stage'], string> = {
  reading: 'Reading local file', resolving: 'Resolving model resources',
  caching: 'Checking local CAD cache', decoding: 'Decoding geometry and materials', preparing: 'Preparing the viewport',
};
const keyboardShortcuts = [
  ['Ctrl / ⌘ O', 'Open a model'],
  ['Ctrl / ⌘ Z', 'Undo last change'],
  ['Ctrl / ⌘ Shift Z', 'Redo last change'],
  ['Ctrl / ⌘ Space', 'View selector'],
  ['Ctrl / ⌘ Click', 'Add / remove selection'],
  ['Shift Click', 'Select scene-tree range'],
  ['Esc', 'Clear selection'],
  ['F', 'Fit model'],
  ['I', 'Isolate / show all'],
  ['M', 'Material presets'],
  ['P', 'Perspective / orthographic'],
  ['G', 'Show / hide grid'],
  ['E', 'Cycle display mode'],
] as const;

const emptyMaterialEditState: MaterialEditState = {
  previewActive: false,
  canUndo: false,
  canRedo: false,
  canRestore: false,
  targetMeshes: 0,
};

function formatNumber(value: number): string { return new Intl.NumberFormat().format(value); }
function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}
function formatDimension(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1_000 || Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
function formatTime(value: number): string {
  const safeValue = Math.max(value, 0);
  const minutes = Math.floor(safeValue / 60);
  const seconds = (safeValue % 60).toFixed(safeValue < 10 ? 2 : 1).padStart(safeValue < 10 ? 5 : 4, '0');
  return `${minutes}:${seconds}`;
}
function showError(message: string): void {
  toast.error(message, { duration: 8_000 });
}
function formatMetricDimensions(dimensions: [number, number, number], preference: DisplayUnitPreference): string {
  const display = metricDisplayForDimensions(dimensions, preference);
  return `${dimensions.map((value) => formatDimension(value * display.factor)).join(' × ')} ${display.unit}`;
}
function formatMetricLength(length: number, preference: DisplayUnitPreference): string {
  const display = metricDisplayForLength(length, preference);
  return `${formatDimension(length * display.factor)} ${display.unit}`;
}

function formatScaleFactor(factor: number): string {
  if (Math.abs(factor - 1) < 1e-9) return '1×';
  if (factor >= 0.001 && factor < 1_000) return `${Number(factor.toPrecision(6))}×`;
  return `${factor.toExponential(3)}×`;
}

function isProjectResourceRecoveryError(value: unknown): value is Error & { issues: ProjectResourceRecoveryIssue[] } {
  if (!(value instanceof Error) || value.name !== 'ProjectResourceRecoveryError') return false;
  const issues = (value as Error & { issues?: unknown }).issues;
  return Array.isArray(issues) && issues.every((issue) => (
    typeof issue === 'object' && issue !== null
    && ['missing', 'ambiguous', 'changed'].includes(String((issue as { kind?: unknown }).kind))
    && typeof (issue as { resourceId?: unknown }).resourceId === 'string'
    && typeof (issue as { uri?: unknown }).uri === 'string'
  ));
}

const accentOptions: Array<{ value: AccentColor; label: string; color: string }> = [
  { value: 'lime', label: 'Lime', color: '#c8ff63' },
  { value: 'blue', label: 'Blue', color: '#68a8ff' },
  { value: 'cyan', label: 'Cyan', color: '#4de1e8' },
  { value: 'orange', label: 'Orange', color: '#ff9a4c' },
  { value: 'violet', label: 'Violet', color: '#b799ff' },
];

function accentHex(accent: AccentColor): string {
  return accentOptions.find((option) => option.value === accent)?.color ?? '#c8ff63';
}

function ToolButton({ active, disabled, icon, label, onClick }: {
  active?: boolean; disabled?: boolean; icon: ReactNode; label: string; onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'default' : 'ghost'}
          size="icon"
          type="button"
          aria-label={label}
          aria-pressed={active === undefined ? undefined : active}
          className="shrink-0 rounded-md"
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

function ToolDivider() {
  return <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-auto" />;
}

function OverflowToolButton({ label, icon, active = false, disabled = false, onClick }: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className="h-14 min-w-0 flex-col gap-1 px-1 text-[9px] leading-none [&_svg]:size-5"
      onClick={onClick}
    >
      {icon}
      <span className="w-full truncate text-center">{label}</span>
    </Button>
  );
}

const lightingPresets: Array<{ value: LightingPreset; label: string }> = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'studio', label: 'Studio' },
  { value: 'outdoor', label: 'Outdoor' },
];

function LightingControls({ lighting, onChange, showHeader = true }: {
  lighting: LightingSettings;
  onChange: (lighting: LightingSettings) => void;
  showHeader?: boolean;
}) {
  const update = (change: Partial<LightingSettings>) => onChange({ ...lighting, ...change });
  return (
    <div className="grid gap-3">
      {showHeader && <div>
        <strong className="text-sm font-semibold">Lighting</strong>
        <p className="text-[11px] text-muted-foreground">Local viewport appearance only</p>
      </div>}
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Lighting preset">
        {lightingPresets.map((preset) => (
          <Button
            key={preset.value}
            variant={lighting.preset === preset.value ? 'default' : 'outline'}
            size="sm"
            aria-pressed={lighting.preset === preset.value}
            onClick={() => update({ preset: preset.value })}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-1.5">
        <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Exposure</span><span className="tabular-nums">{lighting.exposure.toFixed(1)}</span></div>
        <Slider aria-label="Lighting exposure" min={0.5} max={2} step={0.1} value={[lighting.exposure]} onValueChange={(values) => update({ exposure: values[0] ?? 1 })} />
      </div>
      <div className="grid gap-1.5">
        <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Environment strength</span><span className="tabular-nums">{lighting.environmentIntensity.toFixed(1)}</span></div>
        <Slider aria-label="Environment strength" min={0} max={2} step={0.1} value={[lighting.environmentIntensity]} onValueChange={(values) => update({ environmentIntensity: values[0] ?? 1 })} />
      </div>
      <Separator />
      <label className="flex min-h-11 items-center justify-between gap-3 text-xs">
        <span>Environment background</span>
        <Switch aria-label="Environment background" checked={lighting.backgroundVisible} onCheckedChange={(checked) => update({ backgroundVisible: checked })} />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-xs">
        <span><span className="block">Shadows</span><span className="block text-[10px] text-muted-foreground">May reduce performance</span></span>
        <Switch aria-label="Shadows" checked={lighting.shadows} onCheckedChange={(checked) => update({ shadows: checked })} />
      </label>
      <Button variant="ghost" size="sm" onClick={() => onChange({ ...defaultAppSettings.viewer.lighting })}><RotateCcw /> Reset lighting</Button>
    </div>
  );
}

function LightingPopover({ lighting, onChange }: {
  lighting: LightingSettings;
  onChange: (lighting: LightingSettings) => void;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" type="button" aria-label="Lighting" className="shrink-0 rounded-md"><Sun /></Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>Lighting</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="center" sideOffset={10} className="w-72" aria-label="Lighting controls">
        <LightingControls lighting={lighting} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function useCompactLayout(): boolean {
  const query = '(max-width: 1023px)';
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return matches;
}

const compactWorkspaceHeight = 'min(48dvh, 30rem)';
const compactWorkspaceExpandedHeight = 'min(76dvh, 44rem)';
const compactMeasurementHeight = 'min(34dvh, 17rem)';
const compactSectionHeight = 'min(44dvh, 22rem)';
const compactLightingHeight = 'min(48dvh, 24rem)';
const compactAdjustHeight = 'min(52dvh, 32rem)';
const compactSceneHeight = 'min(52dvh, 30rem)';
const compactAnimationHeight = 'min(38dvh, 18rem)';

function ResponsivePanel({ title, description, onClose, children, desktopClassName, compactFixedHeight, compactMode = 'sheet', compactHeight = compactWorkspaceHeight, compactWorkspaceExpanded = false, onCompactWorkspaceExpandedChange, contentClassName, titleClassName }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  desktopClassName: string;
  compactFixedHeight?: boolean;
  compactMode?: 'sheet' | 'workspace';
  compactHeight?: string;
  compactWorkspaceExpanded?: boolean;
  onCompactWorkspaceExpandedChange?: (expanded: boolean) => void;
  contentClassName?: string;
  titleClassName?: string;
}) {
  const compact = useCompactLayout();

  if (compact) {
    if (compactMode === 'workspace') {
      return (
        <aside
          aria-label={title}
          className="absolute inset-x-0 bottom-0 z-40 flex flex-col gap-0 rounded-t-2xl border-t bg-popover text-sm text-popover-foreground shadow-2xl"
          style={{ height: compactWorkspaceExpanded ? compactWorkspaceExpandedHeight : compactHeight }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <h2 className={cn('text-sm font-semibold', titleClassName)}>{title}</h2>
              {description && <p className="sr-only">{description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {onCompactWorkspaceExpandedChange && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={compactWorkspaceExpanded ? `Reduce ${title.toLowerCase()}` : `Expand ${title.toLowerCase()}`}
                  aria-pressed={compactWorkspaceExpanded}
                  onClick={() => onCompactWorkspaceExpandedChange(!compactWorkspaceExpanded)}
                >
                  {compactWorkspaceExpanded ? <ChevronDown /> : <ChevronUp />}
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X /></Button>
            </div>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 max-lg:[&_[data-slot=button]]:min-h-11 max-lg:[&_[data-slot=button]]:min-w-11', contentClassName)}>{children}</div>
        </aside>
      );
    }

    return (
      <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent
          side="bottom"
          className="max-h-[min(82dvh,42rem)] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
          style={compactFixedHeight ? { height: 'min(82dvh, 42rem)' } : undefined}
          showCloseButton
        >
          <SheetHeader className="pr-12 pb-3">
            <SheetTitle className={cn('text-sm font-semibold', titleClassName)}>{title}</SheetTitle>
            {description && <SheetDescription className="text-xs">{description}</SheetDescription>}
          </SheetHeader>
          <div className={cn('min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 max-lg:[&_[data-slot=button]]:min-h-11 max-lg:[&_[data-slot=button]]:min-w-11', contentClassName)}>{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Card size="sm" className={desktopClassName}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className={cn('text-sm font-semibold', titleClassName)}>{title}</CardTitle>
          {description && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p>}
        </div>
        <CardAction><Button variant="ghost" size="icon-sm" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X /></Button></CardAction>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

function handleToolbarNavigation(event: KeyboardEvent<HTMLDivElement>): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;

  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex < 0 || controls.length === 0) return;

  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? controls.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
  event.preventDefault();
  controls[nextIndex]?.focus();
}

function containsSelectedNode(nodes: SceneNode[], selectedIds: ReadonlySet<string>): boolean {
  return nodes.some((node) => selectedIds.has(node.id) || containsSelectedNode(node.children, selectedIds));
}

function flattenSceneNodeIds(nodes: readonly SceneNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenSceneNodeIds(node.children)]);
}

function updateNodeVisibility(nodes: SceneNode[], objectId: string, visible: boolean): SceneNode[] {
  return nodes.map((node) => node.id === objectId
    ? { ...node, visible }
    : { ...node, children: updateNodeVisibility(node.children, objectId, visible) });
}

function updateNodeVisibilities(nodes: SceneNode[], visibility: Record<string, boolean>): SceneNode[] {
  return nodes.map((node) => ({
    ...node,
    visible: visibility[node.id] ?? node.visible,
    children: updateNodeVisibilities(node.children, visibility),
  }));
}

function findNodeName(nodes: SceneNode[], objectId: string | null): string | null {
  if (!objectId) return null;
  for (const node of nodes) {
    if (node.id === objectId) return node.name;
    const childName = findNodeName(node.children, objectId);
    if (childName) return childName;
  }
  return null;
}

function SceneTreeItem({ depth, node, onSelect, onVisibility, selectedIds, primarySelectedId }: {
  depth: number;
  node: SceneNode;
  onSelect: (objectId: string, options: { additive: boolean; range: boolean }) => void;
  onVisibility: (objectId: string, visible: boolean) => void;
  selectedIds: ReadonlySet<string>;
  primarySelectedId: string | null;
}) {
  const selectedWithin = containsSelectedNode(node.children, selectedIds);
  const selected = selectedIds.has(node.id);
  const primarySelected = primarySelectedId === node.id;
  const [expanded, setExpanded] = useState(depth === 0);
  const rowRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (selectedWithin) setExpanded(true);
  }, [selectedWithin]);

  useEffect(() => {
    if (!primarySelected) return;
    rowRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [primarySelected]);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  return (
    <div>
      <div
        ref={rowRef}
        className={cn(
          'group flex h-8 w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-lg pr-1 text-xs max-lg:h-11',
          selected && 'bg-primary/20 text-foreground ring-1 ring-primary/35 ring-inset',
        )}
        style={{ paddingLeft: `${4 + Math.min(depth, 6) * 12}px` }}
      >
        {node.children.length > 0 ? (
          <Button variant="ghost" size="icon-xs" aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`} onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : <span className="w-6 shrink-0" />}
        <button
          type="button"
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
          onPointerDown={(event) => {
            if (event.pointerType !== 'touch') return;
            suppressClickRef.current = false;
            clearLongPress();
            longPressTimerRef.current = window.setTimeout(() => {
              suppressClickRef.current = true;
              onSelect(node.id, { additive: true, range: false });
            }, 450);
          }}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onSelect(node.id, {
              additive: event.ctrlKey || event.metaKey,
              range: event.shiftKey,
            });
          }}
        >
          {node.type === 'mesh'
            ? <Box className={cn('size-3.5 shrink-0 text-muted-foreground', selected && 'text-primary')} />
            : <Boxes className={cn('size-3.5 shrink-0 text-muted-foreground', selected && 'text-primary')} />}
          <span title={node.name} className={cn('block min-w-0 flex-1 truncate', !node.visible && 'text-muted-foreground line-through')}>{node.name}</span>
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 opacity-60 group-hover:opacity-100"
          aria-label={`${node.visible ? 'Hide' : 'Show'} ${node.name}`}
          onClick={() => onVisibility(node.id, !node.visible)}
        >
          {node.visible ? <Eye /> : <EyeOff />}
        </Button>
      </div>
      {expanded && node.children.map((child) => (
        <SceneTreeItem key={child.id} depth={depth + 1} node={child} onSelect={onSelect} onVisibility={onVisibility} selectedIds={selectedIds} primarySelectedId={primarySelectedId} />
      ))}
    </div>
  );
}

export default function App() {
  const nativeShell = isNativeShell();
  const compactLayout = useCompactLayout();
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLElement>(null);
  const previousCompactLayoutRef = useRef(compactLayout);
  const viewerRef = useRef<Viewer | null>(null);
  const viewerPromiseRef = useRef<Promise<Viewer> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectFolderInputRef = useRef<HTMLInputElement>(null);
  const projectRecoveryInputRef = useRef<HTMLInputElement>(null);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const nativeOpenQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [initialSharedView] = useState(() => decodeSharedView(window.location.hash));
  const pendingSharedViewRef = useRef(initialSharedView);
  const [initialSettings] = useState(loadAppSettings);
  const [systemTheme, setSystemTheme] = useState<ViewerTheme>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialSettings.appearance.theme);
  const [accentColor, setAccentColor] = useState<AccentColor>(initialSettings.appearance.accent);
  const [viewportBackground, setViewportBackground] = useState<ViewportBackground>(initialSettings.appearance.viewportBackground);
  const [lighting, setLighting] = useState<LightingSettings>(initialSettings.viewer.lighting);
  const theme: ViewerTheme = resolveThemePreference(themePreference, systemTheme === 'dark');
  const appearanceRef = useRef({ theme, accent: accentColor, viewportBackground, lighting });
  appearanceRef.current = { theme, accent: accentColor, viewportBackground, lighting };
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [loadingBytes, setLoadingBytes] = useState(0);
  const [nativeStartupResolved, setNativeStartupResolved] = useState(!nativeShell);
  const [readingNativeFile, setReadingNativeFile] = useState(false);
  const [clearingCadCache, setClearingCadCache] = useState(false);
  const [cadCacheStats, setCadCacheStats] = useState({ entries: 0, sourceBytes: 0 });
  const [thumbnailProvider, setThumbnailProvider] = useState<ThumbnailProviderStatus | null>(null);
  const [changingThumbnailProvider, setChangingThumbnailProvider] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [projectRecovery, setProjectRecovery] = useState<ProjectResourceRecoveryState | null>(null);
  const [infoVisible, setInfoVisible] = useState(initialSettings.panels.modelInfoVisible);
  const [gridVisible, setGridVisible] = useState(initialSettings.viewer.gridVisible);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(initialSettings.viewer.displayMode);
  const [sceneTree, setSceneTree] = useState<SceneNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const selectedId = selectedIds.at(-1) ?? null;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [isolationActive, setIsolationActive] = useState(false);
  const [treeVisible, setTreeVisible] = useState(initialSettings.panels.sceneObjectsVisible);
  const [sceneWorkspaceExpanded, setSceneWorkspaceExpanded] = useState(false);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [projection, setProjection] = useState<CameraProjection>(initialSettings.viewer.projection);
  const [rotationMode, setRotationMode] = useState<RotationMode>(initialSettings.viewer.rotationMode);
  const [viewSelectorVisible, setViewSelectorVisible] = useState(false);
  const [displayUnit, setDisplayUnit] = useState<DisplayUnitPreference>(initialSettings.viewer.displayUnit);
  const [restoreLastCamera, setRestoreLastCamera] = useState(initialSettings.viewer.restoreLastCamera);
  const [lastCamera, setLastCamera] = useState<CameraState | null>(initialSettings.viewer.lastCamera);
  const [adjustVisible, setAdjustVisible] = useState(false);
  const [adjustWorkspaceExpanded, setAdjustWorkspaceExpanded] = useState(false);
  const [materialVisible, setMaterialVisible] = useState(false);
  const [materialWorkspaceExpanded, setMaterialWorkspaceExpanded] = useState(false);
  const [materialScope, setMaterialScope] = useState<MaterialApplyScope>('selection');
  const materialScopeRef = useRef<MaterialApplyScope>('selection');
  materialScopeRef.current = materialScope;
  const [materialPresetId, setMaterialPresetId] = useState<string | null>(null);
  const [materialOptions, setMaterialOptions] = useState<MaterialPresetOptions | null>(null);
  const [materialFinish, setMaterialFinish] = useState<MaterialFinish | null>(null);
  const [materialEditState, setMaterialEditState] = useState<MaterialEditState>(emptyMaterialEditState);
  const [sourceUnit, setSourceUnit] = useState<LinearUnit>('m');
  const [initialSourceUnit, setInitialSourceUnit] = useState<LinearUnit>('m');
  const [upAxis, setUpAxis] = useState<UpAxis>('y');
  const [initialUpAxis, setInitialUpAxis] = useState<UpAxis>('y');
  const [forwardAxis, setForwardAxis] = useState<ForwardAxis>('z');
  const [initialForwardAxis, setInitialForwardAxis] = useState<ForwardAxis>('z');
  const [calibrationScale, setCalibrationScale] = useState(1);
  const [calibrationAxis, setCalibrationAxis] = useState<'x' | 'y' | 'z'>('x');
  const [calibrationValue, setCalibrationValue] = useState('');
  const [calibrationUnit, setCalibrationUnit] = useState<LinearUnit>('mm');
  const [exportVisible, setExportVisible] = useState(false);
  const [exportScope, setExportScope] = useState<'all' | 'visible'>('all');
  const [exportAnimations, setExportAnimations] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [animations, setAnimations] = useState<AnimationClipInfo[]>([]);
  const [animationVisible, setAnimationVisible] = useState(false);
  const [animationIndex, setAnimationIndex] = useState(0);
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [animationTime, setAnimationTime] = useState(0);
  const [animationLoop, setAnimationLoop] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [sectionVisible, setSectionVisible] = useState(false);
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionAxis, setSectionAxis] = useState<UpAxis>('x');
  const [sectionPosition, setSectionPosition] = useState(0.5);
  const [sectionFlipped, setSectionFlipped] = useState(false);
  const [measurementVisible, setMeasurementVisible] = useState(false);
  const [measurement, setMeasurement] = useState<MeasurementState>({ pointCount: 0, distance: null });
  const [measurementCopied, setMeasurementCopied] = useState(false);
  const [lightingVisible, setLightingVisible] = useState(false);
  const [sharedCopied, setSharedCopied] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [legalDocument, setLegalDocument] = useState<keyof typeof legalDocuments | null>(null);
  const [legalDocumentContent, setLegalDocumentContent] = useState('');
  const [mobileDisplayVisible, setMobileDisplayVisible] = useState(false);
  const [mobileToolsVisible, setMobileToolsVisible] = useState(false);
  const androidNativeShell = nativeShell && /Android/i.test(navigator.userAgent);
  const desktopNativeShell = nativeShell && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const windowsNativeShell = desktopNativeShell && /Windows/i.test(navigator.userAgent);
  const compactLayerOpen = compactLayout && (
    mobileDisplayVisible || mobileToolsVisible || settingsVisible || infoVisible || treeVisible
    || adjustVisible || materialVisible || exportVisible || animationVisible || sectionVisible || measurementVisible || lightingVisible || projectRecovery !== null
  );
  useEffect(() => {
    const enteredCompactLayout = compactLayout && !previousCompactLayoutRef.current;
    previousCompactLayoutRef.current = compactLayout;
    if (!enteredCompactLayout) return;

    const taskPanelOpen = adjustVisible || materialVisible || exportVisible || animationVisible
      || sectionVisible || measurementVisible || lightingVisible || settingsVisible;
    if (taskPanelOpen) {
      setInfoVisible(false);
      setTreeVisible(false);
    } else if (treeVisible && infoVisible) {
      setInfoVisible(false);
    }
  }, [adjustVisible, animationVisible, compactLayout, exportVisible, infoVisible, lightingVisible, materialVisible, measurementVisible, sectionVisible, settingsVisible, treeVisible]);
  const settingsSnapshot = useMemo<AppSettings>(() => ({
    version: 1,
    appearance: { theme: themePreference, accent: accentColor, viewportBackground },
    viewer: { projection, rotationMode, displayMode, gridVisible, displayUnit, restoreLastCamera, lastCamera, lighting },
    panels: { modelInfoVisible: infoVisible, sceneObjectsVisible: treeVisible },
  }), [accentColor, displayMode, displayUnit, gridVisible, infoVisible, lastCamera, lighting, projection, restoreLastCamera, rotationMode, themePreference, treeVisible, viewportBackground]);

  const refreshCadCacheStats = useCallback(async () => {
    setCadCacheStats(await getCadCacheStats());
  }, []);

  const openExternalLink = useCallback((event: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (!nativeShell) return;
    event.preventDefault();
    void import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(url))
      .catch((error: unknown) => {
        console.error(error);
        toast.error('Could not open the link in your browser.');
      });
  }, [nativeShell]);

  const openLegalDocument = useCallback((document: keyof typeof legalDocuments) => {
    setLegalDocument(document);
    setLegalDocumentContent('Loading…');
    void legalDocuments[document].load()
      .then(setLegalDocumentContent)
      .catch((error: unknown) => {
        console.error(error);
        setLegalDocumentContent('This document could not be loaded.');
        toast.error('Could not load the legal document.');
      });
  }, []);

  const refreshThumbnailProvider = useCallback(async () => {
    if (!windowsNativeShell) return;
    const { invoke } = await import('@tauri-apps/api/core');
    setThumbnailProvider(await invoke<ThumbnailProviderStatus>('get_thumbnail_provider_status'));
  }, [windowsNativeShell]);

  const toggleThumbnailProvider = useCallback(async () => {
    if (!thumbnailProvider || changingThumbnailProvider) return;
    setChangingThumbnailProvider(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const next = await invoke<ThumbnailProviderStatus>('set_thumbnail_provider_enabled', { enabled: !thumbnailProvider.enabled });
      setThumbnailProvider(next);
      saveWindowsThumbnailPreference(next.enabled ? 'enabled' : 'disabled');
      toast.success(next.enabled ? 'Explorer GLB, STL, PLY, STEP, and STP thumbnails enabled' : 'Explorer thumbnails disabled');
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setChangingThumbnailProvider(false);
    }
  }, [changingThumbnailProvider, thumbnailProvider]);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    let disposed = false;
    const viewerPromise = import('@/viewer/Viewer').then(({ Viewer: ViewerClass }) => {
      const viewer = new ViewerClass(container, (objectIds, info) => {
        selectedIdsRef.current = objectIds;
        setSelectedIds(objectIds);
        selectionAnchorRef.current = objectIds.at(-1) ?? null;
        setSelectionInfo(info);
        setMaterialPresetId(null);
        setMaterialOptions(null);
        setMaterialFinish(null);
        setMaterialEditState(viewerRef.current?.getMaterialEditState(materialScopeRef.current) ?? emptyMaterialEditState);
      }, (state) => {
        setAnimationPlaying(state.playing);
        setAnimationTime(state.time);
      }, (state) => {
        setMeasurement(state);
        setMeasurementCopied(false);
      }, (camera) => {
        setLastCamera(camera);
      }, (visible) => {
        setViewSelectorVisible(visible);
      });
      const appearance = appearanceRef.current;
      viewer.setTheme(appearance.theme);
      viewer.setAccentColor(accentHex(appearance.accent));
      viewer.setViewportBackground(appearance.viewportBackground);
      viewer.setLighting(appearance.lighting);
      if (disposed) {
        viewer.dispose();
        throw new DOMException('Viewer initialization was cancelled.', 'AbortError');
      }
      viewerRef.current = viewer;
      return viewer;
    });
    viewerPromiseRef.current = viewerPromise;
    void viewerPromise.catch(() => undefined);

    return () => {
      disposed = true;
      loadAbortRef.current?.abort();
      viewerPromiseRef.current = null;
      const viewer = viewerRef.current;
      viewerRef.current = null;
      if (viewer) viewer.dispose();
      else void viewerPromise.catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accentColor;
    viewerRef.current?.setTheme(theme);
    viewerRef.current?.setAccentColor(accentHex(accentColor));
    viewerRef.current?.setViewportBackground(viewportBackground);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#090a0a' : '#f5f5f5');
  }, [accentColor, theme, viewportBackground]);

  useEffect(() => {
    viewerRef.current?.setLighting(lighting);
  }, [lighting]);

  useEffect(() => {
    if (!compactLayout) return;
    const timeout = window.setTimeout(() => viewerRef.current?.fit(), 220);
    return () => window.clearTimeout(timeout);
  }, [adjustVisible, adjustWorkspaceExpanded, compactLayout, lightingVisible, materialVisible, materialWorkspaceExpanded, measurementVisible, sectionVisible]);

  useEffect(() => {
    saveAppSettings(settingsSnapshot);
  }, [settingsSnapshot]);

  useEffect(() => {
    if (!windowsNativeShell) return;
    let cancelled = false;
    void (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        const preference = windowsThumbnailPreference();
        const next = preference === 'disabled'
          ? await invoke<ThumbnailProviderStatus>('get_thumbnail_provider_status')
          : await invoke<ThumbnailProviderStatus>('set_thumbnail_provider_enabled', { enabled: true });
        if (!cancelled) setThumbnailProvider(next);
      } catch {
        const status = await invoke<ThumbnailProviderStatus>('get_thumbnail_provider_status').catch(() => null);
        if (!cancelled && status) setThumbnailProvider(status);
      }
    })();
    return () => { cancelled = true; };
  }, [windowsNativeShell]);

  useEffect(() => {
    if (settingsVisible) {
      void refreshCadCacheStats();
      void refreshThumbnailProvider().catch(() => undefined);
    }
  }, [refreshCadCacheStats, refreshThumbnailProvider, settingsVisible]);

  useEffect(() => {
    if (!androidNativeShell || !compactLayerOpen) return;

    let disposed = false;
    let unregister: (() => Promise<void>) | undefined;
    void import('@tauri-apps/api/app').then(({ onBackButtonPress }) => onBackButtonPress(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
    })).then((listener) => {
      if (disposed) void listener.unregister();
      else unregister = () => listener.unregister();
    }).catch(() => undefined);

    return () => {
      disposed = true;
      if (unregister) void unregister();
    };
  }, [androidNativeShell, compactLayerOpen]);

  const loadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const viewerPromise = viewerPromiseRef.current;
    if (!viewerPromise || files.length === 0) return;
    loadAbortRef.current?.abort();
    setProjectRecovery(null);
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoadingName(files.find((file) => /\.(kea3d|glb|gltf|stl|3mf|obj|ply|fbx|dae|step|stp|iges|igs|brep|blend)$/i.test(file.name))?.name ?? 'Local model');
    setLoadingBytes(files.reduce((total, file) => total + file.size, 0));
    setProgress({ stage: 'preparing', value: 0.05 });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const viewer = viewerRef.current ?? await viewerPromise;
      if (controller.signal.aborted || loadAbortRef.current !== controller) return;
      setProgress({ stage: 'reading', value: 0 });
      const loaded = await viewer.loadFiles(files, (nextProgress) => {
        if (loadAbortRef.current === controller) setProgress(nextProgress);
      }, controller.signal);
      if (controller.signal.aborted || loadAbortRef.current !== controller) return;
      const sharedView = pendingSharedViewRef.current;
      const nextGridVisible = sharedView?.gridVisible ?? gridVisible;
      const nextDisplayMode = sharedView?.displayMode ?? displayMode;
      const nextRotationMode = sharedView?.rotationMode ?? rotationMode;
      viewer.setGridVisible(nextGridVisible);
      viewer.setDisplayMode(nextDisplayMode);
      viewer.setRotationMode(nextRotationMode);
      if (sharedView) {
        viewer.setCameraState(sharedView.camera);
        pendingSharedViewRef.current = null;
        setGridVisible(nextGridVisible);
        setDisplayMode(nextDisplayMode);
        setProjection(sharedView.camera.projection);
        setRotationMode(nextRotationMode);
      } else {
        viewer.setProjection(projection);
        viewer.fit('iso');
      }
      setModelInfo(loaded.info);
      setSceneTree(loaded.sceneTree);
      setSelectedIds([]);
      selectedIdsRef.current = [];
      selectionAnchorRef.current = null;
      setSelectionInfo(null);
      setIsolationActive(false);
      setExplodeFactor(0);
      setSourceUnit(loaded.initialSourceUnit);
      setInitialSourceUnit(loaded.initialSourceUnit);
      setUpAxis(loaded.initialUpAxis);
      setInitialUpAxis(loaded.initialUpAxis);
      setForwardAxis(loaded.initialForwardAxis);
      setInitialForwardAxis(loaded.initialForwardAxis);
      setCalibrationScale(1);
      setCalibrationAxis('x');
      setCalibrationValue('');
      setCalibrationUnit('mm');
      setAdjustVisible(false);
      setExportVisible(false);
      setMaterialVisible(false);
      setMaterialPresetId(null);
      setMaterialOptions(null);
      setMaterialFinish(null);
      setMaterialEditState(emptyMaterialEditState);
      setAnimations(loaded.animations);
      setAnimationVisible(!compactLayout && loaded.animations.length > 0);
      if (compactLayout) {
        setInfoVisible(false);
        setTreeVisible(false);
      }
      setSceneWorkspaceExpanded(false);
      setAnimationIndex(0);
      setAnimationPlaying(false);
      setAnimationTime(0);
      setAnimationLoop(true);
      setAnimationSpeed(1);
      setSectionVisible(false);
      setSectionEnabled(false);
      setSectionAxis('x');
      setSectionPosition(0.5);
      setSectionFlipped(false);
      setMeasurementVisible(false);
      setLightingVisible(false);
      setMeasurement({ pointCount: 0, distance: null });
      setMeasurementCopied(false);
      setProjectRecovery(null);
    } catch (loadError) {
      if (!isLoadCancellation(loadError) && loadAbortRef.current === controller) {
        if (isProjectResourceRecoveryError(loadError)) {
          setProjectRecovery({ files, issues: loadError.issues });
          toast.warning(loadError.message, { duration: 8_000 });
        } else {
          showError(loadError instanceof Error ? loadError.message : 'The model could not be opened.');
        }
      }
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setProgress(null);
        setLoadingName(null);
        setLoadingBytes(0);
        if (inputRef.current) inputRef.current.value = '';
        if (projectFolderInputRef.current) projectFolderInputRef.current.value = '';
      }
    }
  }, [compactLayout, displayMode, gridVisible, projection, rotationMode]);

  useEffect(() => {
    if (!nativeShell) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;
    const schedulePendingOpen = (initialOpen = false) => {
      nativeOpenQueueRef.current = nativeOpenQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const { Channel, invoke } = await import('@tauri-apps/api/core');
          const pending = await invoke<NativeOpenFile[]>('take_pending_open_files');
          if (pending.length === 0) return;
          setLoadingName(pending.find((entry) => /\.(kea3d|glb|gltf|stl|3mf|obj|ply|fbx|dae|step|stp|iges|igs|brep|blend)$/i.test(entry.name))?.name ?? 'Local model');
          setLoadingBytes(pending.reduce((total, entry) => total + entry.size, 0));
          setProgress({ stage: 'reading' });
          setReadingNativeFile(true);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const nativeCadEntry = pending.length === 1 && pending[0]?.nativeCadAvailable ? pending[0] : null;
          if (nativeCadEntry) {
            loadAbortRef.current?.abort();
            const nativeController = new AbortController();
            loadAbortRef.current = nativeController;
            setReadingNativeFile(false);
            setProgress({ stage: 'decoding', value: 0 });
            try {
              const { importNativeCadFile } = await import('@/viewer/nativeCad');
              const nativeImport = await importNativeCadFile(
                nativeCadEntry.id,
                nativeCadEntry.name,
                nativeCadEntry.size,
                (nextProgress) => {
                  if (loadAbortRef.current === nativeController) setProgress(nextProgress);
                },
                nativeController.signal,
              );
              if (nativeController.signal.aborted) return;
              if (loadAbortRef.current === nativeController) loadAbortRef.current = null;
              await loadFiles([nativeImport.file]);
              if (nativeImport.warning) toast.warning(nativeImport.warning);
              return;
            } finally {
              if (loadAbortRef.current === nativeController) loadAbortRef.current = null;
            }
          }
          const files: File[] = [];
          for (const entry of pending) {
            let buffer: ArrayBuffer;
            if (entry.requiresStreaming && entry.sourceUrl && window.kea3dNativeFile) {
              buffer = await readAndroidContentUri(
                window.kea3dNativeFile,
                entry.sourceUrl,
                entry.size,
                (value) => setProgress({ stage: 'reading', value }),
              );
              await invoke('finish_pending_open_file', { id: entry.id }).catch(() => undefined);
            } else if (entry.requiresStreaming) {
              const bytes = entry.size > 0 ? new Uint8Array(entry.size) : null;
              const chunks: Uint8Array[] = [];
              let offset = 0;
              let completed = false;
              let resolveComplete!: () => void;
              let rejectComplete!: (error: unknown) => void;
              const complete = new Promise<void>((resolve, reject) => {
                resolveComplete = resolve;
                rejectComplete = reject;
              });
              const channel = new Channel<NativeOpenBytes>();
              channel.onmessage = (response) => {
                if (completed) return;
                try {
                  const chunk = new Uint8Array(normalizeNativeOpenBytes(response));
                  if (chunk.byteLength === 0) {
                    completed = true;
                    if (bytes && offset !== bytes.byteLength) {
                      rejectComplete(new Error(`The file provider returned ${offset} bytes instead of ${bytes.byteLength}.`));
                    } else {
                      resolveComplete();
                    }
                    return;
                  }
                  if (bytes) {
                    if (offset + chunk.byteLength > bytes.byteLength) {
                      throw new Error('The file provider returned more data than expected.');
                    }
                    bytes.set(chunk, offset);
                  } else {
                    chunks.push(chunk);
                  }
                  offset += chunk.byteLength;
                  if (entry.size > 0) setProgress({ stage: 'reading', value: offset / entry.size });
                } catch (error) {
                  completed = true;
                  rejectComplete(error);
                }
              };
              try {
                const streaming = invoke<void>('stream_pending_open_file', {
                  id: entry.id,
                  expectedSize: entry.size,
                  reader: channel,
                }).catch((error) => {
                  if (!completed) {
                    completed = true;
                    rejectComplete(error);
                  }
                  throw error;
                });
                await Promise.all([streaming, complete]);
              } finally {
                await invoke('finish_pending_open_file', { id: entry.id }).catch(() => undefined);
              }
              if (bytes) {
                buffer = bytes.buffer;
              } else {
                const combined = new Uint8Array(offset);
                let chunkOffset = 0;
                for (const chunk of chunks) {
                  combined.set(chunk, chunkOffset);
                  chunkOffset += chunk.byteLength;
                }
                buffer = combined.buffer;
              }
            } else if (entry.size > 0) {
              const bytes = new Uint8Array(entry.size);
              let offset = 0;
              try {
                while (offset < entry.size) {
                  const response = await invoke<NativeOpenBytes>('read_pending_open_file_chunk', {
                    id: entry.id,
                    offset,
                    expectedSize: entry.size,
                  });
                  const chunk = new Uint8Array(normalizeNativeOpenBytes(response));
                  if (chunk.byteLength === 0 || offset + chunk.byteLength > bytes.byteLength) {
                    throw new Error('The native file reader returned an invalid chunk.');
                  }
                  bytes.set(chunk, offset);
                  offset += chunk.byteLength;
                  setProgress({ stage: 'reading', value: offset / entry.size });
                }
              } finally {
                await invoke('finish_pending_open_file', { id: entry.id }).catch(() => undefined);
              }
              buffer = bytes.buffer;
            } else {
              const response = await invoke<NativeOpenBytes>('read_pending_open_file', { id: entry.id });
              buffer = normalizeNativeOpenBytes(response);
            }
            const file = new File([buffer], entry.name, { lastModified: Date.now() });
            if (entry.relativePath) {
              Object.defineProperty(file, 'webkitRelativePath', { value: entry.relativePath });
            }
            registerPreloadedFileBuffer(file, buffer);
            files.push(file);
          }
          setReadingNativeFile(false);
          await loadFiles(files);
        })
        .catch((error: unknown) => {
          setReadingNativeFile(false);
          setProgress(null);
          setLoadingName(null);
          setLoadingBytes(0);
          showError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (initialOpen) setNativeStartupResolved(true);
        });
    };

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlisten = await listen('native-open-files', () => schedulePendingOpen());
      if (disposed) {
        unlisten();
        unlisten = undefined;
        return;
      }
      schedulePendingOpen(true);
    }).catch((error: unknown) => {
      setNativeStartupResolved(true);
      showError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadFiles, nativeShell]);

  const chooseModelFiles = useCallback(async () => {
    if (!desktopNativeShell) {
      inputRef.current?.click();
      return;
    }
    try {
      const [{ open }, { invoke }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/api/core'),
      ]);
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [{
          name: '3D models',
          extensions: ['kea3d', 'glb', 'gltf', 'stl', '3mf', 'obj', 'mtl', 'ply', 'fbx', 'dae', 'step', 'stp', 'iges', 'igs', 'brep', 'blend', 'bin', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'ktx2'],
        }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const queued = await invoke<number>('queue_open_file_paths', { paths });
      if (queued === 0) showError('Choose a supported 3D model file.');
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [desktopNativeShell]);

  const chooseProjectFolder = useCallback(() => {
    projectFolderInputRef.current?.click();
  }, []);

  const recoverProjectWithFiles = useCallback(async (fileList: FileList | File[]) => {
    if (!projectRecovery) return;
    const files = Array.from(fileList);
    try {
      const { locateProjectResources } = await import('@/project/projectRecovery');
      const result = locateProjectResources(projectRecovery, files);
      if (!result.matchedAll) toast.warning('Some project resources still need attention.');
      await loadFiles(result.files);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [loadFiles, projectRecovery]);

  const rewriteProjectForRecovery = useCallback(async (mode: 'accept' | 'remove') => {
    if (!projectRecovery) return;
    try {
      const { rewriteProjectResources } = await import('@/project/projectRecovery');
      await loadFiles(await rewriteProjectResources(projectRecovery, mode));
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [loadFiles, projectRecovery]);

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault(); setDragging(false); void loadFiles(event.dataTransfer.files);
  };
  const cancelLoad = () => loadAbortRef.current?.abort();
  const toggleGrid = () => {
    const next = !gridVisible; setGridVisible(next); viewerRef.current?.setGridVisible(next);
  };
  const cycleDisplayMode = () => {
    const next: DisplayMode = displayMode === 'solid' ? 'edges' : displayMode === 'edges' ? 'wireframe' : 'solid';
    setDisplayMode(next);
    viewerRef.current?.setDisplayMode(next);
  };
  const closeMeasurement = () => {
    setMeasurementVisible(false);
    viewerRef.current?.setMeasurementEnabled(false);
  };
  const closeAdjustPanel = () => {
    setAdjustWorkspaceExpanded(false);
    setAdjustVisible(false);
  };
  const closeMaterialPanel = () => {
    setMaterialEditState(viewerRef.current?.cancelMaterialPreview() ?? emptyMaterialEditState);
    setMaterialPresetId(null);
    setMaterialOptions(null);
    setMaterialFinish(null);
    setMaterialWorkspaceExpanded(false);
    setMaterialVisible(false);
  };
  const toggleMaterialPanel = () => {
    if (materialVisible) {
      closeMaterialPanel();
      return;
    }
    setMaterialVisible(true);
    setMaterialEditState(viewerRef.current?.getMaterialEditState(materialScope) ?? emptyMaterialEditState);
    setAdjustVisible(false);
    setExportVisible(false);
    setAnimationVisible(false);
    setSectionVisible(false);
    setSettingsVisible(false);
    setLightingVisible(false);
    closeMeasurement();
    if (compactLayout) { setTreeVisible(false); setInfoVisible(false); }
  };
  const previewMaterial = (presetId: string) => {
    try {
      const preset = findMaterialPreset(presetId);
      if (!preset) return;
      const options = defaultMaterialPresetOptions(preset);
      const next = viewerRef.current?.previewMaterialPreset(presetId, materialScope, options) ?? emptyMaterialEditState;
      setMaterialPresetId(presetId);
      setMaterialOptions(options);
      setMaterialFinish(preset.defaultFinish ?? null);
      setMaterialEditState(next);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };
  const updateMaterialPreview = (options: MaterialPresetOptions, finish: MaterialFinish | null = materialFinish) => {
    if (!materialPresetId) return;
    try {
      const next = viewerRef.current?.previewMaterialPreset(materialPresetId, materialScope, options) ?? emptyMaterialEditState;
      setMaterialPresetId(materialPresetId);
      setMaterialOptions(options);
      setMaterialFinish(finish);
      setMaterialEditState(next);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };
  const changeMaterialTone = (tone: MaterialTone) => {
    if (!materialOptions) return;
    updateMaterialPreview({ ...materialOptions, tone });
  };
  const changeMaterialFinish = (finish: MaterialFinish) => {
    const preset = materialPresetId ? findMaterialPreset(materialPresetId) : undefined;
    if (!preset || !materialOptions) return;
    updateMaterialPreview({ ...materialOptions, roughness: finishRoughness(preset, finish) }, finish);
  };
  const changeMaterialNumber = (key: 'roughness' | 'metalness' | 'opacity' | 'transmission' | 'emissiveIntensity', value: number) => {
    if (!materialOptions) return;
    updateMaterialPreview({ ...materialOptions, [key]: value }, key === 'roughness' ? null : materialFinish);
  };
  const changeMaterialScope = (scope: MaterialApplyScope) => {
    materialScopeRef.current = scope;
    setMaterialScope(scope);
    if (materialPresetId && materialOptions) {
      const next = viewerRef.current?.previewMaterialPreset(materialPresetId, scope, materialOptions) ?? emptyMaterialEditState;
      setMaterialEditState(next);
    } else {
      setMaterialEditState(viewerRef.current?.getMaterialEditState(scope) ?? emptyMaterialEditState);
    }
  };
  const applyMaterial = () => {
    setMaterialEditState(viewerRef.current?.applyMaterialPreview() ?? emptyMaterialEditState);
    setMaterialPresetId(null);
    setMaterialOptions(null);
    setMaterialFinish(null);
    toast.success('Material applied locally');
  };
  const restoreMaterial = () => {
    setMaterialEditState(viewerRef.current?.restoreOriginalMaterials(materialScope) ?? emptyMaterialEditState);
    setMaterialPresetId(null);
    setMaterialOptions(null);
    setMaterialFinish(null);
  };
  const undoMaterial = () => {
    setMaterialEditState(viewerRef.current?.undoLastChange() ?? emptyMaterialEditState);
    setMaterialPresetId(null);
    setMaterialOptions(null);
    setMaterialFinish(null);
  };
  const redoMaterial = () => {
    setMaterialEditState(viewerRef.current?.redoLastChange() ?? emptyMaterialEditState);
    setMaterialPresetId(null);
    setMaterialOptions(null);
    setMaterialFinish(null);
  };
  const toggleSettingsPanel = () => {
    const next = !settingsVisible;
    setSettingsVisible(next);
    if (next) {
      if (compactLayout) { setInfoVisible(false); setTreeVisible(false); }
      setAdjustVisible(false);
      setExportVisible(false);
      setAnimationVisible(false);
      setSectionVisible(false);
      setLightingVisible(false);
      if (materialVisible) closeMaterialPanel();
      closeMeasurement();
    }
  };
  const toggleInfoPanel = () => {
    const next = !infoVisible;
    setInfoVisible(next);
    if (next && compactLayout) {
      setTreeVisible(false);
      setAdjustVisible(false);
      setExportVisible(false);
      setAnimationVisible(false);
      setSectionVisible(false);
      setSettingsVisible(false);
      setLightingVisible(false);
      if (materialVisible) closeMaterialPanel();
      closeMeasurement();
    }
  };
  const toggleScenePanel = () => {
    const next = !treeVisible;
    setTreeVisible(next);
    if (next) {
      setSceneWorkspaceExpanded(false);
      setAdjustVisible(false);
      if (compactLayout) {
        setInfoVisible(false);
        setExportVisible(false);
        setAnimationVisible(false);
        setSectionVisible(false);
        setSettingsVisible(false);
        setLightingVisible(false);
        if (materialVisible) closeMaterialPanel();
        closeMeasurement();
      }
    }
  };
  const toggleAdjustPanel = () => {
    const next = !adjustVisible;
    if (!next) {
      closeAdjustPanel();
      return;
    }
    setAdjustWorkspaceExpanded(false);
    setAdjustVisible(true);
    if (next) { setTreeVisible(false); if (compactLayout) setInfoVisible(false); setExportVisible(false); setAnimationVisible(false); setSectionVisible(false); setSettingsVisible(false); setLightingVisible(false); if (materialVisible) closeMaterialPanel(); closeMeasurement(); }
  };
  const toggleExportPanel = () => {
    const next = !exportVisible;
    setExportVisible(next);
    if (next) {
      if (compactLayout) { setTreeVisible(false); setInfoVisible(false); }
      setAdjustVisible(false);
      setAnimationVisible(false);
      setSectionVisible(false);
      setSettingsVisible(false);
      setLightingVisible(false);
      if (materialVisible) closeMaterialPanel();
      closeMeasurement();
    }
  };
  const toggleAnimationPanel = () => {
    const next = !animationVisible;
    setAnimationVisible(next);
    if (next) { if (compactLayout) { setTreeVisible(false); setInfoVisible(false); } setAdjustVisible(false); setExportVisible(false); setSectionVisible(false); setSettingsVisible(false); setLightingVisible(false); if (materialVisible) closeMaterialPanel(); closeMeasurement(); }
  };
  const toggleSectionPanel = () => {
    const next = !sectionVisible;
    setSectionVisible(next);
    if (next) { if (compactLayout) { setTreeVisible(false); setInfoVisible(false); } setAdjustVisible(false); setExportVisible(false); setAnimationVisible(false); setSettingsVisible(false); setLightingVisible(false); if (materialVisible) closeMaterialPanel(); closeMeasurement(); }
  };
  const toggleMeasurementPanel = () => {
    const next = !measurementVisible;
    setMeasurementVisible(next);
    viewerRef.current?.setMeasurementEnabled(next);
    if (!next) return;
    setAdjustVisible(false);
    setExportVisible(false);
    setAnimationVisible(false);
    setSectionVisible(false);
    setSettingsVisible(false);
    setLightingVisible(false);
    if (materialVisible) closeMaterialPanel();
    if (compactLayout) { setTreeVisible(false); setInfoVisible(false); }
    if (animationPlaying) {
      setAnimationPlaying(false);
      viewerRef.current?.setAnimationPlaying(false);
    }
    if (sectionEnabled) {
      setSectionEnabled(false);
      viewerRef.current?.setSection(false, sectionAxis, sectionPosition, sectionFlipped);
    }
  };
  const toggleLightingPanel = () => {
    const next = !lightingVisible;
    setLightingVisible(next);
    if (!next) return;
    setAdjustVisible(false);
    setExportVisible(false);
    setAnimationVisible(false);
    setSectionVisible(false);
    setSettingsVisible(false);
    if (materialVisible) closeMaterialPanel();
    closeMeasurement();
    if (compactLayout) { setTreeVisible(false); setInfoVisible(false); }
  };
  const updateSection = (enabled: boolean, axis = sectionAxis, position = sectionPosition, flipped = sectionFlipped) => {
    setSectionEnabled(enabled);
    setSectionAxis(axis);
    setSectionPosition(position);
    setSectionFlipped(flipped);
    viewerRef.current?.setSection(enabled, axis, position, flipped);
  };
  const selectObject = (objectId: string, options: { additive: boolean; range: boolean }) => {
    if (options.range && selectionAnchorRef.current) {
      const orderedIds = flattenSceneNodeIds(sceneTree);
      const anchorIndex = orderedIds.indexOf(selectionAnchorRef.current);
      const objectIndex = orderedIds.indexOf(objectId);
      if (anchorIndex >= 0 && objectIndex >= 0) {
        const rangeIds = orderedIds.slice(Math.min(anchorIndex, objectIndex), Math.max(anchorIndex, objectIndex) + 1);
        viewerRef.current?.selectObjects(options.additive ? [...new Set([...selectedIdsRef.current, ...rangeIds])] : rangeIds);
        return;
      }
    }
    selectionAnchorRef.current = objectId;
    if (options.additive) {
      viewerRef.current?.selectObjects(selectedIdsRef.current.includes(objectId)
        ? selectedIdsRef.current.filter((selectedId) => selectedId !== objectId)
        : [...selectedIdsRef.current, objectId]);
      return;
    }
    viewerRef.current?.selectObject(objectId);
  };
  const toggleObjectVisibility = (objectId: string, visible: boolean) => {
    viewerRef.current?.setObjectVisible(objectId, visible);
    setSceneTree((nodes) => updateNodeVisibility(nodes, objectId, visible));
  };
  const toggleSelectionIsolation = useCallback(() => {
    const result = viewerRef.current?.toggleSelectionIsolation();
    if (!result) return;
    setIsolationActive(result.active);
    setSceneTree((nodes) => updateNodeVisibilities(nodes, result.visibility));
  }, []);
  const changeExplosion = (values: number[]) => {
    const next = (values[0] ?? 0) / 100;
    setExplodeFactor(next);
    viewerRef.current?.setExplodeFactor(next);
  };
  const updateDimensions = (dimensions: [number, number, number]) => {
    setModelInfo((info) => info ? { ...info, dimensions } : info);
  };
  const toggleProjection = () => {
    const next = projection === 'perspective' ? 'orthographic' : 'perspective';
    setProjection(next);
    viewerRef.current?.setProjection(next);
  };
  const toggleRotationMode = () => {
    const next = rotationMode === 'fixed-up' ? 'free' : 'fixed-up';
    setRotationMode(next);
    viewerRef.current?.setRotationMode(next);
  };
  const toggleViewSelector = () => {
    const next = viewerRef.current?.setViewSelectorVisible(!viewSelectorVisible) ?? false;
    setViewSelectorVisible(next);
  };
  const changeSourceUnit = (unit: LinearUnit) => {
    setSourceUnit(unit);
    setCalibrationScale(1);
    setCalibrationValue('');
    updateDimensions(viewerRef.current?.setUnitScale(unitToMeters[unit]) ?? [0, 0, 0]);
  };
  const changeUpAxis = (axis: UpAxis) => {
    const nextForwardAxis = isForwardAxisCompatible(axis, forwardAxis) ? forwardAxis : defaultForwardAxis(axis);
    setUpAxis(axis);
    setForwardAxis(nextForwardAxis);
    updateDimensions(viewerRef.current?.setOrientation(axis, nextForwardAxis) ?? [0, 0, 0]);
  };
  const changeForwardAxis = (axis: ForwardAxis) => {
    if (!isForwardAxisCompatible(upAxis, axis)) return;
    setForwardAxis(axis);
    updateDimensions(viewerRef.current?.setOrientation(upAxis, axis) ?? [0, 0, 0]);
  };
  const applyKnownDimensionCalibration = () => {
    const referenceDimensions = selectionInfo?.dimensions ?? modelInfo?.dimensions;
    if (!referenceDimensions) return;
    const axisIndex = calibrationAxis === 'x' ? 0 : calibrationAxis === 'y' ? 1 : 2;
    const multiplier = calibrationMultiplier(referenceDimensions[axisIndex], Number(calibrationValue), calibrationUnit);
    if (!multiplier) return;
    const nextCalibrationScale = calibrationScale * multiplier;
    setCalibrationScale(nextCalibrationScale);
    updateDimensions(viewerRef.current?.setUnitScale(unitToMeters[sourceUnit] * nextCalibrationScale) ?? [0, 0, 0]);
    toast.success(selectionInfo ? 'Whole model calibrated from the selected reference.' : 'Model calibrated to the known dimension.');
  };
  const resetAdjustments = () => {
    updateDimensions(viewerRef.current?.resetAdjustments() ?? [0, 0, 0]);
    setSourceUnit(initialSourceUnit);
    setUpAxis(initialUpAxis);
    setForwardAxis(initialForwardAxis);
    setCalibrationScale(1);
    setCalibrationValue('');
  };
  const selectAnimation = (index: number) => {
    setAnimationIndex(index);
    setAnimationPlaying(false);
    setAnimationTime(0);
    viewerRef.current?.setAnimationClip(index);
  };
  const toggleAnimationPlayback = () => {
    const next = !animationPlaying;
    setAnimationPlaying(next);
    viewerRef.current?.setAnimationPlaying(next);
  };
  const changeAnimationLoop = () => {
    const next = !animationLoop;
    setAnimationLoop(next);
    viewerRef.current?.setAnimationLoop(next);
  };
  const changeAnimationSpeed = (speed: number) => {
    setAnimationSpeed(speed);
    viewerRef.current?.setAnimationSpeed(speed);
  };
  const clearMeasurement = () => {
    viewerRef.current?.clearMeasurement();
    setMeasurementCopied(false);
  };
  const copyMeasurement = async () => {
    if (measurement.distance === null) return;
    try {
      await navigator.clipboard.writeText(formatMetricLength(measurement.distance, displayUnit));
      setMeasurementCopied(true);
      toast.success('Measurement copied');
      window.setTimeout(() => setMeasurementCopied(false), 2_000);
    } catch {
      showError('The measurement could not be copied. Clipboard access may be blocked.');
    }
  };
  const applySettings = (settings: AppSettings) => {
    setThemePreference(settings.appearance.theme);
    setAccentColor(settings.appearance.accent);
    setViewportBackground(settings.appearance.viewportBackground);
    setProjection(settings.viewer.projection);
    setRotationMode(settings.viewer.rotationMode);
    setDisplayMode(settings.viewer.displayMode);
    setGridVisible(settings.viewer.gridVisible);
    setDisplayUnit(settings.viewer.displayUnit);
    setRestoreLastCamera(settings.viewer.restoreLastCamera);
    setLastCamera(settings.viewer.lastCamera);
    setLighting(settings.viewer.lighting);
    setInfoVisible(compactLayout ? false : settings.panels.modelInfoVisible);
    setTreeVisible(compactLayout ? false : settings.panels.sceneObjectsVisible);

    const viewer = viewerRef.current;
    viewer?.setViewportBackground(settings.appearance.viewportBackground);
    viewer?.setProjection(settings.viewer.projection);
    viewer?.setRotationMode(settings.viewer.rotationMode);
    viewer?.setDisplayMode(settings.viewer.displayMode);
    viewer?.setGridVisible(settings.viewer.gridVisible);
    viewer?.setLighting(settings.viewer.lighting);
    if (settings.viewer.restoreLastCamera && settings.viewer.lastCamera && modelInfo) {
      viewer?.setCameraState(settings.viewer.lastCamera);
    }
  };
  const exportSettings = () => {
    const camera = viewerRef.current?.getCameraState() ?? lastCamera;
    const exported: AppSettings = {
      ...settingsSnapshot,
      viewer: { ...settingsSnapshot.viewer, lastCamera: camera },
    };
    const blob = new Blob([serializeAppSettings(exported)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kea3d.settings.json';
    link.click();
    toast.success('Settings exported');
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const importSettings = async (file: File) => {
    try {
      if (file.size > 1_048_576) throw new Error('The settings file is unexpectedly large.');
      const imported = parseAppSettingsJson(await file.text());
      if (!imported) throw new Error('This is not a valid Kea3D settings file.');
      applySettings(imported);
      toast.success('Settings imported');
    } catch (importError) {
      showError(importError instanceof Error ? importError.message : 'The settings file could not be imported.');
    } finally {
      if (settingsInputRef.current) settingsInputRef.current.value = '';
    }
  };
  const resetSettings = () => {
    applySettings(structuredClone(defaultAppSettings));
    toast.success('Settings reset to defaults');
  };
  const exportCorrectedGlb = async () => {
    if (!viewerRef.current || !modelInfo) return;
    setExporting(true);
    try {
      const blob = await viewerRef.current.exportGlb({
        onlyVisible: exportScope === 'visible',
        includeAnimations: exportAnimations,
      });
      const suggestedName = `${modelInfo.fileName.replace(/\.[^.]+$/, '')}-fixed.glb`;
      if (nativeShell) {
        const [{ save }, { writeFile }] = await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/plugin-fs'),
        ]);
        const destination = await save({
          title: 'Export GLB',
          defaultPath: suggestedName,
          filters: [{ name: 'Binary glTF', extensions: ['glb'] }],
        });
        if (!destination) return;
        await writeFile(destination, new Uint8Array(await blob.arrayBuffer()));
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = suggestedName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      toast.success(exportScope === 'visible' ? 'Visible objects exported to GLB' : 'Complete model exported to GLB');
    } catch (exportError) {
      showError(exportError instanceof Error ? exportError.message : 'The corrected model could not be exported.');
    } finally {
      setExporting(false);
    }
  };
  const saveScreenshot = async () => {
    if (!viewerRef.current || !modelInfo) return;
    try {
      const blob = await viewerRef.current.capturePng();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${modelInfo.fileName.replace(/\.[^.]+$/, '')}-kea3d.png`; link.click();
      toast.success('Screenshot saved');
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (captureError) {
      showError(captureError instanceof Error ? captureError.message : 'Screenshot failed.');
    }
  };
  const copyViewLink = async () => {
    const camera = viewerRef.current?.getCameraState();
    if (!camera) return;
    try {
      const url = new URL(window.location.href);
      url.hash = encodeSharedView({ version: 1, camera, displayMode, gridVisible, rotationMode });
      await navigator.clipboard.writeText(url.toString());
      window.history.replaceState(null, '', url);
      setSharedCopied(true);
      toast.success('Private view link copied');
      window.setTimeout(() => setSharedCopied(false), 2_000);
    } catch {
      showError('The view link could not be copied. Clipboard access may be blocked.');
    }
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frameRef.current?.requestFullscreen();
    } catch { showError('Fullscreen is not available in this browser.'); }
  };

  const clearLocalCadCache = async () => {
    setClearingCadCache(true);
    const cleared = await clearCadCache();
    setClearingCadCache(false);
    if (!cleared) showError('The local CAD cache could not be cleared in this browser.');
    else {
      await refreshCadCacheStats();
      toast.success('Local CAD cache cleared');
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      if (key === 'escape' && compactLayout && compactLayerOpen) {
        event.preventDefault();
        event.stopPropagation();
        if (mobileToolsVisible) setMobileToolsVisible(false);
        else if (mobileDisplayVisible) setMobileDisplayVisible(false);
        else if (projectRecovery) setProjectRecovery(null);
        else if (lightingVisible) setLightingVisible(false);
        else if (materialVisible) closeMaterialPanel();
        else if (measurementVisible) closeMeasurement();
        else if (sectionVisible) setSectionVisible(false);
        else if (settingsVisible) setSettingsVisible(false);
        else if (adjustVisible) closeAdjustPanel();
        else if (exportVisible) setExportVisible(false);
        else if (animationVisible) setAnimationVisible(false);
        else if (treeVisible) setTreeVisible(false);
        else if (infoVisible) setInfoVisible(false);
        return;
      }
      if (key === 'escape' && modelInfo) {
        event.preventDefault();
        viewerRef.current?.selectObjects([]);
        return;
      }
      const editable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target?.isContentEditable
        || Boolean(target?.closest('button, [role="combobox"], [role="listbox"]'));
      if (editable) return;

      if ((event.ctrlKey || event.metaKey) && key === 'o') {
        event.preventDefault();
        void chooseModelFiles();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'z' && modelInfo) {
        event.preventDefault();
        if (event.shiftKey) redoMaterial();
        else undoMaterial();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y' && modelInfo) {
        event.preventDefault();
        redoMaterial();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space' && modelInfo) {
        event.preventDefault();
        toggleViewSelector();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || !modelInfo) return;

      if (key === 'f') {
        event.preventDefault();
        viewerRef.current?.fit();
      } else if (key === 'p') {
        event.preventDefault();
        toggleProjection();
      } else if (key === 'g') {
        event.preventDefault();
        toggleGrid();
      } else if (key === 'e') {
        event.preventDefault();
        cycleDisplayMode();
      } else if (key === 'i') {
        event.preventDefault();
        toggleSelectionIsolation();
      } else if (key === 'm') {
        event.preventDefault();
        toggleMaterialPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [adjustVisible, animationVisible, chooseModelFiles, closeAdjustPanel, closeMaterialPanel, closeMeasurement, compactLayerOpen, compactLayout, cycleDisplayMode, exportVisible, infoVisible, lightingVisible, materialVisible, measurementVisible, mobileDisplayVisible, mobileToolsVisible, modelInfo, projectRecovery, redoMaterial, sectionVisible, settingsVisible, toggleGrid, toggleMaterialPanel, toggleProjection, toggleSelectionIsolation, toggleViewSelector, treeVisible, undoMaterial]);

  const activeAnimation = animations[animationIndex] ?? null;
  const measurementValue = measurement.distance === null ? null : formatMetricLength(measurement.distance, displayUnit);
  const measurementInstruction = measurement.pointCount === 0
    ? 'Select the first point on the model'
    : measurement.pointCount === 1
      ? 'Select the second point on the model'
      : 'Select another point to start a new measurement';
  const loadingNotice = loadSizeNotice(loadingBytes);
  const selectedName = selectedIds.length > 1
    ? `${selectedIds.length} objects`
    : findNodeName(sceneTree, selectedId);
  const isolateSelectionLabel = isolationActive
    ? 'Show all objects'
    : selectedIds.length > 1 ? 'Isolate selected objects' : 'Isolate selected object';
  const selectedMaterialPreset = materialPresetId ? findMaterialPreset(materialPresetId) ?? null : null;
  const calibrationAxisIndex = calibrationAxis === 'x' ? 0 : calibrationAxis === 'y' ? 1 : 2;
  const calibrationReferenceDimensions = selectionInfo?.dimensions ?? modelInfo?.dimensions;
  const calibrationCurrentMeters = calibrationReferenceDimensions?.[calibrationAxisIndex] ?? 0;
  const calibrationTarget = Number(calibrationValue);
  const calibrationValid = calibrationMultiplier(calibrationCurrentMeters, calibrationTarget, calibrationUnit) !== null;
  const calibrationCurrentValue = calibrationCurrentMeters / unitToMeters[calibrationUnit];
  const adjustmentScale = calibrationScale;
  const infoRows = selectionInfo ? [
    ['Triangles', formatNumber(selectionInfo.triangles)], ['Vertices', formatNumber(selectionInfo.vertices)],
    ['Meshes', formatNumber(selectionInfo.meshes)], ['Materials', formatNumber(selectionInfo.materials)],
    ['Dimensions', formatMetricDimensions(selectionInfo.dimensions, displayUnit)],
  ] : modelInfo ? [
    ['Triangles', formatNumber(modelInfo.triangles)], ['Vertices', formatNumber(modelInfo.vertices)],
    ['Meshes', formatNumber(modelInfo.meshes)], ['Materials', formatNumber(modelInfo.materials)],
    ['Dimensions', formatMetricDimensions(modelInfo.dimensions, displayUnit)], ['File size', formatBytes(modelInfo.fileSize)],
  ] : [];
  const compactViewportBottom = !compactLayout
    ? 0
    : projectRecovery
      ? compactWorkspaceHeight
    : treeVisible
      ? sceneWorkspaceExpanded ? compactWorkspaceExpandedHeight : compactSceneHeight
      : materialVisible
        ? materialWorkspaceExpanded ? compactWorkspaceExpandedHeight : compactWorkspaceHeight
        : measurementVisible
          ? compactMeasurementHeight
          : sectionVisible
            ? compactSectionHeight
            : lightingVisible
              ? compactLightingHeight
          : adjustVisible
            ? adjustWorkspaceExpanded ? compactWorkspaceExpandedHeight : compactAdjustHeight
            : animationVisible
              ? compactAnimationHeight
              : 0;

  return (
    <TooltipProvider>
      <main className="relative h-full w-full min-w-[280px] bg-background text-foreground">
        <section
          ref={frameRef}
          aria-label="Kea3D model viewer"
          className={cn(
            'absolute isolate overflow-hidden bg-muted/30 fullscreen:inset-0 fullscreen:h-full fullscreen:w-full fullscreen:rounded-none fullscreen:border-0 dark:bg-[#0c0d0e]',
            nativeShell
              ? 'inset-0 rounded-none border-0 shadow-none'
              : 'inset-3 rounded-3xl border shadow-inner max-md:inset-1.5 max-md:rounded-2xl',
          )}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
          onDrop={handleDrop}
        >
          <div
            ref={viewportRef}
            className="absolute inset-x-0 top-0 transition-[bottom] duration-200 ease-out"
            style={{ bottom: compactViewportBottom }}
          />
          <input ref={inputRef} className="sr-only" type="file" multiple accept={acceptedExtensions} aria-label="Choose 3D model files"
            onChange={(event) => event.target.files && void loadFiles(event.target.files)} />
          <input ref={(element) => { projectFolderInputRef.current = element; element?.setAttribute('webkitdirectory', ''); }} className="sr-only" type="file" multiple accept={acceptedExtensions} aria-label="Choose Kea3D project folder"
            onChange={(event) => event.target.files && void loadFiles(event.target.files)} />
          <input ref={projectRecoveryInputRef} className="sr-only" type="file" multiple accept=".glb,model/gltf-binary" aria-label="Locate project GLB resources"
            onChange={(event) => { if (event.target.files) recoverProjectWithFiles(event.target.files); event.currentTarget.value = ''; }} />
          <input ref={settingsInputRef} className="sr-only" type="file" accept=".json,application/json" aria-label="Import Kea3D settings"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void importSettings(file); }} />

          {modelInfo && (
            <Button
              variant="outline"
              type="button"
              className="absolute top-5 left-5 z-20 h-11 max-w-[360px] justify-start gap-2.5 rounded-xl bg-card/85 px-3 shadow-lg backdrop-blur-md max-lg:top-3 max-lg:left-3 max-lg:h-10 max-lg:max-w-[calc(100%_-_24px)]"
              aria-label={`Open another model. Current model: ${modelInfo.fileName}`}
              onClick={() => void chooseModelFiles()}
            >
              <img className="size-6 shrink-0" src={`${import.meta.env.BASE_URL}kea3d-icon.svg`} alt="" />
              {!nativeShell && !compactLayout && <span className="kea3d-wordmark shrink-0 text-sm">Kea3D</span>}
              <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <FileBox className="shrink-0" />
              <span className="truncate">{modelInfo.fileName}</span>
            </Button>
          )}

          {!modelInfo && (
            <Button variant="outline" size="icon-lg" type="button" className="absolute top-5 right-5 z-20 rounded-xl bg-card/85 shadow-lg backdrop-blur-md max-lg:top-3 max-lg:right-3" aria-label="Settings" onClick={toggleSettingsPanel}>
              <Settings2 />
            </Button>
          )}

          {modelInfo && (
            <div role="toolbar" aria-label="Viewer tools" aria-orientation="horizontal" onKeyDown={handleToolbarNavigation} className="absolute top-5 left-1/2 z-30 hidden -translate-x-1/2 flex-row items-center gap-0.5 rounded-lg border bg-card p-1 shadow-sm 2xl:flex">
              <ToolButton label="Fit model" icon={<Focus />} onClick={() => viewerRef.current?.fit()} />
              <ToolButton active={viewSelectorVisible} label="View selector" icon={<View />} onClick={toggleViewSelector} />
              <ToolButton active={treeVisible} label="Scene objects" icon={<Layers3 />} onClick={toggleScenePanel} />
              <ToolButton active={isolationActive} disabled={!selectedId && !isolationActive} label={isolateSelectionLabel} icon={isolationActive ? <Boxes /> : <Scan />} onClick={toggleSelectionIsolation} />
              <ToolButton active={displayMode !== 'solid'} label={`Display: ${displayMode[0].toUpperCase()}${displayMode.slice(1)} · click to cycle`} icon={<Network />} onClick={cycleDisplayMode} />
              <ToolButton active={projection === 'orthographic'} label={projection === 'perspective' ? 'Use orthographic view' : 'Use perspective view'} icon={<ScanBox />} onClick={toggleProjection} />
              <ToolButton active={rotationMode === 'free'} label={rotationMode === 'fixed-up' ? 'Rotation: Fixed up · use free orbit' : 'Rotation: Free orbit · lock up vector'} icon={<Orbit />} onClick={toggleRotationMode} />
              <ToolDivider />
              <ToolButton active={gridVisible} label="Grid" icon={<Grid3X3 />} onClick={toggleGrid} />
              <LightingPopover lighting={lighting} onChange={setLighting} />
              <ToolDivider />
              <ToolButton active={infoVisible} label="Model information" icon={<Info />} onClick={toggleInfoPanel} />
              <ToolButton active={measurementVisible} label={measurementValue ? `Measured: ${measurementValue}` : 'Measure distance'} icon={<BetweenHorizontalStart />} onClick={toggleMeasurementPanel} />
              <ToolDivider />
              <ToolButton active={materialVisible} disabled={!selectedId} label="Set material" icon={<PaintBucket />} onClick={toggleMaterialPanel} />
              <ToolButton active={sectionEnabled} label={sectionEnabled ? 'Section cut enabled' : 'Section cut'} icon={<ScissorsLineDashed />} onClick={toggleSectionPanel} />
              <ToolButton active={adjustVisible} label="Adjust model" icon={<Ruler />} onClick={toggleAdjustPanel} />
              {animations.length > 0 && <ToolButton active={animationVisible} label="Animations" icon={animationPlaying ? <Pause /> : <Play />} onClick={toggleAnimationPanel} />}
              <ToolDivider />
              <ToolButton active={exportVisible} label="Export model" icon={<Download />} onClick={toggleExportPanel} />
              {!nativeShell && <ToolButton label={sharedCopied ? 'View link copied' : 'Copy private view link'} icon={sharedCopied ? <Check /> : <Share2 />} onClick={() => void copyViewLink()} />}
              <ToolButton label="Save PNG" icon={<Camera />} onClick={() => void saveScreenshot()} />
              <ToolButton label="Fullscreen" icon={<Maximize2 />} onClick={() => void toggleFullscreen()} />
              <ToolDivider />
              <ToolButton active={settingsVisible} label="Settings" icon={<Settings2 />} onClick={toggleSettingsPanel} />
            </div>
          )}

          {modelInfo && (
            <div role="toolbar" aria-label="Compact desktop viewer tools" aria-orientation="horizontal" onKeyDown={handleToolbarNavigation} className="absolute top-5 left-1/2 z-30 hidden -translate-x-1/2 items-center gap-0.5 rounded-lg border bg-card p-1 shadow-sm lg:flex 2xl:hidden">
              <ToolButton label="Fit model" icon={<Focus />} onClick={() => viewerRef.current?.fit()} />
              <ToolButton active={viewSelectorVisible} label="View selector" icon={<View />} onClick={toggleViewSelector} />
              <ToolButton active={treeVisible} label="Scene objects" icon={<Layers3 />} onClick={toggleScenePanel} />
              <ToolButton active={isolationActive} disabled={!selectedId && !isolationActive} label={isolateSelectionLabel} icon={isolationActive ? <Boxes /> : <Scan />} onClick={toggleSelectionIsolation} />
              <ToolButton active={displayMode !== 'solid'} label={`Display: ${displayMode[0].toUpperCase()}${displayMode.slice(1)} · click to cycle`} icon={<Network />} onClick={cycleDisplayMode} />
              <ToolButton active={projection === 'orthographic'} label={projection === 'perspective' ? 'Use orthographic view' : 'Use perspective view'} icon={<ScanBox />} onClick={toggleProjection} />
              <ToolButton active={rotationMode === 'free'} label={rotationMode === 'fixed-up' ? 'Rotation: Fixed up · use free orbit' : 'Rotation: Free orbit · lock up vector'} icon={<Orbit />} onClick={toggleRotationMode} />
              <ToolDivider />
              <LightingPopover lighting={lighting} onChange={setLighting} />
              <DropdownMenu open={mobileDisplayVisible} onOpenChange={setMobileDisplayVisible}>
                <DropdownMenuTrigger asChild>
                  <Button variant={settingsVisible || infoVisible || measurementVisible || materialVisible || adjustVisible || exportVisible || sectionVisible || animationVisible ? 'default' : 'ghost'} size="icon" aria-label="More viewer tools"><Ellipsis /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" sideOffset={10} className="w-60">
                  <DropdownMenuLabel>View and inspect</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem checked={gridVisible} onCheckedChange={() => toggleGrid()}><Grid3X3 /> Grid</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={infoVisible} onCheckedChange={() => toggleInfoPanel()}><Info /> Model info</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={measurementVisible} onCheckedChange={() => toggleMeasurementPanel()}><BetweenHorizontalStart /> Measure</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem disabled={!selectedId} checked={materialVisible} onCheckedChange={() => toggleMaterialPanel()}><PaintBucket /> Set material</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={sectionVisible} onCheckedChange={() => toggleSectionPanel()}><ScissorsLineDashed /> Section cut</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={adjustVisible} onCheckedChange={() => toggleAdjustPanel()}><Ruler /> Adjust model</DropdownMenuCheckboxItem>
                  {animations.length > 0 && <DropdownMenuCheckboxItem checked={animationVisible} onCheckedChange={() => toggleAnimationPanel()}>{animationPlaying ? <Pause /> : <Play />} Animations</DropdownMenuCheckboxItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Output</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem checked={exportVisible} onCheckedChange={() => toggleExportPanel()}><Download /> Export model</DropdownMenuCheckboxItem>
                  {!nativeShell && <DropdownMenuItem onSelect={() => void copyViewLink()}>{sharedCopied ? <Check /> : <Share2 />} {sharedCopied ? 'View link copied' : 'Copy private view link'}</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => void saveScreenshot()}><Camera /> Save PNG</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void toggleFullscreen()}><Maximize2 /> Fullscreen</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={settingsVisible} onCheckedChange={() => toggleSettingsPanel()}><Settings2 /> Settings</DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {modelInfo && (!compactLayout || !(treeVisible || materialVisible || measurementVisible || sectionVisible || lightingVisible || adjustVisible || animationVisible)) && (
            <div role="toolbar" aria-label="Mobile viewer tools" aria-orientation="horizontal" className="absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card/95 p-1 shadow-lg backdrop-blur-md lg:hidden">
              <Button variant="ghost" size="icon-lg" className="size-11" aria-label="Fit model" onClick={() => viewerRef.current?.fit()}><Focus /></Button>
              <Button variant={viewSelectorVisible ? 'default' : 'ghost'} size="icon-lg" className="size-11" aria-label="View selector" aria-pressed={viewSelectorVisible} onClick={toggleViewSelector}><View /></Button>
              <Button variant={treeVisible ? 'default' : 'ghost'} size="icon-lg" className="size-11" aria-label="Scene objects" aria-pressed={treeVisible} onClick={toggleScenePanel}><Layers3 /></Button>
              <Button variant={isolationActive ? 'default' : 'ghost'} size="icon-lg" className="size-11" aria-label={isolateSelectionLabel} aria-pressed={isolationActive} disabled={!selectedId && !isolationActive} onClick={toggleSelectionIsolation}>{isolationActive ? <Boxes /> : <Scan />}</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={displayMode !== 'solid' || gridVisible ? 'default' : 'ghost'} size="icon-lg" className="size-11" aria-label="Display options"><Network /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top" sideOffset={10} className="w-52 [&_[role^=menuitem]]:min-h-11">
                  <DropdownMenuLabel>Display style</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={displayMode}
                    onValueChange={(value) => {
                      const next = value as DisplayMode;
                      setDisplayMode(next);
                      viewerRef.current?.setDisplayMode(next);
                    }}
                  >
                    <DropdownMenuRadioItem value="solid">Solid</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="edges">Edges</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="wireframe">Wireframe</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={gridVisible}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setGridVisible(next);
                      viewerRef.current?.setGridVisible(next);
                    }}
                  >
                    Grid
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Popover open={mobileToolsVisible} onOpenChange={setMobileToolsVisible}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-lg" className="size-11" aria-label="More tools"><Ellipsis /></Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  sideOffset={10}
                  aria-label="More viewer tools"
                  className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl p-2"
                >
                  <div role="toolbar" aria-label="More viewer tools" className="grid grid-cols-5 gap-1">
                    <OverflowToolButton label={projection === 'perspective' ? 'Orthographic' : 'Perspective'} icon={<ScanBox />} active={projection === 'orthographic'} onClick={() => { toggleProjection(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label={rotationMode === 'fixed-up' ? 'Free orbit' : 'Fixed up'} icon={<Orbit />} active={rotationMode === 'free'} onClick={() => { toggleRotationMode(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Model info" icon={<Info />} active={infoVisible} onClick={() => { toggleInfoPanel(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Lighting" icon={<Sun />} active={lightingVisible} onClick={() => { toggleLightingPanel(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Measure" icon={<BetweenHorizontalStart />} active={measurementVisible} onClick={() => { toggleMeasurementPanel(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Set material" icon={<PaintBucket />} active={materialVisible} disabled={!selectedId} onClick={() => { toggleMaterialPanel(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Adjust model" icon={<Ruler />} active={adjustVisible} onClick={() => { toggleAdjustPanel(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Export" icon={<Download />} active={exportVisible} onClick={() => { toggleExportPanel(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Section cut" icon={<ScissorsLineDashed />} active={sectionEnabled} onClick={() => { toggleSectionPanel(); setMobileToolsVisible(false); }} />
                    {animations.length > 0 && <OverflowToolButton label="Animations" icon={animationPlaying ? <Pause /> : <Play />} active={animationVisible} onClick={() => { toggleAnimationPanel(); setMobileToolsVisible(false); }} />}
                    <OverflowToolButton label="Settings" icon={<Settings2 />} active={settingsVisible} onClick={() => { toggleSettingsPanel(); setMobileToolsVisible(false); }} />
                    {!nativeShell && <OverflowToolButton label="Share" icon={<Share2 />} onClick={() => { void copyViewLink(); setMobileToolsVisible(false); }} />}
                    <OverflowToolButton label="Save PNG" icon={<Camera />} onClick={() => { void saveScreenshot(); setMobileToolsVisible(false); }} />
                    <OverflowToolButton label="Fullscreen" icon={<Maximize2 />} onClick={() => { void toggleFullscreen(); setMobileToolsVisible(false); }} />
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {!modelInfo && !progress && nativeStartupResolved && (
            <section aria-label="Open a model" className="absolute top-1/2 left-1/2 z-10 flex w-[min(410px,calc(100%_-_40px))] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center">
              <div className="mb-5 flex items-center gap-3">
                <img className="size-14" src={`${import.meta.env.BASE_URL}kea3d-icon.svg`} alt="" />
                <span className="kea3d-wordmark text-3xl">Kea3D</span>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight max-md:text-2xl">Open a 3D model</h1>
              <p className="mt-1.5 mb-5 text-sm text-muted-foreground">{initialSharedView ? 'Shared view ready · choose the same local model' : compactLayout ? 'Choose files from your device' : 'Drop files here or choose them from your device'}</p>
              <Button size="lg" className="rounded-xl" onClick={() => void chooseModelFiles()}><FolderOpen /> Choose files</Button>
              {!nativeShell && <Button variant="ghost" size="sm" className="mt-1.5" onClick={chooseProjectFolder}><Boxes /> Open project folder</Button>}
              <small className="mt-4 max-w-sm text-[11px] leading-relaxed text-muted-foreground">KEA3D · STEP · IGES · GLB · STL · 3MF · OBJ · PLY · FBX · DAE · BLEND</small>
              <small className="mt-1 text-[11px] text-muted-foreground">Processed locally · Nothing is uploaded</small>
            </section>
          )}

          {modelInfo && lightingVisible && (
            <ResponsivePanel
              title="Lighting"
              description="Local viewport appearance only"
              onClose={() => setLightingVisible(false)}
              desktopClassName="absolute top-20 right-5 z-20 w-[310px] gap-3 bg-card/92 shadow-2xl backdrop-blur-md"
              compactMode="workspace"
              compactHeight={compactLightingHeight}
              contentClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
            >
              <LightingControls lighting={lighting} onChange={setLighting} showHeader={false} />
            </ResponsivePanel>
          )}

          {projectRecovery && (
            <Suspense fallback={null}>
              <ProjectRecoveryPanel
                issues={projectRecovery.issues}
                compact={compactLayout}
                nativeShell={nativeShell}
                onClose={() => setProjectRecovery(null)}
                onLocate={() => projectRecoveryInputRef.current?.click()}
                onChooseFolder={chooseProjectFolder}
                onAcceptChanged={() => void rewriteProjectForRecovery('accept')}
                onRemoveOptional={() => void rewriteProjectForRecovery('remove')}
              />
            </Suspense>
          )}

          {modelInfo && materialVisible && (
            <ResponsivePanel
              title="Set material"
              description="Numerical PBR presets · reversible"
              onClose={closeMaterialPanel}
              desktopClassName="absolute top-20 right-5 z-30 h-[calc(100%_-_100px)] w-[360px] gap-3 bg-card/94 shadow-2xl backdrop-blur-md"
              compactFixedHeight
              compactMode="workspace"
              compactWorkspaceExpanded={materialWorkspaceExpanded}
              onCompactWorkspaceExpandedChange={setMaterialWorkspaceExpanded}
              contentClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
            >
              <ScrollArea type="always" aria-label="Material editor" className="min-h-0 flex-1 touch-pan-y pr-3" viewportClassName="absolute inset-0 size-auto">
                <div className="grid gap-3 pb-2">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" aria-pressed={materialScope === 'selection'} size="sm" onClick={() => changeMaterialScope('selection')}>Selected objects</Button>
                <Button variant="outline" aria-pressed={materialScope === 'same-material'} size="sm" onClick={() => changeMaterialScope('same-material')}>Same material</Button>
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {selectedId
                  ? `${materialEditState.targetMeshes} ${materialEditState.targetMeshes === 1 ? 'mesh' : 'meshes'} targeted. ${materialScope === 'same-material' ? 'Matching equivalent original PBR materials across the model.' : 'Using the current object selection.'} Choose a preset to preview it.`
                  : 'Select an object in the viewport or Scene objects first.'}
              </p>
              {selectedMaterialPreset && materialOptions && (
                <section aria-label="Material options" className="grid gap-2 rounded-xl border bg-muted/25 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-xs" title={selectedMaterialPreset.name}>{selectedMaterialPreset.name}</strong>
                    <span className="text-[10px] text-muted-foreground">Live preview</span>
                  </div>
                  {selectedMaterialPreset.toneAdjustable && (
                    <div className="grid gap-1">
                      <span className="text-[10px] text-muted-foreground">Tone</span>
                      <div className="grid grid-cols-3 gap-1">
                        {(['dark', 'standard', 'light'] as const).map((tone) => (
                          <Button key={tone} variant={materialOptions.tone === tone ? 'secondary' : 'outline'} size="sm" aria-pressed={materialOptions.tone === tone} onClick={() => changeMaterialTone(tone)}>
                            {tone === 'standard' ? 'Standard' : tone[0]!.toUpperCase() + tone.slice(1)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedMaterialPreset.finishFamily && (
                    <div className="grid gap-1">
                      <span className="text-[10px] text-muted-foreground">Finish</span>
                      <div className="grid grid-cols-3 gap-1">
                        {(['matte', 'satin', 'gloss'] as const).map((finish) => {
                          const label = selectedMaterialPreset.finishFamily === 'metal'
                            ? finish === 'matte' ? 'Brushed' : finish === 'satin' ? 'Satin' : 'Polished'
                            : finish[0]!.toUpperCase() + finish.slice(1);
                          return <Button key={finish} variant={materialFinish === finish ? 'secondary' : 'outline'} size="sm" aria-pressed={materialFinish === finish} onClick={() => changeMaterialFinish(finish)}>{label}</Button>;
                        })}
                      </div>
                    </div>
                  )}
                  {selectedMaterialPreset.emissive && (
                    <div className="grid gap-1">
                      <span className="text-[10px] text-muted-foreground">LED state</span>
                      <div className="grid grid-cols-2 gap-1">
                        <Button variant={!materialOptions.emissionEnabled ? 'secondary' : 'outline'} size="sm" aria-pressed={!materialOptions.emissionEnabled} onClick={() => updateMaterialPreview({ ...materialOptions, emissionEnabled: false })}>Off</Button>
                        <Button variant={materialOptions.emissionEnabled ? 'secondary' : 'outline'} size="sm" aria-pressed={materialOptions.emissionEnabled} onClick={() => updateMaterialPreview({ ...materialOptions, emissionEnabled: true })}>On</Button>
                      </div>
                    </div>
                  )}
                  <Accordion type="single" collapsible>
                    <AccordionItem value="advanced" className="border-0">
                      <AccordionTrigger className="min-h-9 py-1 text-[11px] hover:no-underline">Advanced PBR</AccordionTrigger>
                      <AccordionContent className="grid gap-3 pt-2">
                        <div className="grid gap-1">
                          <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Roughness</span><span className="tabular-nums">{materialOptions.roughness.toFixed(2)}</span></div>
                          <Slider aria-label="Material roughness" min={0.02} max={1} step={0.01} value={[materialOptions.roughness]} onValueChange={(values) => changeMaterialNumber('roughness', values[0] ?? materialOptions.roughness)} />
                        </div>
                        <div className="grid gap-1">
                          <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Metalness</span><span className="tabular-nums">{materialOptions.metalness.toFixed(2)}</span></div>
                          <Slider aria-label="Material metalness" min={0} max={1} step={0.01} value={[materialOptions.metalness]} onValueChange={(values) => changeMaterialNumber('metalness', values[0] ?? materialOptions.metalness)} />
                        </div>
                        {selectedMaterialPreset.transmission !== undefined && (
                          <>
                            <div className="grid gap-1">
                              <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Opacity</span><span className="tabular-nums">{materialOptions.opacity.toFixed(2)}</span></div>
                              <Slider aria-label="Material opacity" min={0.05} max={1} step={0.01} value={[materialOptions.opacity]} onValueChange={(values) => changeMaterialNumber('opacity', values[0] ?? materialOptions.opacity)} />
                            </div>
                            <div className="grid gap-1">
                              <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Transmission</span><span className="tabular-nums">{materialOptions.transmission.toFixed(2)}</span></div>
                              <Slider aria-label="Material transmission" min={0} max={1} step={0.01} value={[materialOptions.transmission]} onValueChange={(values) => changeMaterialNumber('transmission', values[0] ?? materialOptions.transmission)} />
                            </div>
                          </>
                        )}
                        {selectedMaterialPreset.emissive && (
                          <div className="grid gap-1">
                            <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Emission strength</span><span className="tabular-nums">{materialOptions.emissiveIntensity.toFixed(1)}</span></div>
                            <Slider aria-label="Material emission strength" min={0} max={8} step={0.1} value={[materialOptions.emissiveIntensity]} onValueChange={(values) => changeMaterialNumber('emissiveIntensity', values[0] ?? materialOptions.emissiveIntensity)} />
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </section>
              )}
              <div className="grid gap-4">
                  {Object.entries(materialCategoryNames).map(([category, label]) => (
                    <section key={category} aria-labelledby={`material-${category}`} className="grid gap-2">
                      <h3 id={`material-${category}`} className="text-[11px] font-semibold text-muted-foreground">{label}</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {materialPresets.filter((preset) => preset.category === category).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={materialPresetId === preset.id}
                            disabled={!selectedId}
                            className={cn(
                              'flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors hover:bg-muted disabled:opacity-50',
                              materialPresetId === preset.id && 'border-primary bg-primary/20 text-foreground ring-2 ring-primary/55',
                            )}
                            onClick={() => previewMaterial(preset.id)}
                          >
                            <span
                              className="size-6 shrink-0 rounded-md border border-black/20 shadow-inner"
                              style={{
                                background: preset.emissive
                                  ? `radial-gradient(circle at 35% 30%, ${preset.emissive}, ${preset.color} 70%)`
                                  : preset.transmission
                                    ? `linear-gradient(135deg, ${preset.color}ee, ${preset.color}55)`
                                    : preset.color,
                              }}
                            />
                            <span className="leading-tight">{preset.name}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                </div>
              </ScrollArea>
              <Separator className="shrink-0" />
              <div aria-label="Material actions" className={cn('grid shrink-0', compactLayout ? 'grid-cols-[1fr_1fr_1fr_4px_1fr_1fr] gap-1' : 'grid-cols-2 gap-2')}>
                <Button variant="outline" size="sm" className={cn(compactLayout && 'h-14 flex-col gap-0.5 px-1 text-[9px] leading-none')} disabled={!materialEditState.canRestore} onClick={restoreMaterial}><RotateCcw /><span>Original</span></Button>
                <Button variant="outline" size="sm" className={cn(compactLayout && 'h-14 flex-col gap-0.5 px-1 text-[9px] leading-none')} disabled={!materialEditState.canUndo} onClick={undoMaterial}><Undo2 /><span>Undo</span></Button>
                <Button variant="outline" size="sm" className={cn(compactLayout && 'h-14 flex-col gap-0.5 px-1 text-[9px] leading-none')} disabled={!materialEditState.canRedo} onClick={redoMaterial}><Redo2 /><span>Redo</span></Button>
                {compactLayout && <Separator orientation="vertical" className="h-10 self-center justify-self-center" />}
                <Button aria-label="Cancel preview" variant="outline" size="sm" className={cn(compactLayout && 'h-14 flex-col gap-0.5 px-1 text-[9px] leading-none')} disabled={!materialEditState.previewActive} onClick={() => {
                  setMaterialEditState(viewerRef.current?.cancelMaterialPreview() ?? emptyMaterialEditState);
                  setMaterialPresetId(null);
                  setMaterialOptions(null);
                  setMaterialFinish(null);
                }}><X /><span>{compactLayout ? 'Discard' : 'Cancel preview'}</span></Button>
                <Button size="sm" className={cn(compactLayout && 'h-14 flex-col gap-0.5 px-1 text-[9px] leading-none')} disabled={!materialEditState.previewActive} onClick={applyMaterial}><Check /><span>Apply</span></Button>
              </div>
              {!compactLayout && <p className="shrink-0 text-[10px] leading-relaxed text-muted-foreground">The source file is untouched. Use Export to create a GLB copy with applied materials.</p>}
            </ResponsivePanel>
          )}

          {settingsVisible && (
            <ResponsivePanel
              title="Settings"
              description="Saved automatically on this device"
              onClose={() => setSettingsVisible(false)}
              desktopClassName="absolute top-20 right-5 z-30 max-h-[calc(100%_-_100px)] w-[340px] gap-3 bg-card/94 shadow-2xl backdrop-blur-md"
              contentClassName="min-h-0 overflow-y-auto pr-1"
            >
              <Accordion type="multiple" defaultValue={['appearance', 'viewer']}>
                <AccordionItem value="appearance">
                  <AccordionTrigger>Appearance</AccordionTrigger>
                  <AccordionContent className="grid gap-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Theme
                        <Select value={themePreference} onValueChange={(value) => setThemePreference(value as ThemePreference)}>
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="dark">Dark</SelectItem><SelectItem value="light">Light</SelectItem></SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Viewport
                        <Select value={viewportBackground} onValueChange={(value) => setViewportBackground(value as ViewportBackground)}>
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="adaptive">Adaptive</SelectItem><SelectItem value="black">Black</SelectItem><SelectItem value="charcoal">Charcoal</SelectItem>
                            <SelectItem value="slate">Slate</SelectItem><SelectItem value="light">Light</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Accent color</span>
                      <div className="flex gap-2">
                        {accentOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            title={option.label}
                            aria-label={`${option.label} accent`}
                            aria-pressed={accentColor === option.value}
                            className={cn('grid size-8 place-items-center rounded-full border-2 transition-transform hover:scale-105', accentColor === option.value ? 'border-primary ring-2 ring-primary/30' : 'border-transparent')}
                            onClick={() => setAccentColor(option.value)}
                          >
                            <span className="size-5 rounded-full" style={{ backgroundColor: option.color }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="viewer">
                  <AccordionTrigger>Viewer defaults</AccordionTrigger>
                  <AccordionContent className="grid gap-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Projection
                        <Select value={projection} onValueChange={(value) => { const next = value as CameraProjection; setProjection(next); viewerRef.current?.setProjection(next); }}>
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="perspective">Perspective</SelectItem><SelectItem value="orthographic">Orthographic</SelectItem></SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Rotation
                        <Select value={rotationMode} onValueChange={(value) => { const next = value as RotationMode; setRotationMode(next); viewerRef.current?.setRotationMode(next); }}>
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="fixed-up">Fixed up</SelectItem><SelectItem value="free">Free orbit</SelectItem></SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Display
                        <Select value={displayMode} onValueChange={(value) => { const next = value as DisplayMode; setDisplayMode(next); viewerRef.current?.setDisplayMode(next); }}>
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="solid">Solid</SelectItem><SelectItem value="edges">Edges</SelectItem><SelectItem value="wireframe">Wireframe</SelectItem></SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1 text-[11px] text-muted-foreground">
                        Display units
                        <Select value={displayUnit} onValueChange={(value) => setDisplayUnit(value as DisplayUnitPreference)}>
                          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="auto">Automatic</SelectItem><SelectItem value="mm">Millimetres</SelectItem><SelectItem value="cm">Centimetres</SelectItem><SelectItem value="m">Metres</SelectItem></SelectContent>
                        </Select>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant={gridVisible ? 'secondary' : 'outline'} size="sm" aria-pressed={gridVisible} onClick={toggleGrid}>{gridVisible && <Check />} Grid</Button>
                      <Button variant={infoVisible ? 'secondary' : 'outline'} size="sm" aria-pressed={infoVisible} onClick={toggleInfoPanel}>{infoVisible && <Check />} Model info</Button>
                      <Button variant={treeVisible ? 'secondary' : 'outline'} size="sm" aria-pressed={treeVisible} onClick={toggleScenePanel}>{treeVisible && <Check />} Scene objects</Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="data">
                  <AccordionTrigger>Data &amp; portability</AccordionTrigger>
                  <AccordionContent className="grid gap-3">
                    <div className="grid gap-2">
                      <div>
                        <strong className="text-xs font-semibold">Portable settings</strong>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">Export this JSON beside the portable executable, or import it on another device.</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="outline" size="sm"><RotateCcw /> Reset</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                              <AlertDialogDescription>This restores appearance, viewer, panel, unit, and camera defaults. The open model is not changed.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={resetSettings}>Reset settings</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button variant="outline" size="sm" onClick={() => settingsInputRef.current?.click()}><Upload /> Import</Button>
                        <Button size="sm" onClick={exportSettings}><Download /> Export</Button>
                      </div>
                    </div>
                    <Separator />
                    {windowsNativeShell && (
                      <>
                        <div className="grid gap-2">
                          <div>
                            <strong className="text-xs font-semibold">Windows Explorer thumbnails</strong>
                            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">Show isometric previews for GLB, STL, PLY, STEP, and STP files. Enabled automatically on first Windows launch, repaired after moving the portable folder, and removable here without administrator access.</p>
                            {thumbnailProvider && !thumbnailProvider.available && <p className="mt-1 text-[10px] text-destructive">Keep Kea3DThumbnailProvider.dll beside the portable EXE.</p>}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-pressed={thumbnailProvider?.enabled ?? false}
                            disabled={!thumbnailProvider?.available || changingThumbnailProvider}
                            onClick={() => void toggleThumbnailProvider()}
                          >
                            {changingThumbnailProvider ? 'Updating…' : thumbnailProvider?.enabled ? 'Disable Explorer thumbnails' : 'Enable Explorer thumbnails'}
                          </Button>
                        </div>
                        <Separator />
                      </>
                    )}
                    <div className="grid gap-2">
                      <div>
                        <strong className="text-xs font-semibold">Local CAD cache</strong>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">Kea3D keeps recent STEP, IGES, and BREP tessellations locally to speed up repeat opens. Original files are never stored.</p>
                        <p className="mt-1 text-[10px] font-medium text-foreground">{cadCacheStats.entries === 0 ? 'Cache is empty' : `${cadCacheStats.entries} cached ${cadCacheStats.entries === 1 ? 'model' : 'models'} · ${formatBytes(cadCacheStats.sourceBytes)} source data`}</p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={clearingCadCache}>{clearingCadCache ? 'Clearing…' : 'Clear CAD cache'}</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear the local CAD cache?</AlertDialogTitle>
                            <AlertDialogDescription>Recent STEP, IGES, and BREP files may take longer to open again. Original model files and settings are not removed.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => void clearLocalCadCache()}>Clear cache</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="shortcuts">
                  <AccordionTrigger><span className="flex items-center gap-2"><Keyboard className="size-3.5 text-muted-foreground" />Keyboard shortcuts</span></AccordionTrigger>
                  <AccordionContent className="grid gap-2">
                    <p className="text-[10px] leading-relaxed text-muted-foreground">Available when the viewport has focus. They never replace shortcuts while typing in a field.</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                      {keyboardShortcuts.map(([keys, action]) => <div key={keys} className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{action}</dt><dd><kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[9px] text-foreground">{keys}</kbd></dd></div>)}
                    </dl>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="about">
                  <AccordionTrigger><span className="flex items-center gap-2"><Info className="size-3.5 text-muted-foreground" />About Kea3D</span></AccordionTrigger>
                  <AccordionContent className="grid gap-3">
                    <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                      <img className="size-12 shrink-0" src={`${import.meta.env.BASE_URL}kea3d-icon.svg`} alt="" />
                      <div className="min-w-0">
                        <p className="kea3d-wordmark text-lg font-semibold text-foreground">Kea3D</p>
                        <p className="text-[10px] leading-relaxed text-muted-foreground">Fast, private, local-first 3D and CAD viewer.</p>
                      </div>
                    </div>
                    <dl className="grid gap-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Version</dt><dd className="font-medium tabular-nums">{packageMetadata.version}</dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Edition</dt><dd className="text-right font-medium">Free / Core</dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Processing</dt><dd className="text-right font-medium">Local on this device</dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Core license</dt><dd className="font-medium">MPL 2.0</dd></div>
                    </dl>
                    <div className="grid grid-cols-2 gap-2">
                      <Button asChild variant="outline" size="sm"><a href={productWebsite} target="_blank" rel="noreferrer" onClick={(event) => openExternalLink(event, productWebsite)}><ExternalLink /> Website</a></Button>
                      <Button asChild variant="outline" size="sm"><a href={coreSourceRelease} target="_blank" rel="noreferrer" onClick={(event) => openExternalLink(event, coreSourceRelease)}><Code2 /> Core source</a></Button>
                      <Button variant="outline" size="sm" onClick={() => openLegalDocument('license')}><Scale /> Core license</Button>
                      <Button variant="outline" size="sm" onClick={() => openLegalDocument('thirdParty')}><FileBox /> Third-party</Button>
                    </div>
                    <div className="grid gap-1 text-[10px] leading-relaxed text-muted-foreground">
                      <p>This build contains the MPL-licensed Kea3D Core. No separately licensed Pro features are included.</p>
                      <p>Model files are processed locally and are not uploaded by Kea3D.</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </ResponsivePanel>
          )}

          {modelInfo && infoVisible && (
            <ResponsivePanel
              title={selectionInfo ? 'Selected info' : 'Model info'}
              description={selectionInfo && selectedName ? selectedName : undefined}
              onClose={() => setInfoVisible(false)}
              desktopClassName="absolute bottom-5 left-5 z-20 w-[310px] gap-2 bg-card/90 shadow-2xl backdrop-blur-md"
              contentClassName="grid gap-1"
              titleClassName="text-base"
            >
              <dl className="grid gap-1">
                {infoRows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[94px_minmax(0,1fr)] gap-3 text-xs leading-5">
                    <dt className="text-muted-foreground">{label}</dt><dd className="m-0 [overflow-wrap:anywhere] text-right font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </ResponsivePanel>
          )}

          {modelInfo && treeVisible && (
            <ResponsivePanel
              title="Scene objects"
              description={compactLayout ? 'Select, inspect, and manage model parts' : 'Ctrl-click to add · Shift-click for a range'}
              onClose={() => setTreeVisible(false)}
              desktopClassName={cn(
                'absolute top-20 left-5 z-20 w-[310px] gap-3 bg-card/92 shadow-2xl backdrop-blur-md',
                infoVisible ? 'h-[calc(100%_-_330px)]' : 'h-[calc(100%_-_100px)]',
              )}
              compactMode="workspace"
              compactHeight={compactSceneHeight}
              compactWorkspaceExpanded={sceneWorkspaceExpanded}
              onCompactWorkspaceExpandedChange={setSceneWorkspaceExpanded}
              contentClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
            >
                {selectionInfo && selectedName && (
                  <>
                    <section aria-label="Selection details" className="grid gap-2 rounded-xl border bg-muted/35 p-2.5">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block text-[10px] text-muted-foreground">Selected</span>
                          <strong className="block truncate text-xs font-semibold" title={selectedName}>{selectedName}</strong>
                        </div>
                        <Button variant="outline" size="sm" className="shrink-0" onClick={() => viewerRef.current?.fitSelection()}><Focus /> Fit</Button>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] leading-4">
                        <div><dt className="text-muted-foreground">Meshes</dt><dd className="font-semibold tabular-nums">{formatNumber(selectionInfo.meshes)}</dd></div>
                        <div><dt className="text-muted-foreground">Materials</dt><dd className="font-semibold tabular-nums">{formatNumber(selectionInfo.materials)}</dd></div>
                        <div><dt className="text-muted-foreground">Triangles</dt><dd className="font-semibold tabular-nums">{formatNumber(selectionInfo.triangles)}</dd></div>
                        <div><dt className="text-muted-foreground">Vertices</dt><dd className="font-semibold tabular-nums">{formatNumber(selectionInfo.vertices)}</dd></div>
                        <div className="col-span-2"><dt className="text-muted-foreground">Dimensions</dt><dd className="font-semibold tabular-nums">{formatMetricDimensions(selectionInfo.dimensions, displayUnit)}</dd></div>
                      </dl>
                    </section>
                    <Separator />
                  </>
                )}
                <div className="grid gap-1">
                  <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Exploded view</span><span className="tabular-nums">{Math.round(explodeFactor * 100)}%</span></div>
                  <Slider aria-label="Exploded view amount" min={0} max={100} step={1} value={[explodeFactor * 100]} onValueChange={changeExplosion} />
                </div>
                <Separator />
                <ScrollArea className="min-h-0 flex-1 pr-2">
                  {sceneTree.map((node) => (
                    <SceneTreeItem key={node.id} depth={0} node={node} onSelect={selectObject} onVisibility={toggleObjectVisibility} selectedIds={selectedIdSet} primarySelectedId={selectedId} />
                  ))}
                </ScrollArea>
            </ResponsivePanel>
          )}

          {modelInfo && measurementVisible && (
            <ResponsivePanel
              title="Measure"
              description="Surface point-to-point · automatic units"
              onClose={closeMeasurement}
              desktopClassName="absolute top-20 right-5 z-20 w-[310px] gap-3 bg-card/92 shadow-2xl backdrop-blur-md"
              compactMode="workspace"
              compactHeight={compactMeasurementHeight}
              contentClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
            >
                <div className="rounded-xl border bg-muted/35 p-3">
                  <p className="text-[10px] text-muted-foreground">Distance</p>
                  <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{measurementValue ?? '—'}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{measurementInstruction}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" disabled={measurement.pointCount === 0} onClick={clearMeasurement}><RotateCcw /> Clear</Button>
                  <Button size="sm" disabled={!measurementValue} onClick={() => void copyMeasurement()}>{measurementCopied ? <Check /> : <Copy />} {measurementCopied ? 'Copied' : 'Copy'}</Button>
                </div>
            </ResponsivePanel>
          )}

          {modelInfo && adjustVisible && (
            <ResponsivePanel
              title="Adjust model"
              description="Reversible orientation and placement corrections"
              onClose={closeAdjustPanel}
              desktopClassName="absolute top-20 right-5 z-20 w-[310px] gap-3 bg-card/92 shadow-2xl backdrop-blur-md"
              compactMode="workspace"
              compactHeight={compactAdjustHeight}
              compactWorkspaceExpanded={adjustWorkspaceExpanded}
              onCompactWorkspaceExpandedChange={setAdjustWorkspaceExpanded}
              contentClassName="grid min-h-0 gap-3 overflow-y-auto"
            >
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-[11px] text-muted-foreground">
                    Source units
                    <Select value={sourceUnit} onValueChange={(value) => changeSourceUnit(value as LinearUnit)}>
                      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="um">Micrometres (µm)</SelectItem><SelectItem value="mm">Millimetres (mm)</SelectItem><SelectItem value="cm">Centimetres (cm)</SelectItem>
                        <SelectItem value="m">Metres (m)</SelectItem><SelectItem value="in">Inches (in)</SelectItem><SelectItem value="ft">Feet (ft)</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1 text-[11px] text-muted-foreground">
                    Source up axis
                    <Select value={upAxis} onValueChange={(value) => changeUpAxis(value as UpAxis)}>
                      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="y">Y up</SelectItem><SelectItem value="z">Z up</SelectItem><SelectItem value="x">X up</SelectItem></SelectContent>
                    </Select>
                  </label>
                  <label className="col-span-2 grid gap-1 text-[11px] text-muted-foreground">
                    Source forward direction
                    <Select value={forwardAxis} onValueChange={(value) => changeForwardAxis(value as ForwardAxis)}>
                      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {forwardAxes.filter((axis) => isForwardAxisCompatible(upAxis, axis)).map((axis) => (
                          <SelectItem key={axis} value={axis}>{axis.startsWith('-') ? '−' : '+'}{axis.at(-1)?.toUpperCase()} forward</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <div className="rounded-xl border bg-muted/25 px-3 py-2">
                  <p className="text-[10px] font-medium">Base unit conversion</p>
                  <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{sourceUnitConversionText[sourceUnit]}</p>
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">Choose the units, Up axis, and semantic front used when the model was authored. Kea3D converts length to metres, then maps orientation to +Y Up and +Z Forward.</p>
                <Separator />
                <section aria-label="Known dimension calibration" className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-medium">Calibrate by known dimension</p>
                    <span className="text-[10px] font-medium tabular-nums text-muted-foreground">{formatScaleFactor(adjustmentScale)}</span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">Enter one known dimension. The reference may be selected geometry, but the resulting uniform scale always applies to the whole model.</p>
                  <div className={cn('rounded-xl border px-3 py-2 text-[10px]', selectionInfo ? 'border-primary/45 bg-primary/10' : 'bg-muted/25')}>
                    <span className="text-muted-foreground">Reference</span>
                    <strong className="ml-1 font-semibold">{selectionInfo ? selectedName : 'Entire model'}</strong>
                  </div>
                  <label className="grid gap-1 text-[11px] text-muted-foreground">
                    Dimension
                    <Select value={calibrationAxis} onValueChange={(value) => setCalibrationAxis(value as 'x' | 'y' | 'z')}>
                      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="x">Width (X)</SelectItem>
                        <SelectItem value="y">Height (Y)</SelectItem>
                        <SelectItem value="z">Depth (Z)</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
                    <label className="grid gap-1 text-[11px] text-muted-foreground">
                      Known size
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={calibrationValue}
                        placeholder="e.g. 125"
                        aria-label="Known dimension value"
                        onChange={(event) => setCalibrationValue(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-[11px] text-muted-foreground">
                      Unit
                      <Select value={calibrationUnit} onValueChange={(value) => setCalibrationUnit(value as LinearUnit)}>
                        <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="um">µm</SelectItem><SelectItem value="mm">mm</SelectItem><SelectItem value="cm">cm</SelectItem>
                          <SelectItem value="m">m</SelectItem><SelectItem value="in">in</SelectItem><SelectItem value="ft">ft</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>Current {calibrationAxis.toUpperCase()}</span>
                    <span className="font-medium tabular-nums text-foreground">{Number(calibrationCurrentValue.toPrecision(6))} {linearUnitSymbols[calibrationUnit]}</span>
                  </div>
                  <Button variant="secondary" size="sm" disabled={!calibrationValid} onClick={applyKnownDimensionCalibration}><Ruler /> Apply calibration</Button>
                </section>
                <Separator />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => updateDimensions(viewerRef.current?.centerModel() ?? [0, 0, 0])}><Move3D /> Center origin</Button>
                  <Button variant="outline" size="sm" onClick={() => updateDimensions(viewerRef.current?.groundModel() ?? [0, 0, 0])}><Move3D /> Place on ground</Button>
                  <Button variant="ghost" size="sm" className="col-span-2" onClick={resetAdjustments}><RotateCcw /> Reset adjustments</Button>
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">These corrections remain reversible. Use the separate Export tool when you want a new output file.</p>
            </ResponsivePanel>
          )}

          {modelInfo && exportVisible && (
            <ResponsivePanel
              title="Export"
              description="Create a new binary glTF copy"
              onClose={() => setExportVisible(false)}
              desktopClassName="absolute top-20 right-5 z-20 w-[330px] gap-3 bg-card/92 shadow-2xl backdrop-blur-md"
              contentClassName="grid gap-3"
            >
              <div className="flex items-center justify-between rounded-xl border bg-muted/25 p-3">
                <div>
                  <p className="text-xs font-medium">Binary glTF</p>
                  <p className="text-[10px] text-muted-foreground">Single-file .glb</p>
                </div>
                <span className="rounded-md border bg-background px-2 py-1 text-[10px] font-semibold">GLB</span>
              </div>
              <div className="grid gap-1.5">
                <span className="text-[11px] text-muted-foreground">Objects</span>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" aria-pressed={exportScope === 'all'} onClick={() => setExportScope('all')}>All objects</Button>
                  <Button variant="outline" size="sm" aria-pressed={exportScope === 'visible'} onClick={() => setExportScope('visible')}>Visible only</Button>
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  {exportScope === 'visible'
                    ? 'Exports only objects currently visible in Scene objects, including the current isolate result.'
                    : 'Exports the complete model, including objects currently hidden in the viewer.'}
                </p>
              </div>
              <Separator />
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span>
                  <span className="block text-xs font-medium">Include animations</span>
                  <span className="block text-[10px] text-muted-foreground">{animations.length > 0 ? `${animations.length} embedded ${animations.length === 1 ? 'clip' : 'clips'}` : 'No embedded animation clips'}</span>
                </span>
                <Switch checked={exportAnimations && animations.length > 0} disabled={animations.length === 0} onCheckedChange={setExportAnimations} aria-label="Include animations" />
              </label>
              <Button disabled={exporting} onClick={() => void exportCorrectedGlb()}><Download /> {exporting ? 'Exporting…' : 'Export GLB'}</Button>
              <p className="text-[10px] leading-relaxed text-muted-foreground">Includes hierarchy, current transforms, and applied materials. Selection highlights, grid, section cut, and exploded-view spacing are not baked. The source file is never overwritten.</p>
            </ResponsivePanel>
          )}

          {modelInfo && animationVisible && activeAnimation && (
            <ResponsivePanel
              title="Animations"
              description={`${animations.length} ${animations.length === 1 ? 'clip' : 'clips'} embedded in this model`}
              onClose={() => setAnimationVisible(false)}
              desktopClassName="absolute top-20 right-5 z-20 w-[310px] gap-3 bg-card/92 shadow-2xl backdrop-blur-md"
              compactMode="workspace"
              compactHeight={compactAnimationHeight}
              contentClassName="grid min-h-0 gap-3 overflow-y-auto"
            >
                <Select value={String(animationIndex)} onValueChange={(value) => selectAnimation(Number(value))}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Animation clip"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {animations.map((clip, index) => <SelectItem key={`${clip.name}-${index}`} value={String(index)}>{clip.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="grid gap-1.5">
                  <Slider aria-label="Animation timeline" min={0} max={Math.max(activeAnimation.duration, 0.001)} step={0.01} value={[Math.min(animationTime, activeAnimation.duration)]} onValueChange={(values) => viewerRef.current?.seekAnimation(values[0] ?? 0)} />
                  <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{formatTime(animationTime)}</span><span>{formatTime(activeAnimation.duration)}</span></div>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr_82px] gap-1.5">
                  <Button variant="secondary" size="sm" aria-label="Restart animation" onClick={() => viewerRef.current?.resetAnimation()}><RotateCcw /></Button>
                  <Button variant="secondary" size="sm" aria-label={animationPlaying ? 'Pause animation' : 'Play animation'} onClick={toggleAnimationPlayback}>{animationPlaying ? <Pause /> : <Play />}</Button>
                  <Button variant={animationLoop ? 'default' : 'secondary'} size="sm" aria-label="Loop animation" aria-pressed={animationLoop} onClick={changeAnimationLoop}><Repeat2 /></Button>
                  <Select value={String(animationSpeed)} onValueChange={(value) => changeAnimationSpeed(Number(value))}>
                    <SelectTrigger size="sm" className="w-full" aria-label="Playback speed"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="0.25">0.25×</SelectItem><SelectItem value="0.5">0.5×</SelectItem><SelectItem value="1">1×</SelectItem><SelectItem value="1.5">1.5×</SelectItem><SelectItem value="2">2×</SelectItem></SelectContent>
                  </Select>
                </div>
            </ResponsivePanel>
          )}

          {modelInfo && sectionVisible && (
            <ResponsivePanel
              title="Section cut"
              description="Inspect the model interior without changing the file"
              onClose={() => setSectionVisible(false)}
              desktopClassName="absolute top-20 right-5 z-20 w-[310px] gap-3 bg-card/92 shadow-2xl backdrop-blur-md"
              compactMode="workspace"
              compactHeight={compactSectionHeight}
              contentClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
            >
                <Button
                  variant={sectionEnabled ? 'default' : 'secondary'}
                  size="sm"
                  aria-pressed={sectionEnabled}
                  onClick={() => updateSection(!sectionEnabled)}
                >
                  <ScissorsLineDashed /> {sectionEnabled ? 'Section enabled' : 'Enable section'}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-[11px] text-muted-foreground">
                    Cut axis
                    <Select value={sectionAxis} onValueChange={(value) => updateSection(sectionEnabled, value as UpAxis)}>
                      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="x">X axis</SelectItem><SelectItem value="y">Y axis</SelectItem><SelectItem value="z">Z axis</SelectItem></SelectContent>
                    </Select>
                  </label>
                  <div className="grid gap-1 text-[11px] text-muted-foreground">
                    <span>Direction</span>
                    <Button variant="outline" size="sm" disabled={!sectionEnabled} onClick={() => updateSection(sectionEnabled, sectionAxis, sectionPosition, !sectionFlipped)}>
                      <FlipHorizontal2 /> Flip side
                    </Button>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Plane position</span><span className="tabular-nums">{Math.round(sectionPosition * 100)}%</span></div>
                  <Slider
                    aria-label="Section plane position"
                    min={0}
                    max={100}
                    step={1}
                    disabled={!sectionEnabled}
                    value={[sectionPosition * 100]}
                    onValueChange={(values) => updateSection(sectionEnabled, sectionAxis, (values[0] ?? 50) / 100)}
                  />
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">The cut is visual only. Screenshots include the current view, while saved GLB geometry remains complete.</p>
            </ResponsivePanel>
          )}

          {dragging && (
            <div className="absolute inset-2 z-40 grid place-items-center rounded-2xl border border-dashed border-primary bg-background/80 backdrop-blur-sm">
              <div className="flex flex-col gap-1.5 text-center"><strong className="text-xl">Drop to open</strong><span className="text-sm text-muted-foreground">Supported mesh, scene, or CAD model</span></div>
            </div>
          )}

          {(progress || !nativeStartupResolved) && (
            <div className="absolute inset-0 z-50 grid place-items-center bg-background/40 backdrop-blur-[3px]" role="status" aria-live="polite">
              <Card className="w-[min(370px,calc(100%_-_40px))] gap-3 p-4 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="size-8 animate-spin rounded-full border border-border border-t-primary" />
                  <div className="min-w-0">
                    <strong className="block text-sm">{progress ? stageLabels[progress.stage] : 'Starting Kea3D'}</strong>
                    <span className="block truncate text-xs text-muted-foreground">{loadingName ?? 'Checking for a file to open…'}</span>
                  </div>
                </div>
                <Progress value={progress?.value === undefined ? 32 : progress.value * 100} className={cn(progress?.value === undefined && 'animate-pulse')} />
                {progress && loadingNotice && <p className="text-[11px] leading-relaxed text-muted-foreground">{loadingNotice}</p>}
                {progress && !readingNativeFile && <Button variant="outline" size="sm" onClick={cancelLoad}><X /> Cancel</Button>}
              </Card>
            </div>
          )}

        </section>
      </main>
      <Sheet open={legalDocument !== null} onOpenChange={(open) => { if (!open) setLegalDocument(null); }}>
        <SheetContent
          side={compactLayout ? 'bottom' : 'right'}
          className={cn(
            'min-w-0 gap-0 overflow-hidden',
            compactLayout ? 'h-[85dvh] rounded-t-2xl border-x' : 'w-[min(620px,90vw)] sm:max-w-[620px]',
          )}
          style={compactLayout ? { height: 'min(85dvh, 48rem)' } : undefined}
        >
          <SheetHeader className="shrink-0 border-b pr-12">
            <SheetTitle>{legalDocument ? legalDocuments[legalDocument].title : 'Legal document'}</SheetTitle>
            <SheetDescription>{legalDocument ? legalDocuments[legalDocument].description : undefined}</SheetDescription>
          </SheetHeader>
          <div
            data-testid="legal-document-scroll"
            role="region"
            aria-label="Legal document"
            tabIndex={0}
            className="min-h-0 min-w-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-scroll overscroll-contain [scrollbar-gutter:stable]"
          >
            <pre className="m-0 w-full min-w-0 max-w-full whitespace-pre-wrap p-4 pr-6 font-mono text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {legalDocumentContent}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
      <Toaster theme={theme} position="bottom-right" closeButton />
    </TooltipProvider>
  );
}
