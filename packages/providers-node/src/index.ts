// Providers
export { PnpmProvider } from './providers/PnpmProvider';
export { BunProvider } from './providers/BunProvider';
export { YarnProvider } from './providers/YarnProvider';
export { NpmProvider } from './providers/NpmProvider';

// Services
export { NpmRegistryService } from './services/NpmRegistryService';
export type { PackageMetadata } from './services/NpmRegistryService';
export { DeprecationService } from './services/DeprecationService';

// Sources
export { NpmRegistrySource } from './sources/NpmRegistrySource';
export { NpmSizeSource } from './sources/NpmSizeSource';
export { DeprecationSource } from './sources/DeprecationSource';

// Detection
export { detectNodeRuntime, detectNodeProviders, createNodeProvidersByName } from './detection';

// Metadata resolution
export { resolveNpmMetadata } from './resolveNpmMetadata';
