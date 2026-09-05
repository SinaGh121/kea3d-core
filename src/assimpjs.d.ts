declare module 'assimpjs' {
  interface AssimpFile {
    GetPath(): string;
    GetContent(): Uint8Array;
  }

  interface AssimpResult {
    IsSuccess(): boolean;
    FileCount(): number;
    GetErrorCode(): string;
    GetFile(index: number): AssimpFile;
  }

  interface AssimpFileList {
    AddFile(path: string, content: Uint8Array): void;
  }

  interface AssimpModule {
    FileList: new () => AssimpFileList;
    ConvertFileList(files: AssimpFileList, targetFormat: 'glb2'): AssimpResult;
  }

  interface AssimpModuleOptions {
    locateFile?: (path: string) => string;
  }

  export default function createAssimpModule(options?: AssimpModuleOptions): Promise<AssimpModule>;
}
