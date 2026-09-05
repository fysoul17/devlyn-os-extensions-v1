export type PluginEngine = "claude" | "codex" | "grok" | "omp";
export interface PluginInput {
  id: string;
  label: string;
  type: "text" | "multiline";
  required: boolean;
}
export interface PluginCommand {
  id: string;
  title: string;
  description: string;
  instructions: string;
  inputs: PluginInput[];
}
export interface PluginPrerequisite {
  command: string;
  name: string;
  url: string;
}
export interface Manifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  engines: PluginEngine[];
  commands: PluginCommand[];
  prerequisites: PluginPrerequisite[];
}
export type PluginManifest = Manifest;
export interface PluginBundle {
  schemaVersion: 1;
  manifest: Manifest;
  files: { path: string; content: string }[];
}
export interface CatalogEntry {
  manifest: Manifest;
  bundleUrl: string;
  sha256: string;
}
export interface RevokedRelease {
  id: string;
  version: string;
  reason: string;
}
export interface PluginCatalog {
  schemaVersion: 1;
  plugins: CatalogEntry[];
  revoked: RevokedRelease[];
}
export interface PluginSubmission {
  id: string;
  version: string;
  bundleUrl: string;
  sha256: string;
}
export const MAX_BUNDLE_BYTES: number;
export const REGISTRY_REPOSITORY: string;
export function validateManifest(value: unknown): Manifest;
export function validateBundle(value: unknown): PluginBundle;
export function parseBundle(raw: string | Uint8Array): PluginBundle;
export function validatePublicationBundle(raw: string | Uint8Array): PluginBundle;
export function validateCatalog(value: unknown): PluginCatalog;
export function validateSubmission(value: unknown): PluginSubmission;
export function validatePath(value: unknown): string;
export function validateArtifactUrl(value: unknown): string;
export function validateSourceArtifactUrl(value: unknown): string;
export function downloadArtifact(url: string, fetcher?: typeof fetch): Promise<Uint8Array>;
export function sha256(bytes: string | Uint8Array): string;
