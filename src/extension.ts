import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let taskCodeLensProvider: TaskCodeLensProvider;

// ===== TYPES AND INTERFACES =====

interface BundledFile {
    absolutePath: string;
    relativePath: string;
    content: string;
}

interface SpecItem extends vscode.QuickPickItem {
    type: 'spec' | 'file';
    path: string;
    phase?: string;
}

interface TaskState {
    feature: string;
    taskIndex: number;
    status: 'implementing' | 'completed' | 'pending';
}

interface TaskProgress {
    totalTasks: number;
    completedTasks: number;
    currentTask: number | null;
}

interface TaskItem {
    index: number;
    text: string;
    completed: boolean;
    line: number;
}

// ===== GLOBAL STATE =====

let currentTaskState: TaskState | null = null;
let taskProgress: TaskProgress = {
    totalTasks: 0,
    completedTasks: 0,
    currentTask: null
};

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

// ===== TASK MANAGEMENT =====

async function parseTasksFromFile(filePath: string): Promise<TaskItem[]> {
    const uri = vscode.Uri.file(filePath);
    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const contentStr = Buffer.from(content).toString('utf8');
        const lines = contentStr.split('\n');
        const tasks: TaskItem[] = [];
        
        lines.forEach((line, index) => {
            // Match tasks in format: - [ ] or - [x] with optional numbering
            const taskMatch = line.match(/^\s*-\s*\[([x ])\]\s*(.+)$/);
            if (taskMatch) {
                tasks.push({
                    index: tasks.length,
                    text: taskMatch[2].trim(),
                    completed: taskMatch[1] === 'x',
                    line: index
                });
            }
        });
        
        return tasks;
    } catch (error) {
        outputChannel.appendLine(`Error parsing tasks from ${filePath}: ${error}`);
        return [];
    }
}

async function updateTaskProgress(feature: string): Promise<void> {
    const tasksFile = await findSpecFiles(feature);
    const tasksFilePath = tasksFile.find(file => file.includes('03-tasks'));
    
    if (tasksFilePath) {
        const tasks = await parseTasksFromFile(tasksFilePath);
        const completedCount = tasks.filter(task => task.completed).length;
        
        // Add stack trace to see what's calling this function
        const stack = new Error().stack;
        outputChannel.appendLine(`UPDATE TASK PROGRESS CALLED FROM: ${stack?.split('\n')[2]?.trim() || 'unknown'}`);
        outputChannel.appendLine(`UPDATE TASK PROGRESS: ${completedCount}/${tasks.length} tasks completed`);
        
        // Auto-clear currentTaskState if the current task is completed in the file
        if (currentTaskState && tasks[currentTaskState.taskIndex]?.completed) {
            outputChannel.appendLine(`AUTO-CLEARING: Task ${currentTaskState.taskIndex + 1} is completed in file, clearing currentTaskState`);
            currentTaskState = null;
            taskCodeLensProvider?.refresh();
        }
        
        taskProgress = {
            totalTasks: tasks.length,
            completedTasks: completedCount,
            currentTask: currentTaskState?.taskIndex || null
        };
        updateStatusBar();
    }
}

function updateStatusBar(): void {
    if (!statusBarItem) return;
    
    const { totalTasks, completedTasks, currentTask } = taskProgress;
    
    if (totalTasks === 0) {
        statusBarItem.text = "$(checklist) Code:P Ready";
        statusBarItem.tooltip = "Code:P Extension Status";
        statusBarItem.show();
        return;
    }
    
    const progressPercent = Math.round((completedTasks / totalTasks) * 100);
    const isImplementing = currentTaskState !== null && completedTasks < totalTasks;
    const animatedDot = isImplementing ? ' $(sync~spin)' : '';
    
    // Debug logging
    outputChannel.appendLine(`Status Bar Update: currentTaskState=${currentTaskState ? 'SET' : 'NULL'}, isImplementing=${isImplementing}, completed=${completedTasks}/${totalTasks}`);
    
    statusBarItem.text = `$(checklist) ${completedTasks}/${totalTasks} (${progressPercent}%)${animatedDot}`;
    statusBarItem.tooltip = isImplementing 
        ? `Implementing task ${currentTask! + 1} of ${totalTasks}...`
        : `${completedTasks} of ${totalTasks} tasks completed`;
    statusBarItem.show();
}

