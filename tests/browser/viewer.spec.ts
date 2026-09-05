import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function triangleModel(
  includeSecondPart = false,
  duplicateMaterialRecords = false,
  anchors: Array<{ id: string; x: number; legacy?: boolean }> = [],
): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(6);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const binary = Buffer.concat([positions, indices]);
  const gltf = {
    asset: { version: '2.0', generator: 'Kea3D browser test' },
    scene: 0,
    scenes: [{ nodes: Array.from({ length: 1 + (includeSecondPart ? 1 : 0) + anchors.length }, (_, index) => index) }],
    nodes: [
      { name: 'Test triangle', mesh: 0 },
      ...(includeSecondPart ? [{ name: 'Other triangle', mesh: duplicateMaterialRecords ? 1 : 0, translation: [2, 0, 0] }] : []),
      ...anchors.map((anchor) => ({
        name: anchor.id,
        translation: [anchor.x, 0, 0],
        ...(!anchor.legacy && { extras: { kea3d: { anchor: { id: anchor.id, version: 1 } } } }),
      })),
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
      ...(duplicateMaterialRecords ? [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 1 }] }] : []),
    ],
    materials: [
      { name: 'Test red A', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.1, 0.1, 1] } },
      ...(duplicateMaterialRecords ? [{ name: 'Test red B', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.1, 0.1, 1] } }] : []),
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - (json.byteLength % 4)) % 4, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - (binary.byteLength % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedJson.byteLength + 8 + paddedBinary.byteLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(paddedBinary.byteLength, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, paddedBinary]);
}

function embeddedTextureModel(): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const texcoords = Buffer.alloc(24);
  [0, 0, 1, 0, 0, 1].forEach((value, index) => texcoords.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(6);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAHYcAAB2HAY/l8WUAAAANSURBVBhXY/jPwPAfAAUAAf+mXJtdAAAAAElFTkSuQmCC', 'base64');
  const binary = Buffer.concat([positions, texcoords, indices, image]);
  const gltf = {
    asset: { version: '2.0', generator: 'Kea3D embedded-texture browser test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Textured triangle', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Embedded texture', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: texcoords.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength + texcoords.byteLength, byteLength: indices.byteLength, target: 34963 },
      { buffer: 0, byteOffset: positions.byteLength + texcoords.byteLength + indices.byteLength, byteLength: image.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - (json.byteLength % 4)) % 4, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - (binary.byteLength % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedJson.byteLength + 8 + paddedBinary.byteLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(paddedBinary.byteLength, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, paddedBinary]);
}

function externalTriangleModel(): { gltf: Buffer; binary: Buffer } {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(6);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const binary = Buffer.concat([positions, indices]);
  return {
    gltf: Buffer.from(JSON.stringify({
      asset: { version: '2.0', generator: 'Kea3D nested companion browser test' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Nested external triangle', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ uri: '../shared/geometry.bin', byteLength: binary.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
        { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    })),
    binary,
  };
}

function glbJson(buffer: Buffer): Record<string, unknown> {
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
  const jsonLength = buffer.readUInt32LE(12);
  expect(buffer.readUInt32LE(16)).toBe(0x4e4f534a);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trim()) as Record<string, unknown>;
}

function minimalThreeMf(): Buffer {
  const archive = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" name="3MF triangle" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'),
  });
  return Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
}

function binaryStlTriangle(): Buffer {
  const result = Buffer.alloc(84 + 50);
  result.write('Kea3D binary STL fixture', 0, 'ascii');
  result.writeUInt32LE(1, 80);
  [0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((value, index) => {
    result.writeFloatLE(value, 84 + index * 4);
  });
  return result;
}

function binaryPlyTriangle(): Buffer {
  const header = Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n');
  const body = Buffer.alloc(3 * 15 + 13);
  const vertices: Array<[number, number, number, number, number, number]> = [
    [0, 0, 0, 255, 0, 0],
    [10, 0, 0, 0, 255, 0],
    [0, 10, 0, 0, 0, 255],
  ];
  vertices.forEach((vertex, vertexIndex) => {
    const offset = vertexIndex * 15;
    body.writeFloatLE(vertex[0], offset);
    body.writeFloatLE(vertex[1], offset + 4);
    body.writeFloatLE(vertex[2], offset + 8);
    body.writeUInt8(vertex[3], offset + 12);
    body.writeUInt8(vertex[4], offset + 13);
    body.writeUInt8(vertex[5], offset + 14);
  });
  body.writeUInt8(3, 45);
  body.writeInt32LE(0, 46);
  body.writeInt32LE(1, 50);
  body.writeInt32LE(2, 54);
  return Buffer.concat([header, body]);
}

const meshFormatCases: Array<{
  label: string;
  expectedName: RegExp;
  files: Parameters<Locator['setInputFiles']>[0];
}> = [
  {
    label: 'ASCII STL',
    expectedName: /Open another model.*format-triangle\.stl/,
    files: {
      name: 'format-triangle.stl',
      mimeType: 'model/stl',
      buffer: Buffer.from('solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid triangle'),
    },
  },
  {
    label: 'ASCII PLY with vertex colors',
    expectedName: /Open another model.*format-triangle\.ply/,
    files: {
      name: 'format-triangle.ply',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 255 0 0\n10 0 0 0 255 0\n0 10 0 0 0 255\n3 0 1 2'),
    },
  },
  {
    label: 'binary STL',
    expectedName: /Open another model.*format-triangle-binary\.stl/,
    files: {
      name: 'format-triangle-binary.stl',
      mimeType: 'model/stl',
      buffer: binaryStlTriangle(),
    },
  },
  {
    label: 'binary little-endian PLY with vertex colors',
    expectedName: /Open another model.*format-triangle-binary\.ply/,
    files: {
      name: 'format-triangle-binary.ply',
      mimeType: 'application/octet-stream',
      buffer: binaryPlyTriangle(),
    },
  },
  {
    label: 'OBJ with MTL companion',
    expectedName: /Open another model.*format-triangle\.obj/,
    files: [
      {
        name: 'format-triangle.obj',
        mimeType: 'text/plain',
        buffer: Buffer.from('mtllib format-triangle.mtl\no Triangle\nusemtl TestRed\nv 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3'),
      },
      {
        name: 'format-triangle.mtl',
        mimeType: 'text/plain',
        buffer: Buffer.from('newmtl TestRed\nKd 0.8 0.1 0.1\nNs 32'),
      },
    ],
  },
  {
    label: '3MF package',
    expectedName: /Open another model.*format-triangle\.3mf/,
    files: {
      name: 'format-triangle.3mf',
      mimeType: 'model/3mf',
      buffer: minimalThreeMf(),
    },
  },
];

async function openTestModel(page: Page, includeSecondPart = false, duplicateMaterialRecords = false): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'test-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: triangleModel(includeSecondPart, duplicateMaterialRecords),
  });
  await expect(page.getByRole('button', { name: /Open another model.*test-triangle\.glb/ })).toBeVisible();
}

async function openAnimatedTestModel(page: Page): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(resolve('tests/fixtures/AnimatedMorphCube.glb'));
  await expect(page.getByRole('button', { name: /Open another model.*AnimatedMorphCube\.glb/ })).toBeVisible();
}

type LoadMetricDetail = {
  fileName: string;
  status: string;
  renderer?: {
    geometries: number;
    textures: number;
    programs: number;
  };
};

