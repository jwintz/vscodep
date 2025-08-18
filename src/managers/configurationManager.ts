import * as vscode from 'vscode';
import * as path from 'path';
import { GitHubConfig, ConfigFile, ConfigMetadata } from '../types/config';
import { getConfig } from '../types/vscode';
import {
    fileExists,
    directoryExists,
    findFilesRecursive,
    readFileContent,
    getFileModTime
} from '../utils/fileUtils';
import { parseFrontMatter } from '../utils/parserUtils';

export class ConfigurationManager {
    private configCache: Map<string, GitHubConfig> = new Map();
    private fileWatchers: vscode.FileSystemWatcher[] = [];
    private isInitialized = false;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) { }

    /**
     * Initialize configuration discovery and watching
     */
    async initialize(): Promise<void> {
        try {
            this.outputChannel.appendLine('Initializing configuration manager...');

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                this.outputChannel.appendLine('No workspace folders found');
                return;
            }

            // Discover configuration for each workspace folder
            for (const folder of workspaceFolders) {
                await this.discoverConfiguration(folder.uri.fsPath);
                await this.setupFileWatching(folder.uri.fsPath);
            }

            this.isInitialized = true;
            this.outputChannel.appendLine('Configuration manager initialized successfully');

        } catch (error) {
            this.outputChannel.appendLine(`Error initializing configuration manager: ${error}`);
            throw error;
        }
    }

    /**
     * Discover GitHub configuration files in workspace
     */
    async discoverConfiguration(workspaceRoot: string): Promise<GitHubConfig> {
        try {
            const config = getConfig();
            const githubConfig: GitHubConfig = {
                instructions: [],
                steering: [],
                prompts: [],
                copilotInstructions: null,
                lastUpdated: new Date()
            };

            // Check each configured directory
            for (const configDir of config.configDirectories) {
                const fullConfigPath = path.join(workspaceRoot, configDir);

                if (!(await directoryExists(fullConfigPath))) {
                    this.outputChannel.appendLine(`Configuration directory not found: ${fullConfigPath}`);
                    continue;
                }

                // Discover instructions files
                const instructionsPath = path.join(fullConfigPath, 'instructions');
                if (await directoryExists(instructionsPath)) {
                    const instructionFiles = await this.loadConfigFiles(instructionsPath, 'instructions');
                    githubConfig.instructions.push(...instructionFiles);
                }

                // Discover steering files  
                const steeringPath = path.join(fullConfigPath, 'steering');
                if (await directoryExists(steeringPath)) {
                    const steeringFiles = await this.loadConfigFiles(steeringPath, 'steering');
                    githubConfig.steering.push(...steeringFiles);
                }

                // Discover prompt files
                const promptsPath = path.join(fullConfigPath, 'prompts');
                if (await directoryExists(promptsPath)) {
                    const promptFiles = await this.loadConfigFiles(promptsPath, 'prompts');
                    githubConfig.prompts.push(...promptFiles);
                }

                // Load copilot instructions
                const copilotInstructionsPath = path.join(fullConfigPath, 'copilot-instructions.md');
                if (await fileExists(copilotInstructionsPath)) {
                    githubConfig.copilotInstructions = await readFileContent(copilotInstructionsPath);
                }
            }

            // Cache the configuration
            this.configCache.set(workspaceRoot, githubConfig);

            const totalFiles = githubConfig.instructions.length +
                githubConfig.steering.length +
                githubConfig.prompts.length;

            this.outputChannel.appendLine(
                `Discovered ${totalFiles} configuration files in ${workspaceRoot}`
            );

            return githubConfig;

        } catch (error) {
            this.outputChannel.appendLine(`Error discovering configuration: ${error}`);
            throw error;
        }
    }

    /**
     * Load configuration files from a directory
     */
    private async loadConfigFiles(dirPath: string, type: string): Promise<ConfigFile[]> {
        const configFiles: ConfigFile[] = [];

        try {
            const files = await findFilesRecursive(dirPath, ['.md', '.txt']);

            for (const filePath of files) {
                const content = await readFileContent(filePath);
                if (!content) {
                    continue;
                }

                const lastModified = await getFileModTime(filePath);
                const fileName = path.basename(filePath);

                let metadata: ConfigMetadata = { inclusion: 'always' };
                let processedContent = content;

                // Parse front-matter if it's a markdown file
                if (filePath.endsWith('.md')) {
                    const parsed = parseFrontMatter(content);
                    metadata = parsed.metadata;
                    processedContent = parsed.content;
                }

                configFiles.push({
                    path: filePath,
                    name: fileName,
                    content: processedContent,
                    metadata,
                    lastModified
                });
            }

            this.outputChannel.appendLine(`Loaded ${configFiles.length} ${type} files from ${dirPath}`);

        } catch (error) {
            this.outputChannel.appendLine(`Error loading ${type} files: ${error}`);
        }

        return configFiles;
    }

    /**
     * Setup file system watching for configuration changes
     */
    private async setupFileWatching(workspaceRoot: string): Promise<void> {
        try {
            const config = getConfig();

            for (const configDir of config.configDirectories) {
                const pattern = new vscode.RelativePattern(workspaceRoot, `${configDir}/**/*.{md,txt}`);
                const watcher = vscode.workspace.createFileSystemWatcher(pattern);

                // Handle file changes
                watcher.onDidChange(async (uri: vscode.Uri) => {
                    this.outputChannel.appendLine(`Configuration file changed: ${uri.fsPath}`);
                    await this.invalidateCache(workspaceRoot);
                    await this.discoverConfiguration(workspaceRoot);
                });

                watcher.onDidCreate(async (uri: vscode.Uri) => {
                    this.outputChannel.appendLine(`Configuration file created: ${uri.fsPath}`);
                    await this.invalidateCache(workspaceRoot);
                    await this.discoverConfiguration(workspaceRoot);
                });

                watcher.onDidDelete(async (uri: vscode.Uri) => {
                    this.outputChannel.appendLine(`Configuration file deleted: ${uri.fsPath}`);
                    await this.invalidateCache(workspaceRoot);
                    await this.discoverConfiguration(workspaceRoot);
                });

                this.fileWatchers.push(watcher);
                this.context.subscriptions.push(watcher);
            }

        } catch (error) {
            this.outputChannel.appendLine(`Error setting up file watching: ${error}`);
        }
    }

    /**
     * Get current configuration for the active workspace
     */
    async getCurrentConfig(): Promise<GitHubConfig | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Return cached config if available
        if (this.configCache.has(workspaceRoot)) {
            return this.configCache.get(workspaceRoot) || null;
        }

        // Discover configuration if not cached
        if (!this.isInitialized) {
            await this.initialize();
        }

        return this.configCache.get(workspaceRoot) || null;
    }

    /**
     * Refresh configuration by clearing cache and rediscovering
     */
    async refreshConfiguration(): Promise<void> {
        try {
            this.outputChannel.appendLine('Refreshing configuration...');

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return;
            }

            // Clear cache and rediscover for each workspace
            for (const folder of workspaceFolders) {
                await this.invalidateCache(folder.uri.fsPath);
                await this.discoverConfiguration(folder.uri.fsPath);
            }

            this.outputChannel.appendLine('Configuration refresh completed');

        } catch (error) {
            this.outputChannel.appendLine(`Error refreshing configuration: ${error}`);
            throw error;
        }
    }

    /**
     * Invalidate cached configuration for workspace
     */
    private async invalidateCache(workspaceRoot: string): Promise<void> {
        this.configCache.delete(workspaceRoot);
    }

    /**
     * Dispose of watchers and cleanup
     */
    async dispose(): Promise<void> {
        try {
            // Dispose file watchers
            this.fileWatchers.forEach(watcher => watcher.dispose());
            this.fileWatchers = [];

            // Clear cache
            this.configCache.clear();

            this.outputChannel.appendLine('Configuration manager disposed');

        } catch (error) {
            this.outputChannel.appendLine(`Error disposing configuration manager: ${error}`);
        }
    }
}
