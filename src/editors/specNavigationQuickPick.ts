import * as vscode from 'vscode';
import * as path from 'path';
import { findSpecFiles, findSpecDirectories } from '../utils/fileUtils';

interface SpecNavigationItem extends vscode.QuickPickItem {
    filePath: string;
    step: string;
}

/**
 * Provides quick pick navigation for spec workflow files
 */
export class SpecNavigationQuickPick {

    /**
     * Show the spec navigation quick pick
     */
    public async show(): Promise<void> {
        console.log('SpecNavigationQuickPick.show() called');

        const activeEditor = vscode.window.activeTextEditor;

        // Check if current file is a spec file
        if (activeEditor) {
            const currentFile = activeEditor.document.uri.fsPath;
            console.log('Current file:', currentFile);

            // Check if current file is in a spec directory
            if (this.isSpecFile(currentFile)) {
                await this.showSpecNavigation(currentFile);
                return;
            }
        }

        // If no active editor or not a spec file, show feature selection
        console.log('No spec file active, showing feature selection');
        await this.showFeatureSelection();
    }

    /**
     * Check if a file is a spec workflow file
     */
    private isSpecFile(filePath: string): boolean {
        const fileName = path.basename(filePath).toLowerCase();
        const specFilePatterns = [
            '*requirements*.md',
            '*design*.md',
            '*tasks*.md'
        ];

        return specFilePatterns.some(pattern => {
            // Convert glob pattern to regex
            const regexPattern = pattern
                .replace(/\*/g, '.*')
                .replace(/\./g, '\\.');
            const regex = new RegExp(`^${regexPattern}$`);
            return regex.test(fileName);
        });
    }