async function loadWithMetric(
  page: Page,
  files: Parameters<Locator['setInputFiles']>[0],
): Promise<LoadMetricDetail> {
  const metric = page.evaluate(() => new Promise<LoadMetricDetail>((resolveMetric) => {
    globalThis.addEventListener('kea3d:load-metric', (event) => {
      resolveMetric((event as CustomEvent<LoadMetricDetail>).detail);
    }, { once: true });
  }));
  await page.locator('input[type="file"]').first().setInputFiles(files);
  return metric;
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, results.violations.map((violation) => (
    `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`
  )).join('\n')).toEqual([]);
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`scene list keeps space after first selection at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await openTestModel(page);
    const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
    await toolbar.getByRole('button', { name: 'Scene objects' }).click();
    const workspace = page.getByRole('complementary', { name: 'Scene objects' });
    const part = workspace.getByRole('button', { name: 'Test_triangle', exact: true });
    const before = await part.boundingBox();
    await part.click();
    const after = await part.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    const list = workspace.locator('[data-slot="scroll-area-viewport"]');
    expect((await list.boundingBox())!.height).toBeGreaterThan(75);
    if (viewport.width > viewport.height) {
      const panel = (await workspace.boundingBox())!;
      const canvas = (await page.locator('canvas[aria-label="3D model viewport"]').boundingBox())!;
      expect(canvas.x + canvas.width).toBeLessThanOrEqual(panel.x + 2);
      expect(panel.height).toBeGreaterThan(300);
    }
    await part.dblclick();
    await expect(page.getByRole('complementary', { name: 'Selected info' })).toBeVisible();
    await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
  });
}

for (const [width, height] of [[280, 568], [320, 568], [390, 844], [844, 390], [1023, 600], [1024, 600], [1280, 720], [1535, 864], [1536, 864], [1920, 1080]]) {
  test(`shared toolbar fits and stays separate from file header at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.locator('input[type="file"]').first().setInputFiles({ name: `${'Long-model-name-'.repeat(12)}.glb`, mimeType: 'model/gltf-binary', buffer: triangleModel() });
    const toolbar = page.getByRole('toolbar', { name: width < 1024 ? 'Mobile viewer tools' : 'Viewer tools', exact: true });
    await expect(toolbar.getByRole('button', { name: 'Scene objects' })).toBeVisible();
    const bar = (await toolbar.boundingBox())!;
    const header = (await page.getByRole('button', { name: /Open another model/ }).boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(width);
    expect(bar.y >= header.y + header.height || bar.x >= header.x + header.width).toBe(true);
    for (const button of await toolbar.getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const fit = toolbar.getByRole('button', { name: 'Fit model' });
    await fit.focus();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button', { name: 'View selector' })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('toolbar-layout.png') });
  });
}

test('material preview survives compact tool switching and Fit', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openTestModel(page);
  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'Scene objects' }).click();
  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Set material' }).click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Fit model' }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Lighting', exact: true }).click();
  await expect(page.getByText('Material preview · not applied')).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Red', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog', { name: 'More viewer tools' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('live-material-toolbar.png') });
  await expectNoAccessibilityViolations(page);
});

test('primary button text retains contrast across accents and hover states', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: '* { transition: none !important; }' });
  for (const dark of [false, true]) {
    for (const accent of ['lime', 'blue', 'cyan', 'orange', 'violet']) {
      await page.evaluate(({ dark, accent }) => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.dataset.accent = accent;
      }, { dark, accent });
      const button = page.getByRole('button', { name: 'Choose files', exact: true });
      for (const hover of [false, true]) {
        if (hover) await button.hover(); else await page.mouse.move(0, 0);
        const result = await new AxeBuilder({ page }).include('section[aria-label="Open a model"]')
          .withRules(['color-contrast']).analyze();
        expect(result.violations, `${dark ? 'dark' : 'light'} ${accent} hover=${hover}`).toEqual([]);
      }
    }
  }
});

test('empty viewer presents one clear local-file action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open a 3D model' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open project folder' })).toBeVisible();
  await expect(page.locator('input[aria-label="Choose Kea3D project folder"]')).toHaveAttribute('webkitdirectory', '');
  await expect(page.getByText('Processed locally · Nothing is uploaded')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const aboutTrigger = page.getByRole('button', { name: 'About Kea3D' });
  await aboutTrigger.hover();
  await expect(aboutTrigger).toHaveCSS('text-decoration-line', 'none');
  await aboutTrigger.click();
  await expect(page.getByText(/^0\.1\.\d+$/)).toBeVisible();
  const websiteLink = page.getByRole('link', { name: 'Website' });
  await expect(websiteLink).toHaveAttribute('href', 'https://kea3d.com');
  await expect(websiteLink).toHaveCSS('text-decoration-line', 'none');
  await expect(page.getByText('Free / Core')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Source pending' })).toBeDisabled();
  await expect(page.getByText('Internal candidate: matching source publication and distribution review are pending.')).toBeVisible();
  await page.getByRole('button', { name: 'Core license' }).click();
  const licenseDialog = page.getByRole('dialog');
  await expect(licenseDialog.getByText(/Mozilla Public License Version 2\.0/)).toBeVisible();
  const legalViewport = licenseDialog.getByTestId('legal-document-scroll');
  const initialScrollMetrics = await legalViewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
  }));
  expect(initialScrollMetrics.scrollHeight).toBeGreaterThan(initialScrollMetrics.clientHeight);
  expect(initialScrollMetrics.scrollWidth).toBeLessThanOrEqual(initialScrollMetrics.clientWidth + 1);
  await legalViewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => legalViewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await licenseDialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Third-party' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Third-party notices' })).toBeVisible();
  await expect(page.getByTestId('legal-document-scroll')).toContainText('Third-party license texts');
  await expect(page.getByTestId('legal-document-scroll')).toContainText('Android Rust dependency texts');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.setViewportSize({ width: 800, height: 600 });
  const compactSettingsDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
  await expect(compactSettingsDialog).toHaveAttribute('data-side', 'bottom');
  const compactSettingsScroll = compactSettingsDialog.getByTestId('responsive-panel-scroll');
  await expect.poll(() => compactSettingsScroll.evaluate((element) => (
    element.getBoundingClientRect().bottom
  ))).toBeLessThanOrEqual(600);
  const compactSettingsMetrics = await compactSettingsScroll.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      bottom: bounds.bottom,
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      top: bounds.top,
    };
  });
  expect(compactSettingsMetrics.top).toBeGreaterThanOrEqual(0);
  expect(compactSettingsMetrics.bottom).toBeLessThanOrEqual(600);
  expect(compactSettingsMetrics.overflowY).toBe('auto');
  expect(compactSettingsMetrics.scrollHeight).toBeGreaterThan(compactSettingsMetrics.clientHeight);
  await compactSettingsScroll.evaluate((element) => { element.scrollTop = 0; });
  await compactSettingsScroll.hover({ position: { x: 20, y: 40 } });
  await page.mouse.wheel(0, 900);
  await expect.poll(() => compactSettingsScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const compactAboutTrigger = compactSettingsDialog.getByRole('button', { name: 'About Kea3D' });
  await compactAboutTrigger.scrollIntoViewIfNeeded();
  if (await compactAboutTrigger.getAttribute('aria-expanded') === 'true') {
    await compactAboutTrigger.click();
    await expect(compactAboutTrigger).toHaveAttribute('aria-expanded', 'false');
  }
  const scrollHeightBeforeAbout = await compactSettingsScroll.evaluate((element) => element.scrollHeight);
  await compactAboutTrigger.click();
  await expect(compactAboutTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => compactSettingsScroll.evaluate((element) => element.scrollHeight)).toBeGreaterThan(scrollHeightBeforeAbout + 250);
  const compactAboutCopy = compactSettingsDialog.getByText('No separately licensed Pro features are included.');
  await expect.poll(async () => {
    await compactSettingsScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    return compactAboutCopy.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= globalThis.innerHeight;
    });
  }).toBe(true);
  const compactLicenseButton = compactSettingsDialog.getByRole('button', { name: 'Core license' });
  await compactLicenseButton.scrollIntoViewIfNeeded();
  await compactLicenseButton.click();
  const compactLicenseDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Kea3D Core license' }) });
  const compactLegalViewport = compactLicenseDialog.getByTestId('legal-document-scroll');
  await expect(compactLegalViewport).toBeVisible();
  const compactMetrics = await compactLegalViewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(compactMetrics.clientHeight).toBeGreaterThan(200);
  expect(compactMetrics.scrollHeight).toBeGreaterThan(compactMetrics.clientHeight);
  await compactLicenseDialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('No separately licensed Pro features are included.')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 480 });
  const phoneBounds = await compactSettingsDialog.boundingBox();
  expect(phoneBounds).not.toBeNull();
  expect(phoneBounds!.y).toBeGreaterThanOrEqual(0);
  expect(phoneBounds!.y + phoneBounds!.height).toBeLessThanOrEqual(480);
  await compactSettingsDialog.getByRole('button', { name: 'Close' }).click();
  await expect(compactSettingsDialog).toBeHidden();
});

