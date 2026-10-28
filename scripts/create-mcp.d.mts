export interface CreateMcpOptions {
  rootDirectory?: string;
}

export function validateName(name: string): void;
export function createMcpApp(name: string, options?: CreateMcpOptions): Promise<string>;
