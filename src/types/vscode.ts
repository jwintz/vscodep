import * as vscode from 'vscode';

/**
 * Type for command handler functions
 */
export type CommandHandler = (...args: any[]) => any;

/**
 * VSCode extension configuration
 */
export interface CodePConfig {
    autoDiscovery: boolean;
    configDirectories: string[];
    contextInjection: {
        maxFileSize: number;
    };
    workflow: {
        autoSave: boolean;
    };
}

/**
 * Get typed configuration for Code:P extension
 */
export function getConfig(): CodePConfig {
    const config = vscode.workspace.getConfiguration('codep');
    return {
        autoDiscovery: config.get<boolean>('autoDiscovery', true),
        configDirectories: config.get<string[]>('configDirectories', ['.github']),
        contextInjection: {
            maxFileSize: config.get<number>('contextInjection.maxFileSize', 100000),
        },
        workflow: {
            autoSave: config.get<boolean>('workflow.autoSave', true),
        },
    };
}