test('embedded GLB textures load under the application content security policy', async ({ page }) => {
  const loaderErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /texture|Content Security Policy/i.test(message.text())) {
      loaderErrors.push(message.text());
    }
  });
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'embedded-texture.glb',
    mimeType: 'model/gltf-binary',
    buffer: embeddedTextureModel(),
  });
  await expect(page.getByRole('button', { name: /Open another model.*embedded-texture\.glb/ })).toBeVisible();
  await page.waitForTimeout(250);
  expect(loaderErrors).toEqual([]);
});

test('repeated model replacement releases obsolete renderer resources', async ({ page }) => {
  await page.goto('/');
  const snapshots: LoadMetricDetail[] = [];

  for (let index = 0; index < 4; index += 1) {
    snapshots.push(await loadWithMetric(page, {
      name: `replacement-textured-${index}.glb`,
      mimeType: 'model/gltf-binary',
      buffer: embeddedTextureModel(),
    }));
    snapshots.push(await loadWithMetric(page, {
      name: `replacement-simple-${index}.glb`,
      mimeType: 'model/gltf-binary',
      buffer: triangleModel(),
    }));
  }

  snapshots.forEach((snapshot) => {
    expect(snapshot.status, snapshot.fileName).toBe('success');
    expect(snapshot.renderer, snapshot.fileName).toBeDefined();
  });
  const simpleSnapshots = snapshots.filter((snapshot) => snapshot.fileName.includes('-simple-'));
  const stableSimpleSnapshots = simpleSnapshots.slice(1).map((snapshot) => snapshot.renderer!);
  const baseline = stableSimpleSnapshots[0];
  stableSimpleSnapshots.forEach((snapshot) => {
    expect(snapshot.geometries).toBe(baseline.geometries);
    expect(snapshot.textures).toBe(baseline.textures);
    expect(snapshot.programs).toBe(baseline.programs);
  });
});

for (const formatCase of meshFormatCases) {
  test(`${formatCase.label} passes the production import gate`, async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').first().setInputFiles(formatCase.files);
    await expect(page.getByRole('button', { name: formatCase.expectedName })).toBeVisible();
    await expect(page.getByText('The model does not contain renderable triangle geometry.')).toHaveCount(0);
  });
}

test('nested GLTF companion paths resolve relative to the selected main file', async ({ page }) => {
  const model = externalTriangleModel();
  await page.goto('/');
  const selectedPaths = await page.locator('input[type="file"]').first().evaluate((input, payload) => {
    const transfer = new DataTransfer();
    for (const entry of payload) {
      const bytes = Uint8Array.from(atob(entry.base64), (character) => character.charCodeAt(0));
      const selectedFile = new File([bytes], entry.name, { type: entry.mimeType });
      transfer.items.add(selectedFile);
      const transferredFile = transfer.files.item(transfer.files.length - 1);
      if (!transferredFile) throw new Error('The browser did not retain the selected test file.');
      Object.defineProperty(transferredFile, 'webkitRelativePath', { value: entry.relativePath });
    }
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return Array.from(transfer.files, (file) => file.webkitRelativePath);
  }, [
    {
      name: 'model.gltf',
      relativePath: 'product/models/car/model.gltf',
      mimeType: 'model/gltf+json',
      base64: model.gltf.toString('base64'),
    },
    {
      name: 'geometry.bin',
      relativePath: 'product/models/shared/geometry.bin',
      mimeType: 'application/octet-stream',
      base64: model.binary.toString('base64'),
    },
    {
      name: 'geometry.bin',
      relativePath: 'product/variants/geometry.bin',
      mimeType: 'application/octet-stream',
      base64: Buffer.alloc(model.binary.byteLength).toString('base64'),
    },
  ]);

  expect(selectedPaths).toEqual([
    'product/models/car/model.gltf',
    'product/models/shared/geometry.bin',
    'product/variants/geometry.bin',
  ]);
  await expect(page.getByRole('button', { name: /Open another model.*model\.gltf/ })).toBeVisible();
  await expect(page.getByText('More than one selected companion file')).toHaveCount(0);
});

test('STEP passes the production WebAssembly import gate', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(
    resolve('node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp'),
  );
  await expect(page.getByRole('button', { name: /Open another model.*cube\.stp/ })).toBeVisible();
  await expect(page.getByText('The model does not contain renderable triangle geometry.')).toHaveCount(0);
});

test('web project folder selection preserves relative paths and opens its manifest', async ({ page }) => {
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open project folder' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(resolve('tests/fixtures'));
  await expect(page.getByRole('button', { name: /Open another model.*animated\.kea3d/ })).toBeVisible();
});

test('single-resource Kea3D projects open locally and missing resources preserve the current model', async ({ page }) => {
  const manifest = {
    $schema: 'https://kea3d.com/schemas/project/v1.json',
    format: 'kea3d-project',
    version: 1,
    name: 'Fixture project',
    rootInstance: 'fixture',
    resources: [{ id: 'fixture-model', uri: 'components/fixture.glb' }],
    instances: [{ id: 'fixture', resource: 'fixture-model' }],
  };
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: 'fixture.kea3d', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) },
    { name: 'fixture.glb', mimeType: 'model/gltf-binary', buffer: triangleModel() },
  ]);
  await expect(page.getByRole('button', { name: /Open another model.*fixture\.kea3d/ })).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'missing.kea3d',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      ...manifest,
      name: 'Missing resource project',
      resources: [{ id: 'fixture-model', uri: 'components/missing.glb' }],
    })),
  });
  await expect(page.getByLabel('Kea3D model viewer').getByText('Project resource "components/missing.glb" is missing. Choose the .kea3d project and its referenced GLB together.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Open another model.*fixture\.kea3d/ })).toBeVisible();

  await expect(page.getByText('Project resources', { exact: true })).toBeVisible();
  await page.getByLabel('Locate project GLB resources').setInputFiles({
    name: 'replacement.glb',
    mimeType: 'model/gltf-binary',
    buffer: triangleModel(),
  });
  await expect(page.getByRole('button', { name: /Open another model.*missing\.kea3d/ })).toBeVisible();
  await expect(page.getByText('Project resources', { exact: true })).not.toBeVisible();
});