    /**
     * Show navigation for files in the current spec feature
     */
    private async showSpecNavigation(currentFile: string): Promise<void> {
        console.log('Current file:', currentFile);

        const specFiles = await this.findRelatedSpecFiles(currentFile);
        console.log('Found spec files:', specFiles);

        if (specFiles.length === 0) {
            console.log('No spec files found');
            const selection = await vscode.window.showInformationMessage(
                'No spec workflow files found in the current directory.',
                'Initialize Spec Workflow',
                'Cancel'
            );

            if (selection === 'Initialize Spec Workflow') {
                await vscode.commands.executeCommand('codep.initWorkflow');
            }
            return;
        }

        const featureName = this.getFeatureName(currentFile);
        console.log('Feature name:', featureName);

        // Create and sort items by workflow order
        const items = specFiles
            .map(file => this.createQuickPickItem(file, currentFile))
            .sort((a, b) => this.getStepOrder(a.step) - this.getStepOrder(b.step));

        console.log('QuickPick items:', items.map(i => i.label));

        // Use simple showQuickPick
        console.log('About to show simple quickPick');
        const simpleItems = items.map(item => ({
            label: item.label,
            description: item.description,
            detail: item.detail,
            filePath: item.filePath
        }));

        const selected = await vscode.window.showQuickPick(simpleItems, {
            title: `Code:P ${featureName}`,
            placeHolder: 'Select a spec file to open',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            console.log('User selected:', selected.label);
            await this.openFile(selected.filePath);
        } else {
            console.log('User cancelled selection');
        }
    }

    /**
     * Show feature selection when no spec file is active
     */
    private async showFeatureSelection(): Promise<void> {
        console.log('showFeatureSelection: Starting feature selection');
        const features = await findSpecDirectories();
        console.log('showFeatureSelection: Found features:', features);

        if (features.length === 0) {
            console.log('showFeatureSelection: No features found, showing init workflow option');
            const selection = await vscode.window.showInformationMessage(
                'No spec features found in .github/specs directory.',
                'Initialize Spec Workflow',
                'Cancel'
            );

            if (selection === 'Initialize Spec Workflow') {
                console.log('showFeatureSelection: User selected Initialize Spec Workflow');
                await vscode.commands.executeCommand('codep.initWorkflow');
            }
            return;
        }

        console.log('Found features:', features);

        const featureItems = features.map(feature => ({
            label: feature.name,
            description: 'Spec Feature',
            detail: `Navigate to ${feature.name} spec files`,
            path: feature.path
        }));

        const selectedFeature = await vscode.window.showQuickPick(featureItems, {
            title: 'Code:P',
            placeHolder: 'Select a spec feature to navigate',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selectedFeature) {
            console.log('User selected feature:', selectedFeature.label);
            await this.showSpecFilesForFeature(selectedFeature.path);
        } else {
            console.log('User cancelled feature selection');
        }
    }

    /**
     * Show spec files for a selected feature
     */
    private async showSpecFilesForFeature(featurePath: string): Promise<void> {
        const specFiles = await findSpecFiles(featurePath);

        if (specFiles.length === 0) {
            const selection = await vscode.window.showInformationMessage(
                'No spec files found in selected feature.',
                'Initialize Spec Workflow',
                'Cancel'
            );

            if (selection === 'Initialize Spec Workflow') {
                await vscode.commands.executeCommand('codep.initWorkflow');
            }
            return;
        }

        const featureName = path.basename(featurePath);

        // Create and sort items by workflow order
        const items = specFiles
            .map(file => this.createQuickPickItem(file, '')) // No current file to highlight
            .sort((a, b) => this.getStepOrder(a.step) - this.getStepOrder(b.step));

        console.log('Feature spec items:', items.map(i => i.label));

        const simpleItems = items.map(item => ({
            label: item.label,
            description: item.description,
            detail: item.detail,
            filePath: item.filePath
        }));

        const selected = await vscode.window.showQuickPick(simpleItems, {
            title: `Code:P ${featureName}`,
            placeHolder: `Select a ${featureName} spec file to open`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            console.log('User selected spec file:', selected.label);
            await this.openFile(selected.filePath);
        } else {
            console.log('User cancelled spec file selection');
        }
    }

    /**
     * Find related spec files for the current file
     */
    private async findRelatedSpecFiles(currentFilePath: string): Promise<string[]> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(currentFilePath));
        if (!workspaceFolder) {
            return [];
        }

        const currentDir = path.dirname(currentFilePath);
        return await findSpecFiles(currentDir);
    }

    /**
     * Create a quick pick item for a spec file
     */
    private createQuickPickItem(filePath: string, currentFilePath: string): SpecNavigationItem {
        const fileName = path.basename(filePath);
        const step = this.getStepFromFileName(fileName);
        const isCurrent = filePath === currentFilePath;

        let description = step;
        if (isCurrent) {
            description += ' (current)';
        }

        return {
            label: this.getStepLabel(step),
            description,
            detail: fileName,
            filePath,
            step
        };
    }

    /**
     * Get feature name from file path
     */
    private getFeatureName(filePath: string): string {
        const dir = path.dirname(filePath);
        const dirName = path.basename(dir);

        // If we're in a specs subdirectory, use that as the feature name
        if (dirName && dirName !== '.' && dirName !== 'specs') {
            return dirName;
        }

        // Otherwise, try to extract from parent directory structure
        const parentDir = path.dirname(dir);
        const parentName = path.basename(parentDir);

        if (parentName && parentName !== '.' && parentName !== '.github') {
            return parentName;
        }

        return 'Spec Workflow';
    }

    /**
     * Get step identifier from filename
     */
    private getStepFromFileName(fileName: string): string {
        const name = fileName.toLowerCase();
        if (name.includes('requirements')) return 'requirements';
        if (name.includes('design')) return 'design';
        if (name.includes('tasks')) return 'tasks';
        return 'unknown';
    }

    /**
     * Get sort order for workflow steps
     */
    private getStepOrder(step: string): number {
        switch (step) {
            case 'requirements': return 1;
            case 'design': return 2;
            case 'tasks': return 3;
            default: return 999; // Unknown files at the end
        }
    }

    /**
     * Get human-readable label for step
     */
    private getStepLabel(step: string): string {
        switch (step) {
            case 'requirements': return '01 - Requirements';
            case 'design': return '02 - Design';
            case 'tasks': return '03 - Tasks';
            default: return 'Document';
        }
    }

    /**
     * Open a file in the editor
     */
    private async openFile(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    }
}
