import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel;

// ===== TYPES AND INTERFACES =====

interface BundledFile {
    relativePath: string;
    content: string;
}

interface SpecItem extends vscode.QuickPickItem {
    type: 'spec' | 'file';
    path: string;
    phase?: string;
}

// Simple front-matter parser for web compatibility
function parseFrontMatter(content: string): { content: string; data: any; } {
    const frontMatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
    const match = content.match(frontMatterRegex);

    if (!match) {
        return { content, data: {} };
    }

    const yamlContent = match[1];
    const remainingContent = content.slice(match[0].length);

    // Simple YAML parser for basic key-value pairs
    const data: any = {};
    const lines = yamlContent.split('\n');

    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
            data[key] = value;
        }
    }

    return { content: remainingContent, data };
}

// ===== FILE UTILITIES =====

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function directoryExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.Directory) !== 0;
    } catch {
        return false;
    }
}

async function ensureDirectory(fileUri: vscode.Uri): Promise<void> {
    const parentUri = vscode.Uri.joinPath(fileUri, '..');
    if (!(await directoryExists(parentUri))) {
        await vscode.workspace.fs.createDirectory(parentUri);
    }
}

async function getWorkspaceRoot(): Promise<vscode.Uri> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    return workspaceFolder.uri;
}

// ===== BUNDLED FILES MANAGEMENT =====

async function getBundledFiles(context: vscode.ExtensionContext): Promise<BundledFile[]> {
    const bundledFiles: BundledFile[] = [];
    const githubUri = vscode.Uri.joinPath(context.extensionUri, '.github');

    try {
        // Get copilot-instructions.md
        const copilotInstructionsUri = vscode.Uri.joinPath(githubUri, 'copilot-instructions.md');
        if (await fileExists(copilotInstructionsUri)) {
            const content = await vscode.workspace.fs.readFile(copilotInstructionsUri);
            bundledFiles.push({
                relativePath: '.github/copilot-instructions.md',
                content: Buffer.from(content).toString('utf8')
            });
        }

        // Get prompt files
        const promptsUri = vscode.Uri.joinPath(githubUri, 'prompts');
        if (await directoryExists(promptsUri)) {
            const promptFiles = await vscode.workspace.fs.readDirectory(promptsUri);
            for (const [fileName, type] of promptFiles) {
                if (type === vscode.FileType.File && fileName.endsWith('.md')) {
                    const fileUri = vscode.Uri.joinPath(promptsUri, fileName);
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    bundledFiles.push({
                        relativePath: `.github/prompts/${fileName}`,
                        content: Buffer.from(content).toString('utf8')
                    });
                }
            }
        }

        outputChannel.appendLine(`Found ${bundledFiles.length} bundled configuration files`);
        return bundledFiles;
    } catch (error) {
        outputChannel.appendLine(`Error reading bundled files: ${error}`);
        return [];
    }
}

async function compareFileContents(bundledContent: string, workspaceContent: string): Promise<boolean> {
    return bundledContent.trim() === workspaceContent.trim();
}

async function showDiffEditor(bundledFile: BundledFile, workspaceUri: vscode.Uri): Promise<void> {
    // Create a temporary URI for the bundled content
    const bundledUri = vscode.Uri.parse(`untitled:Extension Bundle - ${bundledFile.relativePath}`);

    // Create temporary document with bundled content
    const doc = await vscode.workspace.openTextDocument(bundledUri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(bundledUri, new vscode.Position(0, 0), bundledFile.content);
    await vscode.workspace.applyEdit(edit);

    // Open diff editor
    await vscode.commands.executeCommand('vscode.diff',
        bundledUri,
        workspaceUri,
        `${bundledFile.relativePath}: Extension Bundle ↔ Workspace`
    );
}

// ===== SPEC UTILITIES =====

function isSpecFile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return /\.github\/specs\/[^\/]+\/\d{2}-[^\/]+\.md$/.test(normalizedPath);
}