test('changed project resources require explicit acceptance', async ({ page }) => {
  const model = triangleModel();
  const manifest = {
    $schema: 'https://kea3d.com/schemas/project/v1.json',
    format: 'kea3d-project',
    version: 1,
    name: 'Changed resource project',
    rootInstance: 'fixture',
    resources: [{ id: 'fixture-model', uri: 'fixture.glb', integrity: { byteLength: model.byteLength, sha256: '0'.repeat(64) } }],
    instances: [{ id: 'fixture', resource: 'fixture-model' }],
  };
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: 'changed.kea3d', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) },
    { name: 'fixture.glb', mimeType: 'model/gltf-binary', buffer: model },
  ]);
  await expect(page.getByText('Project resources', { exact: true })).toBeVisible();
  await expect(page.getByText('changed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use changed files' }).click();
  await expect(page.getByRole('button', { name: /Open another model.*changed\.kea3d/ })).toBeVisible();
  await expect(page.getByText('Project resources', { exact: true })).not.toBeVisible();
});

test('Kea3D projects save, pack, reopen, and export flattened GLB round trips', async ({ page }) => {
  const manifest = {
    $schema: 'https://kea3d.com/schemas/project/v1.json',
    format: 'kea3d-project',
    version: 1,
    name: 'Anchor assembly',
    rootInstance: 'base',
    resources: [{ id: 'part-model', uri: 'part.glb' }],
    instances: [
      { id: 'base', resource: 'part-model' },
      { id: 'attached', resource: 'part-model', attachment: { sourceAnchor: 'origin', targetInstance: 'base', targetAnchor: 'mount' } },
    ],
  };
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: 'assembly.kea3d', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) },
    { name: 'part.glb', mimeType: 'model/gltf-binary', buffer: triangleModel(false, false, [{ id: 'origin', x: 0 }, { id: 'mount', x: 2 }]) },
  ]);
  await expect(page.getByRole('button', { name: /Open another model.*assembly\.kea3d/ })).toBeVisible();
  await expect(page.getByText('3 × 1 × 0 m')).toBeVisible();

  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Export model' }).click();
  await expect(page.getByRole('button', { name: 'Save as…' })).toBeVisible();
  const projectDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project' }).click();
  const projectDownload = await projectDownloadPromise;
  expect(projectDownload.suggestedFilename()).toBe('assembly.kea3d');
  const projectPath = await projectDownload.path();
  expect(projectPath).not.toBeNull();
  expect(JSON.parse((await readFile(projectPath!)).toString('utf8'))).toEqual(manifest);

  const packageDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Pack project' }).click();
  const packageDownload = await packageDownloadPromise;
  expect(packageDownload.suggestedFilename()).toBe('assembly.kea3dp');
  const packagePath = await packageDownload.path();
  expect(packagePath).not.toBeNull();
  const packaged = await readFile(packagePath!);
  expect(packaged.subarray(0, 2).toString('ascii')).toBe('PK');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: packageDownload.suggestedFilename(),
    mimeType: 'application/vnd.kea3d.package',
    buffer: packaged,
  });
  await expect(page.getByRole('button', { name: /Open another model.*assembly\.kea3dp/ })).toBeVisible();
  await expect(page.getByText('3 × 1 × 0 m')).toBeVisible();
  if (!await page.getByRole('button', { name: 'Save package' }).isVisible()) {
    await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Export model' }).click();
  }
  await expect(page.getByRole('button', { name: 'Pack project' })).toHaveCount(0);
  const packageSavePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save package' }).click();
  const savedPackage = await packageSavePromise;
  const savedPackagePath = await savedPackage.path();
  expect(savedPackage.suggestedFilename()).toBe('assembly.kea3dp');
  expect(await readFile(savedPackagePath!)).toEqual(packaged);

  const glbDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export flattened GLB' }).click();
  const glbDownload = await glbDownloadPromise;
  expect(glbDownload.suggestedFilename()).toBe('assembly-flattened.glb');
  const glbPath = await glbDownload.path();
  expect(glbPath).not.toBeNull();
  const flattened = await readFile(glbPath!);
  expect(flattened.subarray(0, 4).toString('ascii')).toBe('glTF');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: glbDownload.suggestedFilename(),
    mimeType: 'model/gltf-binary',
    buffer: flattened,
  });
  await expect(page.getByRole('button', { name: /Open another model.*assembly-flattened\.glb/ })).toBeVisible();
  await expect(page.getByText('3 × 1 × 0 m')).toBeVisible();
});

test('incompatible BLEND files retain actionable diagnostics after worker transfer', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'modern-test.blend',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('BLENDER-v420invalid test payload'),
  });
  await expect(page.getByText(/Blender 4\.20 file is not compatible/)).toBeVisible();
  await expect(page.getByText(/detached ArrayBuffer/)).toHaveCount(0);
});

test('loaded model exposes synchronized viewer controls and information', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);
  const toolbar = page.getByRole('toolbar', { name: 'Viewer tools' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Zoom out' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Copy private view link' })).toBeVisible();
  await expect(page.locator('canvas[aria-label="XYZ camera orientation control"]')).toBeVisible();
  const viewSelector = toolbar.getByRole('button', { name: 'View selector' });
  const viewport = page.locator('canvas[aria-label="3D model viewport"]');
  await viewport.hover();
  for (let index = 0; index < 8; index += 1) await page.mouse.wheel(0, -500);
  await page.waitForTimeout(350);
  const zoomedDistance = await page.evaluate(() => {
    const camera = JSON.parse(localStorage.getItem('kea3d.settings.v1') ?? '{}').viewer?.lastCamera;
    return Math.hypot(
      camera.position[0] - camera.target[0],
      camera.position[1] - camera.target[1],
      camera.position[2] - camera.target[2],
    );
  });
  const beforeSelector = await viewport.screenshot();
  await viewSelector.click();
  await expect(viewSelector).toHaveAttribute('aria-pressed', 'true');
  expect((await viewport.screenshot()).equals(beforeSelector)).toBe(false);
  const viewportBounds = await viewport.boundingBox();
  expect(viewportBounds).not.toBeNull();
  await page.mouse.click(
    viewportBounds!.x + viewportBounds!.width * 0.78,
    viewportBounds!.y + viewportBounds!.height * 0.72,
  );
  await expect(viewSelector).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(500);
  const fittedDistance = await page.evaluate(() => {
    const camera = JSON.parse(localStorage.getItem('kea3d.settings.v1') ?? '{}').viewer?.lastCamera;
    return Math.hypot(
      camera.position[0] - camera.target[0],
      camera.position[1] - camera.target[1],
      camera.position[2] - camera.target[2],
    );
  });
  expect(fittedDistance).toBeGreaterThan(zoomedDistance * 1.25);
  await toolbar.getByRole('button', { name: 'Lighting' }).click();
  const studioLighting = page.getByRole('button', { name: 'Studio' });
  await expect(studioLighting).toBeVisible();
  await studioLighting.click();
  await expect(studioLighting).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Model info')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test_triangle', exact: true })).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('authored Anchors remain inspectable and have explicit viewport visibility controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'anchored-part.glb',
    mimeType: 'model/gltf-binary',
    buffer: triangleModel(false, false, [{ id: 'base', x: 0.25 }]),
  });
  await expect(page.getByRole('button', { name: /Open another model.*anchored-part\.glb/ })).toBeVisible();

  const toolbar = page.getByRole('toolbar', { name: 'Viewer tools' });
  const anchorToggle = toolbar.getByRole('button', { name: 'Hide anchors' });
  await expect(anchorToggle).toHaveAttribute('aria-pressed', 'true');
  await anchorToggle.click();
  await expect(toolbar.getByRole('button', { name: 'Show anchors' })).toHaveAttribute('aria-pressed', 'false');
  await toolbar.getByRole('button', { name: 'Show anchors' }).click();

  const closeSceneObjects = page.getByRole('button', { name: 'Close scene objects' });
  if (!await closeSceneObjects.isVisible()) {
    await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Scene objects' }).click();
  }
  const sceneObjects = closeSceneObjects.locator('xpath=ancestor::div[@data-slot="card"]');
  await sceneObjects.getByRole('button', { name: /Scene controls/ }).click();
  const anchorVisibility = page.getByRole('switch', { name: 'Show Anchors' });
  await expect(page.getByText('1 frame in this model')).toBeVisible();
  await expect(anchorVisibility).toBeChecked();
  await anchorVisibility.click();
  await expect(anchorVisibility).not.toBeChecked();
  await anchorVisibility.click();

  await page.keyboard.press('Escape');
  await sceneObjects.getByRole('button', { name: 'base', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Isolate selected object' })).toBeDisabled();
  await sceneObjects.getByRole('button', { name: 'Selection details' }).click();
  await expect(page.getByRole('dialog', { name: 'Selection details' }).getByText('World position', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Selection details' }).getByText('World XYZ °', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const infoToggle = toolbar.getByRole('button', { name: 'Model information' });
  if (await infoToggle.getAttribute('aria-pressed') !== 'true') await infoToggle.click();
  await expect(page.getByText('Anchor info', { exact: true })).toBeVisible();
  const info = page.getByRole('button', { name: 'Close anchor info' }).locator('xpath=ancestor::div[@data-slot="card"]');
  await expect(info.getByText('Name', { exact: true })).toBeVisible();
  await expect(info.getByText('X 0° · Y 0° · Z 0°', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('anchor-info.png') });
  await expectNoAccessibilityViolations(page);
});

test('compact STEP import caches inherited shell and explicit face colors', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(resolve('tests/fixtures/cad-inherited-colors.step'));
  await expect(page.getByRole('button', { name: /Open another model.*cad-inherited-colors\.step/ })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const records = await new Promise<Array<{ result: { meshes: Array<{ brep_faces?: Array<{ color: number[] | null }> }> } }>>((resolveRecords, reject) => {
      const open = indexedDB.open('kea3d-cad-cache', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('tessellations').objectStore('tessellations').getAll();
        request.onsuccess = () => { resolveRecords(request.result); db.close(); };
        request.onerror = () => { reject(request.error); db.close(); };
      };
    });
    return records.flatMap((record) => record.result.meshes.flatMap((mesh) => mesh.brep_faces ?? []))
      .map((face) => face.color?.join(',')).filter((color) => color === '1,0,0').length;
  })).toBe(5);
  await page.screenshot({ path: testInfo.outputPath('cad-colors-compact.png') });
});

