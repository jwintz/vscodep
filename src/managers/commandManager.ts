import * as vscode from 'vscode';
import { ConfigurationManager } from './configurationManager';

export class CommandManager {
    private disposables: vscode.Disposable[] = [];
    private commands: Map<string, (...args: any[]) => any> = new Map();

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel,
        private configurationManager: ConfigurationManager
    ) {
        this.setupCommands();
    }

    /**
     * Register all commands with VSCode
     */
    async registerCommands(): Promise<void> {
        try {
            for (const [commandId, handler] of this.commands) {
                const disposable = vscode.commands.registerCommand(commandId, handler);
                this.disposables.push(disposable);
                this.context.subscriptions.push(disposable);
            }

            this.outputChannel.appendLine(`Registered ${this.commands.size} commands`);
        } catch (error) {
            this.outputChannel.appendLine(`Error registering commands: ${error}`);
            throw error;
        }
    }

    /**
     * Setup command handlers
     */
    private setupCommands(): void {
        this.commands.set('codep.initWorkflow', this.handleInitWorkflow.bind(this));
        this.commands.set('codep.continueWorkflow', this.handleContinueWorkflow.bind(this));
        this.commands.set('codep.injectConfig', this.handleInjectConfig.bind(this));
        this.commands.set('codep.refreshConfig', this.handleRefreshConfig.bind(this));
    }

    /**
     * Handle workflow initialization command
     */
    private async handleInitWorkflow(): Promise<void> {
        try {
            this.outputChannel.appendLine('Initializing new spec workflow...');

            // Check if workspace is available
            if (!vscode.workspace.workspaceFolders) {
                vscode.window.showErrorMessage('Please open a workspace to initialize a spec workflow');
                return;
            }

            // Prompt user for feature name
            const featureName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the feature you want to specify',
                placeHolder: 'e.g., user-authentication-system',
                validateInput: (value: string) => {
                    if (!value || value.trim().length < 3) {
                        return 'Feature name must be at least 3 characters long';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                        return 'Feature name can only contain letters, numbers, hyphens, and underscores';
                    }
                    return null;
                }
            });

            if (!featureName) {
                return; // User cancelled
            }

            // TODO: Create workflow state and navigate to requirements stage
            vscode.window.showInformationMessage(
                `Starting spec workflow for "${featureName}". Implementation coming soon!`
            );

            this.outputChannel.appendLine(`Initialized workflow for feature: ${featureName}`);

        } catch (error) {
            const errorMessage = `Error initializing workflow: ${error}`;
            this.outputChannel.appendLine(errorMessage);
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    /**
     * Handle workflow continuation command
     */
    private async handleContinueWorkflow(): Promise<void> {
        try {
            this.outputChannel.appendLine('Continuing existing workflow...');

            // TODO: Load existing workflow state and continue
            vscode.window.showInformationMessage('Continue workflow feature coming soon!');

        } catch (error) {
            const errorMessage = `Error continuing workflow: ${error}`;
            this.outputChannel.appendLine(errorMessage);
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    /**
     * Handle configuration injection command
     */
    private async handleInjectConfig(): Promise<void> {
        try {
            this.outputChannel.appendLine('Injecting configuration context...');

            // Get current configuration
            const config = await this.configurationManager.getCurrentConfig();

            if (!config) {
                vscode.window.showWarningMessage('No GitHub configuration found. Make sure you have a .github directory in your workspace.');
                return;
            }

            // TODO: Format and inject configuration for AI consumption
            const totalFiles = config.instructions.length + config.steering.length + config.prompts.length;

            vscode.window.showInformationMessage(
                `Found ${totalFiles} configuration files. Context injection implementation coming soon!`
            );

            this.outputChannel.appendLine(`Configuration loaded: ${totalFiles} files`);

        } catch (error) {
            const errorMessage = `Error injecting configuration: ${error}`;
            this.outputChannel.appendLine(errorMessage);
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    /**
     * Handle configuration refresh command
     */
    private async handleRefreshConfig(): Promise<void> {
        try {
            this.outputChannel.appendLine('Refreshing configuration...');

            await this.configurationManager.refreshConfiguration();

            vscode.window.showInformationMessage('Configuration refreshed successfully!');
            this.outputChannel.appendLine('Configuration refresh completed');

        } catch (error) {
            const errorMessage = `Error refreshing configuration: ${error}`;
            this.outputChannel.appendLine(errorMessage);
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    /**
     * Dispose of all registered commands
     */
    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        this.commands.clear();
    }
}
