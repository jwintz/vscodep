import { WorkflowStage, WorkflowStatus } from '../types/workflow';

/**
 * Validate if a string is a valid workflow stage
 */
export function isValidWorkflowStage(stage: string): stage is WorkflowStage {
    const validStages: WorkflowStage[] = [
        '01-requirements',
        '02-design',
        '03-tasks'
    ];
    return validStages.includes(stage as WorkflowStage);
}

/**
 * Validate if a string is a valid workflow status
 */
export function isValidWorkflowStatus(status: string): status is WorkflowStatus {
    const validStatuses: WorkflowStatus[] = [
        'active',
        'completed',
        'paused',
        'cancelled'
    ];
    return validStatuses.includes(status as WorkflowStatus);
}

/**
 * Validate feature name format
 */
export function isValidFeatureName(name: string): boolean {
    // Feature name should be alphanumeric with hyphens and underscores
    const pattern = /^[a-zA-Z0-9_-]+$/;
    return pattern.test(name) && name.length >= 3 && name.length <= 50;
}

/**
 * Sanitize file path to prevent directory traversal
 */
export function sanitizeFilePath(filePath: string): string {
    // Remove any attempts at directory traversal
    return filePath.replace(/\.\./g, '').replace(/\/+/g, '/');
}

/**
 * Validate if file path is within allowed directories
 */
export function isAllowedFilePath(
    filePath: string,
    workspaceRoot: string,
    allowedDirs: string[] = ['.github']
): boolean {
    const normalizedPath = sanitizeFilePath(filePath);
    return allowedDirs.some(dir =>
        normalizedPath.startsWith(`${workspaceRoot}/${dir}`) ||
        normalizedPath.startsWith(`${workspaceRoot}\\${dir}`)
    );
}