test('legacy named locator nodes become standard inspectable Anchors', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'legacy-locators.glb',
    mimeType: 'model/gltf-binary',
    buffer: triangleModel(false, false, [{ id: 'PB_LT_01', x: 0.25, legacy: true }]),
  });

  const toolbar = page.getByRole('toolbar', { name: 'Viewer tools' });
  await expect(toolbar.getByRole('button', { name: 'Hide anchors' })).toBeVisible();
  const closeSceneObjects = page.getByRole('button', { name: 'Close scene objects' });
  if (!await closeSceneObjects.isVisible()) await toolbar.getByRole('button', { name: 'Scene objects' }).click();
  const sceneObjects = closeSceneObjects.locator('xpath=ancestor::div[@data-slot="card"]');
  await expect(sceneObjects.getByRole('button', { name: 'PB_LT_01', exact: true })).toBeVisible();
  await sceneObjects.getByRole('button', { name: /Scene controls/ }).click();
  await expect(page.getByText('1 frame in this model')).toBeVisible();
});

test('manual Anchors create, edit, undo, redo, and survive calibrated GLB export', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);
  const closeSceneObjects = page.getByRole('button', { name: 'Close scene objects' });
  if (!await closeSceneObjects.isVisible()) {
    await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Scene objects' }).click();
  }
  const sceneObjects = closeSceneObjects.locator('xpath=ancestor::div[@data-slot="card"]');

  await sceneObjects.getByRole('button', { name: /Scene controls/ }).click();
  await expect(page.getByText('0 frames in this model')).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Anchor name').fill('Mount face');
  await page.getByLabel('Anchor ID').fill('mount-face');
  await page.getByLabel('Local position X').fill('1');
  await page.getByLabel('Local position Y').fill('2');
  await page.getByLabel('Local position Z').fill('3');
  await page.getByLabel('Local rotation ° Y').fill('90');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(sceneObjects.getByRole('button', { name: 'Mount face', exact: true })).toBeVisible();

  await sceneObjects.getByRole('button', { name: /Scene controls/ }).click();
  await page.getByRole('button', { name: 'Revert scene change' }).click();
  await expect(sceneObjects.getByRole('button', { name: 'Anchor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revert scene change' }).click();
  await expect(page.getByText('0 frames in this model')).toBeVisible();
  await page.getByRole('button', { name: 'Repeat scene change' }).click();
  await page.getByRole('button', { name: 'Repeat scene change' }).click();
  await expect(sceneObjects.getByRole('button', { name: 'Mount face', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await sceneObjects.getByRole('button', { name: 'Mount face', exact: true }).click();
  await sceneObjects.getByRole('button', { name: 'Selection details' }).click();
  await page.getByRole('button', { name: 'Edit Anchor' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.keyboard.press('Escape');
  await sceneObjects.getByRole('button', { name: /Scene controls/ }).click();
  await expect(page.getByText('0 frames in this model')).toBeVisible();
  await page.getByRole('button', { name: 'Revert scene change' }).click();
  await expect(sceneObjects.getByRole('button', { name: 'Mount face', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Adjust model' }).click();
  const unitSelect = page.getByRole('combobox', { name: 'Source units' });
  await unitSelect.click();
  await page.getByRole('option', { name: 'Inches (in)' }).click();
  await page.getByRole('button', { name: 'Close adjust model' }).click();

  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Export model' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GLB' }).click();
  const exportedPath = await (await downloadPromise).path();
  expect(exportedPath).not.toBeNull();
  const exported = glbJson(await readFile(exportedPath!));
  const anchorNode = (exported.nodes as Array<{ name?: string; translation?: number[]; extras?: unknown }>).find((node) => node.name === 'Mount face');
  expect(anchorNode?.translation).toEqual([1, 2, 3]);
  expect(anchorNode?.extras).toEqual({ kea3d: { anchor: { version: 1, id: 'mount-face' } } });
  expect((exported.nodes as Array<{ scale?: number[] }>).some((node) => node.scale?.every((value) => Math.abs(value - 0.0254) < 1e-6))).toBe(true);

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'authored-anchor.glb',
    mimeType: 'model/gltf-binary',
    buffer: await readFile(exportedPath!),
  });
  await expect(page.getByRole('button', { name: /Open another model.*authored-anchor\.glb/ })).toBeVisible();
  if (!await closeSceneObjects.isVisible()) {
    await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Scene objects' }).click();
  }
  await sceneObjects.getByRole('button', { name: /Scene controls/ }).click();
  await expect(page.getByText('1 frame in this model')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('free orbit remains interactive and selected tools use a clear active state', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);

  const rotation = page.getByRole('button', { name: 'Free orbit', exact: true });
  const fit = page.getByRole('button', { name: 'Fit model' });
  await rotation.click();
  await expect(rotation).toHaveAttribute('aria-pressed', 'true');
  expect(await rotation.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(await fit.evaluate((element) => getComputedStyle(element).backgroundColor));

  const viewport = page.locator('canvas[aria-label="3D model viewport"]');
  const beforeOrbit = await viewport.screenshot();
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 90, bounds!.y + bounds!.height / 2 + 45, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect((await viewport.screenshot()).equals(beforeOrbit)).toBe(false);
});

test('selecting a scene part highlights its surface in the viewport', async ({ page }) => {
  await page.goto('/');
  await openTestModel(page);
  const viewport = page.locator('canvas[aria-label="3D model viewport"]');
  const beforeSelection = await viewport.screenshot();
  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();
  await page.waitForTimeout(100);
  expect((await viewport.screenshot()).equals(beforeSelection)).toBe(false);
});

test('model info becomes aggregate selected info while objects are selected', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page, true);

  await expect(page.getByText('Model info', { exact: true })).toBeVisible();
  await expect(page.getByText('File size', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();
  await page.getByRole('button', { name: 'Other_triangle', exact: true }).click({ modifiers: ['Control'] });
  await expect(page.getByText('Selected info', { exact: true })).toBeVisible();
  await expect(page.getByText('2 objects', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('File size', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByText('Model info', { exact: true })).toBeVisible();
  await expect(page.getByText('File size', { exact: true })).toBeVisible();
});

test('scene objects support additive and range multi-selection across shared tools', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page, true);

  const first = page.getByRole('button', { name: 'Test_triangle', exact: true });
  const second = page.getByRole('button', { name: 'Other_triangle', exact: true });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('Control');
  await second.click();
  await page.keyboard.up('Control');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('2 objects', { exact: true }).first()).toBeVisible();

  const toolbar = page.getByRole('toolbar', { name: 'Viewer tools' });
  const isolate = toolbar.getByRole('button', { name: 'Isolate selected objects' });
  await expect(isolate).toBeEnabled();
  await isolate.click();
  await expect(toolbar.getByRole('button', { name: 'Exit isolate' })).toHaveAttribute('aria-pressed', 'true');
  await toolbar.getByRole('button', { name: 'Exit isolate' }).click();

  await toolbar.getByRole('button', { name: 'Set material' }).click();
  await expect(page.getByText(/2 meshes targeted\..*Choose a preset to preview it\./)).toBeVisible();
  await page.getByRole('button', { name: 'Close set material' }).click();

  await second.click();
  await first.click();
  await second.click({ modifiers: ['Shift'] });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveAttribute('aria-pressed', 'false');
});

test('selected parts can be isolated and the previous visibility state is restored', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page, true);

  const toolbar = page.getByRole('toolbar', { name: 'Viewer tools' });
  const isolate = toolbar.getByRole('button', { name: 'Isolate selected object' });
  await expect(isolate).toBeDisabled();
  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();
  await expect(isolate).toBeEnabled();
  await isolate.click();
  await expect(toolbar.getByRole('button', { name: 'Exit isolate' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Show Other_triangle' })).toBeVisible();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('i');
  await expect(toolbar.getByRole('button', { name: 'Isolate selected object' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Hide Other_triangle' })).toBeVisible();
});

test('material presets preview, apply, restore, undo, redo, and survive corrected GLB export', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page, true);
  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();

  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Set material' }).click();
  await expect(page.getByText('Set material', { exact: true })).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.getByRole('button', { name: 'Same material' }).click();
  await expect(page.getByText(/2 meshes targeted\..*Choose a preset to preview it\./)).toBeVisible();

  const viewport = page.locator('canvas[aria-label="3D model viewport"]');
  const beforePreview = await viewport.screenshot();
  await page.getByRole('button', { name: 'Copper' }).click();
  const materialOptions = page.getByRole('region', { name: 'Material options' });
  await expect(materialOptions.getByRole('button', { name: 'Brushed' })).toBeVisible();
  await materialOptions.getByRole('button', { name: 'Polished' }).click();
  await materialOptions.getByRole('button', { name: 'Advanced PBR' }).click();
  await expect(materialOptions.getByText('0.08', { exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  expect((await viewport.screenshot()).equals(beforePreview)).toBe(false);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();

  await page.getByRole('button', { name: 'Close set material' }).click();
  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Export model' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GLB' }).click();
  const exportedPath = await (await downloadPromise).path();
  expect(exportedPath).not.toBeNull();
  const exportedJson = glbJson(await readFile(exportedPath!));
  expect(JSON.stringify(exportedJson)).toContain('Kea3D · Copper');
  const exportedMaterials = exportedJson.materials as Array<{ pbrMetallicRoughness?: { roughnessFactor?: number } }>;
  expect(exportedMaterials.some((material) => material.pbrMetallicRoughness?.roughnessFactor === 0.08)).toBe(true);

  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Set material' }).click();
  await page.getByRole('button', { name: 'Original' }).click();
  await expect(page.getByRole('button', { name: 'Original' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Original' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('button', { name: 'Original' })).toBeDisabled();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Original' })).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('button', { name: 'Original' })).toBeDisabled();
});

test('same material matches equivalent imported PBR records, not only shared instances', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page, true, true);

  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();
  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Set material' }).click();
  await page.getByRole('button', { name: 'Same material' }).click();
  await expect(page.getByText(/2 meshes targeted\..*Choose a preset to preview it\./)).toBeVisible();

  await page.getByRole('button', { name: 'Copper' }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Original' })).toBeEnabled();
});

test('model orientation exposes only forward directions perpendicular to Up', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);

  await page.getByRole('toolbar', { name: 'Viewer tools' })
    .getByRole('button', { name: 'Adjust model' })
    .click();
  const forwardSelect = page.getByRole('combobox', { name: 'Source forward direction' });
  await expect(forwardSelect).toContainText('+Z forward');
  await forwardSelect.click();
  await expect(page.getByRole('option', { name: '+X forward' })).toBeVisible();
  await expect(page.getByRole('option', { name: '−X forward' })).toBeVisible();
  await expect(page.getByRole('option', { name: '+Z forward' })).toBeVisible();
  await expect(page.getByRole('option', { name: '−Z forward' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Y forward/ })).toHaveCount(0);
  await page.getByRole('option', { name: '+X forward' }).click();
  await expect(forwardSelect).toContainText('+X forward');
});

test('inch-authored files use the exact inch-to-metre conversion', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);

  await page.getByRole('toolbar', { name: 'Viewer tools' })
    .getByRole('button', { name: 'Adjust model' })
    .click();
  const unitSelect = page.getByRole('combobox', { name: 'Source units' });
  await unitSelect.click();
  await page.getByRole('option', { name: 'Inches (in)' }).click();

  await expect(page.getByText('1 file unit = 1 in = 2.54 cm = 0.0254 m', { exact: true })).toBeVisible();
  await expect(page.getByText('2.54 × 2.54 × 0 cm', { exact: true })).toBeVisible();
});

test('known dimensions calibrate the model uniformly', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);

  await page.getByRole('toolbar', { name: 'Viewer tools' })
    .getByRole('button', { name: 'Adjust model' })
    .click();
  await page.getByRole('spinbutton', { name: 'Known dimension value' }).fill('250');
  await page.getByRole('button', { name: 'Apply calibration' }).click();

  await expect(page.getByText('25 × 25 × 0 cm', { exact: true })).toBeVisible();
  await expect(page.getByText('0.25×', { exact: true })).toBeVisible();
  await expect(page.getByText('250 mm', { exact: true })).toBeVisible();
});

