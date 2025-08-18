import { ConfigFile, ContextFilter } from './config';

/**
 * Workflow stages following the spec process
 */
export type WorkflowStage =
    | '01-requirements'
    | '02-design'
    | '03-tasks';

/**
 * Workflow status states
 */
export type WorkflowStatus = 'active' | 'completed' | 'paused' | 'cancelled';

/**
 * Individual step within a workflow
 */
export interface WorkflowStep {
    id: string;
    stage: WorkflowStage;
    timestamp: Date;
    description: string;
    context?: any;
}

/**
 * User preferences for workflow behavior
 */
export interface WorkflowPreferences {
    autoSave: boolean;
    maxContextSize: number;
    preferredPromptStyle: string;
    customFilters: ContextFilter[];
}

/**
 * Context information for the current workspace
 */
export interface WorkspaceContext {
    workspaceRoot: string;
    activeFiles: string[];
    currentDirectory: string;
    projectType?: string;
    gitBranch?: string;
}

/**
 * Full context for a workflow
 */
export interface WorkflowContext {
    workspaceRoot: string;
    relevantFiles: string[];
    configContext: ConfigFile[];
    userPreferences: WorkflowPreferences;
    aiContext?: string;
}

/**
 * Complete workflow state
 */
export interface WorkflowState {
    id: string;
    featureName: string;
    currentStage: WorkflowStage;
    context: WorkflowContext;
    history: WorkflowStep[];
    createdAt: Date;
    lastModified: Date;
    status: WorkflowStatus;
}