async function startTaskImplementation(feature: string, taskIndex: number): Promise<void> {
    outputChannel.appendLine(`START TASK CALLED: task ${taskIndex + 1} in feature ${feature}`);
    
    // Safety check: Don't start already completed tasks
    const tasksFile = await findSpecFiles(feature);
    const tasksFilePath = tasksFile.find(file => file.includes('03-tasks'));
    if (tasksFilePath) {
        const tasks = await parseTasksFromFile(tasksFilePath);
        if (tasks[taskIndex] && tasks[taskIndex].completed) {
            outputChannel.appendLine(`ERROR: Attempted to start already completed task ${taskIndex + 1}`);
            return;
        }
    }
    
    currentTaskState = {
        feature,
        taskIndex,
        status: 'implementing'
    };
    
    await updateTaskProgress(feature);
    
    // Trigger spec04 workflow for this task
    await vscode.commands.executeCommand('workbench.action.chat.open', `/spec04 task ${taskIndex + 1}`);
    
    outputChannel.appendLine(`Started implementation of task ${taskIndex + 1} in feature ${feature}`);
}

async function completeTaskImplementation(): Promise<void> {
    if (!currentTaskState) return;
    
    const { feature, taskIndex } = currentTaskState;
    outputChannel.appendLine(`BEFORE COMPLETION: currentTaskState=${currentTaskState ? 'SET' : 'NULL'} (task ${taskIndex + 1})`);
    
    await markTaskCompleted(feature, taskIndex);
    
    // Clear the current task state first
    currentTaskState = null;
    outputChannel.appendLine(`AFTER CLEARING: currentTaskState=${currentTaskState ? 'SET' : 'NULL'}`);
    
    // Update progress (this will call updateStatusBar internally)
    await updateTaskProgress(feature);
    
    // Refresh CodeLens to show "Task Complete"
    taskCodeLensProvider?.refresh();
    
    outputChannel.appendLine(`Completed task ${taskIndex + 1} in feature ${feature}`);
    outputChannel.appendLine(`FINAL STATE: currentTaskState=${currentTaskState ? 'SET' : 'NULL'}`);
}

async function markTaskCompleted(feature: string, taskIndex: number): Promise<void> {
    const tasksFile = await findSpecFiles(feature);
    const tasksFilePath = tasksFile.find(file => file.includes('03-tasks'));
    
    if (!tasksFilePath) return;
    
    try {
        const uri = vscode.Uri.file(tasksFilePath);
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === tasksFilePath);
        
        if (document) {
            // If document is open, use WorkspaceEdit for live updates
            const edit = new vscode.WorkspaceEdit();
            const lines = document.getText().split('\n');
            
            let taskCount = 0;
            for (let i = 0; i < lines.length; i++) {
                const taskMatch = lines[i].match(/^\s*-\s*\[([x ])\]/);
                if (taskMatch && taskCount === taskIndex) {
                    const range = new vscode.Range(i, 0, i, lines[i].length);
                    const newText = lines[i].replace(/^\s*-\s*\[\s\]/, '- [x]');
                    edit.replace(uri, range, newText);
                    break;
                } else if (taskMatch) {
                    taskCount++;
                }
            }
            
            await vscode.workspace.applyEdit(edit);
        }
        
        outputChannel.appendLine(`Marked task ${taskIndex + 1} as completed`);
        
    } catch (error) {
        outputChannel.appendLine(`Error marking task as completed: ${error}`);
    }
}

// ===== CODELENS PROVIDER FOR TASK INTERACTION =====

class TaskCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        
        // Only provide CodeLenses for task files (03-tasks.md)
        if (!document.fileName.includes('03-tasks.md') || !isSpecFile(document.fileName)) {
            return codeLenses;
        }
        
        const feature = getSpecFeature(document.fileName);
        if (!feature) return codeLenses;
        
        const text = document.getText();
        const lines = text.split('\n');
        
        let taskIndex = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const taskMatch = line.match(/^\s*-\s*\[(\s|x)\]\s*(.+)$/);
            
            if (taskMatch) {
                const isCompleted = taskMatch[1] === 'x';
                const isCurrentTask = currentTaskState?.taskIndex === taskIndex;
                
                const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
                let title: string;
                let command: vscode.Command | undefined;
                
                if (isCompleted) {
                    title = '$(check) Task Complete';
                    command = undefined; // No click action for completed tasks
                } else if (isCurrentTask) {
                    title = '$(sync~spin) Implementing...';
                    command = undefined; // No click action while implementing
                } else {
                    title = '$(play) Start Task';
                    command = {
                        title: 'Start Task Implementation',
                        command: 'codep.startTask',
                        arguments: [feature, taskIndex]
                    };
                }
                
                codeLenses.push(new vscode.CodeLens(range, command ? {
                    title,
                    command: command.command,
                    arguments: command.arguments
                } : {
                    title,
                    command: ''
                }));
                
                taskIndex++;
            }
        }
        
        return codeLenses;
    }

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
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
                absolutePath: copilotInstructionsUri.fsPath,
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
                        absolutePath: fileUri.fsPath,
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