test('selected geometry can calibrate the whole model', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page, true);
  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();

  await page.getByRole('toolbar', { name: 'Viewer tools' })
    .getByRole('button', { name: 'Adjust model' })
    .click();
  const calibration = page.getByRole('region', { name: 'Known dimension calibration' });
  await expect(calibration.getByText('Test_triangle', { exact: true })).toBeVisible();
  await calibration.getByRole('spinbutton', { name: 'Known dimension value' }).fill('500');
  await calibration.getByRole('button', { name: 'Apply calibration' }).click();

  await expect(page.getByText('50 × 50 × 0 cm', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('1.5 × 0.5 × 0 m', { exact: true })).toBeVisible();
});

test('corrected GLB export reopens with its uniform scale preserved', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);

  await page.getByRole('toolbar', { name: 'Viewer tools' })
    .getByRole('button', { name: 'Adjust model' })
    .click();
  await page.getByRole('spinbutton', { name: 'Known dimension value' }).fill('10000');
  await page.getByRole('button', { name: 'Apply calibration' }).click();
  await expect(page.getByText('10 × 10 × 0 m', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close adjust model' }).click();
  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Export model' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GLB' }).click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(exportedPath).not.toBeNull();
  const exportedModel = await readFile(exportedPath!);
  expect(exportedModel.subarray(0, 4).toString('ascii')).toBe('glTF');

  await page.locator('input[type="file"]').first().setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'model/gltf-binary',
    buffer: exportedModel,
  });

  await expect(page.getByRole('button', { name: /Open another model.*\.glb/ })).toBeVisible();
  await expect(page.getByText('10 × 10 × 0 m', { exact: true })).toBeVisible();
});

