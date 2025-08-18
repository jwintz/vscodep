import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
    try {
        const uri = vscode.Uri.file(dirPath);
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.type === vscode.FileType.Directory;
    } catch {
        return false;
    }
}

/**
 * Read file content safely with error handling
 */
export async function readFileContent(filePath: string): Promise<string> {
    try {
        const uri = vscode.Uri.file(filePath);
        const bytes = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder('utf-8').decode(bytes);
    } catch (error) {
        throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
}

/**
 * Get file modification time
 */
export async function getFileModTime(filePath: string): Promise<number> {
    try {
        const uri = vscode.Uri.file(filePath);
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.mtime;
    } catch {
        return 0;
    }
}

/**
 * Recursively find all files in a directory with specific extensions
 */
export async function findFilesRecursive(
    dirPath: string,
    extensions: string[] = ['.md', '.txt']
): Promise<string[]> {
    const files: string[] = [];

    try {
        const uri = vscode.Uri.file(dirPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);

        for (const [name, type] of entries) {
            const fullPath = path.join(dirPath, name);

            if (type === vscode.FileType.Directory) {
                const subFiles = await findFilesRecursive(fullPath, extensions);
                files.push(...subFiles);
            } else if (type === vscode.FileType.File && extensions.some(ext => name.endsWith(ext))) {
                files.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dirPath}:`, error);
    }

    return files;
}

/**
 * Normalize path separators for cross-platform compatibility
 */
export function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

/**
 * Get relative path from workspace root
 */
export function getRelativePath(workspaceRoot: string, filePath: string): string {
    return path.relative(workspaceRoot, filePath);
}

/**
 * Find spec workflow files in a directory
 */
export async function findSpecFiles(dirPath: string): Promise<string[]> {
    const specFilePatterns = [
        '*requirements*.md',
        '*design*.md',
        '*tasks*.md'
    ];

    const files: string[] = [];

    try {
        const uri = vscode.Uri.file(dirPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);

        for (const [name, type] of entries) {
            if (type === vscode.FileType.File) {
                const lowerName = name.toLowerCase();
                const matchingPattern = specFilePatterns.find(pattern => {
                    // Convert glob pattern to regex
                    const regexPattern = pattern
                        .replace(/\*/g, '.*')
                        .replace(/\./g, '\\.');
                    const regex = new RegExp(`^${regexPattern}$`);
                    return regex.test(lowerName);
                });
                if (matchingPattern) {
                    files.push(path.join(dirPath, name));
                }
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dirPath}:`, error);
    }

    return files;
}/**
 * Find all spec feature directories in .github/specs
 */
export async function findSpecDirectories(): Promise<{ name: string, path: string; }[]> {
    const features: { name: string, path: string; }[] = [];

    // Find workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return features;
    }

    const specsPath = path.join(workspaceFolder.uri.fsPath, '.github', 'specs');
    console.log('Searching for spec directories in:', specsPath);

    try {
        const uri = vscode.Uri.file(specsPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);

        for (const [name, type] of entries) {
            if (type === vscode.FileType.Directory) {
                const dirPath = path.join(specsPath, name);
                // Check if this directory contains spec files
                const specFiles = await findSpecFiles(dirPath);
                if (specFiles.length > 0) {
                    features.push({ name, path: dirPath });
                }
            }
        }

        console.log('Found spec features:', features);
    } catch (error) {
        console.error(`Error reading specs directory ${specsPath}:`, error);
    }

    return features;
}