async function showDiffEditor(bundledFile: BundledFile, workspaceUri: vscode.Uri, index: number): Promise<void> {
    
    const bundledUri = vscode.Uri.parse(`${bundledFile.absolutePath}`);

    await vscode.commands.executeCommand('vscode.diff',
        bundledUri,
        workspaceUri,
        `${bundledFile.relativePath}: Extension Bundle ↔ Workspace`,
        {
            preview: false
        }
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

    // Check if tasks file has uncompleted tasks
    const tasksFile = files.find(file => file.includes('03-tasks'));
    if (tasksFile) {
        try {
            const tasksUri = vscode.Uri.file(tasksFile);
            const tasksContent = await vscode.workspace.fs.readFile(tasksUri);
            const contentStr = Buffer.from(tasksContent).toString('utf8');

            // Check for uncompleted tasks (- [ ])
            const hasUncompletedTasks = contentStr.includes('- [ ]');
            if (hasUncompletedTasks) {
                return false;
            }
        } catch (error) {
            outputChannel.appendLine(`Error reading tasks file ${tasksFile}: ${error}`);
            // If we can't read the file, assume it's incomplete
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
        const conflicts: { file: BundledFile, targetUri: vscode.Uri; }[] = [];

        for (const file of bundledFiles) {
            const targetUri = vscode.Uri.joinPath(workspaceRoot, file.relativePath);

            if (await fileExists(targetUri)) {
                // Compare contents
                const workspaceContent = await vscode.workspace.fs.readFile(targetUri);
                const workspaceContentStr = Buffer.from(workspaceContent).toString('utf8');

                if (!(await compareFileContents(file.content, workspaceContentStr))) {
                    // Content differs, collect for batch processing
                    conflicts.push({ file, targetUri });
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

        // Open all diff editors with slight delays to ensure they all appear
        for (let i = 0; i < conflicts.length; i++) {
            const { file, targetUri } = conflicts[i];
            setTimeout(() => {
                showDiffEditor(file, targetUri, i);
            }, i * 100); // 100ms delay between each diff editor
        }

        const message = `Configuration injection completed. Created: ${copiedCount}, Conflicts: ${conflictCount}`;
        outputChannel.appendLine(message);

        if (conflictCount > 0) {
            vscode.window.showInformationMessage(`${message}. Please review and save the diff editors to resolve conflicts.`);
        } else {
            const selection = await vscode.window.showInformationMessage(
                `${message}. Reload window to activate new configuration?`,
                'Reload',
                'Later'
            );

            if (selection === 'Reload') {
                await vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
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

        // Trigger spec01 prompt
        outputChannel.appendLine('About to trigger /spec01 prompt...');

        // Check if prompt file exists in workspace
        const promptFile = vscode.Uri.joinPath(workspaceRoot, '.github', 'prompts', 'spec01.prompt.md');
        const promptExists = await fileExists(promptFile);
        outputChannel.appendLine(`Prompt file exists in workspace: ${promptExists}`);

        if (promptExists) {
            const promptContent = await vscode.workspace.fs.readFile(promptFile);
            const contentStr = Buffer.from(promptContent).toString('utf8');
            outputChannel.appendLine(`Prompt file size: ${contentStr.length} characters`);
            outputChannel.appendLine(`Prompt contains "MUST ask for feature name": ${contentStr.includes('MUST ask for the feature name')}`);
        }

        await vscode.commands.executeCommand('workbench.action.chat.open', '/spec01');

        outputChannel.appendLine('Workflow initialization completed - spec01 prompt triggered');

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
            if (features.length === 0) {
                vscode.window.showInformationMessage('No specification exist.');
            } else {
                vscode.window.showInformationMessage('No incomplete workflows found. All specifications are complete!');
            }
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
            // Update task progress for the selected feature
            await updateTaskProgress(selected.label);
            
            // Determine which phase to continue and execute appropriate prompt
            const files = await findSpecFiles(selected.label);

            // Check which phase needs to be worked on
            const hasRequirements = files.some(file => file.includes('01-requirements'));
            const hasDesign = files.some(file => file.includes('02-design'));
            const hasTasks = files.some(file => file.includes('03-tasks') || file.includes('03-plan'));

            let promptCommand = '';

            if (!hasRequirements) {
                promptCommand = '/spec01';
            } else if (!hasDesign) {
                promptCommand = '/spec02';
            } else if (!hasTasks) {
                promptCommand = '/spec03';
            } else {
                // Has all files but tasks are incomplete, continue with implementation
                promptCommand = '/spec04';
            }

            outputChannel.appendLine(`Executing prompt: ${promptCommand} for feature: ${selected.label}`);

            // Execute the appropriate spec prompt
            await vscode.commands.executeCommand('workbench.action.chat.open', promptCommand);

            outputChannel.appendLine(`Workflow continuation completed - ${promptCommand} prompt triggered for "${selected.label}"`);
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

        // Create status bar item
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.text = "$(checklist) Code:P Ready";
        statusBarItem.tooltip = "Code:P Extension Status";
        statusBarItem.command = 'codep.showTaskProgress';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        // Create and register CodeLens provider for task interaction
        taskCodeLensProvider = new TaskCodeLensProvider();
        const codeLensDisposable = vscode.languages.registerCodeLensProvider(
            { scheme: 'file', pattern: '**/*03-tasks.md' },
            taskCodeLensProvider
        );
        context.subscriptions.push(codeLensDisposable);

        // Register commands
        const commands = [
            vscode.commands.registerCommand('codep.injectConfig', () => injectConfig(context)),
            vscode.commands.registerCommand('codep.refreshConfig', () => injectConfig(context)), // Alias
            vscode.commands.registerCommand('codep.showSpecNavigation', showSpecNavigation),
            vscode.commands.registerCommand('codep.initWorkflow', () => initWorkflow(context)),
            vscode.commands.registerCommand('codep.continueWorkflow', continueWorkflow),
            vscode.commands.registerCommand('codep.startTask', async (feature: string, taskIndex: number) => {
                await startTaskImplementation(feature, taskIndex);
                taskCodeLensProvider.refresh();
            }),
            vscode.commands.registerCommand('codep.completeTask', async () => {
                await completeTaskImplementation();
                taskCodeLensProvider.refresh();
            }),
            vscode.commands.registerCommand('codep.showTaskProgress', async () => {
                if (currentTaskState) {
                    const { feature } = currentTaskState;
                    const tasksFile = await findSpecFiles(feature);
                    const tasksFilePath = tasksFile.find(file => file.includes('03-tasks'));
                    if (tasksFilePath) {
                        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tasksFilePath));
                    }
                } else {
                    await showSpecNavigation();
                }
            })
        ];

        context.subscriptions.push(...commands);

        // Listen for document changes to update task progress
        const documentChangeListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.fileName.includes('03-tasks.md') && isSpecFile(document.fileName)) {
                const feature = getSpecFeature(document.fileName);
                if (feature) {
                    await updateTaskProgress(feature);
                    taskCodeLensProvider.refresh();
                }
            }
        });
        context.subscriptions.push(documentChangeListener);

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

        // Dispose output channel and status bar
        outputChannel?.dispose();
        statusBarItem?.dispose();

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
