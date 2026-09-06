declare module 'occt-import-js' {
  interface OcctModule {
    ReadFile(format: 'step' | 'iges' | 'brep', content: Uint8Array, parameters: object | null): unknown;
  }

  interface OcctModuleOptions {
    locateFile?: (path: string) => string;
  }

  export default function createOcctModule(options?: OcctModuleOptions): Promise<OcctModule>;
}

declare module '@kea3d/cad-wasm' {
  export { default } from 'occt-import-js';
}