function getSpecFeature(filePath: string): string | null {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const match = normalizedPath.match(/\.github\/specs\/([^\/]+)\//);
    return match ? match[1] : null;
}

function getSpecPhase(filePath: string): string | null {
    const fileName = filePath.split(/[\/\\]/).pop() || '';
    const match = fileName.match(/^\d{2}-(.+)\.md$/);
    return match ? match[1] : null;
}

async function findSpecFeatures(): Promise<string[]> {
    const workspaceRoot = await getWorkspaceRoot();
    const specsUri = vscode.Uri.joinPath(workspaceRoot, '.github', 'specs');

    if (!(await directoryExists(specsUri))) {
        return [];
    }

    const entries = await vscode.workspace.fs.readDirectory(specsUri);
    return entries
        .filter(([name, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name);
}

async function findSpecFiles(feature: string): Promise<string[]> {
    const workspaceRoot = await getWorkspaceRoot();
    const featureUri = vscode.Uri.joinPath(workspaceRoot, '.github', 'specs', feature);

    if (!(await directoryExists(featureUri))) {
        return [];
    }

    const entries = await vscode.workspace.fs.readDirectory(featureUri);
    return entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
        .map(([name]) => vscode.Uri.joinPath(featureUri, name).fsPath);
}

async function isSpecComplete(feature: string): Promise<boolean> {
    const files = await findSpecFiles(feature);
    const requiredPhases = ['01-requirements', '02-design', '03-tasks'];

    for (const phase of requiredPhases) {
        const hasPhase = files.some(file => file.includes(phase));
        if (!hasPhase) {
            return false;
        }
    }
    return true;
}

// ===== COMMAND IMPLEMENTATIONS =====

async function injectConfig(context: vscode.ExtensionContext): Promise<void> {
    try {
        outputChannel.appendLine('Starting configuration injection...');

        const bundledFiles = await getBundledFiles(context);
        if (bundledFiles.length === 0) {
            vscode.window.showWarningMessage('No configuration files found in extension bundle');
            return;
        }

        const workspaceRoot = await getWorkspaceRoot();
        let copiedCount = 0;
        let conflictCount = 0;

        // Ensure base directories exist
        const baseDirs = ['.github/hooks', '.github/instructions', '.github/steering'];
        for (const dir of baseDirs) {
            const dirUri = vscode.Uri.joinPath(workspaceRoot, dir);
            if (!(await directoryExists(dirUri))) {
                await vscode.workspace.fs.createDirectory(dirUri);
                outputChannel.appendLine(`Created directory: ${dir}`);
            }
        }

        // Process each bundled file
        for (const file of bundledFiles) {
            const targetUri = vscode.Uri.joinPath(workspaceRoot, file.relativePath);

            if (await fileExists(targetUri)) {
                // Compare contents
                const workspaceContent = await vscode.workspace.fs.readFile(targetUri);
                const workspaceContentStr = Buffer.from(workspaceContent).toString('utf8');

                if (!(await compareFileContents(file.content, workspaceContentStr))) {
                    // Content differs, show diff editor
                    await showDiffEditor(file, targetUri);
                    conflictCount++;
                    outputChannel.appendLine(`Conflict detected: ${file.relativePath}`);
                }
            } else {
                // File doesn't exist, create it
                await ensureDirectory(targetUri);
                await vscode.workspace.fs.writeFile(targetUri, Buffer.from(file.content, 'utf8'));
                copiedCount++;
                outputChannel.appendLine(`Created: ${file.relativePath}`);
            }
        }

        const message = `Configuration injection completed. Created: ${copiedCount}, Conflicts: ${conflictCount}`;
        outputChannel.appendLine(message);

        if (conflictCount > 0) {
            vscode.window.showInformationMessage(`${message}. Please review and save the diff editors to resolve conflicts.`);
        } else {
            vscode.window.showInformationMessage(message);
        }

    } catch (error) {
        const errorMessage = `Error during configuration injection: ${error}`;
        outputChannel.appendLine(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
    }
}

async function showSpecNavigation(): Promise<void> {
    try {
        const activeEditor = vscode.window.activeTextEditor;

        // Check if current file is part of a spec
        if (activeEditor) {
            const currentFile = activeEditor.document.uri.fsPath;

            if (isSpecFile(currentFile)) {
                const feature = getSpecFeature(currentFile);
                if (feature) {
                    await showSpecFiles(feature, currentFile);
                    return;
                }
            }
        }

        // Show feature selection
        await showSpecFeatures();

    } catch (error) {
        const errorMessage = `Error in spec navigation: ${error}`;
        outputChannel.appendLine(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
    }
}

async function showSpecFeatures(): Promise<void> {
    const features = await findSpecFeatures();

    if (features.length === 0) {
        const selection = await vscode.window.showInformationMessage(
            'No specification features found. Would you like to initialize a workflow?',
            'Initialize Workflow',
            'Cancel'
        );

        if (selection === 'Initialize Workflow') {
            await vscode.commands.executeCommand('codep.initWorkflow');
        }
        return;
    }

    const items: vscode.QuickPickItem[] = features.map(feature => ({
        label: feature,
        description: 'Specification feature',
        detail: `Open ${feature} specification`
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a specification feature to navigate'
    });

    if (selected) {
        await showSpecFiles(selected.label);
    }
}

async function showSpecFiles(feature: string, currentFile?: string): Promise<void> {
    const files = await findSpecFiles(feature);

    if (files.length === 0) {
        vscode.window.showInformationMessage(`No specification files found for ${feature}`);
        return;
    }

    const items: SpecItem[] = files.map(filePath => {
        const fileName = filePath.split(/[\/\\]/).pop() || '';
        const phase = getSpecPhase(filePath) || fileName;
        const isCurrent = currentFile === filePath;

        return {
            type: 'file',
            path: filePath,
            phase,
            label: `${isCurrent ? '$(arrow-right) ' : ''}${phase}`,
            description: fileName,
            detail: filePath
        };
    });

    // Sort by phase order
    items.sort((a, b) => {
        const order = ['requirements', 'design', 'tasks'];
        const aIndex = order.findIndex(phase => a.phase?.includes(phase));
        const bIndex = order.findIndex(phase => b.phase?.includes(phase));
        return aIndex - bIndex;
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Navigate ${feature} specification files`
    });

    if (selected && selected.type === 'file') {
        const uri = vscode.Uri.file(selected.path);
        await vscode.commands.executeCommand('vscode.open', uri);
    }
}

async function initWorkflow(context: vscode.ExtensionContext): Promise<void> {
    try {
        outputChannel.appendLine('Initializing workflow...');

        // Check if configuration needs injection/refresh
        const workspaceRoot = await getWorkspaceRoot();
        const copilotInstructionsUri = vscode.Uri.joinPath(workspaceRoot, '.github', 'copilot-instructions.md');
        const promptsUri = vscode.Uri.joinPath(workspaceRoot, '.github', 'prompts');

        const configExists = await fileExists(copilotInstructionsUri) && await directoryExists(promptsUri);

        if (!configExists) {
            // Need to inject configuration first
            await injectConfig(context);
        } else {
            // Check if refresh is needed by comparing with bundled files
            const bundledFiles = await getBundledFiles(context);
            let needsRefresh = false;

            for (const bundledFile of bundledFiles) {
                const targetUri = vscode.Uri.joinPath(workspaceRoot, bundledFile.relativePath);
                if (await fileExists(targetUri)) {
                    const workspaceContent = await vscode.workspace.fs.readFile(targetUri);
                    const workspaceContentStr = Buffer.from(workspaceContent).toString('utf8');
                    if (!(await compareFileContents(bundledFile.content, workspaceContentStr))) {
                        needsRefresh = true;
                        break;
                    }
                }
            }

            if (needsRefresh) {
                const selection = await vscode.window.showInformationMessage(
                    'Configuration files may be outdated. Would you like to refresh them?',
                    'Refresh',
                    'Continue'
                );

                if (selection === 'Refresh') {
                    await injectConfig(context);
                }
            }
        }

        // Trigger spec-01-requirements prompt
        outputChannel.appendLine('About to trigger /spec-01-requirements prompt...');

        // Check if prompt file exists in workspace
        const promptFile = vscode.Uri.joinPath(workspaceRoot, '.github', 'prompts', 'spec-01-requirements.prompt.md');
        const promptExists = await fileExists(promptFile);
        outputChannel.appendLine(`Prompt file exists in workspace: ${promptExists}`);

        if (promptExists) {
            const promptContent = await vscode.workspace.fs.readFile(promptFile);
            const contentStr = Buffer.from(promptContent).toString('utf8');
            outputChannel.appendLine(`Prompt file size: ${contentStr.length} characters`);
            outputChannel.appendLine(`Prompt contains "MUST ask for feature name": ${contentStr.includes('MUST ask for the feature name')}`);
        }

        await vscode.commands.executeCommand('workbench.action.chat.open', '/spec01');

        outputChannel.appendLine('Workflow initialization completed - spec-01-requirements prompt triggered');

    } catch (error) {
        const errorMessage = `Error initializing workflow: ${error}`;
        outputChannel.appendLine(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
    }
}

async function continueWorkflow(): Promise<void> {
    try {
        outputChannel.appendLine('Finding incomplete workflows...');

        const features = await findSpecFeatures();
        const incompleteFeatures: string[] = [];

        for (const feature of features) {
            const isComplete = await isSpecComplete(feature);
            if (!isComplete) {
                incompleteFeatures.push(feature);
            }
        }

        if (incompleteFeatures.length === 0) {
            vscode.window.showInformationMessage('No incomplete workflows found. All specifications are complete!');
            return;
        }

        const items: vscode.QuickPickItem[] = incompleteFeatures.map(feature => ({
            label: feature,
            description: 'Incomplete specification',
            detail: `Continue working on ${feature}`
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an incomplete workflow to continue'
        });

        if (selected) {
            // Open the most recent file in the spec
            const files = await findSpecFiles(selected.label);
            if (files.length > 0) {
                // Sort files and open the most recent one
                files.sort((a, b) => {
                    const getPhaseNumber = (path: string) => {
                        const match = path.match(/(\d{2})-/);
                        return match ? parseInt(match[1]) : 0;
                    };
                    return getPhaseNumber(b) - getPhaseNumber(a);
                });

                const uri = vscode.Uri.file(files[0]);
                await vscode.commands.executeCommand('vscode.open', uri);

                vscode.window.showInformationMessage(
                    `Continuing workflow for "${selected.label}". Use the appropriate spec prompt to continue development.`
                );
            }
        }

    } catch (error) {
        const errorMessage = `Error continuing workflow: ${error}`;
        outputChannel.appendLine(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
    }
}

/**
 * Extension activation entry point
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Create output channel for logging
        outputChannel = vscode.window.createOutputChannel('Code:P');
        outputChannel.appendLine('Code:P Extension activating...');

        // Register commands
        const commands = [
            vscode.commands.registerCommand('codep.injectConfig', () => injectConfig(context)),
            vscode.commands.registerCommand('codep.refreshConfig', () => injectConfig(context)), // Alias
            vscode.commands.registerCommand('codep.showSpecNavigation', showSpecNavigation),
            vscode.commands.registerCommand('codep.initWorkflow', () => initWorkflow(context)),
            vscode.commands.registerCommand('codep.continueWorkflow', continueWorkflow)
        ];

        context.subscriptions.push(...commands);

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
