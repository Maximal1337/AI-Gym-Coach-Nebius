// No published types for mammoth; only the one function this codebase uses.
declare module "mammoth" {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
}