test('GLB export can include only currently visible scene objects', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page, true);

  await page.getByRole('button', { name: 'Hide Other_triangle' }).click();
  await page.getByRole('toolbar', { name: 'Viewer tools' }).getByRole('button', { name: 'Export model' }).click();
  await page.getByRole('button', { name: 'Visible only' }).click();
  await expect(page.getByText(/Exports only objects currently visible/)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GLB' }).click();
  const exportedPath = await (await downloadPromise).path();
  expect(exportedPath).not.toBeNull();
  const exportedJson = glbJson(await readFile(exportedPath!));
  expect(exportedJson.meshes).toHaveLength(1);
});

test('compact viewer keeps primary actions touch sized', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openTestModel(page);
  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await expect(toolbar).toBeVisible();
  for (const button of await toolbar.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await toolbar.getByRole('button', { name: 'Scene objects' }).click();
  const overlay = page.locator('[data-slot="sheet-overlay"]');
  await expect(overlay).toBeHidden();
  const workspace = page.getByRole('complementary', { name: 'Scene objects' });
  await expect(workspace).toBeVisible();
  await page.waitForTimeout(250);
  const viewportBounds = await page.locator('canvas[aria-label="3D model viewport"]').boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(viewportBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(viewportBounds!.y + viewportBounds!.height).toBeLessThanOrEqual(workspaceBounds!.y + 1);
  await expect(workspace.getByRole('button', { name: 'Expand scene objects' })).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('compact animations preserve the live model and use one clear transport hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openAnimatedTestModel(page);

  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Animations' }).click();

  const workspace = page.getByRole('complementary', { name: 'Animations' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Fit model' })).toBeVisible();
  await page.waitForTimeout(250);
  const viewportBounds = await page.locator('canvas[aria-label="3D model viewport"]').boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(viewportBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(viewportBounds!.y + viewportBounds!.height).toBeLessThanOrEqual(workspaceBounds!.y + 1);

  const restart = workspace.getByRole('button', { name: 'Restart animation' });
  const play = workspace.getByRole('button', { name: 'Play animation' });
  const loop = workspace.getByRole('button', { name: 'Loop animation' });
  await expect(play).toHaveAttribute('data-variant', 'secondary');
  await expect(loop).toHaveAttribute('data-variant', 'default');
  for (const control of [restart, play, loop]) {
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoAccessibilityViolations(page);
});

test('narrowing a desktop window keeps only the active compact workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openAnimatedTestModel(page);
  await expect(page.getByText('Model info', { exact: true })).toBeVisible();
  await expect(page.getByText('Scene objects', { exact: true })).toBeVisible();
  await expect(page.getByText('Animations', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 600 });
  const animationWorkspace = page.getByRole('complementary', { name: 'Animations' });
  await expect(animationWorkspace).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Scene objects' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Model info' })).toHaveCount(0);
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
});

test('compact more tools uses a small non-modal icon grid', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openTestModel(page);

  const primaryToolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await primaryToolbar.getByRole('button', { name: 'More tools' }).click();
  const overflow = page.getByRole('toolbar', { name: 'More viewer tools' });
  await expect(overflow).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();

  const overflowBounds = await page.getByRole('dialog', { name: 'More viewer tools' }).boundingBox();
  expect(overflowBounds).not.toBeNull();
  expect(overflowBounds!.height).toBeLessThanOrEqual(390);
  const buttons = await overflow.getByRole('button').all();
  expect(buttons.length).toBeGreaterThanOrEqual(12);
  for (const button of buttons) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('canvas[aria-label="3D model viewport"]')).toBeVisible();
});

test('double-click opens information without toggling it closed', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openTestModel(page);
  await page.getByRole('button', { name: 'Close model info' }).click();
  const part = page.getByRole('button', { name: 'Test_triangle', exact: true });
  await part.click();
  await expect(page.getByRole('button', { name: 'Selection details' })).toBeEnabled();
  await part.dblclick();
  await expect(page.getByText('Selected info', { exact: true })).toBeVisible();
  await part.dblclick();
  await expect(page.getByText('Selected info', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close selected info' }).click();
  const canvas = page.locator('canvas[aria-label="3D model viewport"]');
  await canvas.dblclick({ position: { x: 700, y: 500 } });
  await expect(page.getByText('Selected info', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close selected info' }).click();
  await canvas.dblclick({ position: { x: 1400, y: 180 } });
  await expect(page.getByRole('button', { name: /Close (selected|model) info/ })).toHaveCount(0);
});

test('compact anchor visibility stays available in the conditional icon grid', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'mobile-anchor.glb',
    mimeType: 'model/gltf-binary',
    buffer: triangleModel(false, false, [{ id: 'base', x: 0.25 }]),
  });
  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'Hide anchors' }).click();
  await expect(toolbar.getByRole('button', { name: 'Show anchors' })).toHaveAttribute('aria-pressed', 'false');
});

test('compact Escape closes the active layer before clearing model selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openTestModel(page);

  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Lighting', exact: true }).click();
  const lighting = page.getByRole('complementary', { name: 'Lighting' });
  await expect(lighting).toBeVisible();

  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
  })));
  await expect(lighting).toBeHidden();
  await expect(toolbar).toBeVisible();

  await toolbar.getByRole('button', { name: 'More tools' }).click();
  const overflow = page.getByRole('toolbar', { name: 'More viewer tools' });
  await expect(overflow).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
  })));
  await expect(overflow).toBeHidden();
  await expect(toolbar).toBeVisible();
});

