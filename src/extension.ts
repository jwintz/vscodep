import * as vscode from 'vscode';
import { CommandManager } from './managers/commandManager';
import { ConfigurationManager } from './managers/configurationManager';
import { SpecNavigationQuickPick } from './editors/specNavigationQuickPick';

let outputChannel: vscode.OutputChannel;
let commandManager: CommandManager;
let configurationManager: ConfigurationManager;
let specNavigationQuickPick: SpecNavigationQuickPick;

/**
 * Extension activation entry point
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Create output channel for logging
        outputChannel = vscode.window.createOutputChannel('Code:P');
        outputChannel.appendLine('Code:P Extension activating...');

        // Initialize managers
        configurationManager = new ConfigurationManager(context, outputChannel);
        commandManager = new CommandManager(context, outputChannel, configurationManager);
        specNavigationQuickPick = new SpecNavigationQuickPick();

        // Register commands and providers
        await commandManager.registerCommands();

        // Register spec navigation command
        const specNavCommand = vscode.commands.registerCommand('codep.showSpecNavigation', async () => {
            try {
                await specNavigationQuickPick.show();
            } catch (error) {
                outputChannel.appendLine(`Error in spec navigation command: ${error}`);
                vscode.window.showErrorMessage(`Failed to show spec navigation: ${error}`);
            }
        });
        context.subscriptions.push(specNavCommand);

        // Initialize configuration discovery
        if (vscode.workspace.workspaceFolders) {
            await configurationManager.initialize();
        }

        outputChannel.appendLine('Code:P Extension activated successfully');

        // Show welcome message on first activation
        const isFirstRun = context.globalState.get('codep.firstRun', true);
        if (isFirstRun) {
            await showWelcomeMessage();
            await context.globalState.update('codep.firstRun', false);
        }

    } catch (error) {
        const errorMessage = `Failed to activate Code:P extension: ${error}`;
        outputChannel.appendLine(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
        throw error;
    }
}

/**
 * Extension deactivation cleanup
 */
export async function deactivate(): Promise<void> {
    try {
        outputChannel?.appendLine('Code:P Extension deactivating...');

        // Cleanup managers
        if (configurationManager) {
            await configurationManager.dispose();
        }

        if (commandManager) {
            commandManager.dispose();
        }

        // Dispose output channel
        outputChannel?.dispose();

    } catch (error) {
        console.error('Error during Code:P extension deactivation:', error);
    }
}

/**
 * Show welcome message to first-time users
 */
async function showWelcomeMessage(): Promise<void> {
    const message = 'Welcome to Code:P! Start by running "Code:P: Initialize Spec Workflow" from the Command Palette.';
    const action = 'Get Started';

    const result = await vscode.window.showInformationMessage(message, action);

    if (result === action) {
        await vscode.commands.executeCommand('codep.initWorkflow');
    }
}
