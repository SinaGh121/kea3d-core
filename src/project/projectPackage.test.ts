import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { KEA3D_PROJECT_SCHEMA, type Kea3dProjectDocument, type Kea3dProjectSession } from './projectFormat';
import { decodeKea3dPackage, encodeKea3dPackage, KEA3D_PACKAGE_MANIFEST } from './projectPackage';

const zipCentralSignature = 0x02014b50;

function document(): Kea3dProjectDocument {
  return {
    $schema: KEA3D_PROJECT_SCHEMA,
    format: 'kea3d-project',
    version: 1,
    name: 'Fixture',
    rootInstance: 'base',
    resources: [{ id: 'base-model', uri: 'components/base.glb' }],
    instances: [{ id: 'base', resource: 'base-model' }],
  };
}

function session(): Kea3dProjectSession {
  const project = document();
  return {
    document: project,
    manifestFile: new File([JSON.stringify(project)], 'fixture.kea3d'),
    resourceFiles: new Map([['base-model', new File([new Uint8Array([0x67, 0x6c, 0x54, 0x46])], 'base.glb')]]),
  };
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function packageBytes(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 0, mtime: new Date('1980-01-01T00:00:00.000Z') });
}

function manifestBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document()));
}

function firstCentralOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === zipCentralSignature) return offset;
  }
  throw new Error('central directory not found');
}

describe('Kea3D packaged projects', () => {
  it('packs deterministically and restores the validated manifest and resource paths', async () => {
    const first = await encodeKea3dPackage(session());
    const second = await encodeKea3dPackage(session());
    expect(first).toEqual(second);
    const decoded = decodeKea3dPackage(exactBuffer(first));
    expect(decoded.document).toEqual(document());
    expect(decoded.manifestFile.webkitRelativePath).toBe(KEA3D_PACKAGE_MANIFEST);
    expect(decoded.resourceFiles.get('base-model')?.webkitRelativePath).toBe('components/base.glb');
  });

  it('rejects missing, extra, nested, traversing, and colliding entries', () => {
    expect(() => decodeKea3dPackage(exactBuffer(packageBytes({ 'components/base.glb': new Uint8Array([1]) })))).toThrow('manifest');
    expect(() => decodeKea3dPackage(exactBuffer(packageBytes({
      [KEA3D_PACKAGE_MANIFEST]: manifestBytes(),
      'components/base.glb': new Uint8Array([1]),
      'extra.glb': new Uint8Array([2]),
    })))).toThrow('unexpected entry');
    expect(() => decodeKea3dPackage(exactBuffer(packageBytes({
      [KEA3D_PACKAGE_MANIFEST]: manifestBytes(),
      'components/base.glb': new Uint8Array([1]),
      'nested.zip': new Uint8Array([2]),
    })))).toThrow('unexpected entry');
    expect(() => decodeKea3dPackage(exactBuffer(packageBytes({
      [KEA3D_PACKAGE_MANIFEST]: manifestBytes(),
      '../components/base.glb': new Uint8Array([1]),
    })))).toThrow('is unsafe');
    expect(() => decodeKea3dPackage(exactBuffer(packageBytes({
      [KEA3D_PACKAGE_MANIFEST]: manifestBytes(),
      'components/base.glb': new Uint8Array([1]),
      'Components/BASE.glb': new Uint8Array([2]),
    })))).toThrow('colliding');
  });

  it('rejects encrypted entries and Unix symbolic links before extraction', () => {
    const encrypted = packageBytes({ [KEA3D_PACKAGE_MANIFEST]: manifestBytes(), 'components/base.glb': new Uint8Array([1]) });
    const encryptedView = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    const encryptedCentral = firstCentralOffset(encrypted);
    encryptedView.setUint16(encryptedCentral + 8, encryptedView.getUint16(encryptedCentral + 8, true) | 1, true);
    expect(() => decodeKea3dPackage(exactBuffer(encrypted))).toThrow('encrypted');

    const symlink = packageBytes({ [KEA3D_PACKAGE_MANIFEST]: manifestBytes(), 'components/base.glb': new Uint8Array([1]) });
    const symlinkView = new DataView(symlink.buffer, symlink.byteOffset, symlink.byteLength);
    const symlinkCentral = firstCentralOffset(symlink);
    symlink[symlinkCentral + 5] = 3;
    symlinkView.setUint32(symlinkCentral + 38, (0xa1ff << 16) >>> 0, true);
    expect(() => decodeKea3dPackage(exactBuffer(symlink))).toThrow('symbolic links');
  });
});