test('compact lighting keeps its live model preview visible above the controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openTestModel(page);

  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Lighting', exact: true }).click();

  const workspace = page.getByRole('complementary', { name: 'Lighting' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Fit model' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Studio' }).click();
  await expect(workspace.getByRole('button', { name: 'Studio' })).toHaveAttribute('aria-pressed', 'true');
  const exposure = workspace.getByRole('slider', { name: 'Lighting exposure' });
  const initialExposure = await exposure.getAttribute('aria-valuenow');
  await exposure.press('ArrowRight');
  await expect(exposure).not.toHaveAttribute('aria-valuenow', initialExposure ?? '');
  for (const name of ['Environment background', 'Shadows']) {
    const control = workspace.getByRole('switch', { name });
    const controlBounds = await control.boundingBox();
    expect(controlBounds?.width).toBe(36);
    expect(controlBounds?.height).toBe(20);
    const rowBounds = await control.locator('..').boundingBox();
    expect(rowBounds?.height).toBeGreaterThanOrEqual(44);
  }
  await page.waitForTimeout(250);

  const modelViewportBounds = await page.locator('canvas[aria-label="3D model viewport"]').boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(modelViewportBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(modelViewportBounds!.y + modelViewportBounds!.height).toBeLessThanOrEqual(workspaceBounds!.y + 1);
});

test('compact adjust model keeps the corrected model visible beside scrollable controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openTestModel(page);

  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Adjust model' }).click();

  const workspace = page.getByRole('complementary', { name: 'Adjust model' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Fit model' })).toBeVisible();
  await page.waitForTimeout(250);

  const modelViewport = page.locator('canvas[aria-label="3D model viewport"]');
  const modelViewportBounds = await modelViewport.boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(modelViewportBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(modelViewportBounds!.y + modelViewportBounds!.height).toBeLessThanOrEqual(workspaceBounds!.y + 1);
  expect(modelViewportBounds!.height).toBeGreaterThanOrEqual(250);

  const unitSelect = workspace.getByRole('combobox', { name: 'Source units' });
  await unitSelect.click();
  await page.getByRole('option', { name: 'Inches (in)' }).click();
  await expect(workspace.getByText('1 file unit = 1 in = 2.54 cm = 0.0254 m', { exact: true })).toBeVisible();

  const controls = workspace.locator(':scope > div').nth(1);
  await expect.poll(() => controls.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await controls.hover();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => controls.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(workspace.getByRole('button', { name: 'Apply calibration' })).toBeVisible();

  await workspace.getByRole('button', { name: 'Expand adjust model' }).click();
  await page.waitForTimeout(250);
  const expandedBounds = await workspace.boundingBox();
  expect(expandedBounds).not.toBeNull();
  expect(expandedBounds!.height).toBeGreaterThan(workspaceBounds!.height + 100);
});

test('compact material workflow keeps editing and actions separated in a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openTestModel(page);

  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'Scene objects' }).click();
  await page.getByRole('button', { name: 'Test_triangle', exact: true }).click();
  await page.getByRole('button', { name: 'Close scene objects' }).click();
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Set material' }).click();

  const workspace = page.getByRole('complementary', { name: 'Set material' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Fit model' })).toBeVisible();
  await page.waitForTimeout(250);
  const modelViewport = page.locator('canvas[aria-label="3D model viewport"]');
  const modelViewportBounds = await modelViewport.boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(modelViewportBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(modelViewportBounds!.y + modelViewportBounds!.height).toBeLessThanOrEqual(workspaceBounds!.y + 1);
  expect(modelViewportBounds!.height).toBeGreaterThanOrEqual(250);

  await workspace.getByRole('button', { name: 'Expand set material' }).click();
  await page.waitForTimeout(250);
  const expandedWorkspaceBounds = await workspace.boundingBox();
  expect(expandedWorkspaceBounds).not.toBeNull();
  expect(expandedWorkspaceBounds!.height).toBeGreaterThan(workspaceBounds!.height + 100);
  await workspace.getByRole('button', { name: 'Reduce set material' }).click();
  await page.waitForTimeout(250);

  await page.getByRole('button', { name: 'Blue', exact: true }).click();

  const options = page.getByRole('region', { name: 'Material options' });
  await expect(options.getByRole('button', { name: 'Dark' })).toBeVisible();
  await expect(options.getByRole('button', { name: 'Standard' })).toBeVisible();
  await expect(options.getByRole('button', { name: 'Light' })).toBeVisible();
  const standard = options.getByRole('button', { name: 'Standard' });
  const dark = options.getByRole('button', { name: 'Dark' });
  await expect(standard).toHaveAttribute('aria-pressed', 'true');
  await expect(standard).toHaveAttribute('data-variant', 'default');
  expect(await standard.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(await dark.evaluate((element) => getComputedStyle(element).backgroundColor));
  await options.getByRole('button', { name: 'Gloss' }).click();
  await expect(options.getByRole('button', { name: 'Gloss' })).toHaveAttribute('aria-pressed', 'true');

  const editor = page.locator('[data-slot="scroll-area"][aria-label="Material editor"]');
  const editorViewport = editor.locator('[data-slot="scroll-area-viewport"]');
  const actions = page.locator('[aria-label="Material actions"]');
  await expect(actions.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
  const actionBoxes = await Promise.all((await actions.getByRole('button').all()).map((button) => button.boundingBox()));
  expect(actionBoxes).toHaveLength(5);
  expect(await actions.getByRole('button').allTextContents()).toEqual(['Original', 'Undo', 'Redo', 'Discard', 'Apply']);
  expect(actionBoxes.every((box) => box !== null && box.width >= 44 && box.height >= 44)).toBe(true);
  expect(Math.max(...actionBoxes.map((box) => box!.y)) - Math.min(...actionBoxes.map((box) => box!.y))).toBeLessThanOrEqual(1);
  await expect(editor).toHaveCSS('overflow', 'hidden');
  await expect(editorViewport).toHaveCSS('touch-action', 'pan-y');
  await expect(editor.locator('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]')).toBeVisible();
  const editorBounds = await editor.boundingBox();
  const actionBounds = await actions.boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(actionBounds).not.toBeNull();
  expect(editorBounds!.y + editorBounds!.height).toBeLessThanOrEqual(actionBounds!.y);
  expect(workspaceBounds!.y + workspaceBounds!.height - (actionBounds!.y + actionBounds!.height)).toBeLessThanOrEqual(20);

  await editorViewport.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => editorViewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Metals' })).toBeVisible();
});

test('compact measurement keeps the model interactive above its workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openTestModel(page);

  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Measure distance' }).click();

  const workspace = page.getByRole('complementary', { name: 'Measure' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Fit model' })).toBeVisible();
  await page.waitForTimeout(250);

  const modelViewport = page.locator('canvas[aria-label="3D model viewport"]');
  const modelViewportBounds = await modelViewport.boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(modelViewportBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(modelViewportBounds!.y + modelViewportBounds!.height).toBeLessThanOrEqual(workspaceBounds!.y + 1);
  const hitTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.getAttribute('aria-label');
  }, {
    x: modelViewportBounds!.x + modelViewportBounds!.width / 2,
    y: modelViewportBounds!.y + modelViewportBounds!.height / 2,
  });
  expect(hitTarget).toBe('3D model viewport');
});

test('compact section cut keeps its live preview visible above the controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await openTestModel(page);

  const toolbar = page.getByRole('toolbar', { name: 'Mobile viewer tools' });
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Section cut' }).click();

  const workspace = page.getByRole('complementary', { name: 'Section cut' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toBeHidden();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Fit model' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Enable section' }).click();
  const slider = workspace.getByRole('slider', { name: 'Section plane position' });
  await expect(slider).toBeEnabled();
  await slider.press('ArrowRight');
  await page.waitForTimeout(250);

  const modelViewportBounds = await page.locator('canvas[aria-label="3D model viewport"]').boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(modelViewportBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(modelViewportBounds!.y + modelViewportBounds!.height).toBeLessThanOrEqual(workspaceBounds!.y + 1);
});
