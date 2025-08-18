/**
 * Configuration file metadata extracted from front-matter
 */
export interface ConfigMetadata {
    frontMatter?: Record<string, any>;
    inclusion?: 'always' | 'conditional' | 'manual';
    fileMatchPatterns?: string[];
    description?: string;
}

/**
 * Represents a single configuration file
 */
export interface ConfigFile {
    path: string;
    name: string;
    content: string;
    metadata: ConfigMetadata;
    lastModified: number;
}

/**
 * Complete GitHub configuration structure
 */
export interface GitHubConfig {
    instructions: ConfigFile[];
    steering: ConfigFile[];
    prompts: ConfigFile[];
    copilotInstructions: string | null;
    lastUpdated: Date;
}

/**
 * Configuration for context injection preferences
 */
export interface ContextFilter {
    type: 'include' | 'exclude';
    patterns: string[];
    reason?: string;
}
